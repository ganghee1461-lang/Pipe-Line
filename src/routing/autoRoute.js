// ── 도로 따라 공급관 자동 연결 ──
// 도로명주소 도로구간(중심선) 위에서, 기존관을 공급원으로 삼아 모든 수요처의
// '집 앞 도로'까지 최소 연장으로 잇는 공급관을 만든다.
// 인입관(도로↔건물)은 현장 판단이 필요해 기본은 생성하지 않는다.
// 옵션을 켜면 스냅점→마커 직선을 '참조용'으로 그린다(필지 경계 미반영 → 부정확).
// 전체가 히스토리 한 칸이라 Ctrl+Z 한 번에 되돌아간다.
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { getState, addPipe, beginBatch, endBatch } from '../state/store.js';
import { fetchRoads, ROADS_READY } from './roads.js';
import { toSegments, buildGraph, buildNetwork, edgesToPolylines } from './graph.js';

const SUPPLY_DIA = '110A';
const INLET_DIA = '63A';
const MARGIN = 300; // 마커/기존관 bbox 여유(m)

const setStatus = (t) => { const el = document.getElementById('ar-status'); if (el) el.textContent = t; };

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

  // 공급원: 기존관(existing) 세그먼트의 꼭짓점
  const sourcePts = [];
  for (const p of pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      if (p.segs[i].status !== 'existing') continue;
      sourcePts.push(fromLonLat(p.coords[i]), fromLonLat(p.coords[i + 1]));
    }
  }

  setStatus('도로 데이터 불러오는 중…');
  let lines;
  try {
    lines = await fetchRoads(dataBBox(targets), (d, t) => setStatus(`도로 데이터 불러오는 중… ${d}/${t}`));
  } catch (err) {
    setStatus(`도로 조회 실패: ${err.message}`);
    return;
  }
  if (!lines.length) {
    setStatus('이 지역의 도로 데이터가 없습니다 (해당 시군구를 R2에 올렸는지 확인).');
    return;
  }

  setStatus(`도로 ${lines.length.toLocaleString()}개 · 경로 계산 중…`);
  await new Promise((r) => setTimeout(r));

  // 도로망 그래프 + 마커/기존관 스냅 → 최소 연결망
  const segs = toSegments(lines.map((ln) => ln.map((c) => fromLonLat(c))));
  const markerPts = targets.map((d) => fromLonLat([d.lon, d.lat]));
  const g = buildGraph(segs, [...markerPts, ...sourcePts]);
  const idAt = (i) => { const s = g.snaps[i]; return s ? g.idOf(s.point) : undefined; };
  const termIds = markerPts.map((_, i) => idAt(i)).map((v) => (v === undefined ? -1 : v));
  const srcIds = sourcePts.map((_, i) => idAt(markerPts.length + i)).map((v) => (v === undefined ? -1 : v));

  const { used, unreachable } = buildNetwork(g.adj, srcIds, termIds);
  const mains = edgesToPolylines(used, g.coords);

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
  }

  setStatus(
    `완료 — 공급관 ${count}개 · 총 ${Math.round(total).toLocaleString()}m`
    + (inletN ? ` · 인입관 ${inletN}개 ${Math.round(inletLen).toLocaleString()}m (참조용·부정확, 직접 수정 필요)` : '')
    + (unreachable.length ? ` · 못 이은 수요처 ${unreachable.length}곳` : '')
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
    catch (err) { setStatus(`실패: ${err.message}`); }
    finally { btn.disabled = false; }
  });
}
