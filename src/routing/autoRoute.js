// ── 도로 따라 공급관 자동 연결 ──
// 도로명주소 도로구간(중심선) 위에서, 기존관을 공급원으로 삼아 모든 수요처의
// '집 앞 도로'까지 최소 연장으로 잇는 공급관을 만든다.
// 인입관(도로↔건물)은 현장 판단이 필요해 기본은 생성하지 않는다.
// 옵션을 켜면 스냅점→마커 직선을 '참조용'으로 그린다(필지 경계 미반영 → 부정확).
// 전체가 히스토리 한 칸이라 Ctrl+Z 한 번에 되돌아간다.
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { getState, addPipe, insertVertex, beginBatch, endBatch } from '../state/store.js';
import { fetchRoads, ROADS_READY } from './roads.js';
import { toSegments, buildGraph, buildNetwork, edgesToPolylines, pruneLeaves } from './graph.js';

const SUPPLY_DIA = '110A';
const INLET_DIA = '63A';
const MARGIN = 300; // 마커/기존관 bbox 여유(m)

const SOURCE_STEP = 8;    // 기존관 위 분기 가능 지점 간격(m)
const MAX_SOURCE_PTS = 4000;
const VERTEX_MERGE = 3.5;   // 결과 꼭짓점 병합 반경(m) — 교차로 점 뭉침 방지
const EX_ATTACH_MAX = 60;   // 공급관을 기존관에 붙일 최대 거리(m)

const setStatus = (t) => { const el = document.getElementById('ar-status'); if (el) el.textContent = t; };

