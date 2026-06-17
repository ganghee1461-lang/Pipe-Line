// ── 말단 구간번호 라벨 (배관망 모드 전용) ──
// 같은 구간번호는 네트워크 전체에서 묶어 라벨 1개만 표시(루프/분기에서 중복 방지).
// 위치: 자유단(degree==1) 중 구간 중심에서 가장 먼 점 → 없으면(루프) 중심 근처.
// 드래그 중에는 배관 피처의 라이브 형상을 따라 라벨도 같이 움직인다.
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

function keyOf(c) { return `${c[0].toFixed(6)},${c[1].toFixed(6)}`; }
function dist2(a, b) { const dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; }

// 라이브 좌표: 편집(드래그) 중인 피처 형상을 우선 사용 → 라벨이 점을 따라옴
function coordsOf(p) {
  const f = pipeSource.getFeatureById(p.id);
  if (f) return f.getGeometry().getCoordinates().map((c) => toLonLat(c));
  return p.coords;
}

function rebuild() {
  src.clear();
  const { pipes, ui } = getState();
  if (ui.mode !== 'network') return;

  const live = new Map();
  for (const p of pipes) live.set(p.id, coordsOf(p));

  // 좌표 degree (신설/기존 모두 포함해 접속 여부 판단)
  const deg = new Map();
  for (const p of pipes) {
    const cs = live.get(p.id);
    for (let i = 0; i < p.segs.length; i++) {
      for (const c of [cs[i], cs[i + 1]]) {
        const k = keyOf(c);
        deg.set(k, (deg.get(k) || 0) + 1);
      }
    }
  }

  // 구간번호별 정점 모음 (신설관만)
  const sections = new Map(); // sec -> Map(key -> coord)
  for (const p of pipes) {
    const cs = live.get(p.id);
    for (let i = 0; i < p.segs.length; i++) {
      if (p.segs[i].status === 'existing') continue;
      const sec = p.segs[i].section || 1;
      if (!sections.has(sec)) sections.set(sec, new Map());
      const v = sections.get(sec);
      v.set(keyOf(cs[i]), cs[i]);
      v.set(keyOf(cs[i + 1]), cs[i + 1]);
    }
  }

  for (const [sec, vmap] of sections) {
    const verts = [...vmap.values()];
    if (!verts.length) continue;
    const cx = verts.reduce((s, c) => s + c[0], 0) / verts.length;
    const cy = verts.reduce((s, c) => s + c[1], 0) / verts.length;
    const center = [cx, cy];

    const free = verts.filter((c) => deg.get(keyOf(c)) === 1);
    let pos;
    if (free.length) {
      // 자유단(말단) 여러 개면 중심에서 가장 먼 것 = 가장 끝
      free.sort((a, b) => dist2(b, center) - dist2(a, center));
      pos = free[0];
    } else {
      // 루프 등 자유단 없음 → 중심에 가장 가까운 정점
      pos = verts.slice().sort((a, b) => dist2(a, center) - dist2(b, center))[0];
    }
    const f = new Feature(new Point(fromLonLat(pos)));
    f.set('sec', sec);
    src.addFeature(f);
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

let raf = 0;
function scheduleRebuild() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; rebuild(); });
}

export function initSectionLabels() {
  map.addLayer(layer);
  subscribe('pipes:changed', rebuild);
  subscribe('ui:changed', rebuild);
  pipeSource.on('changefeature', scheduleRebuild); // 꼭짓점 드래그 중 라이브 추적
  rebuild();
}
