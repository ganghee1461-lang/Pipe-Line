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
function nearestSeg(p, segs, index, skipIdx = -1) {
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
          if (i === skipIdx) continue;
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

// 가까운 선분 여러 개 (서로 다른 도로 후보). 투영점이 서로 떨어진 것만 남긴다.
function nearestSegs(p, segs, index, k = 3, maxDist = 80) {
  const { grid, cell } = index;
  const cx0 = Math.floor(p[0] / cell), cy0 = Math.floor(p[1] / cell);
  const rings = Math.ceil(maxDist / cell) + 1;
  const cand = [];
  const seen = new Set();
  for (let cx = cx0 - rings; cx <= cx0 + rings; cx++) {
    for (let cy = cy0 - rings; cy <= cy0 + rings; cy++) {
      const arr = grid.get(`${cx},${cy}`);
      if (!arr) continue;
      for (const i of arr) {
        if (seen.has(i)) continue;
        seen.add(i);
        const pr = project(p, segs[i].a, segs[i].b);
        if (pr.dist <= maxDist) cand.push({ segIdx: i, ...pr });
      }
    }
  }
  cand.sort((a, b) => a.dist - b.dist);
  const out = [];
  for (const c of cand) {
    // 이미 고른 후보와 거의 같은 지점이면 건너뜀 (같은 도로의 다른 조각)
    if (out.some((o) => Math.hypot(o.point[0] - c.point[0], o.point[1] - c.point[1]) < 12)) continue;
    out.push(c);
    if (out.length >= k) break;
  }
  return out;
}

// ── 그래프 구성 (스냅점에서 선분을 쪼개 노드로 편입) ──
// points: [[x,y], ...] 연결 대상(마커/기존관). 반환: { adj, nodes, snaps }
const WELD_TOL = 3;    // 끊어진 도로 끝점을 이어 붙일 허용 오차(m)
const CANDIDATES = 3;  // 마커당 스냅 후보 도로 수
const MERGE_TOL = 2.5; // 이 거리 안의 분할점은 하나로 합침(노드 뭉침 방지)

export function buildGraph(segs, points) {
  const index = buildIndex(segs);
  const splits = new Map(); // segIdx → [{t, point}]

  // 분할점 추가. 같은 선분에 이미 아주 가까운 분할점이 있으면 그것을 재사용한다.
  // (교차로에서 여러 마커가 조금씩 다른 지점에 스냅되어 노드가 뭉치는 것을 막음)
  const addCut = (segIdx, t, point) => {
    let arr = splits.get(segIdx);
    if (!arr) { arr = []; splits.set(segIdx, arr); }
    for (const c of arr) {
      if (Math.hypot(c.point[0] - point[0], c.point[1] - point[1]) <= MERGE_TOL) return c.point;
    }
    arr.push({ t, point });
    return point;
  };

  // ── 노딩(교차점 이어붙이기) ──
  // 도로명주소 도로구간은 T자 교차에서 끝점을 공유하지 않는 경우가 있어,
  // 그대로 쓰면 도로망이 조각조각 끊긴다(고립된 마커·이상한 우회의 원인).
  // 다른 선분 위에 얹혀 있는 '매달린 끝점'을 그 선분에 투영해 붙인다.
  const endCount = new Map();
  const bump = (pt) => {
    const k = nkey(pt[0], pt[1]);
    endCount.set(k, (endCount.get(k) || 0) + 1);
  };
  segs.forEach((s) => { bump(s.a); bump(s.b); });

  const remap = new Map(); // 원래 끝점 key → 이어붙일 좌표
  segs.forEach((s, i) => {
    for (const pt of [s.a, s.b]) {
      const k = nkey(pt[0], pt[1]);
      if (endCount.get(k) !== 1) continue;        // 이미 다른 선과 만나는 점
      if (remap.has(k)) continue;
      const near = nearestSeg(pt, segs, index, i); // 자기 선분 제외
      if (!near || near.dist > WELD_TOL) continue;
      if (near.t <= 0.001 || near.t >= 0.999) continue; // 끝점끼리면 좌표만 맞추면 됨
      remap.set(k, addCut(near.segIdx, near.t, near.point));
    }
  });
  const fix = (pt) => remap.get(nkey(pt[0], pt[1])) || pt;

  // 점마다 후보 도로 여러 곳에 스냅 → 나중에 총 연장이 가장 짧아지는 곳을 고른다
  const snapSets = points.map((p) => {
    const list = nearestSegs(p, segs, index, CANDIDATES);
    if (!list.length) {
      const s = nearestSeg(p, segs, index);
      if (!s) return [];
      list.push(s);
    }
    return list.map((s) => {
      const pt = addCut(s.segIdx, s.t, s.point);   // 병합된 지점을 사용
      return { point: pt, dist: Math.hypot(p[0] - pt[0], p[1] - pt[1]) };
    });
  });
  const snaps = snapSets.map((l) => l[0] || null); // 기존 호환(가장 가까운 곳)

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
    const a = fix(s.a), b = fix(s.b); // 이어붙인 끝점 반영
    const cuts = splits.get(i);
    if (!cuts || !cuts.length) { link(nodeId(a), nodeId(b)); return; }
    // 선분 위 스냅점들을 t 순서로 정렬해 연속 분할
    const pts = [{ t: 0, point: a }, ...cuts.sort((x, y) => x.t - y.t), { t: 1, point: b }];
    for (let k = 0; k < pts.length - 1; k++) link(nodeId(pts[k].point), nodeId(pts[k + 1].point));
  });

  return {
    adj,
    coords,
    idOf: (pt) => nodes.get(nkey(pt[0], pt[1])),
    snaps,    // points와 같은 순서 (가장 가까운 후보)
    snapSets, // points와 같은 순서, 후보 목록
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

// ── 공급원(sources)에서 모든 수요처를 잇는 최소 연결망 ──
// 수요처마다 스냅 후보가 여러 곳이라, 그중 '도로 경로 + 인입 거리'의 합이
// 가장 작은 후보를 골라 연결한다. 이미 관이 지나는 도로가 있으면 그쪽이 선택돼
// 뒷골목까지 뻗는 불필요한 곁가지가 생기지 않는다.
// groups[i] = [{ id, extra }]  extra = 마커→스냅점 거리(인입 연장)
export function buildNetwork(adj, sourceIds, groups) {
  const used = new Set();
  const connected = new Set(sourceIds.filter((v) => v >= 0));
  const chosen = new Array(groups.length).fill(-1); // 그룹별 선택된 노드
  const pending = new Set();
  groups.forEach((g, i) => { if (g && g.length) pending.add(i); });
  const unreachable = [];

  if (!connected.size) {
    // 공급원이 없으면 첫 수요처의 가장 가까운 후보를 시작점으로
    const first = pending.values().next().value;
    if (first === undefined) return { used, unreachable, chosen };
    const c = groups[first][0];
    connected.add(c.id); chosen[first] = c.id; pending.delete(first);
  }

  while (pending.size) {
    const { dist, prev } = dijkstra(adj, [...connected]);
    let bestGroup = -1, bestNode = -1, bestCost = Infinity;
    for (const gi of pending) {
      for (const c of groups[gi]) {
        if (c.id < 0) continue;
        const cost = dist[c.id] + (c.extra || 0); // 도로 경로 + 인입 거리
        if (cost < bestCost) { bestCost = cost; bestGroup = gi; bestNode = c.id; }
      }
    }
    if (bestGroup < 0 || !Number.isFinite(bestCost)) { unreachable.push(...pending); break; }

    const path = pathTo(prev, bestNode);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      used.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      connected.add(a); connected.add(b);
    }
    connected.add(bestNode);
    chosen[bestGroup] = bestNode;
    pending.delete(bestGroup);
  }
  return { used, unreachable, chosen };
}

