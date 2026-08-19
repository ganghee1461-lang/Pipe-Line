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

// 폴백 순서: 같은 출처 프록시 → R2 직접. 어느 쪽이 왜 실패했는지 그대로 노출한다.
const R2_DIRECT = 'https://pub-e3ded0c9aba24c7d8513e0b7a266b91a.r2.dev';
const SOURCES = [...new Set([BASE, R2_DIRECT])];
let activeBase = null;      // 성공한 출처 (이후 파일도 여기서)
let manifestPromise = null;
const fileCache = new Map(); // code → lines

async function tryFetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const errs = [];
      for (const base of SOURCES) {
        try {
          const j = await tryFetchJson(`${base}/manifest.json`);
          activeBase = base;
          return j.entries || [];
        } catch (e) {
          errs.push(`${base} → ${e.message}`);
        }
      }
      throw new Error(`도로 목록 실패 [v2] ${errs.join(' / ')}`);
    })().catch((e) => { manifestPromise = null; throw e; });
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
  const gj = await tryFetchJson(`${activeBase || BASE}/${code}.json`);
  const lines = linesFromGeoJSON(gj);
  fileCache.set(code, lines);
  return lines;
}

// bbox와 겹치는 시군구 파일만 받아 도로선을 모아 반환
export async function fetchRoads(bbox, onProgress) {
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
