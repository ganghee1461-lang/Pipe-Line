// ── 토지(소유구분) 기반 경로 탐색 ──
// 도로 중심선 대신 "지날 수 있는 땅" 위에서 최소비용 경로를 찾는다.
//   · 공유지(국·도·시·군유)  → 통행 가능. 지목이 도/구면 더 싸게(실제 길일 확률↑)
//   · 사유지                → 지상권 협의 필요 → 비싸게 (짧게 스치는 정도만 허용)
//   · 공원·학교 등 시설 부지 → 차단 (한복판을 가로지르지 않도록)
//   · 필지 정보 없음         → 차단 (모르는 땅은 안 씀)
// 좌표는 EPSG:3857(m).

// 한복판을 가로지르면 안 되는 시설 지목
const BLOCKED_JIMOK = new Set(['공', '학', '체', '종', '원', '묘', '사', '유원지', '공원', '학교용지', '체육용지', '종교용지', '묘지', '사적지']);
// 실제 통행로일 확률이 높은 지목
const ROADLIKE_JIMOK = new Set(['도', '구', '천', '제', '철', '수']);

export const COST = {
  roadPublic: 1,   // 공유지 + 도로성 지목
  otherPublic: 2,  // 공유지 (대·전 등 현황도로 추정)
  private: 6,      // 사유지 (지상권 협의 필요)
  blocked: 0,      // 통행 불가
};

// 필지 한 곳의 통행 비용 결정
export function costOf({ jimok, isPublic }) {
  if (BLOCKED_JIMOK.has(jimok)) return COST.blocked;
  if (isPublic === true) return ROADLIKE_JIMOK.has(jimok) ? COST.roadPublic : COST.otherPublic;
  if (isPublic === false) return COST.private;
  return COST.blocked; // 미확인
}

// ── 폴리곤 → 격자 래스터화 ──
// grid[i] = 셀 비용(0이면 통행 불가). 셀 인덱스 = y*w + x
export function rasterize(parcels, extent, cell) {
  const [minX, minY, maxX, maxY] = extent;
  const w = Math.max(1, Math.ceil((maxX - minX) / cell));
  const h = Math.max(1, Math.ceil((maxY - minY) / cell));
  const grid = new Float32Array(w * h);      // 비용 (0 = 차단)
  const owner = new Int32Array(w * h).fill(-1); // 셀이 속한 필지 index

  parcels.forEach((p, pi) => {
    if (!p.rings || !p.rings.length || !p.cost) return;
    // 필지 bbox 안의 셀만 검사
    let pminX = Infinity, pminY = Infinity, pmaxX = -Infinity, pmaxY = -Infinity;
    for (const ring of p.rings) for (const [x, y] of ring) {
      if (x < pminX) pminX = x; if (x > pmaxX) pmaxX = x;
      if (y < pminY) pminY = y; if (y > pmaxY) pmaxY = y;
    }
    const x0 = Math.max(0, Math.floor((pminX - minX) / cell));
    const x1 = Math.min(w - 1, Math.ceil((pmaxX - minX) / cell));
    const y0 = Math.max(0, Math.floor((pminY - minY) / cell));
    const y1 = Math.min(h - 1, Math.ceil((pmaxY - minY) / cell));
    for (let gy = y0; gy <= y1; gy++) {
      const cy = minY + (gy + 0.5) * cell;
      for (let gx = x0; gx <= x1; gx++) {
        const cx = minX + (gx + 0.5) * cell;
        if (!pointInRings([cx, cy], p.rings)) continue;
        const idx = gy * w + gx;
        // 더 싼 쪽 우선 (경계 중첩 시)
        if (grid[idx] === 0 || p.cost < grid[idx]) { grid[idx] = p.cost; owner[idx] = pi; }
      }
    }
  });

  return { grid, owner, w, h, cell, minX, minY };
}

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

const toCell = (r, [x, y]) => [Math.floor((x - r.minX) / r.cell), Math.floor((y - r.minY) / r.cell)];
const toXY = (r, gx, gy) => [r.minX + (gx + 0.5) * r.cell, r.minY + (gy + 0.5) * r.cell];

// 통행 가능한 가장 가까운 셀 찾기 (마커가 차단 셀에 있을 때)
export function nearestOpen(r, pt, maxRing = 40) {
  const [cx, cy] = toCell(r, pt);
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= r.w || gy >= r.h) continue;
        const idx = gy * r.w + gx;
        if (r.grid[idx] > 0) return { gx, gy, idx };
      }
    }
  }
  return null;
}

// ── 이진 힙 ──
class Heap {
  constructor() { this.a = []; }
  push(it) {
    const a = this.a; a.push(it);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, rr = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (rr < a.length && a[rr].f < a[m].f) m = rr;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

// ── 다중 출발점 다익스트라 (격자, 8방향) ──
// 반환 { dist, prev } — 모든 셀까지의 최소비용과 역추적
export function fieldFrom(r, startIdxs) {
  const n = r.w * r.h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const h = new Heap();
  for (const s of startIdxs) { if (s >= 0 && r.grid[s] > 0) { dist[s] = 0; h.push({ i: s, f: 0 }); } }

  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (h.size) {
    const { i, f } = h.pop();
    if (f > dist[i]) continue;
    const gx = i % r.w, gy = (i / r.w) | 0;
    for (const [dx, dy, mul] of D) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
      const ni = ny * r.w + nx;
      const c = r.grid[ni];
      if (c <= 0) continue; // 차단
      const nd = f + c * mul * r.cell;
      if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = i; h.push({ i: ni, f: nd }); }
    }
  }
  return { dist, prev };
}

// 역추적 → 좌표 폴리라인
export function tracePath(r, prev, target) {
  const pts = [];
  for (let i = target; i !== -1; i = prev[i]) {
    pts.push(toXY(r, i % r.w, (i / r.w) | 0));
    if (prev[i] === -1) break;
  }
  return pts.reverse();
}

// 격자 계단 경로를 직선 구간으로 단순화 (같은 방향 연속 병합 + 미세 흔들림 제거)
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    // a-c 직선에서 b가 tol 이내로 벗어나면 b 생략
    const vx = c[0] - a[0], vy = c[1] - a[1];
    const len = Math.hypot(vx, vy) || 1;
    const d = Math.abs((b[0] - a[0]) * vy - (b[1] - a[1]) * vx) / len;
    if (d > tol) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export { toCell, toXY };
