// ── 도로 따라 수요처 자동 연결 ──
// 기존관(status:'existing')을 공급원으로 삼아, 도로망 위에서 모든 수요처를
// 최소 연장으로 잇는 배관을 생성한다. (도로 그래프 + 최단경로 + Prim 최소연결)
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { getState, addPipe } from '../state/store.js';
import { fetchRoads } from './roads.js';
import { toSegments, buildGraph, buildNetwork, edgesToPolylines } from './graph.js';

const statusEl = () => document.getElementById('ar-status');
const setStatus = (t) => { const el = statusEl(); if (el) el.textContent = t; };

// 현재 지도 화면 + 여유(margin m)로 bbox 계산 → [minLon,minLat,maxLon,maxLat]
function viewBBox(margin = 300) {
  const e = map.getView().calculateExtent(map.getSize());
  const [a, b] = [toLonLat([e[0] - margin, e[1] - margin]), toLonLat([e[2] + margin, e[3] + margin])];
  return [a[0], a[1], b[0], b[1]];
}

// 마커/기존관을 모두 포함하는 bbox (화면 밖 수요처도 놓치지 않도록)
function dataBBox(demands, margin = 300) {
  const pts = demands.filter((d) => Number.isFinite(d.lon)).map((d) => fromLonLat([d.lon, d.lat]));
  for (const p of getState().pipes) {
    for (const c of p.coords) pts.push(fromLonLat(c));
  }
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
  material: 'PE', diameter: '63A', use: 'supply', pressure: '저압',
  status: 'planned', review: 'target', pavement: 'asphalt', section: 1, markerNo: '',
};

export async function runAutoRoute(source = 'osm') {
  const { demands, pipes } = getState();
  const targets = demands.filter((d) => Number.isFinite(d.lon) && Number.isFinite(d.lat));
  if (!targets.length) { setStatus('연결할 수요처가 없습니다.'); return; }

  // 공급원: 기존관(existing) 세그먼트의 꼭짓점
  const sourcePts = [];
  for (const p of pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      if (p.segs[i].status !== 'existing') continue;
      sourcePts.push(fromLonLat(p.coords[i]), fromLonLat(p.coords[i + 1]));
    }
  }

  setStatus(`도로 데이터 불러오는 중… (${source === 'vworld' ? 'VWorld' : 'OSM'})`);
  let lines;
  try {
    lines = await fetchRoads(source, dataBBox(targets));
  } catch (err) {
    setStatus(`도로 조회 실패: ${err.message}`);
    return;
  }
  if (!lines.length) {
    setStatus(source === 'vworld'
      ? '이 영역에서 도로를 찾지 못했습니다 (VWorld 도로중심선 미제공 지역일 수 있음) — OSM으로 시도해 보세요.'
      : '이 영역에서 도로를 찾지 못했습니다. 지도를 도로가 있는 곳으로 옮겨 보세요.');
    return;
  }

  setStatus(`도로 ${lines.length}개 · 경로 계산 중…`);
  await new Promise((r) => setTimeout(r)); // 상태 표시 갱신

  const segs = toSegments(lines.map((ln) => ln.map((c) => fromLonLat(c))));
  const markerPts = targets.map((d) => fromLonLat([d.lon, d.lat]));
  const allPts = [...markerPts, ...sourcePts];
  const g = buildGraph(segs, allPts);

  const idAt = (i) => {
    const s = g.snaps[i];
    return s ? g.idOf(s.point) : undefined;
  };
  const termIds = markerPts.map((_, i) => idAt(i)).map((v) => (v === undefined ? -1 : v));
  const srcIds = sourcePts.map((_, i) => idAt(markerPts.length + i)).map((v) => (v === undefined ? -1 : v));

  const { used, unreachable } = buildNetwork(g.adj, srcIds, termIds);
  const mains = edgesToPolylines(used, g.coords);

  // 1) 도로를 따라가는 공급관
  let total = 0;
  const len = (ll) => {
    let s = 0;
    for (let i = 0; i < ll.length - 1; i++) s += Math.hypot(ll[i + 1][0] - ll[i][0], ll[i + 1][1] - ll[i][1]);
    return s;
  };
  for (const line of mains) {
    if (line.length < 2) continue;
    total += len(line);
    const coords = line.map((c) => toLonLat(c));
    addPipe({
      coords,
      segs: Array.from({ length: coords.length - 1 }, () => ({ ...DEFAULT_ATTR, use: 'supply' })),
    });
  }

  // 2) 각 수요처 → 도로 접점 인입관
  let inlets = 0;
  targets.forEach((d, i) => {
    const snap = g.snaps[i];
    if (!snap) return;
    const p = markerPts[i];
    if (Math.hypot(p[0] - snap.point[0], p[1] - snap.point[1]) < 0.5) return;
    total += snap.dist;
    inlets++;
    addPipe({
      coords: [toLonLat(p), toLonLat(snap.point)],
      segs: [{ ...DEFAULT_ATTR, use: 'inlet', diameter: '32A', markerNo: String(i + 1) }],
    });
  });

  const miss = unreachable.length;
  setStatus(
    `완료 — 공급관 ${mains.length}개 · 인입관 ${inlets}개 · 총 ${Math.round(total).toLocaleString()}m`
    + (miss ? ` (도로로 못 이은 수요처 ${miss}곳)` : '')
    + (srcIds.some((v) => v >= 0) ? '' : ' · 기존관이 없어 최소연결로 생성')
  );
}

export function initAutoRoute() {
  const btn = document.getElementById('ar-run');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const source = document.querySelector('input[name="ar-src"]:checked')?.value || 'osm';
    btn.disabled = true;
    try { await runAutoRoute(source); }
    catch (err) { setStatus(`실패: ${err.message}`); }
    finally { btn.disabled = false; }
  });
}
