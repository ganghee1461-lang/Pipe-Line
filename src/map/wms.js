// ── WMS 레이어 (소유구분지적도 / 도시계획도로) ──
// VWorld WMS는 CORS 헤더를 주지 않고, 서버사이드(Cloudflare) 프록시 호출은 IP 차단으로 502가 난다.
// 해결: 브라우저에서 VWorld를 '직접' 호출하되 crossOrigin을 지정하지 않는다.
//   - crossOrigin 미지정 → 평범한 <img> 로드라 CORS 검사 자체가 없음(프록시 불필요)
//   - 브라우저가 실제 Referer(등록 도메인)를 붙여줘서 VWorld 인증 통과
//   - 단, 지도 캔버스가 tainted 되어 '지도 PNG 내보내기'만 제한됨(표시·클릭조회는 정상)
import ImageLayer from 'ol/layer/Image.js';
import ImageWMS from 'ol/source/ImageWMS.js';
import { VWORLD, IS_MOCK } from '../config/vworld.js';
import { map } from './map.js';

// 브라우저 직접 호출 (CORS 헤더가 필요 없는 경로)
const POSS_WMS = 'https://api.vworld.kr/ned/wms/getPossessionWMS';
const ROAD_WMS = 'https://api.vworld.kr/req/wms';

function makeWms({ url, layers, ned }) {
  // OpenLayers ImageWMS가 SERVICE/VERSION/REQUEST/BBOX/WIDTH/HEIGHT/CRS를 자동 주입.
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
      // crossOrigin 미지정이 핵심 — CORS 검사를 피해 직접 로드한다.
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
