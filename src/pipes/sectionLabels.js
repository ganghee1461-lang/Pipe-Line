// ── 말단 구간번호 라벨 (배관망 모드 전용) ──
// 같은 구간번호가 연속된 세그먼트 묶음(run)마다 번호 1개를 말단(자유단)에 표시.
// 말단 판정: 네트워크 그래프에서 degree==1(다른 선분과 안 만나는 끝점).
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { Style, Text, Fill, Stroke } from 'ol/style.js';
import { fromLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { getState, subscribe } from '../state/store.js';
import { sectionColor } from '../config/pipeStyles.js';

const src = new VectorSource();
const layer = new VectorLayer({ source: src, zIndex: 10, declutter: true, style: styleFor });

function keyOf(c) { return `${c[0].toFixed(7)},${c[1].toFixed(7)}`; }

function rebuild() {
  src.clear();
  const { pipes, ui } = getState();
  if (ui.mode !== 'network') return;

  // 좌표별 incident 세그먼트 수(degree) — 신설/기존 모두 포함해 접속 여부 판단
  const deg = new Map();
  for (const p of pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      for (const c of [p.coords[i], p.coords[i + 1]]) {
        const k = keyOf(c);
        deg.set(k, (deg.get(k) || 0) + 1);
      }
    }
  }

  for (const p of pipes) {
    let i = 0;
    while (i < p.segs.length) {
      if (p.segs[i].status === 'existing') { i++; continue; } // 기존관은 라벨 제외
      const sec = p.segs[i].section || 1;
      let j = i;
      while (j + 1 < p.segs.length
        && p.segs[j + 1].status !== 'existing'
        && (p.segs[j + 1].section || 1) === sec) j++;

      // run = 세그먼트 i..j (좌표 i..j+1). 말단(자유단) 우선 배치.
      const startC = p.coords[i];
      const endC = p.coords[j + 1];
      let pos;
      if (deg.get(keyOf(endC)) === 1) pos = endC;
      else if (deg.get(keyOf(startC)) === 1) pos = startC;
      else pos = p.coords[Math.floor((i + j + 1) / 2)] || endC; // 양끝 다 접속 → 중간점

      const f = new Feature(new Point(fromLonLat(pos)));
      f.set('sec', sec);
      src.addFeature(f);
      i = j + 1;
    }
  }
}

function styleFor(f) {
  const sec = f.get('sec');
  return new Style({
    text: new Text({
      text: String(sec),
      font: 'bold 13px sans-serif',
      fill: new Fill({ color: sectionColor(sec) }),
      stroke: new Stroke({ color: '#ffffff', width: 3.5 }),
      offsetY: -11,
    }),
  });
}

export function initSectionLabels() {
  map.addLayer(layer);
  subscribe('pipes:changed', rebuild);
  subscribe('ui:changed', rebuild);
  rebuild();
}
