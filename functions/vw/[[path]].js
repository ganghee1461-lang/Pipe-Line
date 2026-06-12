// ── Cloudflare Pages Function: VWorld 프록시 ──
// VWorld의 WMS(GetMap 이미지)·일부 API는 CORS 헤더를 주지 않아 브라우저가 막는다.
// 프론트가 같은 출처의 /vw/* 로 호출하면 여기서 api.vworld.kr 로 전달하고
// 응답에 CORS 헤더를 붙여 돌려준다.
//
// 라우트: functions/vw/[[path]].js  →  /vw/<나머지경로>
// 예) /vw/ned/wms/getPossessionWMS?... → https://api.vworld.kr/ned/wms/getPossessionWMS?...

const VWORLD_ORIGIN = 'https://api.vworld.kr';
const CORS = { 'Access-Control-Allow-Origin': '*' };

export async function onRequest(context) {
  // 어떤 경우에도 불투명한 520이 아니라 읽을 수 있는 에러를 반환한다.
  try {
    const { request, params } = context;
    const url = new URL(request.url);

    // [[path]] 는 배열(나머지 세그먼트). 이어붙여 대상 경로 구성.
    const rest = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
    if (!rest) {
      return new Response('proxy: empty path', { status: 400, headers: CORS });
    }
    const target = `${VWORLD_ORIGIN}/${rest}${url.search}`;

    // VWorld 키는 등록 도메인의 Referer로 인증한다. 서버사이드 fetch는 Referer가 없어
    // 키가 거부되므로, 들어온 요청의 출처(=pipe-line.pages.dev)를 Referer로 붙인다.
    const origin = url.origin;

    let resp;
    try {
      resp = await fetch(target, {
        method: 'GET',
        headers: {
          Accept: 'application/json,image/png,*/*',
          Referer: `${origin}/`,
        },
        redirect: 'follow',
      });
    } catch (e) {
      return new Response(`proxy fetch failed for ${target}\n${e}`, {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // 본문을 버퍼로 받아 새 Response로 다시 싼다.
    // (원본 헤더를 그대로 복사하면 content-encoding/length 불일치로 520이 난다 → 최소 헤더만 설정)
    const body = await resp.arrayBuffer();
    const headers = new Headers(CORS);
    const ct = resp.headers.get('content-type');
    if (ct) headers.set('Content-Type', ct);
    if (ct && ct.startsWith('image/')) headers.set('Cache-Control', 'public, max-age=86400');

    return new Response(body, { status: resp.status, headers });
  } catch (e) {
    return new Response(`proxy handler error: ${e && e.stack ? e.stack : e}`, {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
