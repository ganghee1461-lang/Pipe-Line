// ── 배관 연장 집계 (모드별 타겟 속성으로 그룹, 기존관 제외) ──
import { getState, subscribe } from '../state/store.js';
import { legendGroup } from '../config/pipeStyles.js';
import { segLength, fmtLength } from './util.js';

let listEl, sumEl;

export function initTotals() {
  listEl = document.getElementById('pipe-totals');
  sumEl = document.getElementById('pipe-total-sum');
  subscribe('pipes:changed', render);
  subscribe('ui:changed', render); // 모드 전환 시 그룹 기준 변경
  render();
}

function render() {
  const { pipes, ui } = getState();
  const groups = new Map(); // 라벨 -> 연장합
  let total = 0;

  for (const p of pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      const a = p.segs[i];
      if (a.status === 'existing') continue; // 기존관 연장 제외
      const len = segLength(p.coords, i);
      total += len;
      const k = legendGroup(a, ui.mode, ui.colorBy);
      groups.set(k, (groups.get(k) || 0) + len);
    }
  }

  if (!groups.size) {
    listEl.innerHTML = '<li class="pt-empty">작도된 신설 배관이 없습니다 (P키로 작도)</li>';
    sumEl.textContent = '';
    return;
  }

  const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  listEl.innerHTML = rows
    .map(([k, len]) => `
      <li class="pt-row">
        <span class="pt-key">${esc(k)}</span>
        <span class="pt-val">${fmtLength(len)}</span>
      </li>`)
    .join('');
  sumEl.textContent = `합계 ${fmtLength(total)}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
