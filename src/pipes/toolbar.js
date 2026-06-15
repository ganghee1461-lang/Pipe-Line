// ── 배관 도구 툴바 (지도 위) ──
import { getState, subscribe, setTool, undo, redo, canUndo, canRedo } from '../state/store.js';

export function initPipeToolbar() {
  const bar = document.getElementById('pipe-tools');
  const undoBtn = document.getElementById('tb-undo');
  const redoBtn = document.getElementById('tb-redo');

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
  }
  subscribe('ui:changed', refresh);
  subscribe('pipes:changed', refresh);
  refresh();
}
