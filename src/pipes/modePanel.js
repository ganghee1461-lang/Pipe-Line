// ── 모드 전환 (영업 / 굴착심의 / 배관망) + 영업 색상 기준(관경/포장) ──
import { getState, subscribe, setUI } from '../state/store.js';

const LEGEND = {
  sales: { diameter: '신설=관경별 색 · 기존관=회색 실선', pavement: '신설=포장별 색 · 기존관=회색 실선' },
  excavation: '기존관=파란 점선 · 심의대상=빨간 실선 · 미대상=빨간 점선',
  network: '기존관=파란 실선 · 신설=구간(N)별 색',
};

let collapsed = false;

export function initModePanel() {
  const seg = document.getElementById('mode-switch');
  const cbSeg = document.getElementById('colorby-switch');
  const legend = document.getElementById('mode-legend');
  const collapseBtn = document.getElementById('mode-collapse');

  // 모드 선택 레이아웃 접기/펼치기 (패널 하단 화살표)
  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    seg.style.display = collapsed ? 'none' : '';
    collapseBtn.textContent = collapsed ? '▾' : '▴';
    collapseBtn.title = collapsed ? '모드 탭 펼치기' : '모드 탭 접기';
    refresh();
  });

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
    // 색상 기준 토글은 영업 모드에서만 의미 (접힌 상태에선 숨김)
    cbSeg.style.display = (!collapsed && mode === 'sales') ? '' : 'none';
    legend.textContent = mode === 'sales' ? LEGEND.sales[colorBy] : LEGEND[mode];
  }
  subscribe('ui:changed', refresh);
  refresh();
}
