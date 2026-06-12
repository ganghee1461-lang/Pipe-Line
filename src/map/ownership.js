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
import { getParcelsInBox, getPossession, isPublicLand } from '../api/vworld.js';

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
  let pub = 0, priv = 0, unknown = 0, done = 0;

  await pool(parcels, CONCURRENCY, async (p) => {
    let isPub = cache.get(p.pnu);
    if (isPub === undefined) {
      const poss = await getPossession(p.pnu);
      isPub = poss ? isPublicLand(poss.code, poss.name) : null;
      cache.set(p.pnu, isPub);
    }
    const feat = geojson.readFeature(
      { type: 'Feature', geometry: p.geometry, properties: {} },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
    );
    feat.set('pub', isPub);
    src.addFeature(feat);
    if (isPub === true) pub++;
    else if (isPub === false) priv++;
    else unknown++;
    done++;
    onStatus({ state: 'loading', msg: `${done}/${parcels.length} 분류 중…` });
  });

  scanning = false;
  onStatus({ state: 'done', pub, priv, unknown, capped });
}

export function clearOwnership() {
  src.clear();
}
