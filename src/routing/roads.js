// ── 도로 중심선(벡터) 수집 — OSM Overpass ──
// 무료·무제한이고 골목길/이면도로까지 상세해 배관 경로에 적합.
// 브라우저 직접 호출은 CORS/차단이 잦아 프록시 경유:
//   운영 functions/osm/[[path]].js · 개발 vite.config.js의 /osm
// 반환: [[ [lon,lat], [lon,lat], ... ], ...]  (LineString 배열)

const OVERPASS = '/osm/api/interpreter';

// 배관이 지날 수 있는 도로 종류 (계단·산길 등 제외)
const HIGHWAY = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|road';

export async function fetchRoads([minLon, minLat, maxLon, maxLat]) {
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
