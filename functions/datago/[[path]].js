// ── Cloudflare Pages Function: 공공데이터포털(apis.data.go.kr) 프록시 ──
// data.go.kr 게이트웨이는 브라우저 직접호출 시 "Forbidden"을 자주 반환한다(서버호출은 정상).
// 프론트가 같은 출처의 /datago/* 로 호출하면 여기서 apis.data.go.kr 로 전달한다.
//
// 라우트: functions/datago/[[path]].js  →  /datago/<나머지경로>
// 디버그: 쿼리에 &_raw=1 을 붙이면 상태/타입/본문 미리보기를 텍스트로 반환.

const ORIGIN = 'https://apis.data.go.kr';
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
        headers: { Accept: 'application/json,*/*' },
        redirect: 'follow',
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      return new Response(`proxy fetch failed for:\n${target}\n\n${e}`, { status: 504, headers: TEXT });
    }
    clearTimeout(timer);

    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get('content-type') || '';
    if (url.searchParams.get('_raw') === '1') {
      const preview = new TextDecoder('utf-8').decode(buf.slice(0, 800));
      return new Response(
        `target: ${target}\nstatus: ${resp.status}\ncontent-type: ${ct}\nbytes: ${buf.byteLength}\n--- body ---\n${preview}`,
        { status: 200, headers: TEXT }
      );
    }

    const headers = new Headers(CORS);
    if (ct) headers.set('Content-Type', ct);
    return new Response(buf, { status: resp.status, headers });
  } catch (e) {
    return new Response(`proxy handler error: ${e && e.stack ? e.stack : e}`, { status: 500, headers: TEXT });
  }
}
