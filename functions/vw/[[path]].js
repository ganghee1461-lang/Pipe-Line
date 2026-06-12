// ── Cloudflare Pages Function: VWorld 프록시 ──
// VWorld의 WMS(GetMap 이미지)·일부 API는 CORS 헤더를 주지 않아 브라우저가 막는다.
// 프론트가 같은 출처의 /vw/* 로 호출하면 여기서 api.vworld.kr 로 전달하고
// 응답에 CORS 헤더를 붙여 돌려준다.
//
// 라우트: functions/vw/[[path]].js  →  /vw/<나머지경로>
// 디버그: 쿼리에 &_debug=1 을 붙이면 이미지 대신 상태/타입/본문 미리보기를 텍스트로 반환.

const VWORLD_ORIGIN = 'https://api.vworld.kr';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const TEXT = { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' };

export async function onRequest(context) {
  try {
    const { request, params } = context;
    const url = new URL(request.url);

    const rest = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
    if (!rest) return new Response('proxy: empty path', { status: 400, headers: TEXT });
    const target = `${VWORLD_ORIGIN}/${rest}${url.search}`;
    const origin = url.origin;

    // VWorld가 응답을 안 주고 멈추는 경우 함수가 죽어 불투명한 520이 난다 → 타임아웃으로 차단.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);

    let resp;
    try {
      resp = await fetch(target, {
        method: 'GET',
        headers: { Accept: 'application/json,image/png,*/*', Referer: `${origin}/` },
        redirect: 'follow',
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      return new Response(`proxy fetch failed (timeout?) for:\n${target}\n\n${e}`, {
        status: 504, headers: TEXT,
      });
    }
    clearTimeout(timer);

    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get('content-type') || '';

    // 디버그 모드: VWorld 응답을 그대로 사람이 읽게.
    if (url.searchParams.get('_debug') === '1') {
      const preview = new TextDecoder('utf-8').decode(buf.slice(0, 600));
      return new Response(
        `target: ${target}\nstatus: ${resp.status}\ncontent-type: ${ct}\nbytes: ${buf.byteLength}\n--- body preview ---\n${preview}`,
        { status: 200, headers: TEXT }
      );
    }

    const headers = new Headers(CORS);
    if (ct) headers.set('Content-Type', ct);
    if (ct.startsWith('image/')) headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(buf, { status: resp.status, headers });
  } catch (e) {
    return new Response(`proxy handler error: ${e && e.stack ? e.stack : e}`, {
      status: 500, headers: TEXT,
    });
  }
}
