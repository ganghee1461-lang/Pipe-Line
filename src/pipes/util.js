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

// 세그먼트 1구간(점 i ~ i+1)의 측지 연장(m)
export function segLength(coordsLonLat, i) {
  if (!coordsLonLat || i + 1 >= coordsLonLat.length) return 0;
  return pipeLength([coordsLonLat[i], coordsLonLat[i + 1]]);
}

// 형상 편집(점 추가/삭제/이동) 후 세그먼트 속성 배열을 새 좌표 개수에 맞춰 재조정.
// oldCoords/oldSegs(=N-1) → newCoords 기준으로 segs를 반환.
export function reconcileSegs(oldCoords, oldSegs, newCoords) {
  const dn = newCoords.length - oldCoords.length;
  if (dn === 0) return oldSegs.map((a) => ({ ...a })); // 이동만
  const k = firstDiffIndex(oldCoords, newCoords);
  const segs = oldSegs.map((a) => ({ ...a }));

  if (dn === 1) {
    // 점 1개 삽입 → 해당 세그먼트가 둘로 분할 (속성 복제)
    const src = segs[Math.min(Math.max(k - 1, 0), segs.length - 1)] || { ...oldSegs[0] };
    segs.splice(k, 0, { ...src });
    return segs;
  }
  if (dn === -1) {
    // 점 1개 삭제 → 인접 세그먼트 병합(또는 끝점 제거)
    if (k <= 0) segs.shift();
    else if (k >= newCoords.length) segs.pop();
    else segs.splice(k, 1);
    return segs;
  }
  // 예외: 기본 속성으로 재생성
  return Array.from({ length: Math.max(0, newCoords.length - 1) }, () => ({ ...(oldSegs[0] || {}) }));
}

function firstDiffIndex(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return i;
  }
  return n;
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
