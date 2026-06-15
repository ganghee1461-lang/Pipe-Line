// ── 전체 마커 스타일 컨트롤 (색상·모양) ──
import { getState, subscribe, setMarkerStyle } from '../state/store.js';
import { MARKER_COLORS, MARKER_SHAPES } from './markers.js';

const SHAPE_ICON = { circle: '●', triangle: '▲', square: '■' };
let colorsEl, shapesEl;

export function initMarkerStyle() {
  colorsEl = document.getElementById('ms-colors');
  shapesEl = document.getElementById('ms-shapes');

  colorsEl.innerHTML = MARKER_COLORS
    .map((c) => `<button class="ci" data-color="${c}" style="background:${c}" title="${c}"></button>`)
    .join('');
  shapesEl.innerHTML = MARKER_SHAPES
    .map((sh) => `<button class="si" data-shape="${sh}">${SHAPE_ICON[sh]}</button>`)
    .join('');

  colorsEl.querySelectorAll('.ci').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ color: b.dataset.color }));
  });
  shapesEl.querySelectorAll('.si').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ shape: b.dataset.shape }));
  });

  subscribe('ui:changed', refresh);
  refresh();
}

function refresh() {
  const { color, shape } = getState().ui.markerStyle;
  colorsEl.querySelectorAll('.ci').forEach((b) => b.classList.toggle('on', b.dataset.color === color));
  shapesEl.querySelectorAll('.si').forEach((b) => b.classList.toggle('on', b.dataset.shape === shape));
}
