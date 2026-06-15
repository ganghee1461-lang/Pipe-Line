// ── Cloudflare Pages Function: GitHub save/ 폴더 저장·목록·읽기 ──
// GET  /api/save            → save/ 의 .json 파일 목록 { files: [...] }
// GET  /api/save?file=NAME  → 해당 파일 내용(JSON) 반환
// POST /api/save {name,data}→ save/NAME.json 커밋 (생성/갱신). GITHUB_TOKEN 필요.
//
// 토큰: Cloudflare Pages → Settings → Environment variables 에 GITHUB_TOKEN (repo 쓰기 권한) 추가.

const OWNER = 'ganghee1461-lang';
const REPO = 'Pipe-Line';
const BRANCH = 'claude/bold-keller-gidnt6';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = env.GITHUB_TOKEN;
  const headers = { 'User-Agent': 'pipe-line-app', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;

  try {
    if (request.method === 'GET') {
      const file = url.searchParams.get('file');
      if (file) {
        const r = await fetch(`${base}/save/${encodeURIComponent(file)}?ref=${BRANCH}`, { headers });
        if (!r.ok) return json({ error: `읽기 실패 HTTP ${r.status}` }, r.status);
        const j = await r.json();
        return new Response(b64decode(j.content), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }
      const r = await fetch(`${base}/save?ref=${BRANCH}`, { headers });
      if (!r.ok) return json({ error: `목록 실패 HTTP ${r.status}` }, r.status);
      const arr = await r.json();
      const files = arr.filter((x) => x.type === 'file' && x.name.toLowerCase().endsWith('.json')).map((x) => x.name);
      return json({ files });
    }

    if (request.method === 'POST') {
      if (!token) return json({ error: 'GITHUB_TOKEN 미설정 — Cloudflare 환경변수에 토큰을 추가하세요.' }, 500);
      const body = await request.json().catch(() => null);
      const name = (body?.name || '').replace(/[^\w가-힣 .\-]/g, '').trim();
      if (!name) return json({ error: '파일 이름이 필요합니다.' }, 400);
      const path = `save/${name}.json`;
      const apiUrl = `${base}/save/${encodeURIComponent(name)}.json`;

      let sha;
      const g = await fetch(`${apiUrl}?ref=${BRANCH}`, { headers });
      if (g.ok) sha = (await g.json()).sha;

      const put = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `save: ${name}`,
          content: b64encode(JSON.stringify(body.data, null, 2)),
          branch: BRANCH,
          sha,
        }),
      });
      if (!put.ok) return json({ error: `GitHub 저장 실패 HTTP ${put.status}: ${await put.text()}` }, 502);
      return json({ ok: true, path });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: `서버 오류: ${e}` }, 500);
  }
}
