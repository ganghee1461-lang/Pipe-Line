// ── 배관 연장 집계 (종류별 합계) ──
import { getState, subscribe } from '../state/store.js';
import { pipeKey } from '../config/pipeStyles.js';
import { pipeLength, fmtLength } from './util.js';

let listEl, sumEl;

export function initTotals() {
  listEl = document.getElementById('pipe-totals');
  sumEl = document.getElementById('pipe-total-sum');
  subscribe('pipes:changed', render);
  render();
}

function render() {
  const { pipes } = getState();
  const groups = new Map(); // key -> { count, len }
  let total = 0;

  for (const p of pipes) {
    const len = pipeLength(p.coords);
    total += len;
    const k = pipeKey(p.attr);
    const g = groups.get(k) || { count: 0, len: 0 };
    g.count++;
    g.len += len;
    groups.set(k, g);
  }

  if (!pipes.length) {
    listEl.innerHTML = '<li class="pt-empty">작도된 배관이 없습니다 (P키로 작도)</li>';
    sumEl.textContent = '';
    return;
  }

  const rows = [...groups.entries()].sort((a, b) => b[1].len - a[1].len);
  listEl.innerHTML = rows
    .map(([k, g]) => `
      <li class="pt-row">
        <span class="pt-key">${esc(k)}</span>
        <span class="pt-val">${g.count}개 · ${fmtLength(g.len)}</span>
      </li>`)
    .join('');
  sumEl.textContent = `총 ${pipes.length}개 · ${fmtLength(total)}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
