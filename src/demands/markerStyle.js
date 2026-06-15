// ── 전체 마커 스타일 컨트롤 (색상·모양·채움·테두리) ──
import { getState, subscribe, setMarkerStyle } from '../state/store.js';
import { MARKER_COLORS, BORDER_COLORS, MARKER_SHAPES } from './markers.js';

const SHAPE_ICON = { circle: '●', triangle: '▲', square: '■' };
let colorsEl, borderColorsEl, shapesEl, fillEl, borderEl;

export function initMarkerStyle() {
  colorsEl = document.getElementById('ms-colors');
  borderColorsEl = document.getElementById('ms-border-color');
  shapesEl = document.getElementById('ms-shapes');
  fillEl = document.getElementById('ms-fill');
  borderEl = document.getElementById('ms-border');

  colorsEl.innerHTML = MARKER_COLORS
    .map((c) => `<button class="ci" data-color="${c}" style="background:${c}" title="${c}"></button>`)
    .join('');
  borderColorsEl.innerHTML = BORDER_COLORS
    .map((c) => `<button class="ci" data-bc="${c}" style="background:${c}" title="${c}"></button>`)
    .join('');
  shapesEl.innerHTML = MARKER_SHAPES
    .map((sh) => `<button class="si" data-shape="${sh}">${SHAPE_ICON[sh]}</button>`)
    .join('');

  colorsEl.querySelectorAll('.ci').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ color: b.dataset.color }));
  });
  borderColorsEl.querySelectorAll('.ci').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ borderColor: b.dataset.bc }));
  });
  shapesEl.querySelectorAll('.si').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ shape: b.dataset.shape }));
  });
  fillEl.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ fill: b.dataset.fill }));
  });
  borderEl.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ border: b.dataset.border }));
  });

  subscribe('ui:changed', refresh);
  refresh();
}

function refresh() {
  const { color, borderColor, shape, fill, border } = getState().ui.markerStyle;
  colorsEl.querySelectorAll('.ci').forEach((b) => b.classList.toggle('on', b.dataset.color === color));
  borderColorsEl.querySelectorAll('.ci').forEach((b) => b.classList.toggle('on', b.dataset.bc === borderColor));
  shapesEl.querySelectorAll('.si').forEach((b) => b.classList.toggle('on', b.dataset.shape === shape));
  fillEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.fill === fill));
  borderEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.border === border));
}
