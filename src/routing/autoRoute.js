// ── 도로 따라 수요처 자동 연결 (OSM 기반) ──
// 공급관: 기존관(status:'existing')을 공급원으로, 도로망 위에서 수요처들을 최소 연장으로 연결.
// 인입관: 이미 있는 공급관(직접 그린 것 포함)에서 각 수요처 '필지 경계까지'만 연결.
//         남의 토지를 가로지르지 않도록 필지 폴리곤을 받아 최근접 구간을 고른다.
// 공급관/인입관은 각각 켜고 끌 수 있고, 전체가 히스토리 한 칸(Ctrl+Z 한 번)으로 되돌아간다.
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { getState, addPipe, updateDemand, beginBatch, endBatch } from '../state/store.js';
import { fetchRoads } from './roads.js';
import { toSegments, buildGraph, buildNetwork, edgesToPolylines } from './graph.js';
import { getParcel } from '../api/vworld.js';
import { ringsOf, nearestSupplyToRings, segsNear } from './inlet.js';

const SUPPLY_DIA = '110A'; // 공급관 고정 관경
const INLET_DIA = '63A';   // 인입관 고정 관경
const INLET_SEARCH_R = 400; // 인입관 부착점 탐색 반경(m)

const setStatus = (t) => { const el = document.getElementById('ar-status'); if (el) el.textContent = t; };

function viewBBox(margin = 300) {
  const e = map.getView().calculateExtent(map.getSize());
  const [a, b] = [toLonLat([e[0] - margin, e[1] - margin]), toLonLat([e[2] + margin, e[3] + margin])];
  return [a[0], a[1], b[0], b[1]];
}

// 마커/기존 배관을 모두 포함하는 bbox (화면 밖 수요처도 놓치지 않도록)
function dataBBox(demands, margin = 300) {
  const pts = demands.filter((d) => Number.isFinite(d.lon)).map((d) => fromLonLat([d.lon, d.lat]));
  for (const p of getState().pipes) for (const c of p.coords) pts.push(fromLonLat(c));
  if (!pts.length) return viewBBox(margin);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const [lo, hi] = [toLonLat([minX - margin, minY - margin]), toLonLat([maxX + margin, maxY + margin])];
  return [lo[0], lo[1], hi[0], hi[1]];
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

// 현재 상태의 공급관(use:'supply') 폴리라인 — 인입관 부착 대상
function supplyPolylines() {
  const out = [];
  for (const p of getState().pipes) {
    let run = null;
    for (let i = 0; i < p.segs.length; i++) {
      if (p.segs[i].use !== 'supply') { run = null; continue; }
      if (!run) { run = [fromLonLat(p.coords[i])]; out.push(run); }
      run.push(fromLonLat(p.coords[i + 1]));
    }
  }
  return out;
}

// 동시 실행 제한 (필지 조회용)
async function mapLimit(arr, limit, fn) {
  let i = 0;
  async function worker() { for (let k = i++; k < arr.length; k = i++) await fn(arr[k], k); }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
}

// ── 1) 공급관 생성 ──
async function buildSupply(targets) {
  const sourcePts = [];
  for (const p of getState().pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      if (p.segs[i].status !== 'existing') continue;
      sourcePts.push(fromLonLat(p.coords[i]), fromLonLat(p.coords[i + 1]));
    }
  }

  setStatus('도로 데이터 불러오는 중…');
  let lines;
  try {
    lines = await fetchRoads(dataBBox(targets));
  } catch (err) {
    setStatus(`도로 조회 실패: ${err.message}`);
    return null;
  }
  if (!lines.length) {
    setStatus('이 영역에서 도로를 찾지 못했습니다. 지도를 도로가 있는 곳으로 옮겨 보세요.');
    return null;
  }

  setStatus(`도로 ${lines.length}개 · 경로 계산 중…`);
  await new Promise((r) => setTimeout(r));

  const segs = toSegments(lines.map((ln) => ln.map((c) => fromLonLat(c))));
  const markerPts = targets.map((d) => fromLonLat([d.lon, d.lat]));
  const g = buildGraph(segs, [...markerPts, ...sourcePts]);
  const idAt = (i) => { const s = g.snaps[i]; return s ? g.idOf(s.point) : undefined; };
  const termIds = markerPts.map((_, i) => idAt(i)).map((v) => (v === undefined ? -1 : v));
  const srcIds = sourcePts.map((_, i) => idAt(markerPts.length + i)).map((v) => (v === undefined ? -1 : v));

  const { used, unreachable } = buildNetwork(g.adj, srcIds, termIds);
  const mains = edgesToPolylines(used, g.coords);

  let total = 0;
  for (const line of mains) {
    if (line.length < 2) continue;
    total += lenOf(line);
    const coords = line.map((c) => toLonLat(c));
    addPipe({
      coords,
      segs: Array.from({ length: coords.length - 1 }, () => ({ ...DEFAULT_ATTR, use: 'supply', diameter: SUPPLY_DIA })),
    });
  }
  return { count: mains.length, total, unreachable: unreachable.length, hasSource: srcIds.some((v) => v >= 0) };
}

