// ── 도로 그래프 + 최단경로 + 최소연결(MST) ──
// 좌표는 전부 EPSG:3857(m) 기준. 거리 = 미터.
//
// 흐름: 도로 LineString → 선분 목록 → (마커/기존관 스냅점으로 선분 분할) → 그래프
//       → 터미널 간 최단경로(Dijkstra) → 메트릭 클로저 위 MST → 사용된 도로 간선 집합

const KEY_P = 1; // 노드 좌표 반올림(0.1m) 자릿수
const nkey = (x, y) => `${x.toFixed(KEY_P)},${y.toFixed(KEY_P)}`;

// ── 선분 목록 만들기 ──
export function toSegments(lines3857) {
  const segs = [];
  for (const ln of lines3857) {
    for (let i = 0; i < ln.length - 1; i++) {
      const a = ln[i], b = ln[i + 1];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      segs.push({ a, b });
    }
  }
  return segs;
}

// ── 격자 공간索인 (가장 가까운 선분 탐색 가속) ──
function buildIndex(segs, cell = 60) {
  const grid = new Map();
  const put = (cx, cy, i) => {
    const k = `${cx},${cy}`;
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(i);
  };
  segs.forEach((s, i) => {
    const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]);
    const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
      for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) put(cx, cy, i);
    }
  });
  return { grid, cell };
}

// 점 P를 선분 AB에 투영 → { t(0~1), point, dist }
function project(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + vx * t, a[1] + vy * t];
  return { t, point: q, dist: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

// 가장 가까운 선분 찾기 (반경을 넓혀가며 탐색)
function nearestSeg(p, segs, index) {
  const { grid, cell } = index;
  const cx0 = Math.floor(p[0] / cell), cy0 = Math.floor(p[1] / cell);
  let best = null;
  for (let ring = 0; ring <= 12; ring++) {
    for (let cx = cx0 - ring; cx <= cx0 + ring; cx++) {
      for (let cy = cy0 - ring; cy <= cy0 + ring; cy++) {
        if (ring > 0 && Math.abs(cx - cx0) !== ring && Math.abs(cy - cy0) !== ring) continue;
        const arr = grid.get(`${cx},${cy}`);
        if (!arr) continue;
        for (const i of arr) {
          const pr = project(p, segs[i].a, segs[i].b);
          if (!best || pr.dist < best.dist) best = { segIdx: i, ...pr };
        }
      }
    }
    // ring겹까지 훑었으면 ring*cell 안쪽은 모두 확인된 상태 → 그보다 가까우면 확정
    if (best && best.dist <= ring * cell) break;
  }
  return best;
}

// ── 그래프 구성 (스냅점에서 선분을 쪼개 노드로 편입) ──
// points: [[x,y], ...] 연결 대상(마커/기존관). 반환: { adj, nodes, snaps }
export function buildGraph(segs, points) {
  const index = buildIndex(segs);
  const splits = new Map(); // segIdx → [{t, point}]
  const snaps = points.map((p) => {
    const s = nearestSeg(p, segs, index);
    if (!s) return null;
    if (!splits.has(s.segIdx)) splits.set(s.segIdx, []);
    splits.get(s.segIdx).push({ t: s.t, point: s.point });
    return { point: s.point, dist: s.dist };
  });

  const nodes = new Map(); // key → id
  const coords = [];       // id → [x,y]
  const adj = [];          // id → [{to, w}]
  const nodeId = (pt) => {
    const k = nkey(pt[0], pt[1]);
    let id = nodes.get(k);
    if (id === undefined) { id = coords.length; nodes.set(k, id); coords.push(pt); adj.push([]); }
    return id;
  };
  const link = (i, j) => {
    if (i === j) return;
    const w = Math.hypot(coords[i][0] - coords[j][0], coords[i][1] - coords[j][1]);
    adj[i].push({ to: j, w });
    adj[j].push({ to: i, w });
  };

  segs.forEach((s, i) => {
    const cuts = splits.get(i);
    if (!cuts || !cuts.length) { link(nodeId(s.a), nodeId(s.b)); return; }
    // 선분 위 스냅점들을 t 순서로 정렬해 연속 분할
    const pts = [{ t: 0, point: s.a }, ...cuts.sort((x, y) => x.t - y.t), { t: 1, point: s.b }];
    for (let k = 0; k < pts.length - 1; k++) link(nodeId(pts[k].point), nodeId(pts[k + 1].point));
  });

  return {
    adj,
    coords,
    idOf: (pt) => nodes.get(nkey(pt[0], pt[1])),
    snaps, // points와 같은 순서
  };
}

// ── Dijkstra (이진 힙) ──
class Heap {
  constructor() { this.a = []; }
  push(item) {
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].d <= a[i].d) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].d < a[m].d) m = l;
        if (r < a.length && a[r].d < a[m].d) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

