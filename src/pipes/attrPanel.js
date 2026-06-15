// ── 배관 속성 패널 ──
// 단일 선택: 해당 배관 편집. 다중 선택: 속성 일괄 지정 + 선택 개소 연장 합계.
import { getState, subscribe, updatePipes, removePipes, clearPipeSelection } from '../state/store.js';
import { DIAMETERS } from '../config/pipeStyles.js';
import { pipeLength, fmtLength } from './util.js';

const MIX = '__mix__';                 // 값이 섞여 있을 때
const FIXED = ['use', 'pressure', 'status', 'review', 'pavement']; // 옵션 고정 셀렉트
let els = {};
let panel, titleEl, lenEl, delBtn;

export function initAttrPanel() {
  panel = document.getElementById('pipe-attr');
  titleEl = document.getElementById('pa-title');
  lenEl = document.getElementById('pa-len');
  delBtn = document.getElementById('pa-del');
  ['material', 'diameter', ...FIXED].forEach((f) => { els[f] = document.getElementById(`pa-${f}`); });

  els.material.addEventListener('change', () => {
    const m = els.material.value;
    if (m === MIX) return;
    fillDiameters(m, els.diameter.value);
    updatePipes(getState().ui.selectedPipeIds, { material: m, diameter: els.diameter.value });
  });
  els.diameter.addEventListener('change', () => applyField('diameter'));
  FIXED.forEach((f) => els[f].addEventListener('change', () => applyField(f)));

  delBtn.addEventListener('click', () => {
    const ids = getState().ui.selectedPipeIds;
    if (ids.length) removePipes(ids);
  });
  document.getElementById('pa-close').addEventListener('click', clearPipeSelection);

  subscribe('ui:changed', render);
  subscribe('pipes:changed', render);
  render();
}

function applyField(field) {
  const v = els[field].value;
  if (v === MIX) return;
  updatePipes(getState().ui.selectedPipeIds, { [field]: v });
}

// 셀렉트에 값 반영. 섞여 있으면 '— 혼합 —' 옵션을 임시로 넣어 선택.
function setSelect(el, value) {
  const ex = el.querySelector(`option[value="${MIX}"]`);
  if (ex) ex.remove();
  if (value === MIX) {
    const opt = document.createElement('option');
    opt.value = MIX;
    opt.textContent = '— 혼합 —';
    el.insertBefore(opt, el.firstChild);
    el.value = MIX;
  } else {
    el.value = value;
  }
}

function fillDiameters(material, keep) {
  const list = material && DIAMETERS[material]
    ? DIAMETERS[material]
    : [...new Set([...DIAMETERS.PLP, ...DIAMETERS.PE])];
  els.diameter.innerHTML = list.map((d) => `<option value="${d}">${d}</option>`).join('');
  els.diameter.value = keep && keep !== MIX && list.includes(keep) ? keep : list[0];
}

function render() {
  const { pipes, ui } = getState();
  const items = pipes.filter((p) => ui.selectedPipeIds.includes(p.id));
  if (!items.length) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const multi = items.length > 1;

  const common = (f) => {
    const set = new Set(items.map((p) => p.attr[f]));
    return set.size === 1 ? [...set][0] : MIX;
  };

  const matV = common('material');
  setSelect(els.material, matV);
  fillDiameters(matV === MIX ? null : matV, common('diameter'));
  setSelect(els.diameter, common('diameter'));
  FIXED.forEach((f) => setSelect(els[f], common(f)));

  // 압력은 공급관에서만 의미
  els.pressure.disabled = common('use') !== 'supply';

  // 선택 개소 연장 (기존관 제외)
  const len = items
    .filter((p) => p.attr.status !== 'existing')
    .reduce((s, p) => s + pipeLength(p.coords), 0);

  if (multi) {
    titleEl.textContent = '배관 일괄 지정';
    lenEl.textContent = `${items.length}개 선택 · 연장 ${fmtLength(len)}`;
    delBtn.textContent = `선택 ${items.length}개 삭제`;
  } else {
    titleEl.textContent = '배관 속성';
    lenEl.textContent = `#${items[0].id} · ${fmtLength(pipeLength(items[0].coords))}`;
    delBtn.textContent = '이 배관 삭제';
  }
}
