// ── 저장 / 불러오기 패널 ──
// 저장 = GitHub save/ 폴더에 커밋(/api/save). 목록·불러오기도 GitHub 경유(확인 후 대체).
// 로컬 파일 내보내기/열기도 백업용으로 제공.
import { exportProject, importProject } from '../state/store.js';
import { getViewState, setViewState, exportMapImage } from '../map/map.js';
import { legendEntries } from '../pipes/legend.js';
import { DASH } from '../config/pipeStyles.js';

let nameInput, statusEl, ghListEl, pathEl;
let currentFolder = '';   // '' = save 루트
let folders = [];         // 루트의 폴더 목록
let files = [];           // 현재 위치의 파일 목록

// 프로젝트 데이터 + 현재 편집 시점(지도 위치/줌)
function projectData() {
  return { ...exportProject(), view: getViewState() };
}

export function initSavePanel() {
  nameInput = document.getElementById('save-name');
  statusEl = document.getElementById('save-status');
  ghListEl = document.getElementById('gh-list');
  pathEl = document.getElementById('sv-path');

  document.getElementById('save-btn').addEventListener('click', saveToGithub);
  document.getElementById('gh-list-btn').addEventListener('click', refresh);
  document.getElementById('folder-new').addEventListener('click', newFolder);
  document.getElementById('folder-del').addEventListener('click', delFolder);
  document.getElementById('export-btn').addEventListener('click', exportFile);
  const importFile = document.getElementById('import-file');
  document.getElementById('import-btn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importFromFile);
  document.getElementById('export-img-btn').addEventListener('click', exportImage);

  // Ctrl+S / Cmd+S → GitHub 저장
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveToGithub();
    }
  });

  initClipboard();
  refresh();
}

function status(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', isErr);
}

