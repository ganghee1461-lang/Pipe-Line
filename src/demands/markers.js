// ── 수요처 마커 레이어 ──
// 데이터(store.demands)에 바인딩. 메모 유무에 따라 디자인 분기.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { fromLonLat } from 'ol/proj.js';
import { Style, Circle, RegularShape, Fill, Stroke, Text } from 'ol/style.js';
import { map } from '../map/map.js';
import { getState, subscribe, updateDemand, setUI } from '../state/store.js';

// 마커 채움 색상 ('transparent' = 투명, 체커보드로 표시). 테두리색도 동일 팔레트 사용.
export const MARKER_COLORS = [
  '#b91c1c', '#ea580c', '#ca8a04', '#facc15', '#2E7D32', '#0891b2',
  '#1d4ed8', '#6A1B9A', '#db2777', '#475569', '#ffffff', 'transparent',
];
export const BORDER_COLORS = MARKER_COLORS;
export const MARKER_SHAPES = ['circle', 'triangle', 'square'];

const src = new VectorSource();
export const markerLayer = new VectorLayer({ source: src, zIndex: 7, style: styleFor });
map.addLayer(markerLayer);

const styleCache = new Map();
const NONE = 'rgba(0,0,0,0)';

// ── 보색 계산 (메모 코너 점 색) ──
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3); }
  const to = (x) => ('0' + Math.round(x * 255).toString(16)).slice(-2);
  return '#' + to(r) + to(g) + to(b);
}
function complement(hex) {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.12) return '#7c3aed'; // 무채색(흰/회색) → 고정 보라
  return hslToHex((h + 0.5) % 1, Math.max(0.6, s), Math.min(0.55, Math.max(0.42, l)));
}
function isLight(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

function makeImage(shape, radius, fill, stroke) {
  if (shape === 'triangle') return new RegularShape({ points: 3, radius: radius + 2, fill, stroke });
  if (shape === 'square') return new RegularShape({ points: 4, radius, angle: Math.PI / 4, fill, stroke });
  return new Circle({ radius, fill, stroke });
}

function styleFor(feature) {
  const d = feature.get('demand');
  const num = feature.get('num') ?? d.id; // 표시 순번 (삭제 시 자동 재부여)
  const hasMemo = !!(d.memo && d.memo.trim());
  const selected = getState().ui.selectedDemandId === d.id;
  const ms = getState().ui.markerStyle; // { color, borderColor, shape, border }
  const { color, shape } = ms;
  const borderColor = ms.borderColor || '#ffffff';
  const dashed = ms.border === 'dashed';
  const key = `${color}-${borderColor}-${shape}-${ms.border}-${hasMemo ? 'm' : ''}-${selected ? 's' : ''}-${num}`;
  if (styleCache.has(key)) return styleCache.get(key);

  const radius = 10;
  const fill = new Fill({ color: color === 'transparent' ? NONE : color });
  const stroke = new Stroke({
    color: borderColor === 'transparent' ? NONE : borderColor,
    width: 2.4,
    lineDash: dashed ? [4, 3] : undefined,
  });

  const styles = [];
  // 선택 표시: 파란 외곽 링
  if (selected) {
    styles.push(new Style({
      image: new Circle({ radius: radius + 5, stroke: new Stroke({ color: '#1d4ed8', width: 2.5 }), fill: new Fill({ color: NONE }) }),
    }));
  }
  // 마커 본체 + 번호 (글자색=테두리색, 헤일로는 명도 따라 자동 대비)
  const labelColor = borderColor === 'transparent' ? '#111827' : borderColor;
  const halo = isLight(labelColor) ? '#1c1c1e' : '#ffffff';
  styles.push(new Style({
    image: makeImage(shape, radius, fill, stroke),
    text: new Text({
      text: String(num),
      font: '600 11px "Noto Sans KR", sans-serif',
      fill: new Fill({ color: labelColor }),
      stroke: new Stroke({ color: halo, width: 2 }),
      offsetY: shape === 'triangle' ? 2 : 0,
    }),
  }));
  // 메모 표시: 보색 코너 점 (우상단)
  if (hasMemo) {
    const basis = color !== 'transparent' ? color : (borderColor !== 'transparent' ? borderColor : '#ffffff');
    styles.push(new Style({
      image: new Circle({
        radius: 5,
        fill: new Fill({ color: complement(basis) }),
        stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
        displacement: [9, 9],
      }),
    }));
  }
  styleCache.set(key, styles);
  return styles;
}

function rebuild(demands) {
  src.clear();
  styleCache.clear();
  const feats = [];
  demands.forEach((d, i) => {
    if (!Number.isFinite(d.lon) || !Number.isFinite(d.lat)) return;
    const f = new Feature({ geometry: new Point(fromLonLat([d.lon, d.lat])) });
    f.set('demand', d);
    f.set('num', i + 1); // 배열 순서 = 표시 순번
    f.setId(d.id);
    feats.push(f);
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

// ── 마커 클릭 팝업 (선택 + 메모 + 스타일) ──
const popup = document.getElementById('marker-popup');

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function hidePopup() { popup.classList.add('hidden'); popup.innerHTML = ''; }

function showPopup(pixel, d, num) {
  popup.innerHTML = `
    <div class="mp-bar">
      <b>#${num ?? d.id}</b>
      <span class="mp-q" title="${esc(d.query)}">${esc(d.query)}</span>
      <button class="mp-close">✕</button>
    </div>
    <div class="mp-body">
      <div class="mp-addr">${esc(d.address)}</div>
      <textarea class="mp-memo" placeholder="메모…">${esc(d.memo || '')}</textarea>
    </div>`;
  popup.classList.remove('hidden');
  popup.style.left = `${pixel[0] + 14}px`;
  popup.style.top = `${pixel[1]}px`;

  popup.querySelector('.mp-close').onclick = hidePopup;
  const memo = popup.querySelector('.mp-memo');
  const save = () => updateDemand(d.id, { memo: memo.value });
  memo.addEventListener('change', save);
  memo.addEventListener('blur', save);
}

function markerAtPixel(pixel) {
  let hit = null;
  map.forEachFeatureAtPixel(
    pixel,
    (f, lyr) => { if (lyr === markerLayer) { hit = f; return true; } },
    { hitTolerance: 7 }
  );
  return hit;
}

export function initMarkers() {
  subscribe('demands:changed', rebuild);
  subscribe('ui:changed', applyFilter);

  // 마커 클릭 → 선택 + 메모/스타일 팝업
  map.on('singleclick', (evt) => {
    const f = markerAtPixel(evt.pixel);
    if (!f) { hidePopup(); return; }
    const d = f.get('demand');
    setUI({ selectedDemandId: d.id });
    showPopup(evt.pixel, d, f.get('num'));
  });
}

export function isMarkerAt(pixel) { return !!markerAtPixel(pixel); }

export { src as markerSource };
