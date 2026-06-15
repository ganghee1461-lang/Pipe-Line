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
  const ms = getState().ui.markerStyle; // 전체 공통 스타일
  const color = ms.color;
  const shape = ms.shape;
  const key = `${color}-${shape}-${hasMemo ? 'm' : ''}-${selected ? 's' : ''}-${d.id}`;
  if (styleCache.has(key)) return styleCache.get(key);

  const radius = selected ? 13 : 10;
  const fill = new Fill({ color });
  // 선택=파랑 / 메모=황색 / 기본=흰색 테두리 (스타일은 전체 공통이라 테두리로 구분)
  const stroke = new Stroke({
    color: selected ? '#1d4ed8' : hasMemo ? '#fde68a' : '#ffffff',
    width: selected ? 3 : hasMemo ? 3 : 2,
  });
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

// ── 마커 클릭 팝업 (선택 + 메모 + 스타일) ──
const popup = document.getElementById('marker-popup');

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function hidePopup() { popup.classList.add('hidden'); popup.innerHTML = ''; }

function showPopup(pixel, d) {
  popup.innerHTML = `
    <div class="mp-bar">
      <b>#${d.id}</b>
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
    showPopup(evt.pixel, d);
  });
}

export function isMarkerAt(pixel) { return !!markerAtPixel(pixel); }

export { src as markerSource };
