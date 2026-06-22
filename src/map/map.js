// ── 지도 코어: OpenLayers Map + 배경지도 ──
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { boundingExtent } from 'ol/extent.js';
import { tileUrl } from '../config/vworld.js';
import { getState, setUI } from '../state/store.js';

function makeBasemapSource(layer) {
  return new XYZ({
    url: tileUrl(layer),
    maxZoom: 19,
    crossOrigin: 'anonymous',
    attributions: '© <a href="https://www.vworld.kr" target="_blank">VWorld</a>',
  });
}

export const basemapLayer = new TileLayer({
  source: makeBasemapSource('Base'),
  zIndex: 0,
});

export const map = new Map({
  target: 'map',
  layers: [basemapLayer],
  view: new View({
    center: fromLonLat([127.0, 37.55]),
    zoom: 12,
    minZoom: 6,
    maxZoom: 21,
  }),
});

export function setBasemap(layer) {
  basemapLayer.setSource(makeBasemapSource(layer));
  setUI({ basemap: layer });
}

// 부드러운 시점 이동 (수요처 리스트 클릭용)
export function flyTo(lon, lat, zoom = 17) {
  const view = map.getView();
  const target = Math.max(view.getZoom(), zoom);
  view.animate({ center: fromLonLat([lon, lat]), zoom: target, duration: 500 });
}

// 여러 좌표가 모두 보이도록 시점 맞춤 (검색 결과 포커스용)
export function fitToLonLats(lonlats, { maxZoom = 17, padding = 90 } = {}) {
  const pts = lonlats.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (!pts.length) return;
  if (pts.length === 1) { flyTo(pts[0][0], pts[0][1], maxZoom); return; }
  const ext = boundingExtent(pts.map(([lon, lat]) => fromLonLat([lon, lat])));
  map.getView().fit(ext, { duration: 500, maxZoom, padding: [padding, padding, padding, padding] });
}

export function currentZoom() {
  return map.getView().getZoom();
}

// 편집 시점(중심 좌표 + 줌) 저장/복원 — 프로젝트 저장 시 함께 보관
export function getViewState() {
  const v = map.getView();
  const c = v.getCenter();
  if (!c) return null;
  const [lon, lat] = toLonLat(c);
  return { lon, lat, zoom: v.getZoom() };
}
export function setViewState(s) {
  if (!s) return;
  const v = map.getView();
  if (Number.isFinite(s.lon) && Number.isFinite(s.lat)) v.setCenter(fromLonLat([s.lon, s.lat]));
  if (Number.isFinite(s.zoom)) v.setZoom(s.zoom);
}

// 지금 보이는 지도 화면을 그대로 PNG(Blob)로 — 리사이즈/줌 변경 없이 현재 캔버스를
// device 해상도(보이는 그대로, HiDPI면 자동 고화질)로 합성. 패널/팝업(DOM)은 자동 제외.
// drawOverlay(ctx, w, h, scale)로 범례 등을 덧그릴 수 있다.
// WMS(소유지적/도시계획)가 켜져 있으면 캔버스가 tainted 되어 보안 제한으로 실패할 수 있다(reject).
export function exportMapImage(drawOverlay = null) {
  return new Promise((resolve, reject) => {
    const dpr = window.devicePixelRatio || 1;
    const size = map.getSize();
    const width = Math.round(size[0] * dpr);
    const height = Math.round(size[1] * dpr);

    map.once('rendercomplete', () => {
      try {
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        map.getViewport()
          .querySelectorAll('.ol-layer canvas, canvas.ol-layer')
          .forEach((canvas) => {
            if (!canvas.width) return;
            const opacity = canvas.parentNode.style.opacity || canvas.style.opacity;
            ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);
            const transform = canvas.style.transform;
            // 캔버스 transform(CSS px)을 dpr만큼 키워 device 해상도로 1:1 합성
            let m = [1, 0, 0, 1, 0, 0];
            const mm = transform && transform.match(/^matrix\(([^(]*)\)$/);
            if (mm) m = mm[1].split(',').map(Number);
            ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
            ctx.drawImage(canvas, 0, 0);
          });
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (drawOverlay) drawOverlay(ctx, width, height, dpr);
        out.toBlob((blob) => {
          blob ? resolve(blob) : reject(new Error('보안 제한(소유지적도·도시계획 레이어를 끄고 다시 시도)'));
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    });
    map.renderSync();
  });
}

// 디버그 편의
if (import.meta.env.DEV) window.__map = map;
export { getState };
