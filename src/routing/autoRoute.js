// ── 토지(소유구분) 기반 수요처 자동 연결 ──
// 도로 중심선 대신 "지날 수 있는 땅" 위에서 경로를 찾는다.
//   공유지(국·도·시·군유) → 통행 가능 (지목 도/구면 더 싸게)
//   사유지               → 비싸게 (지상권 협의 필요, 짧게만)
//   공원·학교 등 시설    → 차단
// 경로 중 '수요처 필지 안'은 인입관, 나머지는 공급관으로 나눠 생성한다.
// 전체가 히스토리 한 칸이라 Ctrl+Z 한 번에 되돌아간다.
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { getState, addPipe, updateDemand, beginBatch, endBatch } from '../state/store.js';
import { getParcelsInBox, getPossession, isPublicLand } from '../api/vworld.js';
import { costOf, COST, rasterize, pointInRings, nearestOpen, fieldFrom, tracePath, simplify, toCell } from './landGraph.js';

const SUPPLY_DIA = '110A';
const INLET_DIA = '63A';
const MARGIN = 150;        // 마커 bbox 여유(m)
const CELL = 4;            // 격자 한 칸(m)
const MAX_CELLS = 400000;  // 격자 상한 (넘으면 셀을 키움)
const CONCURRENCY = 8;

const setStatus = (t) => { const el = document.getElementById('ar-status'); if (el) el.textContent = t; };

