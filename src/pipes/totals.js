// ── 배관 연장 집계 (모드별 타겟 속성으로 그룹, 기존관 제외) ──
import { getState, subscribe, selectSegs, setTool, segKey } from '../state/store.js';
import { legendGroup } from '../config/pipeStyles.js';
import { segLength, fmtLength } from './util.js';

let listEl, sumEl, meterToggle, meterAgg, sortSel, sortDirBtn;
let meterOpen = false;
let sortBy = 'len';  // 'len' | 'name'
let sortAsc = false; // 연장: 기본 많은순(내림차순)

function leadingNum(s) { const m = /^(\d+)/.exec(s); return m ? Number(m[1]) : null; }
function cmpName(a, b) {
  const na = leadingNum(a), nb = leadingNum(b);
  if (na != null && nb != null) return na - nb;
  if (na != null) return -1;
  if (nb != null) return 1;
  return a.localeCompare(b, 'ko');
}

export function initTotals() {
  listEl = document.getElementById('pipe-totals');
  sumEl = document.getElementById('pipe-total-sum');
  meterToggle = document.getElementById('meter-toggle');
  meterAgg = document.getElementById('meter-agg');
  sortSel = document.getElementById('pt-sort');
  sortDirBtn = document.getElementById('pt-sort-dir');
  sortSel.addEventListener('change', () => { sortBy = sortSel.value; render(); });
  sortDirBtn.addEventListener('click', () => { sortAsc = !sortAsc; sortDirBtn.textContent = sortAsc ? '▲' : '▼'; render(); });

  // 집계 항목 클릭 → 해당 속성 선분들 선택·하이라이트
  listEl.addEventListener('click', (e) => {
    const li = e.target.closest('.pt-row');
    if (!li || !li.dataset.key) return;
    selectGroup(li.dataset.key);
  });
  meterToggle.addEventListener('click', () => {
    meterOpen = !meterOpen;
    meterToggle.setAttribute('aria-expanded', String(meterOpen));
    meterToggle.textContent = `${meterOpen ? '▾' : '▸'} 구간별 계량기 정보 보기`;
    meterAgg.classList.toggle('hidden', !meterOpen);
    if (meterOpen) renderMeters();
  });
  subscribe('pipes:changed', () => { render(); if (meterOpen) renderMeters(); });
  subscribe('demands:changed', () => { if (meterOpen) renderMeters(); });
  subscribe('ui:changed', render); // 모드 전환 시 그룹 기준 변경
  render();
}

// 구간별 계량기 집계: 인입관 세그먼트의 마커번호 → 수요처 → 계량기를 구간(section)별 등급으로 합산
function renderMeters() {
  const { pipes, demands } = getState();
  const demandByNum = new Map(); // 표시번호(배열위치+1) → 수요처
  demands.forEach((d, i) => demandByNum.set(i + 1, d));

  // 멀티 세그먼트 인입관 중복 방지: (구간:마커번호) 쌍 1회만 집계
  const seen = new Set();
  const sections = new Map(); // section → Map(grade → qty)
  const missing = new Set();  // 연결되었으나 수요처를 못 찾은 마커번호

  for (const p of pipes) {
    for (const a of p.segs) {
      if (a.use !== 'inlet' || a.markerNo === '' || a.markerNo == null) continue;
      const sec = a.section || 1;
      const pairKey = `${sec}:${a.markerNo}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const d = demandByNum.get(Number(a.markerNo));
      if (!d) { missing.add(a.markerNo); continue; }
      if (!sections.has(sec)) sections.set(sec, new Map());
      const gmap = sections.get(sec);
      for (const m of d.meters || []) {
        gmap.set(m.grade, (gmap.get(m.grade) || 0) + (Number(m.qty) || 0));
      }
    }
  }

  if (!sections.size) {
    meterAgg.innerHTML = `<div class="ma-empty">인입관에 마커번호를 입력하면 구간별 계량기가 집계됩니다.${
      missing.size ? `<br>※ 미연결 번호: ${[...missing].join(', ')}` : ''}</div>`;
    return;
  }

  const rows = [...sections.entries()].sort((a, b) => a[0] - b[0]);
  meterAgg.innerHTML = rows.map(([sec, gmap]) => {
    const total = [...gmap.values()].reduce((s, q) => s + q, 0);
    const grades = [...gmap.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([g, q]) => `<span class="ma-chip">${esc(g)}호 <b>${q}</b></span>`).join('');
    return `<div class="ma-sec">
        <div class="ma-sec-head"><span>${sec}번 구간</span><span class="ma-sec-total">계 ${total}개</span></div>
        <div class="ma-chips">${grades}</div>
      </div>`;
  }).join('') + (missing.size ? `<div class="ma-empty">※ 미연결 번호: ${[...missing].join(', ')}</div>` : '');
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

  const dir = sortAsc ? 1 : -1;
  const rows = [...groups.entries()].sort((a, b) =>
    sortBy === 'name' ? dir * cmpName(a[0], b[0]) : dir * (a[1] - b[1]));
  listEl.innerHTML = rows
    .map(([k, len]) => `
      <li class="pt-row" data-key="${esc(k)}" title="클릭하면 해당 선분 선택">
        <span class="pt-key">${esc(k)}</span>
        <span class="pt-val">${fmtLength(len)}</span>
      </li>`)
    .join('');
  sumEl.textContent = `합계 ${fmtLength(total)}`;
}

// 같은 그룹(legendGroup) 라벨을 가진 모든 선분을 선택
function selectGroup(key) {
  const { pipes, ui } = getState();
  const keys = [];
  for (const p of pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      if (legendGroup(p.segs[i], ui.mode, ui.colorBy) === key) keys.push(segKey(p.id, i));
    }
  }
  if (!keys.length) return;
  setTool('select');
  selectSegs(keys);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
