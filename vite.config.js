import { defineConfig } from 'vite';

// VWorld 직접호출(JSONP)이 막히는 환경을 대비한 dev 프록시.
// VITE_API_MODE=proxy 일 때 src/api/vworld.js 가 /vw/* 경로로 호출하면
// 아래 규칙이 api.vworld.kr 로 우회 전달한다. (운영은 functions/ 가 같은 역할)
export default defineConfig({
  server: {
    proxy: {
      '/vw': {
        target: 'https://api.vworld.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/vw/, ''),
      },
      // 도로 데이터 R2 (운영은 functions/roads/ 가 같은 역할)
      '/roads': {
        target: 'https://pub-e3ded0c9aba24c7d8513e0b7a266b91a.r2.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/roads/, ''),
      },
      // 공공데이터포털 건축HUB (운영은 functions/datago/ 가 같은 역할)
      '/datago': {
        target: 'https://apis.data.go.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/datago/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
