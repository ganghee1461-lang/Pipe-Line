// ── 모드 전환 (영업 / 굴착심의 / 배관망 분석) ──
// 모드는 시각표현(배관 색/대시)만 바꾼다. 원본 데이터는 불변.
import { getState, subscribe, setUI } from '../state/store.js';

const LEGEND = {
  sales: '신설=관경별 색 · 기존관=회색 실선',
  excavation: '기존관=파란 점선 · 심의대상=빨간 실선 · 미대상=빨간 점선',
  network: '기존관=파란 실선 · 신설=관경별 색',
};

export function initModePanel() {
  const seg = document.getElementById('mode-switch');
  const legend = document.getElementById('mode-legend');

  seg.querySelectorAll('button[data-mode]').forEach((b) => {
    b.addEventListener('click', () => setUI({ mode: b.dataset.mode }));
  });

  function refresh() {
    const { mode } = getState().ui;
    seg.querySelectorAll('button[data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    legend.textContent = LEGEND[mode] || '';
  }
  subscribe('ui:changed', refresh);
  refresh();
}