// 여러 출발점에서 동시에 (기존관 = 하나의 공급원으로 취급할 때 사용)
export function dijkstra(adj, sources) {
  const n = adj.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const h = new Heap();
  for (const s of sources) { if (s >= 0 && dist[s] > 0) { dist[s] = 0; h.push({ v: s, d: 0 }); } }
  while (h.size) {
    const { v, d } = h.pop();
    if (d > dist[v]) continue;
    for (const e of adj[v]) {
      const nd = d + e.w;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = v; h.push({ v: e.to, d: nd }); }
    }
  }
  return { dist, prev };
}

function pathTo(prev, target) {
  const out = [];
  for (let v = target; v !== -1; v = prev[v]) out.push(v);
  return out.reverse();
}

// ── 공급원(sources)에서 모든 터미널을 잇는 최소 연결망 ──
// Prim 방식: 이미 연결된 집합에서 가장 가까운 터미널을 하나씩 흡수하며
// 그 최단경로의 도로 간선을 결과에 누적한다(경로 재사용 → 총 연장 최소화).
export function buildNetwork(adj, sourceIds, terminalIds) {
  const used = new Set();          // "a|b" 간선 집합
  const connected = new Set(sourceIds.filter((v) => v >= 0));
  const remaining = new Set(terminalIds.filter((v) => v >= 0 && !connected.has(v)));
  const unreachable = [];
  if (!connected.size) { // 공급원이 없으면 첫 터미널을 시작점으로
    const first = remaining.values().next().value;
    if (first === undefined) return { used, unreachable };
    connected.add(first); remaining.delete(first);
  }

  while (remaining.size) {
    const { dist, prev } = dijkstra(adj, [...connected]);
    let best = -1, bestD = Infinity;
    for (const t of remaining) if (dist[t] < bestD) { bestD = dist[t]; best = t; }
    if (best < 0 || !Number.isFinite(bestD)) { unreachable.push(...remaining); break; }
    const path = pathTo(prev, best);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      used.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      connected.add(a); connected.add(b);
    }
    connected.add(best);
    remaining.delete(best);
  }
  return { used, unreachable };
}

// ── 사용된 간선들을 폴리라인으로 병합 ──
export function edgesToPolylines(used, coords) {
  const nb = new Map(); // node → Set(node)
  const add = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
  for (const k of used) {
    const [a, b] = k.split('|').map(Number);
    add(a, b); add(b, a);
  }
  const seen = new Set();
  const ekey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const lines = [];

  const walk = (start) => {
    for (const next of nb.get(start)) {
      if (seen.has(ekey(start, next))) continue;
      const chain = [start];
      let prev = start, cur = next;
      for (;;) {
        seen.add(ekey(prev, cur));
        chain.push(cur);
        const around = nb.get(cur);
        if (!around || around.size !== 2) break; // 분기/끝점에서 멈춤
        let nxt = -1;
        for (const c of around) if (c !== prev) nxt = c;
        if (nxt < 0 || seen.has(ekey(cur, nxt))) break;
        prev = cur; cur = nxt;
      }
      lines.push(chain.map((id) => coords[id]));
    }
  };

  for (const [n, s] of nb) if (s.size !== 2) walk(n); // 끝점·분기점부터
  for (const [n] of nb) walk(n);                      // 남은 순환 구간
  return lines;
}
