// ── 배관 공통 유틸 ──
import LineString from 'ol/geom/LineString.js';
import { fromLonLat } from 'ol/proj.js';
import { getLength } from 'ol/sphere.js';

// lon/lat 좌표열 → 3857 LineString
export function toLine(coordsLonLat) {
  return new LineString(coordsLonLat.map((c) => fromLonLat(c)));
}

// 측지 연장(m). 좌표가 2개 미만이면 0.
export function pipeLength(coordsLonLat) {
  if (!coordsLonLat || coordsLonLat.length < 2) return 0;
  return getLength(toLine(coordsLonLat)); // 기본 EPSG:3857 → 측지 보정 길이(m)
}

// m → 보기 좋은 라벨
export function fmtLength(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(1)} m`;
}

// #rrggbb + alpha → rgba()
export function withAlpha(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
