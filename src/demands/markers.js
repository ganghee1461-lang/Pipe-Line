// ── 수요처 마커 레이어 ──
// 데이터(store.demands)에 바인딩. 메모 유무에 따라 디자인 분기.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { fromLonLat } from 'ol/proj.js';
import { Style, Circle, Fill, Stroke, Text } from 'ol/style.js';
import { map } from '../map/map.js';
import { getState, subscribe } from '../state/store.js';

const src = new VectorSource();
export const markerLayer = new VectorLayer({ source: src, zIndex: 7, style: styleFor });
map.addLayer(markerLayer);

// 스타일 캐시 (메모유무 + 선택 + 번호 조합으로 키) — 불필요한 Style 재생성 방지
const styleCache = new Map();

function styleFor(feature) {
  const d = feature.get('demand');
  const hasMemo = !!(d.memo && d.memo.trim());
  const selected = getState().ui.selectedDemandId === d.id;
  const key = `${hasMemo ? 'm' : 'n'}-${selected ? 's' : ''}-${d.id}`;
  if (styleCache.has(key)) return styleCache.get(key);

  const color = hasMemo ? '#b45309' : '#b91c1c';
  const radius = selected ? 13 : 10;
  const style = new Style({
    image: new Circle({
      radius,
      fill: hasMemo ? new Fill({ color: 'rgba(180,83,9,0.18)' }) : new Fill({ color }),
      stroke: new Stroke({
        color: selected ? '#1d4ed8' : hasMemo ? color : '#ffffff',
        width: hasMemo ? 2.5 : 2,
        lineDash: hasMemo ? [5, 3] : undefined,
      }),
    }),
    text: new Text({
      text: String(d.id),
      font: 'bold 11px "Noto Sans KR", sans-serif',
      fill: new Fill({ color: hasMemo ? color : '#fff' }),
    }),
  });
  styleCache.set(key, style);
  return style;
}

function rebuild(demands) {
  src.clear();
  styleCache.clear();
  const feats = demands
    .filter((d) => Number.isFinite(d.lon) && Number.isFinite(d.lat))
    .map((d) => {
      const f = new Feature({ geometry: new Point(fromLonLat([d.lon, d.lat])) });
      f.set('demand', d);
      f.setId(d.id);
      return f;
    });
  src.addFeatures(feats);
  applyFilter();
}

function applyFilter() {
  const { filterMemoOnly } = getState().ui;
  src.getFeatures().forEach((f) => {
    const d = f.get('demand');
    const hide = filterMemoOnly && !(d.memo && d.memo.trim());
    f.setStyle(hide ? new Style() : undefined); // 빈 스타일 = 숨김
  });
}

export function initMarkers() {
  subscribe('demands:changed', rebuild);
  subscribe('ui:changed', applyFilter);
  // 마커 클릭 → 선택 + 팝업은 list 모듈과 연동 (간단히 선택만)
}

export { src as markerSource };
