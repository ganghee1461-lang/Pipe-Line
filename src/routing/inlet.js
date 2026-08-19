// ── 인입관 기하 계산 ──
// 인입관은 공급관에서 시작해 "해당 수요처 필지의 경계까지"만 긋는다.
// 남의 토지를 가로지르지 않도록, 공급관과 필지 경계 사이의 최근접 구간을 고른다.
// 좌표는 전부 EPSG:3857(m).

// GeoJSON Polygon/MultiPolygon → 외곽선 링 배열 [[ [x,y], ... ], ...]
export function ringsOf(geometry, toXY) {
  if (!geometry) return [];
  const out = [];
  const push = (ring) => {
    const pts = ring.map(toXY).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length >= 3) out.push(pts);
  };
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(push);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => poly.forEach(push));
  return out;
}

// 점 p를 선분 ab에 투영
function project(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + vx * t, a[1] + vy * t];
  return { point: q, dist: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

// 선분끼리 최근접 쌍 (교차하지 않는 선분에서는 양 끝점 투영 중 최소가 정답)
function segToSeg(a1, a2, b1, b2) {
  const c = [
    { ...project(a1, b1, b2), from: a1 },
    { ...project(a2, b1, b2), from: a2 },
  ];
  let best = c[0].dist <= c[1].dist ? { p: c[0].from, q: c[0].point, d: c[0].dist }
    : { p: c[1].from, q: c[1].point, d: c[1].dist };
  for (const [p, s1, s2] of [[b1, a1, a2], [b2, a1, a2]]) {
    const pr = project(p, s1, s2);
    if (pr.dist < best.d) best = { p: pr.point, q: p, d: pr.dist };
  }
  return best; // p: 첫 선분 위 점, q: 둘째 선분 위 점
}

// 공급관 선분들 ↔ 필지 경계 링들 사이의 최근접 연결
// 반환 { from(공급관 위 점), to(필지 경계 위 점), dist } | null
export function nearestSupplyToRings(supplySegs, rings, maxDist = Infinity) {
  let best = null;
  for (const s of supplySegs) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const r = segToSeg(s.a, s.b, ring[i], ring[i + 1]);
        if (!best || r.d < best.dist) best = { from: r.p, to: r.q, dist: r.d };
      }
    }
  }
  if (!best || best.dist > maxDist) return best && best.dist <= maxDist ? best : (best || null);
  return best;
}

// 폴리라인 배열 → 선분 목록 (반경 안의 것만)
export function segsNear(polylines, center, radius) {
  const out = [];
  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (Math.hypot(mx - center[0], my - center[1]) > radius) continue;
      out.push({ a, b });
    }
  }
  return out;
}

// 점이 링 안에 있는지 (ray casting)
export function pointInRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
