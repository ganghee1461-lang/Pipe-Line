// ── Cloudflare Pages Function: VWorld 프록시 ──
// VWorld의 WMS(GetMap 이미지)·일부 API는 CORS 헤더를 주지 않아 브라우저가 막는다.
// 프론트가 같은 출처의 /vw/* 로 호출하면 여기서 api.vworld.kr 로 전달하고
// 응답에 CORS 헤더를 붙여 돌려준다.
//
// 라우트: functions/vw/[[path]].js  →  /vw/<나머지경로>
// 예) /vw/ned/wms/getPossessionWMS?... → https://api.vworld.kr/ned/wms/getPossessionWMS?...

const VWORLD_ORIGIN = 'https://api.vworld.kr';

export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);

  // [[path]] 는 배열(나머지 세그먼트). 이어붙여 대상 경로 구성.
  const rest = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
  const target = `${VWORLD_ORIGIN}/${rest}${url.search}`;

  let resp;
  try {
    resp = await fetch(target, {
      method: request.method,
      headers: { Accept: 'application/json,image/png,*/*' },
    });
  } catch (e) {
    return new Response(`proxy fetch failed: ${e}`, {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // 본문을 버퍼로 받아 새 Response로 다시 싼다.
  // (원본 헤더를 그대로 복사하면 content-encoding/length 불일치로 520이 난다 → 최소 헤더만 설정)
  const body = await resp.arrayBuffer();
  const headers = new Headers({ 'Access-Control-Allow-Origin': '*' });
  const ct = resp.headers.get('content-type');
  if (ct) headers.set('Content-Type', ct);
  // 이미지/타일은 캐시 허용(같은 BBOX 재요청 절감)
  if (ct && ct.startsWith('image/')) headers.set('Cache-Control', 'public, max-age=86400');

  return new Response(body, { status: resp.status, headers });
}