// ── 2) 인입관 생성 (공급관 → 필지 경계) ──
async function buildInlets(targets) {
  const supply = supplyPolylines();
  if (!supply.length) {
    setStatus('인입관을 뽑을 공급관이 없습니다. 공급관을 먼저 그리거나 함께 생성하세요.');
    return null;
  }

  setStatus(`필지 경계 조회 중… 0/${targets.length}`);
  const parcels = new Array(targets.length).fill(null);
  let done = 0;
  await mapLimit(targets, 5, async (d, i) => {
    try {
      const p = await getParcel(d.lon, d.lat);
      if (p?.geometry) parcels[i] = ringsOf(p.geometry, (c) => fromLonLat(c));
    } catch { /* 실패는 아래에서 직선 폴백 */ }
    done++;
    if (done % 5 === 0 || done === targets.length) setStatus(`필지 경계 조회 중… ${done}/${targets.length}`);
  });

  let made = 0, total = 0;
  const notes = []; // 특이사항(필지 못 찾음 → 마커까지 직선)
  targets.forEach((d, i) => {
    const marker = fromLonLat([d.lon, d.lat]);
    const near = segsNear(supply, marker, INLET_SEARCH_R);
    if (!near.length) return;

    const rings = parcels[i];
    let from = null, to = null, fallback = false;
    if (rings && rings.length) {
      const r = nearestSupplyToRings(near, rings);
      if (r) { from = r.from; to = r.to; }
    }
    if (!from) {
      // 필지를 못 받았으면 마커까지 직선으로 (특이사항 기록)
      let best = null;
      for (const s of near) {
        const pr = projectPoint(marker, s.a, s.b);
        if (!best || pr.dist < best.dist) best = pr;
      }
      if (!best) return;
      from = best.point; to = marker; fallback = true;
    }

    const dist = Math.hypot(from[0] - to[0], from[1] - to[1]);
    if (dist < 0.5) return; // 이미 붙어 있음
    total += dist;
    made++;
    addPipe({
      coords: [toLonLat(from), toLonLat(to)], // 공급관 → 필지(마커) 방향
      segs: [{ ...DEFAULT_ATTR, use: 'inlet', diameter: INLET_DIA, markerNo: String(i + 1) }],
    });
    if (fallback) {
      notes.push(i + 1);
      const memo = (d.memo || '').trim();
      const tag = '[자동연결] 필지 경계를 확인하지 못해 마커까지 직선으로 연결 — 토지 통과 여부 확인 필요';
      if (!memo.includes(tag)) updateDemand(d.id, { memo: memo ? `${memo}\n${tag}` : tag });
    }
  });
  return { made, total, notes };
}

function projectPoint(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + vx * t, a[1] + vy * t];
  return { point: q, dist: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

export async function runAutoRoute({ supply = true, inlet = true } = {}) {
  const { demands } = getState();
  const targets = demands.filter((d) => Number.isFinite(d.lon) && Number.isFinite(d.lat));
  if (!targets.length) { setStatus('연결할 수요처가 없습니다.'); return; }
  if (!supply && !inlet) { setStatus('공급관·인입관 중 하나는 켜야 합니다.'); return; }

  // 전체를 히스토리 한 칸으로 묶어 Ctrl+Z 한 번에 되돌리기
  beginBatch();
  try {
    const parts = [];
    let total = 0;

    if (supply) {
      const s = await buildSupply(targets);
      if (!s) return; // 상태 메시지는 buildSupply가 설정
      total += s.total;
      parts.push(`공급관 ${s.count}개`);
      if (s.unreachable) parts.push(`못 이은 수요처 ${s.unreachable}곳`);
      if (!s.hasSource) parts.push('기존관 없어 최소연결');
    }

    if (inlet) {
      const r = await buildInlets(targets);
      if (r) {
        total += r.total;
        parts.push(`인입관 ${r.made}개`);
        if (r.notes.length) parts.push(`필지 미확인 ${r.notes.length}곳(메모 기록)`);
      } else if (!supply) {
        return; // 공급관도 안 만들었고 인입관도 실패 → 메시지 유지
      }
    }

    setStatus(`완료 — ${parts.join(' · ')} · 총 ${Math.round(total).toLocaleString()}m (Ctrl+Z로 되돌리기)`);
  } finally {
    endBatch();
  }
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
