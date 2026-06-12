// ── VWorld 엔드포인트 / 레이어 식별자 (레거시에서 검증된 값) ──
// 키·도메인은 .env(VITE_VWORLD_*)에서 주입. 없으면 mock 모드로 동작.

const KEY = import.meta.env.VITE_VWORLD_KEY || 'YOUR_VWORLD_KEY';
const DOMAIN = import.meta.env.VITE_VWORLD_DOMAIN || '127.0.0.1';
const API_MODE = import.meta.env.VITE_API_MODE || 'jsonp'; // 'jsonp' | 'proxy'

// 키가 placeholder면 mock 모드
export const IS_MOCK = !KEY || KEY === 'YOUR_VWORLD_KEY';

export const VWORLD = {
  key: KEY,
  domain: DOMAIN,
  apiMode: API_MODE,

  // 직접호출(JSONP/WMTS/WMS) 베이스
  direct: {
    geocode: 'https://api.vworld.kr/req/address',
    data: 'https://api.vworld.kr/req/data',
    possAttr: 'https://api.vworld.kr/ned/data/getPossessionAttr',
    possWms: 'https://api.vworld.kr/ned/wms/getPossessionWMS',
    roadWms: 'https://api.vworld.kr/req/wms',
    wmts: 'https://api.vworld.kr/req/wmts/1.0.0',
  },

  // 프록시 경유 베이스 (dev=vite.config의 /vw, 운영=functions의 /api/vworld)
  proxy: {
    geocode: '/vw/req/address',
    data: '/vw/req/data',
    possAttr: '/vw/ned/data/getPossessionAttr',
    possWms: '/vw/ned/wms/getPossessionWMS',
    roadWms: '/vw/req/wms',
    wmts: '/vw/req/wmts/1.0.0',
  },

  // WMS 레이어 식별자
  layers: {
    possession: 'dt_d160',      // 소유구분지적도
    cityRoad: 'lt_c_upisuq151', // 도시계획도로
    parcel: 'LP_PA_CBND_BUBUN', // 필지 GetFeature
  },

  // 줌 임계값
  minZoom: {
    possession: 16,
    road: 13,
  },
};

// apiMode에 따라 base 묶음 선택
export function base() {
  return VWORLD.apiMode === 'proxy' ? VWORLD.proxy : VWORLD.direct;
}

// 배경지도 타일 URL
export function tileUrl(layer /* 'Base' | 'Satellite' */) {
  const ext = layer === 'Satellite' ? 'jpeg' : 'png';
  return `${base().wmts}/${VWORLD.key}/${layer}/{z}/{y}/{x}.${ext}`;
}
