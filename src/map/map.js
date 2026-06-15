// ── 지도 코어: OpenLayers Map + 배경지도 ──
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import { fromLonLat } from 'ol/proj.js';
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

// 디버그 편의
if (import.meta.env.DEV) window.__map = map;
export { getState };
