// ── WMS 레이어 (소유구분지적도 / 도시계획도로) ──
// VWorld WMS(GetMap 이미지)는 CORS 헤더를 주지 않아 직접 호출 시 캔버스 렌더가 막힌다.
// (배경 WMTS 타일은 CORS 허용 → 직접, WMS만 프록시 경유) 그래서 WMS URL은 항상
// /vw 프록시(운영=functions/vw, 로컬=vite proxy)로 보내 프록시가 CORS 헤더를 붙이게 한다.
import ImageLayer from 'ol/layer/Image.js';
import ImageWMS from 'ol/source/ImageWMS.js';
import { VWORLD, IS_MOCK } from '../config/vworld.js';
import { map } from './map.js';

// WMS는 이미지라 JSONP 불가 → 무조건 프록시 경로 사용
const POSS_WMS = '/vw/ned/wms/getPossessionWMS';
const ROAD_WMS = '/vw/req/wms';

function makeWms({ url, layers, ned }) {
  // OpenLayers ImageWMS가 SERVICE/VERSION/REQUEST/BBOX/WIDTH/HEIGHT/CRS/STYLES를
  // 자동 주입한다. 여기서는 레이어·키·포맷 등 고유 파라미터만 넘긴다(중복 금지).
  const params = {
    LAYERS: layers,
    STYLES: layers, // VWorld WMS는 STYLES에 레이어명을 요구(빈값이면 백엔드 502)
    FORMAT: 'image/png',
    TRANSPARENT: true,
    VERSION: '1.3.0',
    key: VWORLD.key,
    domain: VWORLD.domain,
    // 소유지적(ned)은 빈 영역을 흰색 대신 비워두도록 exceptions=blank
    ...(ned ? { exceptions: 'blank' } : {}),
  };
  return new ImageLayer({
    source: new ImageWMS({
      url,
      params,
      crossOrigin: 'anonymous',
      ratio: 1,
    }),
    visible: false,
    opacity: 0.75,
    zIndex: 0,
  });
}

export const possLayer = makeWms({
  url: POSS_WMS, layers: VWORLD.layers.possession, ned: true,
});
export const roadLayer = makeWms({
  url: ROAD_WMS, layers: VWORLD.layers.cityRoad, ned: false,
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
