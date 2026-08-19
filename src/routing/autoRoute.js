// ── 도로 따라 공급관 자동 연결 ──
// 도로명주소 도로구간(중심선) 위에서, 기존관을 공급원으로 삼아 모든 수요처의
// '집 앞 도로'까지 최소 연장으로 잇는 공급관을 만든다.
// 인입관(도로↔건물)은 현장 판단이 필요해 기본은 생성하지 않는다.
// 옵션을 켜면 스냅점→마커 직선을 '참조용'으로 그린다(필지 경계 미반영 → 부정확).
// 전체가 히스토리 한 칸이라 Ctrl+Z 한 번에 되돌아간다.
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { getState, addPipe, beginBatch, endBatch } from '../state/store.js';
import { fetchRoads, ROADS_READY } from './roads.js';
import { toSegments, buildGraph, buildNetwork, edgesToPolylines, pruneLeaves } from './graph.js';

const SUPPLY_DIA = '110A';
const INLET_DIA = '63A';
const MARGIN = 300; // 마커/기존관 bbox 여유(m)

const SOURCE_STEP = 8;    // 기존관 위 분기 가능 지점 간격(m)
const MAX_SOURCE_PTS = 4000;

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

export async function runAutoRoute({ inlet = false } = {}) {
  const { demands, pipes } = getState();
  const targets = demands.filter((d) => Number.isFinite(d.lon) && Number.isFinite(d.lat));
  if (!targets.length) { setStatus('연결할 수요처가 없습니다.'); return; }
  if (!ROADS_READY) {
    setStatus('도로 데이터 주소가 설정되지 않았습니다 — Cloudflare 환경변수 VITE_ROADS_URL 확인');
    return;
  }

  // 공급원: 기존관을 일정 간격으로 샘플링 → 기존관 어느 지점에서든 분기 가능
  const sourcePts = existingPipePoints(pipes);

  const t0 = openOverlay('공급관 자동 연결');
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
  const idAt = (i) => { const s = g.snaps[i]; return s ? g.idOf(s.point) : undefined; };
  const termIds = markerPts.map((_, i) => idAt(i)).map((v) => (v === undefined ? -1 : v));
  const srcIds = sourcePts.map((_, i) => idAt(markerPts.length + i)).map((v) => (v === undefined ? -1 : v));

  phase(`최소 연결 경로 계산 중… (수요처 ${targets.length}곳)`, 70, '', t0);
  await tick();
  const { used, unreachable } = buildNetwork(g.adj, srcIds, termIds);
  // 어떤 수요처/공급원에도 닿지 않는 막다른 곁가지 제거
  const keep = new Set([...termIds, ...srcIds].filter((v) => v >= 0));
  const mains = edgesToPolylines(pruneLeaves(used, keep), g.coords);

  // 연결 못 한 수요처 번호 (표시용)
  const idToTargets = new Map();
  termIds.forEach((id, i) => {
    if (id < 0) return;
    if (!idToTargets.has(id)) idToTargets.set(id, []);
    idToTargets.get(id).push(i + 1);
  });
  const missNos = [];
  termIds.forEach((id, i) => { if (id < 0) missNos.push(i + 1); });
  for (const id of unreachable) for (const n of idToTargets.get(id) || []) missNos.push(n);
  missNos.sort((a, b) => a - b);

  phase('배관 생성 중…', 90, '', t0);
  await tick();

  // 공급관 + (선택)참조용 인입관 생성 — 전체를 히스토리 한 칸으로
  beginBatch();
  let total = 0, count = 0, inletN = 0, inletLen = 0;
  try {
    for (const line of mains) {
      if (line.length < 2) continue;
      total += lenOf(line);
      count++;
      const coords = line.map((c) => toLonLat(c));
      addPipe({
        coords,
        segs: Array.from({ length: coords.length - 1 }, () => ({ ...DEFAULT_ATTR, use: 'supply', diameter: SUPPLY_DIA })),
      });
    }

    // 참조용 인입관: 도로 스냅점 → 마커 직선. 필지 경계를 보지 않으므로 위치는 부정확하다.
    // 실제 인입 위치를 잡을 때 눈대중 기준으로만 쓰고, 반드시 직접 수정해야 한다.
    if (inlet) {
      targets.forEach((d, i) => {
        const snap = g.snaps[i];
        if (!snap) return;
        const p = markerPts[i];
        const dist = Math.hypot(p[0] - snap.point[0], p[1] - snap.point[1]);
        if (dist < 0.5) return;
        inletLen += dist;
        inletN++;
        addPipe({
          coords: [toLonLat(snap.point), toLonLat(p)], // 공급관 → 마커 방향
          segs: [{ ...DEFAULT_ATTR, use: 'inlet', diameter: INLET_DIA, markerNo: String(i + 1) }],
        });
      });
    }
  } finally {
    endBatch();
    closeOverlay();
  }

  setStatus(
    `완료 — 공급관 ${count}개 · 총 ${Math.round(total).toLocaleString()}m`
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
    const inlet = document.getElementById('ar-inlet')?.checked === true;
    try { await runAutoRoute({ inlet }); }
    catch (err) { closeOverlay(); setStatus(`실패: ${err.message}`); }
    finally { closeOverlay(); btn.disabled = false; }
  });
}
