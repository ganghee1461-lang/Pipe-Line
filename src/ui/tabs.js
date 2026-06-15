// ── 사이드바 탭 전환 ──
export function initTabs() {
  const nav = document.getElementById('tabs');
  const panes = [...document.querySelectorAll('.tab-pane')];
  nav.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      nav.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      panes.forEach((p) => p.classList.toggle('hidden', p.dataset.tab !== b.dataset.tab));
    });
  });
}
