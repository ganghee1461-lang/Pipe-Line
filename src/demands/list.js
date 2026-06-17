// ── 수요처 리스트 (카드: 순번·메모·계량기 / 정렬) ──
import { getState, subscribe, updateDemand, removeDemand, setUI } from '../state/store.js';
import { flyTo } from '../map/map.js';

const listEl = document.getElementById('demand-list');
const countEl = document.getElementById('demand-count');
const filterMemo = document.getElementById('filter-memo');
const sortSel = document.getElementById('demand-sort');
const sortDirBtn = document.getElementById('demand-sort-dir');
let sortBy = 'num';
let sortAsc = true; // true=오름차순

export function initList() {
  subscribe('demands:changed', render);
  subscribe('ui:changed', render);
  filterMemo.addEventListener('change', (e) => setUI({ filterMemoOnly: e.target.checked }));
  if (sortSel) sortSel.addEventListener('change', () => { sortBy = sortSel.value; updateDir(); render(); });
  if (sortDirBtn) sortDirBtn.addEventListener('click', () => { sortAsc = !sortAsc; updateDir(); render(); });
  updateDir();
}

// 메모는 단순 유무라 방향 토글 비활성화
function updateDir() {
  const disabled = sortBy === 'memo';
  sortDirBtn.disabled = disabled;
  sortDirBtn.textContent = sortAsc ? '▲' : '▼';
}

function meterTotal(d) {
  return (d.meters || []).reduce((s, m) => s + (Number(m.qty) || 0), 0);
}
function meterSummary(d) {
  const meters = d.meters || [];
  if (!meters.length) return '';
  const g = new Map();
  for (const m of meters) {
    const k = `${m.use} ${m.grade}`;
    g.set(k, (g.get(k) || 0) + (Number(m.qty) || 0));
  }
  return [...g.entries()].map(([k, q]) => `${esc(k)}<b>×${q}</b>`).join(' · ');
}

function render() {
  const { demands, ui } = getState();
  const numById = new Map();
  demands.forEach((d, i) => numById.set(d.id, i + 1)); // 표시 순번 = 배열 위치(정렬과 무관)

  let visible = ui.filterMemoOnly ? demands.filter((d) => d.memo && d.memo.trim()) : [...demands];
  const dir = sortAsc ? 1 : -1;
  if (sortBy === 'address') {
    visible.sort((a, b) => dir * String(a.address || '').localeCompare(String(b.address || ''), 'ko'));
  } else if (sortBy === 'meters') {
    visible.sort((a, b) => dir * (meterTotal(a) - meterTotal(b)));
  } else if (sortBy === 'memo') {
    // 메모 있는 것 먼저 (방향 무관)
    visible.sort((a, b) => (b.memo && b.memo.trim() ? 1 : 0) - (a.memo && a.memo.trim() ? 1 : 0));
  } else {
    visible.sort((a, b) => dir * (numById.get(a.id) - numById.get(b.id)));
  }

  countEl.textContent = demands.length;
  listEl.innerHTML = '';

  for (const d of visible) {
    const li = document.createElement('li');
    li.className = 'demand-item';
    if (d.notFound) li.classList.add('not-found');
    if (ui.selectedDemandId === d.id) li.classList.add('selected');
    if (d.memo && d.memo.trim()) li.classList.add('has-memo');

    const meters = meterSummary(d);
    li.innerHTML = `
      <div class="di-head">
        <span class="di-badge">#${numById.get(d.id)}</span>
        <span class="di-query" title="${esc(d.query)}">${esc(d.query)}</span>
        <button class="di-memo-btn" title="메모">🔖</button>
        <button class="di-del" title="삭제">🗑</button>
      </div>
      <div class="di-addr">${esc(d.address)}</div>
      ${meters ? `<div class="di-meters">🔢 ${meters}</div>` : ''}
      <textarea class="di-memo-input ${d.memo ? '' : 'hidden'}" rows="2" placeholder="메모…">${esc(d.memo || '')}</textarea>
    `;

    li.querySelector('.di-head').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (Number.isFinite(d.lon)) flyTo(d.lon, d.lat);
      setUI({ selectedDemandId: d.id });
    });

    const memoInput = li.querySelector('.di-memo-input');
    li.querySelector('.di-memo-btn').addEventListener('click', () => {
      memoInput.classList.toggle('hidden');
      if (!memoInput.classList.contains('hidden')) memoInput.focus();
    });
    memoInput.addEventListener('change', () => updateDemand(d.id, { memo: memoInput.value }));
    memoInput.addEventListener('blur', () => updateDemand(d.id, { memo: memoInput.value }));

    li.querySelector('.di-del').addEventListener('click', () => removeDemand(d.id));

    listEl.appendChild(li);
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
