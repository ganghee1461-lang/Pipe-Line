// ── 수요처 마커 레이어 ──
// 데이터(store.demands)에 바인딩. 메모 유무에 따라 디자인 분기.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { fromLonLat } from 'ol/proj.js';
import { Style, Circle, RegularShape, Fill, Stroke, Text } from 'ol/style.js';
import { map } from '../map/map.js';
import { getState, subscribe } from '../state/store.js';

// 마커 색상 팔레트 (리스트 색칠 선택과 공유)
export const MARKER_COLORS = ['#b91c1c', '#b45309', '#0f766e', '#1d4ed8', '#6A1B9A', '#2E7D32', '#475569'];
export const MARKER_SHAPES = ['circle', 'triangle', 'square'];

const src = new VectorSource();
export const markerLayer = new VectorLayer({ source: src, zIndex: 7, style: styleFor });
map.addLayer(markerLayer);

// 스타일 캐시 (색/모양/메모/선택/번호 조합으로 키) — 불필요한 Style 재생성 방지
const styleCache = new Map();

function styleFor(feature) {
  const d = feature.get('demand');
  const hasMemo = !!(d.memo && d.memo.trim());
  const selected = getState().ui.selectedDemandId === d.id;
  const color = d.color || (hasMemo ? '#b45309' : '#b91c1c');
  const shape = d.shape || 'circle';
  const key = `${color}-${shape}-${hasMemo ? 'm' : ''}-${selected ? 's' : ''}-${d.id}`;
  if (styleCache.has(key)) return styleCache.get(key);

  const radius = selected ? 13 : 10;
  const fill = new Fill({ color });
  const stroke = new Stroke({ color: selected ? '#1d4ed8' : '#ffffff', width: selected ? 3 : 2 });
  let image;
  if (shape === 'triangle') image = new RegularShape({ points: 3, radius: radius + 2, fill, stroke });
  else if (shape === 'square') image = new RegularShape({ points: 4, radius, angle: Math.PI / 4, fill, stroke });
  else image = new Circle({ radius, fill, stroke });

  const style = new Style({
    image,
    text: new Text({
      text: String(d.id),
      font: 'bold 11px "Noto Sans KR", sans-serif',
      fill: new Fill({ color: '#ffffff' }),
      offsetY: shape === 'triangle' ? 2 : 0,
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
