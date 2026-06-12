// ── Cloudflare Pages Function: VWorld 프록시 ──
// 직접 호출(JSONP)이 막히는 엔드포인트를 우회한다.
// VITE_API_MODE=proxy 로 빌드하면 프론트가 /vw/* 로 호출 → 여기서 api.vworld.kr 로 전달.
//
// 라우트: functions/vw/[[path]].js  →  /vw/<나머지경로>
// 예) /vw/req/address?... → https://api.vworld.kr/req/address?...

const VWORLD_ORIGIN = 'https://api.vworld.kr';

export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);

  // [[path]] 는 배열(나머지 세그먼트). 이어붙여 대상 경로 구성.
  const rest = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
  const target = `${VWORLD_ORIGIN}/${rest}${url.search}`;

  const resp = await fetch(target, {
    method: request.method,
    headers: { Accept: 'application/json,image/png,*/*' },
  });

  // CORS 허용 + 원본 콘텐츠 타입 유지
  const headers = new Headers(resp.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(resp.body, { status: resp.status, headers });
}
