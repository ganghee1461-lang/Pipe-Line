// ── 배관 벡터 레이어 (세그먼트 모델) ──
// 배관 = 폴리라인 1개 피처. 각 세그먼트(점-점 구간)를 개별 속성으로 스타일링.
// 색/대시는 세그먼트 속성 + 모드. 인입관 세그먼트는 끝에 화살표. 선택은 세그먼트 단위.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import { Style, Stroke, RegularShape, Fill, Circle } from 'ol/style.js';
import { map } from '../map/map.js';
import { getState, subscribe, segKey } from '../state/store.js';
import { pipeStyle, DASH } from '../config/pipeStyles.js';
import { toLine } from './util.js';

export const pipeSource = new VectorSource();
const layer = new VectorLayer({ source: pipeSource, zIndex: 8, style: styleFor });

// V모드 hover 미리보기 (어떤 선분이 선택될지)
let hoveredSeg = null;
export function setHoveredSeg(key) {
  if (key !== hoveredSeg) { hoveredSeg = key; layer.changed(); }
}

function styleFor(feature) {
  const p = feature.get('pipe');
  const { mode, colorBy, selectedSegs, tool } = getState().ui;
  const cs = feature.getGeometry().getCoordinates();
  const selSet = new Set(selectedSegs);
  const styles = [];

  for (let i = 0; i < p.segs.length; i++) {
    const a = p.segs[i];
    const s = pipeStyle(a, mode, colorBy);
    const seg = new LineString([cs[i], cs[i + 1]]);
    const key = segKey(p.id, i);
    const selected = selSet.has(key);
    const hovered = !selected && tool === 'select' && hoveredSeg === key;

    if (selected) {
      styles.push(new Style({
        geometry: seg,
        stroke: new Stroke({ color: 'rgba(29,78,216,0.4)', width: 11, lineCap: 'round' }),
      }));
    } else if (hovered) {
      styles.push(new Style({
        geometry: seg,
        stroke: new Stroke({ color: 'rgba(15,118,110,0.32)', width: 10, lineCap: 'round' }),
      }));
    }
    styles.push(new Style({
      geometry: seg,
      stroke: new Stroke({
        color: s.color, width: 4, lineDash: DASH[s.dash], lineCap: 'round', lineJoin: 'round',
      }),
    }));

    if (s.arrow) {
      const end = cs[i + 1];
      const prev = cs[i];
      const rot = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
      styles.push(new Style({
        geometry: new Point(end),
        image: new RegularShape({
          points: 3, radius: 7, fill: new Fill({ color: s.color }),
          rotateWithView: true, rotation: -rot + Math.PI / 2, angle: 0,
        }),
      }));
    }
  }

  // 선택(V)·꼭짓점(A) 모드: 점을 표시. A모드는 더 크고 채워진 핸들로 강조.
  if (tool === 'vertex' || tool === 'select') {
    const vtx = tool === 'vertex';
    styles.push(new Style({
      geometry: new MultiPoint(cs),
      image: new Circle({
        radius: vtx ? 6 : 4,
        fill: new Fill({ color: vtx ? '#0f766e' : '#ffffff' }),
        stroke: new Stroke({ color: vtx ? '#ffffff' : '#0f766e', width: vtx ? 2 : 1.5 }),
      }),
    }));
  }
  return styles;
}

function rebuild() {
  pipeSource.clear();
  for (const p of getState().pipes) {
    if (!p.coords || p.coords.length < 2) continue;
    const f = new Feature({ geometry: toLine(p.coords) });
    f.setId(p.id);
    f.set('pipe', p);
    pipeSource.addFeature(f);
  }
}

export function initPipeLayer() {
  map.addLayer(layer);
  subscribe('pipes:changed', rebuild);
  subscribe('ui:changed', () => layer.changed());
  rebuild();
}
