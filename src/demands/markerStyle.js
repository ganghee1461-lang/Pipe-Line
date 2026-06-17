// ── 전체 마커 스타일 컨트롤 (채움색·테두리색·모양·테두리선) ──
import { getState, subscribe, setMarkerStyle } from '../state/store.js';
import { MARKER_COLORS, BORDER_COLORS, MARKER_SHAPES } from './markers.js';

const SHAPE_ICON = { circle: '●', triangle: '▲', square: '■' };
let colorsEl, borderColorsEl, shapesEl, borderEl, numEl;

// 색 스와치 HTML (transparent는 체커보드)
function swatch(cls, dataAttr, c) {
  if (c === 'transparent') return `<button class="ci ci-checker" data-${dataAttr}="transparent" title="투명"></button>`;
  return `<button class="ci" data-${dataAttr}="${c}" style="background:${c}" title="${c}"></button>`;
}

export function initMarkerStyle() {
  colorsEl = document.getElementById('ms-colors');
  borderColorsEl = document.getElementById('ms-border-color');
  shapesEl = document.getElementById('ms-shapes');
  borderEl = document.getElementById('ms-border');
  numEl = document.getElementById('ms-num');

  colorsEl.innerHTML = MARKER_COLORS.map((c) => swatch('ci', 'color', c)).join('');
  borderColorsEl.innerHTML = BORDER_COLORS.map((c) => swatch('ci', 'bc', c)).join('');
  shapesEl.innerHTML = MARKER_SHAPES.map((sh) => `<button class="si" data-shape="${sh}">${SHAPE_ICON[sh]}</button>`).join('');

  colorsEl.querySelectorAll('.ci').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ color: b.dataset.color }));
  });
  borderColorsEl.querySelectorAll('.ci').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ borderColor: b.dataset.bc }));
  });
  shapesEl.querySelectorAll('.si').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ shape: b.dataset.shape }));
  });
  borderEl.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ border: b.dataset.border }));
  });
  numEl.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => setMarkerStyle({ showNum: b.dataset.num === 'show' }));
  });

  subscribe('ui:changed', refresh);
  refresh();
}

function refresh() {
  const { color, borderColor, shape, border, showNum } = getState().ui.markerStyle;
  const numOn = showNum !== false;
  colorsEl.querySelectorAll('.ci').forEach((b) => b.classList.toggle('on', b.dataset.color === color));
  borderColorsEl.querySelectorAll('.ci').forEach((b) => b.classList.toggle('on', b.dataset.bc === borderColor));
  shapesEl.querySelectorAll('.si').forEach((b) => b.classList.toggle('on', b.dataset.shape === shape));
  borderEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.border === border));
  numEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.num === 'show') === numOn));
}