// ── 진행 오버레이 (계산 중 조작 차단) ──
function openOverlay(title) {
  let el = document.getElementById('probe-overlay');
  if (!el) { el = document.createElement('div'); el.id = 'probe-overlay'; document.body.appendChild(el); }
  el.innerHTML = `
    <div class="pb-box">
      <div class="pb-title">${title}</div>
      <div class="pb-phase" id="pb-phase">준비 중…</div>
      <div class="pb-bar"><i id="pb-fill"></i></div>
      <div class="pb-meta"><span id="pb-count"></span><span id="pb-time">0.0초</span></div>
    </div>`;
  el.classList.remove('hidden');
  return performance.now();
}
const closeOverlay = () => document.getElementById('probe-overlay')?.classList.add('hidden');
function phase(text, pct, count, t0) {
  const p = document.getElementById('pb-phase'); if (p) p.textContent = text;
  const f = document.getElementById('pb-fill'); if (f && pct != null) f.style.width = `${pct}%`;
  const c = document.getElementById('pb-count'); if (c) c.textContent = count || '';
  const t = document.getElementById('pb-time'); if (t && t0) t.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}초`;
}
const tick = () => new Promise((r) => setTimeout(r));

// 기존관 위를 일정 간격으로 촘촘히 샘플링 → 기존관 '아무 지점'에서도 분기 가능
function existingPipePoints(pipes) {
  const pts = [];
  for (const p of pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      if (p.segs[i].status !== 'existing') continue;
      const a = fromLonLat(p.coords[i]);
      const b = fromLonLat(p.coords[i + 1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / SOURCE_STEP));
      for (let k = 0; k <= n; k++) {
        pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        if (pts.length >= MAX_SOURCE_PTS) return pts;
      }
    }
  }
  return pts;
}

const DEFAULT_ATTR = {
  material: 'PE', diameter: SUPPLY_DIA, use: 'supply', pressure: '저압',
  status: 'planned', review: 'target', pavement: 'asphalt', section: 1, markerNo: '',
};

const ptKey = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

// 도로 형상을 따라온 폴리라인의 불필요한 꼭짓점 제거 (Douglas-Peucker).
// 갈래는 별도 폴리라인으로 나뉘어 있어 분기점(양 끝)은 항상 보존된다.
function simplify(pts, tol, protectedKeys = null) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  // 인입관이 붙는 접점 등은 지우면 안 된다 (지우면 인입관이 공급관에서 떨어진다)
  if (protectedKeys) {
    for (let i = 0; i < pts.length; i++) {
      if (protectedKeys.has(ptKey(pts[i]))) keep[i] = 1;
    }
  }
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j <= i + 1) continue;
    const a = pts[i], b = pts[j];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const len = Math.hypot(vx, vy) || 1;
    let far = -1, farD = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - a[0]) * vy - (pts[k][1] - a[1]) * vx) / len;
      if (d > farD) { farD = d; far = k; }
    }
    if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const lenOf = (ll) => {
  let s = 0;
  for (let i = 0; i < ll.length - 1; i++) s += Math.hypot(ll[i + 1][0] - ll[i][0], ll[i + 1][1] - ll[i][1]);
  return s;
};

// 마커 + 기존관을 모두 포함하는 영역 (화면 위치와 무관)
function dataBBox(targets) {
  const pts = targets.map((d) => fromLonLat([d.lon, d.lat]));
  for (const p of getState().pipes) for (const c of p.coords) pts.push(fromLonLat(c));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const [lo, hi] = [toLonLat([minX - MARGIN, minY - MARGIN]), toLonLat([maxX + MARGIN, maxY + MARGIN])];
  return [lo[0], lo[1], hi[0], hi[1]];
}

export async function runAutoRoute({ supply = true, inlet = false } = {}) {
  const { demands, pipes } = getState();
  const targets = demands.filter((d) => Number.isFinite(d.lon) && Number.isFinite(d.lat));
  if (!targets.length) { setStatus('연결할 수요처가 없습니다.'); return; }
  if (!supply && !inlet) { setStatus('공급관·인입관 중 하나는 켜야 합니다.'); return; }
  if (!ROADS_READY) {
    setStatus('도로 데이터 주소가 설정되지 않았습니다 — Cloudflare 환경변수 VITE_ROADS_URL 확인');
    return;
  }

  // 공급원: 기존관을 일정 간격으로 샘플링 → 기존관 어느 지점에서든 분기 가능
  const sourcePts = existingPipePoints(pipes);

  const t0 = openOverlay('자동 연결');
  phase('도로 데이터 불러오는 중…', 10, '', t0);
  await tick();
  setStatus('도로 데이터 불러오는 중…');
  let lines;
  try {
    lines = await fetchRoads(dataBBox(targets), (d, t) => setStatus(`도로 데이터 불러오는 중… ${d}/${t}`));
  } catch (err) {
    closeOverlay();
    setStatus(`도로 조회 실패: ${err.message}`);
    return;
  }
  if (!lines.length) {
    closeOverlay();
    setStatus('이 지역의 도로 데이터가 없습니다 (해당 시군구를 R2에 올렸는지 확인).');
    return;
  }

  phase(`도로망 구성 중… (도로 ${lines.length.toLocaleString()}개)`, 40, '', t0);
  setStatus(`도로 ${lines.length.toLocaleString()}개 · 경로 계산 중…`);
  await tick();

  // 도로망 그래프 + 마커/기존관 스냅 → 최소 연결망
  const segs = toSegments(lines.map((ln) => ln.map((c) => fromLonLat(c))));
  const markerPts = targets.map((d) => fromLonLat([d.lon, d.lat]));
  const g = buildGraph(segs, [...markerPts, ...sourcePts]);

  // 수요처마다 스냅 후보 여러 곳 → 총 연장이 가장 짧아지는 곳을 알고리즘이 고른다
  const groups = markerPts.map((_, i) => (g.snapSets[i] || [])
    .map((s) => ({ id: g.idOf(s.point), extra: s.dist }))
    .filter((c) => c.id !== undefined));
  const srcIds = sourcePts.map((_, i) => {
    const s = g.snaps[markerPts.length + i];
    const id = s ? g.idOf(s.point) : undefined;
    return id === undefined ? -1 : id;
  });

  phase(`최소 연결 경로 계산 중… (수요처 ${targets.length}곳)`, 70, '', t0);
  await tick();
  const { used, unreachable, chosen } = buildNetwork(g.adj, srcIds, groups);

  // 기존관 스냅점 → 실제 기존관 좌표 (공급관이 기존관에 맞물리도록 잇는 데 사용)
  const srcAnchor = new Map();
  sourcePts.forEach((pt, i) => {
    const sn = g.snaps[markerPts.length + i];
    if (!sn) return;
    const id = g.idOf(sn.point);
    if (id === undefined) return;
    const d = Math.hypot(pt[0] - sn.point[0], pt[1] - sn.point[1]);
    const cur = srcAnchor.get(id);
    if (!cur || d < cur.d) srcAnchor.set(id, { pt, d });
  });

  // 어떤 수요처/공급원에도 닿지 않는 막다른 곁가지 제거
  const keep = new Set([...chosen.filter((v) => v >= 0), ...srcIds.filter((v) => v >= 0)]);
  const mains = edgesToPolylines(pruneLeaves(used, keep), g.coords);

  // 연결 못 한 수요처 번호 (표시용)
  const missNos = [];
  chosen.forEach((id, i) => { if (id < 0) missNos.push(i + 1); });
  missNos.sort((a, b) => a - b);

  phase('배관 생성 중…', 90, '', t0);
  await tick();

  // ── 공급관 폴리라인 확정 ──
  const tol = inlet ? 1.5 : 4.0;
  let supplyLines = [];
  if (supply) {
    for (const raw of mains) {
      if (raw.length < 2) continue;
      supplyLines.push(simplify(raw, tol));
    }
  }

  // ── 결과 전체에 걸쳐 가까운 꼭짓점 병합 ──
  // 교차로에서는 도로 선분이 여러 개라 선분별 병합만으로는 점이 뭉쳐 남는다.
  // 생성된 모든 폴리라인의 꼭짓점을 한꺼번에 묶어 대표점 하나로 통일한다.
  {
    const reps = [];                       // 대표점 목록
    const repOf = (pt) => {
      for (const r of reps) {
        if (Math.hypot(r[0] - pt[0], r[1] - pt[1]) <= VERTEX_MERGE) return r;
      }
      reps.push(pt);
      return pt;
    };
    supplyLines = supplyLines.map((line) => {
      const out = [];
      for (const pt of line) {
        const r = repOf(pt);
        const last = out[out.length - 1];
        if (last && Math.hypot(last[0] - r[0], last[1] - r[1]) < 0.05) continue; // 중복 제거
        out.push(r);
      }
      return out;
    }).filter((l) => l.length >= 2 && lenOf(l) > 1); // 길이 없는 토막 제거
  }

  // ── 기존관과 접점 공유 ──
  // 공급관 끝점을 기존관 위 정확한 지점으로 맞추고, 기존관에도 그 점을 꼭짓점으로 넣는다.
  const exInserts = []; // { pipeId, seg, lonlat }
  {
    const exPipes = getState().pipes.filter((p) => p.segs.some((sg) => sg.status === 'existing'));
    const nearestOnPipe = (m) => {
      let best = null;
      for (const p of exPipes) {
        for (let i = 0; i < p.segs.length; i++) {
          if (p.segs[i].status !== 'existing') continue;
          const a = fromLonLat(p.coords[i]), b = fromLonLat(p.coords[i + 1]);
          const vx = b[0] - a[0], vy = b[1] - a[1];
          const l2 = vx * vx + vy * vy;
          let t = l2 ? ((m[0] - a[0]) * vx + (m[1] - a[1]) * vy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const q = [a[0] + vx * t, a[1] + vy * t];
          const d = Math.hypot(m[0] - q[0], m[1] - q[1]);
          if (!best || d < best.d) best = { pipeId: p.id, seg: i, point: q, d };
        }
      }
      return best;
    };
    for (const line of supplyLines) {
      for (const endIdx of [0, line.length - 1]) {
        if (!srcAnchor.has(g.idOf(line[endIdx]))) continue; // 기존관에서 나온 끝점만
        const hit = nearestOnPipe(line[endIdx]);
        if (!hit || hit.d > EX_ATTACH_MAX) continue;
        line[endIdx] = hit.point;                       // 끝점을 기존관 위로 정확히
        exInserts.push({ ...hit, lonlat: toLonLat(hit.point) });
      }
    }
  }

  // ── 인입관: 공급관에 수직으로 내리고, 발점을 공급관 꼭짓점으로 삽입 ──
  const attachTargets = supplyLines.map((line) => ({ line, insert: [] }));
  const drawnBase = attachTargets.length;
  if (inlet) {
    for (const p of getState().pipes) {
      let run = null;
      for (let i = 0; i < p.segs.length; i++) {
        if (p.segs[i].use !== 'supply' && p.segs[i].status !== 'existing') { run = null; continue; }
        if (!run) { run = [fromLonLat(p.coords[i])]; attachTargets.push({ line: run, insert: null }); }
        run.push(fromLonLat(p.coords[i + 1]));
      }
    }
  }

  const footOn = (line, m) => {
    let best = null;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const l2 = vx * vx + vy * vy;
      let t = l2 ? ((m[0] - a[0]) * vx + (m[1] - a[1]) * vy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const q = [a[0] + vx * t, a[1] + vy * t];
      const d = Math.hypot(m[0] - q[0], m[1] - q[1]);
      if (!best || d < best.d) best = { seg: i, point: q, d };
    }
    return best;
  };

  const inlets = [];
  if (inlet && attachTargets.length) {
    markerPts.forEach((m, i) => {
      let best = null, bestIdx = -1;
      attachTargets.forEach((tg, ti) => {
        if (tg.line.length < 2) return;
        const f = footOn(tg.line, m);
        if (f && (!best || f.d < best.d)) { best = f; bestIdx = ti; }
      });
      if (!best || best.d < 0.5) return;
      inlets.push({ i, from: best.point, to: m, d: best.d });
      const tg = attachTargets[bestIdx];
      if (tg.insert) tg.insert.push({ seg: best.seg, point: best.point });
    });
    for (const tg of attachTargets) {
      if (!tg.insert || !tg.insert.length) continue;
      tg.insert.sort((a, b) => b.seg - a.seg);
      for (const ins of tg.insert) {
        const at = ins.seg + 1;
        const prev = tg.line[at - 1], next = tg.line[at];
        if (!prev || !next) continue;
        if (Math.hypot(prev[0] - ins.point[0], prev[1] - ins.point[1]) < 0.2) continue;
        if (Math.hypot(next[0] - ins.point[0], next[1] - ins.point[1]) < 0.2) continue;
        tg.line.splice(at, 0, ins.point);
      }
    }
  }

  // ── 생성 (전체를 히스토리 한 칸으로) ──
  beginBatch();
  let total = 0, count = 0, inletN = 0, inletLen = 0;
  try {
    // 기존관에 접점 꼭짓점 삽입 (뒤 구간부터 넣어야 인덱스가 밀리지 않음)
    exInserts.sort((a, b) => b.pipeId - a.pipeId || b.seg - a.seg);
    for (const ins of exInserts) insertVertex(ins.pipeId, ins.seg, ins.lonlat);

    for (let k = 0; k < drawnBase; k++) {
      const line = attachTargets[k].line;
      if (line.length < 2) continue;
      total += lenOf(line);
      count++;
      const coords = line.map((c) => toLonLat(c));
      addPipe({
        coords,
        segs: Array.from({ length: coords.length - 1 }, () => ({ ...DEFAULT_ATTR, use: 'supply', diameter: SUPPLY_DIA })),
      });
    }
    for (const it of inlets) {
      inletLen += it.d;
      inletN++;
      addPipe({
        coords: [toLonLat(it.from), toLonLat(it.to)],
        segs: [{ ...DEFAULT_ATTR, use: 'inlet', diameter: INLET_DIA, markerNo: String(it.i + 1) }],
      });
    }
  } finally {
    endBatch();
    closeOverlay();
  }

  setStatus(
    `완료 — ${supply ? `공급관 ${count}개 · ${Math.round(total).toLocaleString()}m` : '공급관 생략'}`
    + (inletN ? ` · 인입관 ${inletN}개 ${Math.round(inletLen).toLocaleString()}m (참조용·부정확, 직접 수정 필요)` : '')
    + (missNos.length ? ` · 못 이은 수요처 ${missNos.length}곳(#${missNos.join(', #')})` : '')
    + (srcIds.some((v) => v >= 0) ? '' : ' · 기존관이 없어 최소연결로 생성')
    + ' · Ctrl+Z로 되돌리기'
  );
}

export function initAutoRoute() {
  const btn = document.getElementById('ar-run');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const supply = document.getElementById('ar-supply')?.checked !== false;
    const inlet = document.getElementById('ar-inlet')?.checked === true;
    try { await runAutoRoute({ supply, inlet }); }
    catch (err) { closeOverlay(); setStatus(`실패: ${err.message}`); }
    finally { closeOverlay(); btn.disabled = false; }
  });
}
