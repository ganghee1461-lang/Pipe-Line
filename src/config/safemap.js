// ── 생활안전지도(safemap.go.kr) 건설공사현황 API 설정 ──
// 건설공사현황 정보조회 서비스(IF_0043). 좌표(x,y)는 EPSG:3857로 내려와 지도와 동일 좌표계라
// 별도 변환이 필요 없다. 인증키는 .env(VITE_SAFEMAP_KEY)에서 주입.
//
// 호출은 항상 프록시 경유(/safemap/*):
//   - 운영 사이트가 https라 http 엔드포인트 직접호출은 혼합콘텐츠로 막히고, CORS 헤더도 없음.
//   - dev: vite.config.js 의 /safemap 프록시,  운영: functions/safemap/[[path]].js

const KEY = import.meta.env.VITE_SAFEMAP_KEY || '';

// 키가 없으면 데모(mock) 데이터로 동작
export const SAFEMAP_ENABLED = !!KEY;
export const SAFEMAP_KEY = KEY;

// 프록시 경유 엔드포인트 (원본: http://safemap.go.kr/openapi2/IF_0043)
export const SAFEMAP_BASE = '/safemap/openapi2/IF_0043';
