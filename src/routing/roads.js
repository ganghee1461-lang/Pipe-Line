// ── 도로 중심선(벡터) 수집 ──
// 자동 배관 연결의 기반 그래프가 될 도로 선형을 가져온다. 두 출처를 비교할 수 있게 둘 다 지원.
//   osm    : Overpass API — 무료·무제한, 골목길/이면도로까지 상세
//   vworld : VWorld 데이터 API GetFeature — 기존 키 재사용
// 반환: [[ [lon,lat], [lon,lat], ... ], ...]  (LineString 배열)

import { VWORLD } from '../config/vworld.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

// 배관이 지날 수 있는 도로 종류 (계단·산길 등은 제외)
const HIGHWAY = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|road';

export async function fetchRoadsOSM([minLon, minLat, maxLon, maxLat]) {
  const q = `[out:json][timeout:30];
(way["highway"~"^(${HIGHWAY})$"](${minLat},${minLon},${maxLat},${maxLon}););
out geom;`;
  const r = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: q,
  });
  if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
  const j = await r.json();
  const lines = [];
  for (const el of j.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const coords = el.geometry.map((p) => [p.lon, p.lat]);
    if (coords.length >= 2) lines.push(coords);
  }
  return lines;
}

// VWorld 도로중심선 후보 레이어 (환경에 따라 제공 여부가 달라 순차 시도)
const VW_LAYERS = ['LT_L_MOCTLINK', 'LT_L_SPRD_MANAGE'];

export async function fetchRoadsVWorld([minLon, minLat, maxLon, maxLat]) {
  const base = VWORLD.apiMode === 'proxy' ? VWORLD.proxy.data : VWORLD.direct.data;
  for (const layer of VW_LAYERS) {
    const qs = new URLSearchParams({
      service: 'data', request: 'GetFeature', data: layer,
      key: VWORLD.key, domain: VWORLD.domain, format: 'json',
      geomfilter: `BOX(${minLon},${minLat},${maxLon},${maxLat})`,
      size: '1000', geometry: 'true', attribute: 'false', crs: 'EPSG:4326',
    });
    let j = null;
    try {
      const r = await fetch(`${base}?${qs}`);
      if (!r.ok) continue;
      j = await r.json();
    } catch { continue; }
    if (j?.response?.status !== 'OK') continue;
    const feats = j.response.result?.featureCollection?.features || [];
    const lines = [];
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'LineString' && g.coordinates.length >= 2) lines.push(g.coordinates);
      else if (g.type === 'MultiLineString') {
        for (const c of g.coordinates) if (c.length >= 2) lines.push(c);
      }
    }
    if (lines.length) return lines;
  }
  return [];
}

export function fetchRoads(source, bbox) {
  return source === 'vworld' ? fetchRoadsVWorld(bbox) : fetchRoadsOSM(bbox);
}
