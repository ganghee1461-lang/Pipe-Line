// ── 저장 / 불러오기 패널 ──
// 저장 = GitHub save/ 폴더에 커밋(/api/save). 목록·불러오기도 GitHub 경유(확인 후 대체).
// 로컬 파일 내보내기/열기도 백업용으로 제공.
import { exportProject, importProject } from '../state/store.js';
import { getViewState, setViewState, exportMapImage } from '../map/map.js';
import { legendEntries } from '../pipes/legend.js';
import { DASH } from '../config/pipeStyles.js';

let nameInput, statusEl, ghListEl, folderSel;
let currentFolder = ''; // '' = 루트

// 프로젝트 데이터 + 현재 편집 시점(지도 위치/줌)
function projectData() {
  return { ...exportProject(), view: getViewState() };
}

export function initSavePanel() {
  nameInput = document.getElementById('save-name');
  statusEl = document.getElementById('save-status');
  ghListEl = document.getElementById('gh-list');
  folderSel = document.getElementById('save-folder');

  document.getElementById('save-btn').addEventListener('click', saveToGithub);
  document.getElementById('gh-list-btn').addEventListener('click', listGithub);
  document.getElementById('folder-new').addEventListener('click', newFolder);
  document.getElementById('folder-del').addEventListener('click', delFolder);
  folderSel.addEventListener('change', () => { currentFolder = folderSel.value; listGithub(); });
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
  loadFolders();
}

function status(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', isErr);
}

// 폴더 목록을 받아 드롭다운 채우고 현재 폴더의 파일 목록 표시
async function loadFolders() {
  try {
    const r = await fetch('/api/save');
    const j = await r.json().catch(() => ({}));
    const folders = j.folders || [];
    folderSel.innerHTML = folders.map((f) => `<option value="${esc(f)}">📁 ${esc(f)}</option>`).join('')
      + '<option value="">· (루트)</option>';
    if (folders.length && !folders.includes(currentFolder) && currentFolder !== '') currentFolder = folders[0];
    folderSel.value = currentFolder;
    renderFolderTargets(folders);
  } catch {
    folderSel.innerHTML = '<option value="">· (루트)</option>';
    currentFolder = '';
    renderFolderTargets([]);
  }
  listGithub();
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
    currentFolder = j.folder || name;
    status(`폴더 생성됨: ${currentFolder}`);
    await loadFolders();
    folderSel.value = currentFolder;
  } catch (err) {
    status(`폴더 생성 실패: ${err.message}`, true);
  }
}

async function delFolder() {
  if (!currentFolder) { status('루트(기타)는 삭제할 수 없어요.', true); return; }
  if (!confirm(`'${currentFolder}' 폴더와 그 안의 저장 파일을 모두 삭제할까요?`)) return;
  status('폴더 삭제 중…');
  try {
    const r = await fetch(`/api/save?folder=${encodeURIComponent(currentFolder)}&rmdir=1`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    status(`폴더 삭제됨: ${currentFolder}`);
    currentFolder = '';
    await loadFolders();
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
    listGithub();
  } catch (err) {
    status(`저장 실패: ${err.message}`, true);
  }
}

async function listGithub() {
  const label = document.getElementById('gh-folder-label');
  if (label) label.textContent = currentFolder ? `(${currentFolder})` : '(루트)';
  ghListEl.innerHTML = '<li class="sv-empty">불러오는 중…</li>';
  try {
    const r = await fetch(`/api/save${folderQuery('?')}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const files = j.files || [];
    if (!files.length) { ghListEl.innerHTML = '<li class="sv-empty">이 폴더에 저장 파일 없음</li>'; return; }
    ghListEl.innerHTML = files
      .map((f) => `<li class="sv-row" draggable="true" data-f="${esc(f)}">
        <span class="sv-name" title="${esc(f)}">${esc(f)}</span>
        <button class="gh-load" data-f="${esc(f)}">열기</button>
        <button class="gh-del" data-f="${esc(f)}" title="삭제">🗑</button>
      </li>`)
      .join('');
    ghListEl.querySelectorAll('.gh-load').forEach((b) => { b.onclick = () => loadGithub(b.dataset.f); });
    ghListEl.querySelectorAll('.gh-del').forEach((b) => { b.onclick = () => deleteGithub(b.dataset.f); });
    bindRowInteractions();
  } catch (err) {
    ghListEl.innerHTML = `<li class="sv-empty">목록 실패 (${esc(String(err.message || err))})</li>`;
  }
}

// ── 파일 이동 (드래그앤드롭 / 잘라내기·붙여넣기) ──
let clipboard = null;   // { file, folder } 잘라낸 파일
let selectedRow = null; // 선택된 파일명 (Ctrl+X 대상)

function bindRowInteractions() {
  ghListEl.querySelectorAll('.sv-row').forEach((row) => {
    const f = row.dataset.f;
    // 행 클릭 = 선택 (Ctrl+X 대상 지정)
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
}

// 폴더 목록(드롭 대상) 렌더 — 드래그해서 폴더 위에 놓으면 이동
function renderFolderTargets(folders) {
  const wrap = document.getElementById('folder-targets');
  if (!wrap) return;
  wrap.innerHTML = folders.map((f) => `<button class="fd-target ${f === currentFolder ? 'cur' : ''}" data-t="${esc(f)}">📁 ${esc(f)}</button>`).join('')
    + `<button class="fd-target ${currentFolder === '' ? 'cur' : ''}" data-t="">· 루트</button>`;

  wrap.querySelectorAll('.fd-target').forEach((btn) => {
    const to = btn.dataset.t;
    btn.addEventListener('click', () => { currentFolder = to; folderSel.value = to; loadFolders(); });
    btn.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; btn.classList.add('over'); });
    btn.addEventListener('dragleave', () => btn.classList.remove('over'));
    btn.addEventListener('drop', async (e) => {
      e.preventDefault();
      btn.classList.remove('over');
      try {
        const { file, folder } = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
        if (file) await moveFile(file, folder, to);
      } catch { /* 잘못된 드롭 데이터 무시 */ }
    });
  });
}

async function moveFile(file, fromFolder, toFolder) {
  if ((fromFolder || '') === (toFolder || '')) return;
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
    listGithub();
  } catch (err) {
    status(`이동 실패: ${err.message}`, true);
  }
}

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
      status(`잘라냄: ${clipboard.file} — 폴더 이동 후 Ctrl+V`);
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
    listGithub();
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
