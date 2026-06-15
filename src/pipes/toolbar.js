// ── 배관 도구 툴바 (지도 위) ──
import { getState, subscribe, setTool, undo, redo, canUndo, canRedo } from '../state/store.js';

const HINTS = {
  select: '클릭 선택 · Shift+드래그 박스선택 · Ctrl+클릭 추가선택 · Del 삭제',
  draw: '클릭으로 점 찍기 · 더블클릭 완료 · Esc 취소',
  vertex: '꼭짓점 드래그로 수정 · Ctrl+클릭 점 추가 · Alt+클릭 점 삭제',
};

export function initPipeToolbar() {
  const bar = document.getElementById('pipe-tools');
  const undoBtn = document.getElementById('tb-undo');
  const redoBtn = document.getElementById('tb-redo');
  const hintEl = document.getElementById('pipe-hint');

  bar.querySelectorAll('button[data-tool]').forEach((b) => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  function refresh() {
    const { tool } = getState().ui;
    bar.querySelectorAll('button[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    undoBtn.disabled = !canUndo();
    redoBtn.disabled = !canRedo();
    hintEl.textContent = HINTS[tool] || '';
  }
  subscribe('ui:changed', refresh);
  subscribe('pipes:changed', refresh);
  refresh();
}
