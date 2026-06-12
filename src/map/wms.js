// ── WMS 레이어 (소유구분지적도 / 도시계획도로) ──
// VWorld WMS는 EPSG:3857 GetMap 이미지. OpenLayers ImageWMS 로 처리하고
// 키/도메인은 customParams 로 주입. 줌 임계값 미만에서는 자동 비표시.
import ImageLayer from 'ol/layer/Image.js';
import ImageWMS from 'ol/source/ImageWMS.js';
import { VWORLD, base, IS_MOCK } from '../config/vworld.js';
import { map } from './map.js';

function makeWms({ url, layers, ned }) {
  // ned/wms(소유지적)는 파라미터가 조금 다르다(레거시 기준):
  //   layers=dt_d160, transparent=false, bgcolor=0xFFFFFF, exceptions=blank
  const params = ned
    ? {
        layers, crs: 'EPSG:3857', format: 'image/png',
        transparent: false, bgcolor: '0xFFFFFF', exceptions: 'blank',
        key: VWORLD.key, domain: VWORLD.domain,
      }
    : {
        SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
        LAYERS: layers, FORMAT: 'image/png', TRANSPARENT: true,
        CRS: 'EPSG:3857', key: VWORLD.key,
      };
  return new ImageLayer({
    source: new ImageWMS({
      url,
      params,
      crossOrigin: 'anonymous',
      ratio: 1,
      // ned WMS는 표준 GetMap이 아니라 직접 URL 조립이 필요할 수 있음 → serverType 미지정
    }),
    visible: false,
    opacity: 0.75,
    zIndex: 0,
  });
}

export const possLayer = makeWms({
  url: base().possWms, layers: VWORLD.layers.possession, ned: true,
});
export const roadLayer = makeWms({
  url: base().roadWms, layers: VWORLD.layers.cityRoad, ned: false,
});
possLayer.setZIndex(4);
roadLayer.setZIndex(5);
map.addLayer(possLayer);
map.addLayer(roadLayer);

// 줌 임계값에 따라 가시성 보정
function enforceMinZoom() {
  const z = map.getView().getZoom();
  if (possLayer.getVisible() && z < VWORLD.minZoom.possession) possLayer.setOpacity(0);
  else if (possLayer.getVisible()) possLayer.setOpacity(possLayer.get('userOpacity') ?? 0.75);
  if (roadLayer.getVisible() && z < VWORLD.minZoom.road) roadLayer.setOpacity(0);
  else if (roadLayer.getVisible()) roadLayer.setOpacity(roadLayer.get('userOpacity') ?? 0.8);
}
map.getView().on('change:resolution', enforceMinZoom);

export function toggleWms(which, on) {
  const layer = which === 'poss' ? possLayer : roadLayer;
  layer.setVisible(on);
  enforceMinZoom();
  if (on && IS_MOCK) console.info(`[mock] ${which} WMS 토글 — 실제 타일은 키 연결 후 표시`);
}

export function setWmsOpacity(which, value /* 0~1 */) {
  const layer = which === 'poss' ? possLayer : roadLayer;
  layer.set('userOpacity', value);
  layer.setOpacity(value);
  enforceMinZoom();
}
