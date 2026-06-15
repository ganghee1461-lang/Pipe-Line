// ── 배관 벡터 레이어 ──
// store.pipes 를 단일 소스로 렌더. 관경→색, 용도/압력→대시, 인입관→화살표.
// 모드(영업/굴착심의/배관망)에 따라 강조/흐림, 선택 시 후광.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import { Style, Stroke, RegularShape, Fill, Circle } from 'ol/style.js';
import { map } from '../map/map.js';
import { getState, subscribe } from '../state/store.js';
import { pipeStyle, DASH } from '../config/pipeStyles.js';
import { toLine } from './util.js';

export const pipeSource = new VectorSource();
const layer = new VectorLayer({ source: pipeSource, zIndex: 8, style: styleFor });

function styleFor(feature) {
  const p = feature.get('pipe');
  const { mode, selectedPipeIds } = getState().ui;
  const s = pipeStyle(p.attr, mode);
  const selected = selectedPipeIds.includes(p.id);

  const width = 4;
  const color = s.color;
  const styles = [];

  // 선택 후광
  if (selected) {
    styles.push(new Style({
      stroke: new Stroke({ color: 'rgba(29,78,216,0.4)', width: width + 7, lineCap: 'round' }),
    }));
  }

  // 본선
  styles.push(new Style({
    stroke: new Stroke({
      color,
      width,
      lineDash: DASH[s.dash],
      lineCap: 'round',
      lineJoin: 'round',
    }),
  }));

  // 인입관 화살표(말단)
  if (s.arrow) {
    const geom = feature.getGeometry();
    const cs = geom.getCoordinates();
    if (cs.length >= 2) {
      const end = cs[cs.length - 1];
      const prev = cs[cs.length - 2];
      const rot = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
      styles.push(new Style({
        geometry: new Point(end),
        image: new RegularShape({
          points: 3,
          radius: 7,
          fill: new Fill({ color }),
          rotateWithView: true,
          rotation: -rot + Math.PI / 2,
          angle: 0,
        }),
      }));
    }
  }

  // 꼭짓점 편집(A) 모드: 기존 점을 dot으로 표시 (추가 위치 미리보기는 Ctrl일 때만 Modify가 표시)
  if (getState().ui.tool === 'vertex') {
    styles.push(new Style({
      geometry: new MultiPoint(feature.getGeometry().getCoordinates()),
      image: new Circle({
        radius: 4.5,
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: '#0f766e', width: 1.6 }),
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
  subscribe('ui:changed', () => layer.changed()); // 선택/모드 변경 시 재스타일
  rebuild();
}
