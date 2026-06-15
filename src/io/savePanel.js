// ── 저장 / 불러오기 패널 ──
// 저장 = GitHub save/ 폴더에 커밋(/api/save). 목록·불러오기도 GitHub 경유(확인 후 대체).
// 로컬 파일 내보내기/열기도 백업용으로 제공.
import { exportProject, importProject } from '../state/store.js';

let nameInput, statusEl, ghListEl;

export function initSavePanel() {
  nameInput = document.getElementById('save-name');
  statusEl = document.getElementById('save-status');
  ghListEl = document.getElementById('gh-list');

  document.getElementById('save-btn').addEventListener('click', saveToGithub);
  document.getElementById('gh-list-btn').addEventListener('click', listGithub);
  document.getElementById('export-btn').addEventListener('click', exportFile);
  const importFile = document.getElementById('import-file');
  document.getElementById('import-btn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importFromFile);

  listGithub();
}

function status(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', isErr);
}

async function saveToGithub() {
  const name = (nameInput.value || '').trim();
  if (!name) { nameInput.focus(); return; }
  status('GitHub에 저장 중…');
  try {
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: exportProject() }),
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
  ghListEl.innerHTML = '<li class="sv-empty">불러오는 중…</li>';
  try {
    const r = await fetch('/api/save');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const files = j.files || [];
    if (!files.length) { ghListEl.innerHTML = '<li class="sv-empty">save/ 폴더에 저장 파일 없음</li>'; return; }
    ghListEl.innerHTML = files
      .map((f) => `<li class="sv-row"><span class="sv-name" title="${esc(f)}">${esc(f)}</span><button class="gh-load" data-f="${esc(f)}">열기</button></li>`)
      .join('');
    ghListEl.querySelectorAll('.gh-load').forEach((b) => { b.onclick = () => loadGithub(b.dataset.f); });
  } catch (err) {
    ghListEl.innerHTML = `<li class="sv-empty">목록 실패 (${esc(String(err.message || err))})</li>`;
  }
}

async function loadGithub(file) {
  if (!confirm(`'${file}' 을(를) 불러올까요?\n현재 작업 내용이 대체됩니다.`)) return;
  try {
    const r = await fetch(`/api/save?file=${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    importProject(await r.json());
    status(`불러옴: ${file}`);
    nameInput.value = file.replace(/\.json$/i, '');
  } catch (err) {
    status(`불러오기 실패: ${err.message}`, true);
  }
}

function exportFile() {
  const name = (nameInput.value || 'pipeline').trim();
  const blob = new Blob([JSON.stringify(exportProject(), null, 2)], { type: 'application/json' });
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
      importProject(JSON.parse(reader.result));
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
