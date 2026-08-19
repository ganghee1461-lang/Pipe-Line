// ── Cloudflare Pages Function: 도로 데이터(R2) 프록시 ──
// 앱이 R2 공개 URL을 직접 부르면 교차 출처라 CORS 설정에 걸린다.
// 같은 출처의 /roads/* 로 받으면 CORS 자체가 발생하지 않는다.
//
// 라우트: functions/roads/[[path]].js  →  /roads/<파일명>
// 예)  /roads/manifest.json,  /roads/43800.json
// 도로 데이터는 거의 바뀌지 않으므로 길게 캐싱한다.

const R2 = 'https://pub-e3ded0c9aba24c7d8513e0b7a266b91a.r2.dev';
const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };

export async function onRequest(context) {
  const { params } = context;
  const rest = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
  if (!rest) return new Response('roads: empty path', { status: 400, headers: TEXT });

  const target = `${R2}/${rest}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const resp = await fetch(target, { signal: ctl.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      return new Response(`roads: ${rest} → HTTP ${resp.status}`, { status: resp.status, headers: TEXT });
    }
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });
    return new Response(resp.body, { status: 200, headers });
  } catch (e) {
    clearTimeout(timer);
    return new Response(`roads: ${rest} 요청 실패 — ${e && e.name === 'AbortError' ? '시간초과' : e}`, {
      status: 504, headers: TEXT,
    });
  }
}
