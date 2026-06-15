// ── 저장 / 불러오기 패널 ──
// 브라우저(localStorage)에 이름별 저장 + JSON 파일 내보내기/불러오기.
// 내보낸 .json 은 GitHub 저장소 save/ 폴더에 커밋해 공유·보관할 수 있다.
import { exportProject, importProject } from '../state/store.js';

const KEY = 'pipeline.saves';
// GitHub 공개 저장소의 save/ 폴더에서 직접 불러오기 (읽기 전용, 인증 불필요)
const GH = { owner: 'ganghee1461-lang', repo: 'Pipe-Line', branch: 'claude/bold-keller-gidnt6', dir: 'save' };
let nameInput, listEl, ghListEl;

function loadSaves() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function persist(s) { localStorage.setItem(KEY, JSON.stringify(s)); }

export function initSavePanel() {
  nameInput = document.getElementById('save-name');
  listEl = document.getElementById('save-list');
  document.getElementById('save-btn').addEventListener('click', save);
  document.getElementById('export-btn').addEventListener('click', exportFile);
  const importFile = document.getElementById('import-file');
  document.getElementById('import-btn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importFromFile);

  ghListEl = document.getElementById('gh-list');
  document.getElementById('gh-list-btn').addEventListener('click', listGithub);

  renderList();
}

async function listGithub() {
  ghListEl.innerHTML = '<li class="sv-empty">불러오는 중…</li>';
  try {
    const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.dir}?ref=${GH.branch}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const files = (await r.json())
      .filter((x) => x.type === 'file' && x.name.toLowerCase().endsWith('.json'));
    if (!files.length) { ghListEl.innerHTML = '<li class="sv-empty">save/ 폴더에 저장 파일 없음</li>'; return; }
    ghListEl.innerHTML = files
      .map((f) => `<li class="sv-row"><span class="sv-name" title="${esc(f.name)}">${esc(f.name)}</span><button class="gh-load" data-u="${esc(f.download_url)}">열기</button></li>`)
      .join('');
    ghListEl.querySelectorAll('.gh-load').forEach((b) => { b.onclick = () => loadGithub(b.dataset.u); });
  } catch (err) {
    ghListEl.innerHTML = `<li class="sv-empty">불러오기 실패 (${esc(String(err.message || err))}) — 비공개 저장소면 불가</li>`;
  }
}

async function loadGithub(downloadUrl) {
  try {
    const r = await fetch(downloadUrl);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    importProject(await r.json());
  } catch {
    alert('GitHub 파일 불러오기 실패');
  }
}

function save() {
  const name = (nameInput.value || '').trim();
  if (!name) { nameInput.focus(); return; }
  const saves = loadSaves();
  saves[name] = exportProject();
  persist(saves);
  renderList();
}

function renderList() {
  const saves = loadSaves();
  const names = Object.keys(saves).sort();
  if (!names.length) { listEl.innerHTML = '<li class="sv-empty">저장된 항목 없음</li>'; return; }
  listEl.innerHTML = names
    .map((n) => `
      <li class="sv-row">
        <span class="sv-name" title="${esc(n)}">${esc(n)}</span>
        <button class="sv-load" data-n="${esc(n)}">열기</button>
        <button class="sv-dl" data-n="${esc(n)}" title="파일로 내보내기">⬇</button>
        <button class="sv-del" data-n="${esc(n)}" title="삭제">🗑</button>
      </li>`)
    .join('');
  listEl.querySelectorAll('.sv-load').forEach((b) => { b.onclick = () => importProject(loadSaves()[b.dataset.n]); });
  listEl.querySelectorAll('.sv-dl').forEach((b) => { b.onclick = () => download(b.dataset.n, loadSaves()[b.dataset.n]); });
  listEl.querySelectorAll('.sv-del').forEach((b) => {
    b.onclick = () => { const s = loadSaves(); delete s[b.dataset.n]; persist(s); renderList(); };
  });
}

function exportFile() {
  const name = (nameInput.value || 'pipeline').trim();
  download(name, exportProject());
}

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importFromFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      importProject(data);
      const name = file.name.replace(/\.json$/i, '');
      const saves = loadSaves();
      saves[name] = data;
      persist(saves);
      renderList();
      if (nameInput) nameInput.value = name;
    } catch {
      alert('불러오기 실패: 올바른 JSON 파일이 아닙니다.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
