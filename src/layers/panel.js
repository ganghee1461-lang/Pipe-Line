// ── 레이어 패널 (WMS 토글 / 투명도 / 배경지도 전환) ──
import { toggleWms, setWmsOpacity } from '../map/wms.js';
import { setBasemap } from '../map/map.js';

export function initLayerPanel() {
  bindWms('poss', 'poss-toggle', 'poss-opacity', 0.75);
  bindWms('road', 'road-toggle', 'road-opacity', 0.8);

  document.querySelectorAll('#basemap-switch button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#basemap-switch button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      setBasemap(b.dataset.base);
    });
  });
}

function bindWms(which, toggleId, opacityId, init) {
  const toggle = document.getElementById(toggleId);
  const opacity = document.getElementById(opacityId);
  setWmsOpacity(which, init);
  toggle.addEventListener('change', (e) => toggleWms(which, e.target.checked));
  opacity.addEventListener('input', (e) => setWmsOpacity(which, e.target.value / 100));
}
