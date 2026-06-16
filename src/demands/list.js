// ── 수요처 리스트 (리스트 ↔ 마커 동기화, 메모 편집) ──
import { getState, subscribe, updateDemand, removeDemand, setUI } from '../state/store.js';
import { flyTo } from '../map/map.js';

const listEl = document.getElementById('demand-list');
const countEl = document.getElementById('demand-count');
const filterMemo = document.getElementById('filter-memo');

export function initList() {
  subscribe('demands:changed', render);
  subscribe('ui:changed', render);
  filterMemo.addEventListener('change', (e) => setUI({ filterMemoOnly: e.target.checked }));
}

function render() {
  const { demands, ui } = getState();
  const visible = ui.filterMemoOnly
    ? demands.filter((d) => d.memo && d.memo.trim())
    : demands;

  countEl.textContent = demands.length;
  listEl.innerHTML = '';

  for (const d of visible) {
    const li = document.createElement('li');
    li.className = 'demand-item';
    if (d.notFound) li.classList.add('not-found');
    if (ui.selectedDemandId === d.id) li.classList.add('selected');
    if (d.memo && d.memo.trim()) li.classList.add('has-memo');

    li.innerHTML = `
      <div class="di-head">
        <span class="di-badge">#${d.id}</span>
        <span class="di-query" title="${esc(d.query)}">${esc(d.query)}</span>
        <button class="di-memo-btn" title="메모">🔖</button>
        <button class="di-del" title="삭제">🗑</button>
      </div>
      <div class="di-addr">${esc(d.address)}</div>
      <textarea class="di-memo-input ${d.memo ? '' : 'hidden'}" rows="2" placeholder="메모…">${esc(d.memo || '')}</textarea>
    `;

    // 리스트 클릭 → 시점 이동 + 선택
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
