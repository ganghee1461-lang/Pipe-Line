// ── 도로 중심선(벡터) 수집 ──
// 자동 배관 연결의 기반 그래프가 될 도로 선형을 가져온다. 두 출처를 비교할 수 있게 둘 다 지원.
//   osm    : Overpass API — 무료·무제한, 골목길/이면도로까지 상세. 프록시(/osm) 경유.
//   vworld : VWorld 데이터 API — CORS 헤더가 없어 앱의 JSONP 경로(api/vworld.js) 사용.
// 반환: [[ [lon,lat], [lon,lat], ... ], ...]  (LineString 배열)

import { getRoadLines } from '../api/vworld.js';

// 운영: functions/osm/[[path]].js, 개발: vite.config.js의 /osm 프록시
const OVERPASS = '/osm/api/interpreter';

// 배관이 지날 수 있는 도로 종류 (계단·산길 등은 제외)
const HIGHWAY = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|road';

export async function fetchRoadsOSM([minLon, minLat, maxLon, maxLat]) {
  const q = `[out:json][timeout:45];
(way["highway"~"^(${HIGHWAY})$"](${minLat},${minLon},${maxLat},${maxLon}););
out geom;`;
  const r = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: q,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text.slice(0, 160) || `HTTP ${r.status}`);
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`응답 형식 오류: ${text.slice(0, 120)}`); }
  const lines = [];
  for (const el of j.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const coords = el.geometry.map((p) => [p.lon, p.lat]);
    if (coords.length >= 2) lines.push(coords);
  }
  return lines;
}

export function fetchRoadsVWorld(bbox) {
  return getRoadLines(bbox);
}

export function fetchRoads(source, bbox) {
  return source === 'vworld' ? fetchRoadsVWorld(bbox) : fetchRoadsOSM(bbox);
}
