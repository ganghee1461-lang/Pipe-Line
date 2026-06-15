// ── 수요처 리스트 (리스트 ↔ 마커 동기화, 메모 편집, 마커 스타일 지정) ──
import { getState, subscribe, updateDemand, removeDemand, setUI } from '../state/store.js';
import { flyTo } from '../map/map.js';
import { MARKER_COLORS, MARKER_SHAPES } from './markers.js';

const listEl = document.getElementById('demand-list');
const countEl = document.getElementById('demand-count');
const filterMemo = document.getElementById('filter-memo');
const openStyle = new Set(); // 스타일 팔레트가 열린 수요처 id

const SHAPE_ICON = { circle: '●', triangle: '▲', square: '■' };

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
    const shape = d.shape || 'circle';
    const li = document.createElement('li');
    li.className = 'demand-item';
    if (d.notFound) li.classList.add('not-found');
    if (ui.selectedDemandId === d.id) li.classList.add('selected');
    if (d.memo && d.memo.trim()) li.classList.add('has-memo');

    li.innerHTML = `
      <div class="di-head">
        <span class="di-badge" style="${d.color ? `background:${d.color}` : ''}">#${d.id}</span>
        <span class="di-query" title="${esc(d.query)}">${esc(d.query)}</span>
        <button class="di-style-btn" title="마커 스타일">🎨</button>
        <button class="di-memo-btn" title="메모">🔖</button>
        <button class="di-del" title="삭제">🗑</button>
      </div>
      <div class="di-style ${openStyle.has(d.id) ? '' : 'hidden'}">
        <div class="di-colors">
          ${MARKER_COLORS.map((c) => `<button class="ci ${d.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        </div>
        <div class="di-shapes">
          ${MARKER_SHAPES.map((sh) => `<button class="si ${shape === sh ? 'on' : ''}" data-shape="${sh}">${SHAPE_ICON[sh]}</button>`).join('')}
        </div>
      </div>
      <div class="di-addr">${esc(d.address)}</div>
      <input class="di-memo-input ${d.memo ? '' : 'hidden'}" placeholder="메모…" value="${esc(d.memo || '')}" />
    `;

    // 리스트 클릭 → 시점 이동 + 선택
    li.querySelector('.di-head').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (Number.isFinite(d.lon)) flyTo(d.lon, d.lat);
      setUI({ selectedDemandId: d.id });
    });

    // 마커 스타일 팔레트 토글
    li.querySelector('.di-style-btn').addEventListener('click', () => {
      if (openStyle.has(d.id)) openStyle.delete(d.id);
      else openStyle.add(d.id);
      li.querySelector('.di-style').classList.toggle('hidden');
    });
    li.querySelectorAll('.ci').forEach((b) => {
      b.addEventListener('click', () => updateDemand(d.id, { color: b.dataset.color }));
    });
    li.querySelectorAll('.si').forEach((b) => {
      b.addEventListener('click', () => updateDemand(d.id, { shape: b.dataset.shape }));
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
