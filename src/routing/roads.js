// ── 도로 중심선 로더 (도로명주소 도로구간) ──
// 국토교통부 도로명주소 전자지도에서 뽑아 R2에 올린 시군구별 GeoJSON을 읽는다.
// 도로명이 부여된 실제 통행로만 담겨 있어(복개천 포함, 열린 하천 제외) OSM보다 정확하다.
//
// 준비: tools/extract-roads.sh 로 추출 → R2(road-data) 업로드
// 구성: manifest.json { entries:[{ code(시군구), bbox:[minLon,minLat,maxLon,maxLat] }] }
//       + {code}.json (GeoJSON LineString/MultiLineString)
// 반환: [[ [lon,lat], ... ], ...]

// 기본은 같은 출처의 프록시(/roads) — 교차 출처가 아니라 CORS 문제가 생기지 않는다.
//   운영: functions/roads/[[path]].js,  개발: vite.config.js의 /roads 프록시
// R2를 직접 부르고 싶으면 VITE_ROADS_URL 로 덮어쓴다.
const BASE = (import.meta.env.VITE_ROADS_URL || '/roads').replace(/\/+$/, '');
export const ROADS_READY = !!BASE;

let manifestPromise = null;
const fileCache = new Map(); // code → lines

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}/manifest.json`)
      .then((r) => { if (!r.ok) throw new Error(`manifest HTTP ${r.status}`); return r.json(); })
      .then((j) => j.entries || [])
      .catch((e) => { manifestPromise = null; throw new Error(`도로 목록을 못 받았습니다: ${e.message}`); });
  }
  return manifestPromise;
}

const overlaps = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

function linesFromGeoJSON(gj) {
  const out = [];
  for (const f of gj.features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') { if (g.coordinates.length >= 2) out.push(g.coordinates); }
    else if (g.type === 'MultiLineString') for (const c of g.coordinates) if (c.length >= 2) out.push(c);
  }
  return out;
}

async function loadFile(code) {
  if (fileCache.has(code)) return fileCache.get(code);
  const r = await fetch(`${BASE}/${code}.json`);
  if (!r.ok) throw new Error(`${code} HTTP ${r.status}`);
  const lines = linesFromGeoJSON(await r.json());
  fileCache.set(code, lines);
  return lines;
}

// bbox와 겹치는 시군구 파일만 받아 도로선을 모아 반환
export async function fetchRoads(bbox, onProgress) {
  if (!ROADS_READY) {
    throw new Error('도로 데이터 주소가 설정되지 않았습니다 (VITE_ROADS_URL).');
  }
  const entries = await loadManifest();
  const need = entries.filter((e) => overlaps(bbox, e.bbox));
  if (!need.length) return [];

  const out = [];
  let done = 0;
  for (const e of need) {
    out.push(...await loadFile(e.code));
    done++;
    onProgress?.(done, need.length);
  }
  return out;
}
