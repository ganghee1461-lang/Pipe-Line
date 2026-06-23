// ── Cloudflare Pages Function: 생활안전지도(safemap.go.kr) 프록시 ──
// 운영 사이트가 https라 http API 직접호출은 혼합콘텐츠로 막히고 CORS 헤더도 없다.
// 프론트가 같은 출처의 /safemap/* 로 호출하면 여기서 safemap.go.kr 로 전달하고
// 응답에 CORS 헤더를 붙여 돌려준다.
//
// 라우트: functions/safemap/[[path]].js  →  /safemap/<나머지경로>

const ORIGIN = 'https://safemap.go.kr';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const TEXT = { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' };

export async function onRequest(context) {
  try {
    const { request, params } = context;
    const url = new URL(request.url);

    const rest = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
    if (!rest) return new Response('proxy: empty path', { status: 400, headers: TEXT });
    const target = `${ORIGIN}/${rest}${url.search}`;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);

    let resp;
    try {
      resp = await fetch(target, {
        method: 'GET',
        headers: {
          Accept: 'application/json,*/*',
          Referer: `${url.origin}/`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
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

    if (url.searchParams.get('_debug') === '1') {
      const preview = new TextDecoder('utf-8').decode(buf.slice(0, 600));
      return new Response(
        `target: ${target}\nstatus: ${resp.status}\ncontent-type: ${ct}\nbytes: ${buf.byteLength}\n--- body preview ---\n${preview}`,
        { status: 200, headers: TEXT }
      );
    }

    const headers = new Headers(CORS);
    if (ct) headers.set('Content-Type', ct);
    return new Response(buf, { status: resp.status, headers });
  } catch (e) {
    return new Response(`proxy handler error: ${e && e.stack ? e.stack : e}`, {
      status: 500, headers: TEXT,
    });
  }
}