// ── 탐색기: 현재 위치의 폴더/파일을 읽어 렌더 ──
async function refresh() {
  ghListEl.innerHTML = '<li class="sv-empty">불러오는 중…</li>';
  try {
    // 폴더 목록은 항상 루트에서 (한 단계 구조)
    const rootRes = await fetch('/api/save');
    const rootJson = await rootRes.json().catch(() => ({}));
    if (!rootRes.ok) throw new Error(rootJson.error || `HTTP ${rootRes.status}`);
    folders = rootJson.folders || [];
    if (currentFolder && !folders.includes(currentFolder)) currentFolder = ''; // 삭제된 폴더 방어

    if (currentFolder) {
      const r = await fetch(`/api/save?folder=${encodeURIComponent(currentFolder)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      files = j.files || [];
    } else {
      files = rootJson.files || [];
    }
    render();
  } catch (err) {
    ghListEl.innerHTML = `<li class="sv-empty">목록 실패 (${esc(String(err.message || err))})</li>`;
  }
}

function render() {
  // 경로 표시 (save / 폴더)
  pathEl.innerHTML = currentFolder
    ? `<button class="sv-crumb" data-up="1">save</button><span class="sv-sep">/</span><b>${esc(currentFolder)}</b>`
    : '<b>save</b>';
  const up = pathEl.querySelector('[data-up]');
  if (up) up.onclick = () => { currentFolder = ''; refresh(); };

  const rows = [];
  // 상위로 (폴더 안일 때)
  if (currentFolder) {
    rows.push('<li class="sv-row sv-up" data-up="1"><span class="sv-ico">↰</span><span class="sv-name">상위 폴더로</span></li>');
  }
  // 폴더 (루트에서만 — 한 단계 구조)
  if (!currentFolder) {
    for (const f of folders) {
      rows.push(`<li class="sv-row sv-dir" data-dir="${esc(f)}">
        <span class="sv-ico">📁</span>
        <span class="sv-name" title="${esc(f)}">${esc(f)}</span>
      </li>`);
    }
  }
  // 파일
  for (const f of files) {
    rows.push(`<li class="sv-row sv-file" draggable="true" data-f="${esc(f)}">
      <span class="sv-ico">📄</span>
      <span class="sv-name" title="${esc(f)}">${esc(f.replace(/\.json$/i, ''))}</span>
      <button class="gh-load" data-f="${esc(f)}">열기</button>
      <button class="gh-del" data-f="${esc(f)}" title="삭제">🗑</button>
    </li>`);
  }
  if (!rows.length) rows.push('<li class="sv-empty">비어 있음 — 아래에서 저장해 보세요</li>');
  ghListEl.innerHTML = rows.join('');

  // 상위로 / 폴더 진입
  ghListEl.querySelectorAll('[data-up]').forEach((el) => {
    el.onclick = () => { currentFolder = ''; refresh(); };
  });
  ghListEl.querySelectorAll('.sv-dir').forEach((el) => {
    el.onclick = () => { currentFolder = el.dataset.dir; refresh(); };
  });
  ghListEl.querySelectorAll('.gh-load').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); loadGithub(b.dataset.f); };
  });
  ghListEl.querySelectorAll('.gh-del').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); deleteGithub(b.dataset.f); };
  });
  bindRowInteractions();

  // 저장 위치 안내 (입력창 placeholder)
  nameInput.placeholder = currentFolder ? `${currentFolder} 에 저장할 파일 이름` : '파일 이름';
  document.getElementById('folder-del').disabled = !currentFolder;
}

async function newFolder() {
  const name = (prompt('새 폴더 이름 (예: 제천)') || '').trim();
  if (!name) return;
  status('폴더 생성 중…');
  try {
    const r = await fetch('/api/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mkdir: name }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    status(`폴더 생성됨: ${j.folder || name}`);
    currentFolder = '';
    refresh();
  } catch (err) {
    status(`폴더 생성 실패: ${err.message}`, true);
  }
}

async function delFolder() {
  if (!currentFolder) return;
  if (!confirm(`'${currentFolder}' 폴더와 그 안의 저장 파일을 모두 삭제할까요?`)) return;
  status('폴더 삭제 중…');
  try {
    const r = await fetch(`/api/save?folder=${encodeURIComponent(currentFolder)}&rmdir=1`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    status(`폴더 삭제됨: ${currentFolder}`);
    currentFolder = '';
    refresh();
  } catch (err) {
    status(`폴더 삭제 실패: ${err.message}`, true);
  }
}

function folderQuery(prefix = '?') {
  return currentFolder ? `${prefix}folder=${encodeURIComponent(currentFolder)}` : '';
}

async function saveToGithub() {
  const name = (nameInput.value || '').trim();
  if (!name) { nameInput.focus(); return; }
  status('GitHub에 저장 중…');
  try {
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: currentFolder, name, data: projectData() }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    status(`저장됨: ${j.path}`);
    refresh();
  } catch (err) {
    status(`저장 실패: ${err.message}`, true);
  }
}

// ── 파일 이동 (드래그앤드롭 / 잘라내기·붙여넣기) ──
let clipboard = null;   // { file, folder } 잘라낸 파일
let selectedRow = null; // 선택된 파일명 (Ctrl+X 대상)

function bindRowInteractions() {
  // 파일 행: 선택 / 드래그 시작
  ghListEl.querySelectorAll('.sv-file').forEach((row) => {
    const f = row.dataset.f;
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      ghListEl.querySelectorAll('.sv-row').forEach((r) => r.classList.remove('sel'));
      row.classList.add('sel');
      selectedRow = f;
    });
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ file: f, folder: currentFolder }));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
  });

  // 폴더 행 / '상위 폴더로' 행 = 드롭 대상
  ghListEl.querySelectorAll('.sv-dir, .sv-up').forEach((el) => {
    const to = el.classList.contains('sv-up') ? '' : el.dataset.dir;
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('over');
      try {
        const { file, folder } = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
        if (file) await moveFile(file, folder, to);
      } catch { /* 잘못된 드롭 데이터 무시 */ }
    });
  });
}

async function moveFile(file, fromFolder, toFolder) {
  if ((fromFolder || '') === (toFolder || '')) return;
  // 낙관적 갱신: GitHub 목록 API는 커밋 직후 캐시로 지연될 수 있어 화면을 먼저 정리한다.
  const row = ghListEl.querySelector(`.sv-file[data-f="${cssEsc(file)}"]`);
  if (row) row.remove();
  status(`이동 중… ${file}`);
  try {
    const r = await fetch(`/api/save${fromFolder ? `?folder=${encodeURIComponent(fromFolder)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ move: { file, to: toFolder } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    status(`이동됨: ${j.path}`);
  } catch (err) {
    status(`이동 실패: ${err.message}`, true);
  }
  refresh();
}

// querySelector용 속성값 이스케이프
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

// Ctrl+X 잘라내기 / Ctrl+V 현재 폴더에 붙여넣기
function initClipboard() {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'x' || e.key === 'X') {
      if (!selectedRow) return;
      e.preventDefault();
      clipboard = { file: selectedRow, folder: currentFolder };
      status(`잘라냄: ${clipboard.file} — 폴더로 이동 후 Ctrl+V`);
    } else if (e.key === 'v' || e.key === 'V') {
      if (!clipboard) return;
      e.preventDefault();
      const { file, folder } = clipboard;
      clipboard = null;
      moveFile(file, folder, currentFolder);
    }
  });
}
async function loadGithub(file) {
  if (!confirm(`'${file}' 을(를) 불러올까요?\n현재 작업 내용이 대체됩니다.`)) return;
  try {
    const r = await fetch(`/api/save?file=${encodeURIComponent(file)}${folderQuery('&')}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    importProject(data);
    setViewState(data.view);
    status(`불러옴: ${file}`);
    nameInput.value = file.replace(/\.json$/i, '');
  } catch (err) {
    status(`불러오기 실패: ${err.message}`, true);
  }
}

async function deleteGithub(file) {
  if (!confirm(`'${file}' 을(를) 삭제할까요?`)) return;
  try {
    const r = await fetch(`/api/save?file=${encodeURIComponent(file)}${folderQuery('&')}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    status(`삭제됨: ${file}`);
    refresh();
  } catch (err) {
    status(`삭제 실패: ${err.message}`, true);
  }
}

// 범례를 캔버스 우상단에 그린다 (DOM이 아니라 직접 렌더 → 이미지에 포함)
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawLegend(ctx, width, height, scale) {
  const entries = legendEntries();
  if (!entries.length) return;
  const s = scale;
  const pad = 11 * s, sw = 26 * s, gap = 9 * s, rowH = 17 * s;
  const fs = 12 * s, titleFs = 12 * s, titleH = 22 * s;
  ctx.font = `${fs}px "Noto Sans KR", sans-serif`;
  let maxLabel = 0;
  for (const e of entries) maxLabel = Math.max(maxLabel, ctx.measureText(e.label).width);
  const boxW = pad * 2 + sw + gap + maxLabel;
  const boxH = titleH + pad * 0.5 + entries.length * rowH + pad * 0.5;
  const x = width - boxW - 14 * s;
  const y = 14 * s;

  roundRect(ctx, x, y, boxW, boxH, 8 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.lineWidth = 1 * s;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.stroke();

  ctx.fillStyle = '#111827';
  ctx.font = `700 ${titleFs}px "Noto Sans KR", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('범례', x + pad, y + titleH / 2);

  let ry = y + titleH + pad * 0.5 + rowH / 2;
  for (const e of entries) {
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 3 * s;
    ctx.setLineDash((DASH[e.dash] || []).map((v) => v * s));
    ctx.beginPath();
    ctx.moveTo(x + pad, ry);
    ctx.lineTo(x + pad + sw, ry);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#1f2937';
    ctx.font = `${fs}px "Noto Sans KR", sans-serif`;
    ctx.fillText(e.label, x + pad + sw + gap, ry);
    ry += rowH;
  }
}

async function exportImage() {
  const btn = document.getElementById('export-img-btn');
  const statusBox = document.getElementById('export-img-status');
  const withLegend = document.getElementById('export-legend').checked;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '이미지 생성 중…';
  try {
    const blob = await exportMapImage(withLegend ? drawLegend : null);
    const name = (nameInput.value || 'pipeline').trim();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    statusBox.textContent = '저장됨 ✓';
  } catch (err) {
    statusBox.textContent = `실패: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

function exportFile() {
  const name = (nameInput.value || 'pipeline').trim();
  const blob = new Blob([JSON.stringify(projectData(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importFromFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm(`'${file.name}' 을(를) 불러올까요?\n현재 작업 내용이 대체됩니다.`)) { e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      importProject(data);
      setViewState(data.view);
      if (nameInput) nameInput.value = file.name.replace(/\.json$/i, '');
      status(`불러옴: ${file.name}`);
    } catch {
      status('불러오기 실패: 올바른 JSON이 아닙니다.', true);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
