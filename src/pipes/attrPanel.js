// ── 배관 속성 패널 (세그먼트 모델) ──
// 선택된 세그먼트(들)의 속성 편집. 다중 선택 시 일괄 지정 + 선택 구간 연장 합계.
import { getState, subscribe, updateSegs, removeSegs, clearSegSelection, parseSeg } from '../state/store.js';
import { DIAMETERS } from '../config/pipeStyles.js';
import { segLength, fmtLength } from './util.js';

const MIX = '__mix__';
const FIXED = ['use', 'pressure', 'status', 'review', 'pavement'];
let els = {};
let panel, titleEl, lenEl, delBtn;

export function initAttrPanel() {
  panel = document.getElementById('pipe-attr');
  titleEl = document.getElementById('pa-title');
  lenEl = document.getElementById('pa-len');
  delBtn = document.getElementById('pa-del');
  ['material', 'diameter', 'section', ...FIXED].forEach((f) => { els[f] = document.getElementById(`pa-${f}`); });

  els.material.addEventListener('change', () => {
    const m = els.material.value;
    if (m === MIX) return;
    fillDiameters(m, els.diameter.value);
    updateSegs(getState().ui.selectedSegs, { material: m, diameter: els.diameter.value });
  });
  els.diameter.addEventListener('change', () => applyField('diameter'));
  FIXED.forEach((f) => els[f].addEventListener('change', () => applyField(f)));
  // 구간 번호 (숫자 입력)
  els.section.addEventListener('change', () => {
    const v = parseInt(els.section.value, 10);
    if (Number.isFinite(v) && v >= 1) updateSegs(getState().ui.selectedSegs, { section: v });
  });

  delBtn.addEventListener('click', () => {
    const keys = getState().ui.selectedSegs;
    if (keys.length) removeSegs(keys);
  });
  document.getElementById('pa-close').addEventListener('click', clearSegSelection);

  subscribe('ui:changed', render);
  subscribe('pipes:changed', render);
  render();
}

function applyField(field) {
  const v = els[field].value;
  if (v === MIX) return;
  updateSegs(getState().ui.selectedSegs, { [field]: v });
}

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
  // 선택된 세그먼트 → {attr, pipe, i}
  const items = ui.selectedSegs
    .map((k) => {
      const { pipeId, i } = parseSeg(k);
      const p = pipes.find((x) => x.id === pipeId);
      return p && p.segs[i] ? { attr: p.segs[i], pipe: p, i } : null;
    })
    .filter(Boolean);

  if (!items.length) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const multi = items.length > 1;

  const common = (f) => {
    const set = new Set(items.map((it) => it.attr[f]));
    return set.size === 1 ? [...set][0] : MIX;
  };

  const matV = common('material');
  setSelect(els.material, matV);
  fillDiameters(matV === MIX ? null : matV, common('diameter'));
  setSelect(els.diameter, common('diameter'));
  FIXED.forEach((f) => setSelect(els[f], common(f)));
  els.pressure.disabled = common('use') !== 'supply';

  // 구간 번호: 단일이면 값, 혼합이면 빈칸 + placeholder
  const sec = common('section');
  if (sec === MIX) { els.section.value = ''; els.section.placeholder = '혼합'; }
  else { els.section.value = sec; els.section.placeholder = ''; }

  // 선택 구간 연장 (기존관 제외)
  const len = items
    .filter((it) => it.attr.status !== 'existing')
    .reduce((s, it) => s + segLength(it.pipe.coords, it.i), 0);

  if (multi) {
    titleEl.textContent = '선분 일괄 지정';
    lenEl.textContent = `${items.length}개 선분 · 연장 ${fmtLength(len)}`;
    delBtn.textContent = `선택 ${items.length}개 삭제`;
  } else {
    titleEl.textContent = '배관 선분 속성';
    lenEl.textContent = `#${items[0].pipe.id}-${items[0].i + 1} · ${fmtLength(segLength(items[0].pipe.coords, items[0].i))}`;
    delBtn.textContent = '이 선분 삭제';
  }
}
