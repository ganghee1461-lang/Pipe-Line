// ── 배관 연장 집계 (세그먼트 단위, 기존관 제외) ──
import { getState, subscribe } from '../state/store.js';
import { pipeKey } from '../config/pipeStyles.js';
import { segLength, fmtLength } from './util.js';

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
  let counted = 0;

  for (const p of pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      const a = p.segs[i];
      if (a.status === 'existing') continue; // 기존관은 연장 집계 제외
      const len = segLength(p.coords, i);
      total += len;
      counted++;
      const k = pipeKey(a);
      const g = groups.get(k) || { count: 0, len: 0 };
      g.count++;
      g.len += len;
      groups.set(k, g);
    }
  }

  if (!counted) {
    listEl.innerHTML = '<li class="pt-empty">작도된 신설 구간이 없습니다 (P키로 작도)</li>';
    sumEl.textContent = '';
    return;
  }

  const rows = [...groups.entries()].sort((a, b) => b[1].len - a[1].len);
  listEl.innerHTML = rows
    .map(([k, g]) => `
      <li class="pt-row">
        <span class="pt-key">${esc(k)}</span>
        <span class="pt-val">${g.count}구간 · ${fmtLength(g.len)}</span>
      </li>`)
    .join('');
  sumEl.textContent = `신설 ${counted}구간 · ${fmtLength(total)}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
