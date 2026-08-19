// ── Cloudflare Pages Function: OSM Overpass API 프록시 ──
// 브라우저에서 overpass-api.de 직접 호출은 CORS/차단으로 실패하는 경우가 많아 서버 경유.
// 라우트: functions/osm/[[path]].js  →  /osm/<나머지경로>  (예: /osm/api/interpreter)
// 본 서버가 과부하일 때를 대비해 미러를 순차 시도한다.

const MIRRORS = [
  'https://overpass-api.de',
  'https://overpass.kumi.systems',
];
const CORS = { 'Access-Control-Allow-Origin': '*' };
const TEXT = { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' };

export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  const rest = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
  if (!rest) return new Response('proxy: empty path', { status: 400, headers: TEXT });

  // POST 본문(Overpass QL)은 한 번만 읽어 재시도에 재사용
  let body = null;
  if (request.method === 'POST') body = await request.text();

  const errors = [];
  for (const origin of MIRRORS) {
    const target = `${origin}/${rest}${url.search}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 55000); // Overpass는 느릴 수 있음
    try {
      const resp = await fetch(target, {
        method: request.method,
        headers: {
          Accept: 'application/json,*/*',
          'Content-Type': 'text/plain;charset=UTF-8',
          'User-Agent': 'pipe-line-app/1.0 (gis routing)',
        },
        body: request.method === 'POST' ? body : undefined,
        signal: ctl.signal,
      });
      clearTimeout(timer);
      const buf = await resp.arrayBuffer();
      if (!resp.ok) { errors.push(`${origin} → HTTP ${resp.status}`); continue; }
      const headers = new Headers(CORS);
      headers.set('Content-Type', resp.headers.get('content-type') || 'application/json');
      return new Response(buf, { status: 200, headers });
    } catch (e) {
      clearTimeout(timer);
      errors.push(`${origin} → ${e && e.name === 'AbortError' ? '시간초과' : e}`);
    }
  }
  return new Response(`overpass 실패:\n${errors.join('\n')}`, { status: 502, headers: TEXT });
}
