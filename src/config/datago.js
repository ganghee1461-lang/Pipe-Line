// ── 공공데이터포털(data.go.kr) 인증키 설정 ──
// 건축HUB 건축인허가 등. 호출은 항상 프록시 경유(/datago/*):
//   - apis.data.go.kr는 브라우저 직접호출 시 "Forbidden"이 잦아 서버(프록시)로 호출.
//   - dev: vite.config.js의 /datago 프록시, 운영: functions/datago/[[path]].js
// 키는 .env(VITE_DATAGO_KEY)에서 주입. 미설정 시 건축인허가 기능 비활성.

const KEY = import.meta.env.VITE_DATAGO_KEY || '';

export const DATAGO_ENABLED = !!KEY;
export const DATAGO_KEY = KEY;
export const DATAGO_BASE = '/datago'; // 프록시 경유 베이스
