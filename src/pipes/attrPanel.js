// ── 배관 속성 패널 (선택된 배관 편집) ──
import { getState, subscribe, updatePipe, removePipe, selectPipe } from '../state/store.js';
import { DIAMETERS } from '../config/pipeStyles.js';
import { pipeLength, fmtLength } from './util.js';

const FIELDS = ['material', 'diameter', 'use', 'pressure', 'status', 'review'];
let els = {};
let panel, lenEl;
let current = null; // 편집 중 배관 id

export function initAttrPanel() {
  panel = document.getElementById('pipe-attr');
  lenEl = document.getElementById('pa-len');
  FIELDS.forEach((f) => { els[f] = document.getElementById(`pa-${f}`); });

  // 재질 변경 시 관경 옵션 갱신
  els.material.addEventListener('change', () => {
    fillDiameters(els.material.value, els.diameter.value);
    commit();
  });
  FIELDS.filter((f) => f !== 'material').forEach((f) => {
    els[f].addEventListener('change', commit);
  });

  document.getElementById('pa-del').addEventListener('click', () => {
    if (current != null) removePipe(current);
  });
  document.getElementById('pa-close').addEventListener('click', () => {
    selectPipe(null); // 선택만 해제 (배관은 유지)
  });

  subscribe('ui:changed', render);
  subscribe('pipes:changed', render);
  render();
}

function fillDiameters(material, keep) {
  const list = DIAMETERS[material] || DIAMETERS.PLP;
  els.diameter.innerHTML = list.map((d) => `<option value="${d}">${d}</option>`).join('');
  els.diameter.value = list.includes(keep) ? keep : list[0];
}

function commit() {
  if (current == null) return;
  updatePipe(current, {
    attr: {
      material: els.material.value,
      diameter: els.diameter.value,
      use: els.use.value,
      pressure: els.pressure.value,
      status: els.status.value,
      review: els.review.value,
    },
  });
}

function render() {
  const { pipes, ui } = getState();
  const p = pipes.find((x) => x.id === ui.selectedPipeId);
  if (!p) {
    current = null;
    panel.classList.add('hidden');
    return;
  }
  current = p.id;
  panel.classList.remove('hidden');

  els.material.value = p.attr.material;
  fillDiameters(p.attr.material, p.attr.diameter);
  els.use.value = p.attr.use;
  els.pressure.value = p.attr.pressure;
  els.status.value = p.attr.status;
  els.review.value = p.attr.review;

  // 압력은 공급관에서만 의미 → 인입관이면 비활성
  els.pressure.disabled = p.attr.use !== 'supply';

  lenEl.textContent = `#${p.id} · ${fmtLength(pipeLength(p.coords))}`;
}
