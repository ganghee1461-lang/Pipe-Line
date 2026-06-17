// ── 모드 전환 (영업 / 굴착심의 / 배관망) + 영업 색상 기준(관경/포장) ──
import { getState, subscribe, setUI } from '../state/store.js';

const LEGEND = {
  sales: { diameter: '신설=관경별 색 · 기존관=회색 실선', pavement: '신설=포장별 색 · 기존관=회색 실선' },
  excavation: '기존관=파란 점선 · 심의대상=빨간 실선 · 미대상=빨간 점선',
  network: '기존관=파란 실선 · 신설=구간(N)별 색',
};

export function initModePanel() {
  const seg = document.getElementById('mode-switch');
  const cbSeg = document.getElementById('colorby-switch');
  const legend = document.getElementById('mode-legend');

  // 모드 전환 탭 숨기기 토글 (디자인 탭)
  const hideToggle = document.getElementById('hide-modetabs');
  if (hideToggle) {
    hideToggle.addEventListener('change', () => {
      seg.style.display = hideToggle.checked ? 'none' : '';
    });
  }

  seg.querySelectorAll('button[data-mode]').forEach((b) => {
    b.addEventListener('click', () => setUI({ mode: b.dataset.mode }));
  });
  cbSeg.querySelectorAll('button[data-colorby]').forEach((b) => {
    b.addEventListener('click', () => setUI({ colorBy: b.dataset.colorby }));
  });

  function refresh() {
    const { mode, colorBy } = getState().ui;
    seg.querySelectorAll('button[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    cbSeg.querySelectorAll('button[data-colorby]').forEach((b) => b.classList.toggle('active', b.dataset.colorby === colorBy));
    // 색상 기준 토글은 영업 모드에서만 의미
    cbSeg.style.display = mode === 'sales' ? '' : 'none';
    legend.textContent = mode === 'sales' ? LEGEND.sales[colorBy] : LEGEND[mode];
  }
  subscribe('ui:changed', refresh);
  refresh();
}