// ── 고리 제거: 사용된 간선들을 트리로 정리 ──
// 여러 최단경로를 합치면 부분적으로 겹쳐 고리가 남을 수 있다(불필요한 중복 가지).
// 사용된 간선만으로 이루어진 부분그래프에서 공급원 기준 최단경로 트리를 만들어
// 각 수요처까지의 경로만 남기면 고리가 사라진다.
export function treeify(used, sourceIds, terminalIds, coords) {
  const nb = new Map();
  const add = (a, b, w) => { if (!nb.has(a)) nb.set(a, []); nb.get(a).push({ to: b, w }); };
  for (const k of used) {
    const [a, b] = k.split('|').map(Number);
    const w = Math.hypot(coords[a][0] - coords[b][0], coords[a][1] - coords[b][1]);
    add(a, b, w); add(b, a, w);
  }
  const subAdj = [];
  for (let i = 0; i < coords.length; i++) subAdj.push(nb.get(i) || []);

  const starts = sourceIds.filter((v) => v >= 0 && nb.has(v));
  const seeds = starts.length ? starts : terminalIds.filter((v) => v >= 0 && nb.has(v)).slice(0, 1);
  if (!seeds.length) return new Set();

  const { prev } = dijkstra(subAdj, seeds);
  const out = new Set();
  for (const t of terminalIds) {
    if (t < 0 || !nb.has(t)) continue;
    for (let v = t; v !== -1 && prev[v] !== -1; v = prev[v]) {
      const a = v, b = prev[v];
      out.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }
  return out;
}

// ── 막다른 가지 치기 ──
// 어떤 수요처/공급원에도 닿지 않는 말단 간선을 반복적으로 제거한다.
// (경로를 합치는 과정에서 생기는, 아무도 쓰지 않는 곁가지 제거)
export function pruneLeaves(used, keepIds) {
  const edges = new Set(used);
  const nb = new Map(); // node → Set(node)
  const add = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
  for (const k of edges) {
    const [a, b] = k.split('|').map(Number);
    add(a, b); add(b, a);
  }

  const ekey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  // 말단(차수 1)이면서 보존 대상이 아닌 노드를 계속 떼어낸다
  const queue = [];
  for (const [n, s] of nb) if (s.size === 1 && !keepIds.has(n)) queue.push(n);

  while (queue.length) {
    const n = queue.pop();
    const s = nb.get(n);
    if (!s || s.size !== 1 || keepIds.has(n)) continue;
    const [other] = [...s];
    edges.delete(ekey(n, other));
    nb.delete(n);
    const os = nb.get(other);
    if (os) {
      os.delete(n);
      if (os.size === 1 && !keepIds.has(other)) queue.push(other);
      else if (os.size === 0) nb.delete(other);
    }
  }
  return edges;
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
