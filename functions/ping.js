// 진단용: Pages Functions가 배포·실행되는지 확인하는 최소 엔드포인트.
// https://pipe-line.pages.dev/ping → "pong" 이 보이면 Functions 정상.
export function onRequest() {
  return new Response('pong', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
