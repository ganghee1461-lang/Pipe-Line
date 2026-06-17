// ── 구간 종점 라벨 (배관망 모드 전용) ──
// 자동 판정이 오류가 많아 '수동 지정' 방식으로 변경:
//   배관망 모드에서 꼭짓점을 우클릭 → 그 점을 인접 구간의 '종점'으로 표시/해제.
// 라벨은 꼭짓점 좌표에 붙고, 드래그 시 라이브 형상을 따라 같이 움직인다.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { Style, Text, Fill, Stroke } from 'ol/style.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { getState, subscribe } from '../state/store.js';
import { pipeSource } from './layer.js';
import { sectionColor } from '../config/pipeStyles.js';

const src = new VectorSource();
const layer = new VectorLayer({ source: src, zIndex: 10, declutter: true, style: styleFor });

// 라이브 좌표: 편집(드래그) 중인 피처 형상을 우선 사용 → 라벨이 점을 따라옴
function coordsOf(p) {
  const f = pipeSource.getFeatureById(p.id);
  if (f) return f.getGeometry().getCoordinates().map((c) => toLonLat(c));
  return p.coords;
}

function rebuild() {
  src.clear();
  const { pipes, terminals, ui } = getState();
  if (ui.mode !== 'network') return;

  for (const t of terminals) {
    const p = pipes.find((x) => x.id === t.pipeId);
    if (!p) continue;
    const cs = coordsOf(p);
    if (t.idx < 0 || t.idx >= cs.length) continue;
    const f = new Feature(new Point(fromLonLat(cs[t.idx])));
    f.set('sec', t.section || 1);
    src.addFeature(f);
  }
}

function styleFor(f) {
  const sec = f.get('sec');
  return new Style({
    text: new Text({
      text: `${sec}구간 종점`,
      font: 'bold 12px "Noto Sans KR", sans-serif',
      fill: new Fill({ color: sectionColor(sec) }),
      stroke: new Stroke({ color: '#ffffff', width: 3.5 }),
      offsetY: -13,
      padding: [2, 3, 2, 3],
    }),
  });
}

let raf = 0;
function scheduleRebuild() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; rebuild(); });
}

export function initSectionLabels() {
  map.addLayer(layer);
  subscribe('pipes:changed', rebuild);
  subscribe('terminals:changed', rebuild);
  subscribe('ui:changed', rebuild);
  pipeSource.on('changefeature', scheduleRebuild); // 꼭짓점 드래그 중 라이브 추적
  rebuild();
}
