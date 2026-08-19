// ── Cloudflare Pages Function: GitHub save/ 저장·목록·읽기 (폴더 지원) ──
// GET  /api/save                        → { folders:[...], files:[루트 .json] }
// GET  /api/save?folder=제천            → { files:[해당 폴더 .json] }
// GET  /api/save?folder=제천&file=x.json→ 파일 내용(JSON)
// POST /api/save {folder,name,data}     → save/폴더/NAME.json 커밋
// POST /api/save {mkdir:"제천"}         → 폴더 생성(.gitkeep 커밋)
// DELETE /api/save?folder=제천&file=x   → 파일 삭제
// DELETE /api/save?folder=제천&rmdir=1  → 폴더(내 파일 전부) 삭제
//
// 토큰: Cloudflare Pages → Settings → Environment variables 에 GITHUB_TOKEN(repo 쓰기) 추가.

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
// 폴더/파일 이름 정리 (경로 구분자·특수문자 제거)
function clean(s) { return String(s || '').replace(/[^\w가-힣 .\-]/g, '').trim(); }
// 경로를 세그먼트별로 인코딩('/' 유지)
function enc(path) { return path.split('/').map(encodeURIComponent).join('/'); }

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = env.GITHUB_TOKEN;
  const headers = { 'User-Agent': 'pipe-line-app', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;
  const folder = clean(url.searchParams.get('folder'));

  try {
    if (request.method === 'GET') {
      const file = url.searchParams.get('file');
      if (file) {
        const p = `save/${folder ? folder + '/' : ''}${file}`;
        const r = await fetch(`${base}/${enc(p)}?ref=${BRANCH}`, { headers });
        if (!r.ok) return json({ error: `읽기 실패 HTTP ${r.status}` }, r.status);
        const j = await r.json();
        return new Response(b64decode(j.content), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }
      const listPath = folder ? `save/${folder}` : 'save';
      const r = await fetch(`${base}/${enc(listPath)}?ref=${BRANCH}`, { headers });
      if (!r.ok) {
        if (r.status === 404) return json({ folders: [], files: [] });
        return json({ error: `목록 실패 HTTP ${r.status}` }, r.status);
      }
      const arr = await r.json();
      const folders = folder ? [] : arr.filter((x) => x.type === 'dir').map((x) => x.name).sort((a, b) => a.localeCompare(b, 'ko'));
      const files = arr.filter((x) => x.type === 'file' && x.name.toLowerCase().endsWith('.json')).map((x) => x.name);
      return json({ folders, files });
    }

    if (request.method === 'POST') {
      if (!token) return json({ error: 'GITHUB_TOKEN 미설정 — Cloudflare 환경변수에 토큰을 추가하세요.' }, 500);
      const body = await request.json().catch(() => null);

      // 폴더 생성
      if (body?.mkdir) {
        const f = clean(body.mkdir);
        if (!f) return json({ error: '폴더 이름이 필요합니다.' }, 400);
        const apiUrl = `${base}/${enc(`save/${f}/.gitkeep`)}`;
        let sha;
        const g = await fetch(`${apiUrl}?ref=${BRANCH}`, { headers });
        if (g.ok) return json({ ok: true, folder: f }); // 이미 있음
        const put = await fetch(apiUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `mkdir: ${f}`, content: b64encode(''), branch: BRANCH, sha }),
        });
        if (!put.ok) return json({ error: `폴더 생성 실패 HTTP ${put.status}` }, 502);
        return json({ ok: true, folder: f });
      }

      const name = clean(body?.name);
      if (!name) return json({ error: '파일 이름이 필요합니다.' }, 400);
      const p = `save/${folder ? folder + '/' : ''}${name}.json`;
      const apiUrl = `${base}/${enc(p)}`;
      let sha;
      const g = await fetch(`${apiUrl}?ref=${BRANCH}`, { headers });
      if (g.ok) sha = (await g.json()).sha;
      const put = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `save: ${p}`,
          content: b64encode(JSON.stringify(body.data, null, 2)),
          branch: BRANCH,
          sha,
        }),
      });
      if (!put.ok) return json({ error: `GitHub 저장 실패 HTTP ${put.status}: ${await put.text()}` }, 502);
      return json({ ok: true, path: p });
    }

    if (request.method === 'DELETE') {
      if (!token) return json({ error: 'GITHUB_TOKEN 미설정' }, 500);

      // 폴더 삭제 (내부 파일 전부 삭제)
      if (url.searchParams.get('rmdir')) {
        if (!folder) return json({ error: '폴더 지정 필요' }, 400);
        const lr = await fetch(`${base}/${enc(`save/${folder}`)}?ref=${BRANCH}`, { headers });
        if (lr.ok) {
          const items = await lr.json();
          for (const it of items) {
            if (it.type !== 'file') continue;
            await fetch(`${base}/${enc(it.path)}`, {
              method: 'DELETE',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: `rmdir: ${it.path}`, sha: it.sha, branch: BRANCH }),
            });
          }
        }
        return json({ ok: true });
      }

      const file = url.searchParams.get('file');
      if (!file) return json({ error: 'file 파라미터 필요' }, 400);
      const p = `save/${folder ? folder + '/' : ''}${file}`;
      const apiUrl = `${base}/${enc(p)}`;
      const g = await fetch(`${apiUrl}?ref=${BRANCH}`, { headers });
      if (!g.ok) return json({ error: `파일 없음 HTTP ${g.status}` }, g.status);
      const sha = (await g.json()).sha;
      const del = await fetch(apiUrl, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `delete: ${p}`, sha, branch: BRANCH }),
      });
      if (!del.ok) return json({ error: `삭제 실패 HTTP ${del.status}` }, 502);
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: `서버 오류: ${e}` }, 500);
  }
}
