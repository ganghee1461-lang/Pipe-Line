# 배관 영업 GIS

도시가스/배관 공급 영업 담당자를 위한 웹 기반 GIS 단일 페이지 앱.
VWorld 데이터 + OpenLayers. Vite로 정적 빌드 → Cloudflare Pages 배포.

## 현재 구현 상태 (단계별)

- [x] **1단계** 지도 + WMS 레이어 + 수요처 검색/리스트/메모
  - 배경지도(기본/위성), 소유구분지적도·도시계획도로 WMS 토글/투명도
  - 필지 클릭 → 소유구분(공유/사유)·지번·지목·면적 팝업
  - 다중 일괄 검색, 리스트↔마커 동기화, 메모(메모만 보기 필터 포함)
- [ ] 2단계 배관 작도(P) · 속성 · 편집(V/A)
- [ ] 3단계 연장 집계 · 모드 전환(영업/굴착심의/배관망 분석)

## 로컬 실행

```bash
npm install
cp .env.example .env   # VWorld 키 입력 (없으면 mock 모드로 동작)
npm run dev            # http://localhost:5173
```

키가 없으면 **Mock 모드**로 켜져서 가짜 데이터로 UI/구조를 확인할 수 있다.

## 환경변수 (.env)

| 변수 | 설명 |
|---|---|
| `VITE_VWORLD_KEY` | VWorld 인증키. 미설정 시 mock 모드 |
| `VITE_VWORLD_DOMAIN` | 키에 등록한 도메인 (로컬 `127.0.0.1`, 운영 `pipe-line.pages.dev`) |
| `VITE_API_MODE` | `jsonp`(직접호출, 기본) 또는 `proxy`(프록시 경유) |

### VWorld 키 발급
[vworld.kr](https://www.vworld.kr) 에서 발급하고, 아래 도메인을 모두 등록:
`localhost`, `127.0.0.1`, `pipe-line.pages.dev`

## CORS 전략

1. **1차: 직접호출(JSONP)** — 검색·역지오코딩·필지·소유속성은 JSONP로 우회 (레거시 검증).
2. **2차: 프록시 폴백** — 막히는 엔드포인트는 `VITE_API_MODE=proxy`로 전환.
   - 운영: `functions/vw/[[path]].js` (Cloudflare Pages Functions)
   - 로컬: `vite.config.js`의 `/vw` 프록시
3. 호출은 전부 `src/api/vworld.js` 한 곳에 추상화 — 경로만 교체하면 됨.

## Cloudflare Pages 배포

1. Cloudflare Pages → "Connect to Git" → 이 저장소 연결
2. 빌드 설정: **Build command** `npm run build`, **Output** `dist`
3. 환경변수에 `VITE_VWORLD_KEY` 등 설정
4. 프로젝트명을 `pipe-line` 으로 → `https://pipe-line.pages.dev`
5. `functions/` 디렉토리는 자동으로 Pages Functions로 배포됨

## 디렉토리 구조

```
src/
  config/   엔드포인트·레이어ID·배관 스타일 매핑
  api/      VWorld 호출 추상화 (jsonp/proxy/mock)
  state/    중앙 상태 + pub/sub
  map/      지도·배경·WMS·필지조회
  demands/  수요처 검색·리스트·마커·메모
  layers/   레이어 패널 UI
functions/  Cloudflare 프록시
reference/  레거시 프로토타입 (참고용)
```
