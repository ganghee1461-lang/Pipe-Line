// ── 공유지/사유지 색칠 (배관 설치 가능 부지 찾기) ──
// 목적: 도시가스 배관은 국·시·군·도유 등 '나라땅(공유지)'에 설치 가능.
// 현재 화면의 필지를 긁어 공유(파랑)/사유(빨강)로 칠해 한눈에 배관 가능 부지를 본다.
//
// WMS 소유구분지적도는 서버가 구운 PNG라 카테고리별 재색칠이 불가능 → 벡터로 직접 칠한다.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Style, Fill, Stroke } from 'ol/style.js';
import { toLonLat } from 'ol/proj.js';
import { map } from './map.js';
import { getOwnershipParcels, getParcelsInBox, getPossession, isPublicLand } from '../api/vworld.js';

const MIN_ZOOM = 16;      // 이 줌 미만에선 필지가 너무 많아 비활성
const MAX_PARCELS = 160;  // 1회 스캔 상한 (API 호출량 보호)
const CONCURRENCY = 6;    // 소유속성 동시 조회 수

const geojson = new GeoJSON();
const src = new VectorSource();
const layer = new VectorLayer({
  source: src,
  zIndex: 6,
  style: (f) => styleFor(f.get('pub')),
});
map.addLayer(layer);

const cache = new Map(); // pnu -> pub(true|false|null)

function styleFor(pub) {
  // 파랑=공유(배관 가능) / 빨강=사유 / 회색=미확인
  const c = pub === true ? '29,78,216' : pub === false ? '185,28,28' : '139,148,158';
  return new Style({
    fill: new Fill({ color: `rgba(${c},0.32)` }),
    stroke: new Stroke({ color: `rgb(${c})`, width: 1.3 }),
  });
}

// 동시 실행 풀
async function pool(items, n, fn) {
  const iter = items[Symbol.iterator]();
  const workers = Array.from({ length: n }, async () => {
    for (let cur = iter.next(); !cur.done; cur = iter.next()) await fn(cur.value);
  });
  await Promise.all(workers);
}

let scanning = false;

// onStatus({ state, ... }) 콜백으로 진행상황/결과 통지
export async function scanOwnership(onStatus) {
  if (scanning) return;
  const view = map.getView();
  if (view.getZoom() < MIN_ZOOM) {
    onStatus({ state: 'zoom' });
    return;
  }
  scanning = true;
  onStatus({ state: 'loading', msg: '필지 조회 중…' });

  const ext = view.calculateExtent(map.getSize());
  const [minLon, minLat] = toLonLat([ext[0], ext[1]]);
  const [maxLon, maxLat] = toLonLat([ext[2], ext[3]]);

  // ① 빠른 경로: 소유구분 데이터 일괄조회 (1회 호출, 상한 없음)
  try {
    const bulk = await getOwnershipParcels(minLon, minLat, maxLon, maxLat);
    if (bulk && bulk.length) {
      src.clear();
      const tally = renderParcels(bulk.map((b) => ({ geometry: b.geometry, pub: b.pub })));
      scanning = false;
      onStatus({ state: 'done', ...tally, capped: false });
      return;
    }
  } catch {
    /* 폴백으로 진행 */
  }

  // ② 폴백: 필지 경계 일괄 + 필지별 소유구분 조회 (N+1, 상한 적용)
  let parcels;
  try {
    parcels = await getParcelsInBox(minLon, minLat, maxLon, maxLat);
  } catch {
    scanning = false;
    onStatus({ state: 'error' });
    return;
  }

  const capped = parcels.length > MAX_PARCELS;
  if (capped) parcels = parcels.slice(0, MAX_PARCELS);

  if (!parcels.length) {
    scanning = false;
    onStatus({ state: 'empty' });
    return;
  }

  src.clear();
  const classified = [];
  let done = 0;

  await pool(parcels, CONCURRENCY, async (p) => {
    let isPub = cache.get(p.pnu);
    if (isPub === undefined) {
      const poss = await getPossession(p.pnu);
      isPub = poss ? isPublicLand(poss.code, poss.name) : null;
      cache.set(p.pnu, isPub);
    }
    classified.push({ geometry: p.geometry, pub: isPub });
    done++;
    onStatus({ state: 'loading', msg: `${done}/${parcels.length} 분류 중…` });
  });

  const tally = renderParcels(classified);
  scanning = false;
  onStatus({ state: 'done', ...tally, capped });
}

// 분류된 필지들을 벡터로 그리고 집계 반환
function renderParcels(items) {
  let pub = 0, priv = 0, unknown = 0;
  for (const it of items) {
    if (!it.geometry) continue;
    const feat = geojson.readFeature(
      { type: 'Feature', geometry: it.geometry, properties: {} },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
    );
    feat.set('pub', it.pub);
    src.addFeature(feat);
    if (it.pub === true) pub++;
    else if (it.pub === false) priv++;
    else unknown++;
  }
  return { pub, priv, unknown };
}

export function clearOwnership() {
  src.clear();
}
