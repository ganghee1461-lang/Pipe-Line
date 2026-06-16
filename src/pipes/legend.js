// ── 배관 범례 (현재 레이어에 있는 종류만, 모드별 색상 반영, 접기/펴기) ──
import { getState, subscribe } from '../state/store.js';
import { pipeStyle, legendGroup } from '../config/pipeStyles.js';

let box, listEl, toggleBtn;
let open = true;

export function initLegend() {
  box = document.getElementById('pipe-legend');
  listEl = document.getElementById('legend-list');
  toggleBtn = document.getElementById('legend-toggle');
  toggleBtn.addEventListener('click', () => { open = !open; apply(); });
  subscribe('pipes:changed', render);
  subscribe('ui:changed', render); // 모드 변경 시 색 갱신
  apply();
  render();
}

function apply() {
  box.classList.toggle('collapsed', !open);
  toggleBtn.textContent = open ? '▾' : '▸';
}

function dashCss(d) {
  return d === 'dashed' ? 'dashed' : d === 'dotted' ? 'dotted' : 'solid';
}

function render() {
  const { pipes, ui } = getState();
  const types = new Map(); // 라벨 -> 대표 attr
  for (const p of pipes) {
    for (const a of p.segs) {
      const k = legendGroup(a, ui.mode, ui.colorBy);
      if (!types.has(k)) types.set(k, a);
    }
  }

  if (!types.size) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');

  listEl.innerHTML = [...types.entries()]
    .map(([k, a]) => {
      const s = pipeStyle(a, ui.mode, ui.colorBy);
      return `<li class="lg-row">
        <span class="lg-swatch" style="border-top:3px ${dashCss(s.dash)} ${s.color}"></span>
        <span class="lg-label">${esc(k)}</span>
      </li>`;
    })
    .join('');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