// ── 진행 오버레이 ──
let cancelled = false;
function openOverlay(title) {
  cancelled = false;
  let el = document.getElementById('probe-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'probe-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="pb-box">
      <div class="pb-title">${title}</div>
      <div class="pb-phase" id="pb-phase">준비 중…</div>
      <div class="pb-bar"><i id="pb-fill"></i></div>
      <div class="pb-meta"><span id="pb-count"></span><span id="pb-time">0.0초</span></div>
      <button class="pb-cancel" id="pb-cancel">중단</button>
    </div>`;
  el.classList.remove('hidden');
  document.getElementById('pb-cancel').onclick = () => { cancelled = true; };
  return performance.now();
}
function closeOverlay() { document.getElementById('probe-overlay')?.classList.add('hidden'); }
function phase(t) { const e = document.getElementById('pb-phase'); if (e) e.textContent = t; }
function progress(done, total, t0) {
  const f = document.getElementById('pb-fill');
  if (f) f.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  const c = document.getElementById('pb-count');
  if (c) c.textContent = total ? `${done.toLocaleString()} / ${total.toLocaleString()}` : '';
  const t = document.getElementById('pb-time');
  if (t) t.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}초`;
}
const tick = () => new Promise((r) => setTimeout(r));

async function mapLimit(arr, limit, fn) {
  let i = 0;
  async function worker() { for (let k = i++; k < arr.length; k = i++) { if (cancelled) return; await fn(arr[k], k); } }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
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

// 마커들을 감싸는 영역 (화면과 무관)
function targetExtent(targets) {
  const pts = targets.map((d) => fromLonLat([d.lon, d.lat]));
  for (const p of getState().pipes) for (const c of p.coords) pts.push(fromLonLat(c));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return [minX - MARGIN, minY - MARGIN, maxX + MARGIN, maxY + MARGIN];
}

export async function runAutoRoute({ supply = true, inlet = true } = {}) {
  const { demands, pipes } = getState();
  const targets = demands.filter((d) => Number.isFinite(d.lon) && Number.isFinite(d.lat));
  if (!targets.length) { setStatus('연결할 수요처가 없습니다.'); return; }
  if (!supply && !inlet) { setStatus('공급관·인입관 중 하나는 켜야 합니다.'); return; }

  const t0 = openOverlay('토지 기반 자동 연결');
  try {
    const ext = targetExtent(targets);
    const [lo, hi] = [toLonLat([ext[0], ext[1]]), toLonLat([ext[2], ext[3]])];

    // 1) 영역 내 필지 일괄 조회
    phase('필지 조회 중…');
    await tick();
    const raw = await getParcelsInBox([lo[0], lo[1], hi[0], hi[1]]);
    if (cancelled) { setStatus('중단됨'); return; }
    if (!raw.length) { setStatus('이 영역의 필지를 받지 못했습니다 (VWorld 키·범위를 확인하세요).'); return; }

    // 2) 소유구분 조회
    phase(`소유구분 조회 중… (필지 ${raw.length.toLocaleString()}개)`);
    await tick();
    const own = new Map();
    let done = 0;
    await mapLimit(raw, CONCURRENCY, async (p) => {
      const o = await getPossession(p.pnu).catch(() => null);
      own.set(p.pnu, o ? isPublicLand(o.code, o.name) : null);
      done++;
      if (done % 20 === 0 || done === raw.length) progress(done, raw.length, t0);
    });
    if (cancelled) { setStatus('중단됨'); return; }

    // 3) 격자 래스터화
    phase('통행 가능 구역 계산 중…');
    await tick();
    let cell = CELL;
    while (((ext[2] - ext[0]) / cell) * ((ext[3] - ext[1]) / cell) > MAX_CELLS) cell *= 1.5;

    const parcels = raw.map((p) => ({
      pnu: p.pnu,
      rings: ringsOf(p.geometry),
      cost: costOf({ jimok: p.jimok, isPublic: own.get(p.pnu) }),
      isPublic: own.get(p.pnu),
    }));
    // 수요처가 속한 필지는 목적지이므로 통행 허용
    const targetParcel = new Map(); // demand index → parcel index
    targets.forEach((d, di) => {
      const pt = fromLonLat([d.lon, d.lat]);
      for (let pi = 0; pi < parcels.length; pi++) {
        if (parcels[pi].rings.length && pointInRings(pt, parcels[pi].rings)) {
          targetParcel.set(di, pi);
          if (!parcels[pi].cost) parcels[pi].cost = COST.otherPublic; // 차단이었어도 목적지는 진입 허용
          break;
        }
      }
    });

    const r = rasterize(parcels, ext, cell);

    // 4) 공급원: 기존관 꼭짓점, 없으면 가장 '싼 땅'에 있는 수요처
    const startIdxs = [];
    for (const p of pipes) {
      for (let i = 0; i < p.segs.length; i++) {
        if (p.segs[i].status !== 'existing') continue;
        for (const c of [p.coords[i], p.coords[i + 1]]) {
          const o = nearestOpen(r, fromLonLat(c));
          if (o) startIdxs.push(o.idx);
        }
      }
    }
    const markerCells = targets.map((d) => nearestOpen(r, fromLonLat([d.lon, d.lat])));
    if (!startIdxs.length) {
      const first = markerCells.find(Boolean);
      if (!first) { setStatus('통행 가능한 땅을 찾지 못했습니다.'); return; }
      startIdxs.push(first.idx);
    }

    // 5) 순차적으로 가장 가까운 수요처를 흡수 (경로 재사용 → 총 연장 최소화)
    phase('경로 계산 중…');
    await tick();
    const connected = new Set(startIdxs);
    const remaining = new Set(markerCells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0));
    const paths = [];        // { di, pts }
    const unreachable = [];
    let step = 0;
    const totalSteps = remaining.size;

    while (remaining.size) {
      if (cancelled) break;
      const { dist, prev } = fieldFrom(r, [...connected]);
      let best = -1, bestD = Infinity;
      for (const di of remaining) {
        const d = dist[markerCells[di].idx];
        if (d < bestD) { bestD = d; best = di; }
      }
      if (best < 0 || !Number.isFinite(bestD)) { unreachable.push(...remaining); break; }
      const pts = tracePath(r, prev, markerCells[best].idx);
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i];
        const [gx, gy] = toCell(r, [x, y]);
        connected.add(gy * r.w + gx);
      }
      paths.push({ di: best, pts });
      remaining.delete(best);
      step++;
      progress(step, totalSteps, t0);
      if (step % 5 === 0) await tick();
    }

    // 6) 경로를 공급관/인입관으로 나눠 생성
    phase('배관 생성 중…');
    await tick();
    beginBatch();
    let supplyLen = 0, inletLen = 0, supplyN = 0, inletN = 0;
    const reviewed = [];

    for (const { di, pts } of paths) {
      const pi = targetParcel.get(di);
      const rings = pi !== undefined ? parcels[pi].rings : null;
      // 경로를 '수요처 필지 밖(공급관)' / '안(인입관)'으로 분할
      let cut = pts.length;
      if (rings && rings.length) {
        for (let i = 0; i < pts.length; i++) {
          if (pointInRings(pts[i], rings)) { cut = i; break; }
        }
      }
      const head = simplify(pts.slice(0, Math.max(2, cut + 1)), cell * 0.8);
      const tail = cut < pts.length ? simplify(pts.slice(Math.max(0, cut - 1)), cell * 0.8) : [];

      if (supply && head.length >= 2) {
        const coords = head.map((c) => toLonLat(c));
        supplyLen += lenOf(head); supplyN++;
        addPipe({ coords, segs: Array.from({ length: coords.length - 1 }, () => ({ ...DEFAULT_ATTR, use: 'supply', diameter: SUPPLY_DIA })) });
      }
      if (inlet && tail.length >= 2) {
        const coords = tail.map((c) => toLonLat(c));
        inletLen += lenOf(tail); inletN++;
        addPipe({ coords, segs: Array.from({ length: coords.length - 1 }, () => ({ ...DEFAULT_ATTR, use: 'inlet', diameter: INLET_DIA, markerNo: String(di + 1) })) });
      }

      // 사유지를 지나야 했는지 검사 → 검토 표시
      let crossesPrivate = false;
      for (const p of pts) {
        const [gx, gy] = toCell(r, p);
        const oi = r.owner[gy * r.w + gx];
        if (oi >= 0 && oi !== pi && parcels[oi].isPublic === false) { crossesPrivate = true; break; }
      }
      if (crossesPrivate) {
        reviewed.push(di + 1);
        const d = targets[di];
        const tag = '[자동연결] 사유지 통과 구간 있음 — 지상권 검토 필요';
        const memo = (d.memo || '').trim();
        if (!memo.includes(tag)) updateDemand(d.id, { memo: memo ? `${memo}\n${tag}` : tag });
      }
    }
    for (const di of unreachable) {
      const d = targets[di];
      const tag = '[자동연결] 통행 가능한 경로를 찾지 못함 — 검토 필요';
      const memo = (d.memo || '').trim();
      if (!memo.includes(tag)) updateDemand(d.id, { memo: memo ? `${memo}\n${tag}` : tag });
    }
    endBatch();

    const total = Math.round(supplyLen + inletLen);
    setStatus(
      `완료 — 공급관 ${supplyN}개 ${Math.round(supplyLen).toLocaleString()}m · 인입관 ${inletN}개 ${Math.round(inletLen).toLocaleString()}m · 총 ${total.toLocaleString()}m`
      + (reviewed.length ? ` · 사유지 통과 ${reviewed.length}곳(메모)` : '')
      + (unreachable.length ? ` · 경로없음 ${unreachable.length}곳` : '')
      + (cancelled ? ' [중단됨]' : '') + ' · Ctrl+Z로 되돌리기'
    );
  } catch (err) {
    setStatus(`실패: ${err.message}`);
  } finally {
    closeOverlay();
  }
}

// GeoJSON → 3857 링 배열
function ringsOf(geometry) {
  if (!geometry) return [];
  const out = [];
  const push = (ring) => {
    const pts = ring.map((c) => fromLonLat(c));
    if (pts.length >= 3) out.push(pts);
  };
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(push);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => poly.forEach(push));
  return out;
}

export function initAutoRoute() {
  const btn = document.getElementById('ar-run');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const supply = document.getElementById('ar-supply')?.checked !== false;
    const inlet = document.getElementById('ar-inlet')?.checked !== false;
    btn.disabled = true;
    try { await runAutoRoute({ supply, inlet }); }
    catch (err) { setStatus(`실패: ${err.message}`); }
    finally { btn.disabled = false; }
  });
}
