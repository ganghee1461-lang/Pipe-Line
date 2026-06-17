// ── 구간 종점 라벨 (배관망 모드 전용) ──
// 자동 판정이 오류가 많아 '수동 지정' 방식으로 변경:
//   배관망 모드에서 꼭짓점을 우클릭 → 그 점을 인접 구간의 '종점'으로 표시/해제.
// 라벨은 꼭짓점 좌표에 붙고, 드래그 시 라이브 형상을 따라 같이 움직인다.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { Style, Icon } from 'ol/style.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { getState, subscribe } from '../state/store.js';
import { pipeSource } from './layer.js';

// 축소해도 사라지지 않도록 declutter 끔
const src = new VectorSource();
const layer = new VectorLayer({ source: src, zIndex: 10, declutter: false, style: styleFor });

// 통일색 배지(짙은 슬레이트 + 흰 글씨). 구간 색상과 무관 → 시인성 우선.
const BADGE_BG = '#1f2937';
const badgeCache = new Map();
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function badgeStyle(n) {
  const label = String(n);
  if (badgeCache.has(label)) return badgeCache.get(label);
  const dpr = window.devicePixelRatio || 1;
  const fs = 13, padX = 7, padY = 4;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  ctx.font = `bold ${fs}px "Noto Sans KR", sans-serif`;
  const w = Math.ceil(ctx.measureText(label).width) + padX * 2;
  const h = fs + padY * 2;
  c.width = w * dpr; c.height = h * dpr;
  ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = `bold ${fs}px "Noto Sans KR", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  roundRect(ctx, 1, 1, w - 2, h - 2, 5);
  ctx.fillStyle = BADGE_BG; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, w / 2, h / 2 + 0.5);
  const style = new Style({
    image: new Icon({ img: c, imgSize: [c.width, c.height], scale: 1 / dpr, displacement: [0, 14] }),
  });
  badgeCache.set(label, style);
  return style;
}

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
  return badgeStyle(f.get('sec'));
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
