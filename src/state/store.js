// ── 중앙 상태 + 경량 pub/sub ──
// 모든 기능 모듈은 여기를 단일 소스로 읽고 쓴다. 직접 DOM 전역변수 금지.

const state = {
  demands: [],          // { id, query, address, lon, lat, memo }
  pipes: [],            // { id, coords:[[lon,lat]...], segs:[attr×(N-1)] }  세그먼트=점-점 구간
  ui: {
    mode: 'sales',      // 'sales' | 'excavation' | 'network'
    tool: 'select',     // 'select' | 'draw' | 'vertex'
    basemap: 'Base',
    filterMemoOnly: false,
    selectedDemandId: null,
    selectedSegs: [],   // 선택된 세그먼트 키 'pipeId:i' (다중)
  },
};

const listeners = new Map(); // event -> Set<fn>

export function getState() {
  return state;
}

export function subscribe(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => fn(payload, state));
  listeners.get('*')?.forEach((fn) => fn(event, state));
}

// ── 수요처 ──
let demandSeq = 0;
export function addDemand(d) {
  const demand = { id: ++demandSeq, memo: '', ...d };
  state.demands.push(demand);
  emit('demands:changed', state.demands);
  return demand;
}
export function updateDemand(id, patch) {
  const d = state.demands.find((x) => x.id === id);
  if (!d) return;
  Object.assign(d, patch);
  emit('demands:changed', state.demands);
}
export function removeDemand(id) {
  const i = state.demands.findIndex((x) => x.id === id);
  if (i >= 0) state.demands.splice(i, 1);
  emit('demands:changed', state.demands);
}
export function clearDemands() {
  state.demands = [];
  emit('demands:changed', state.demands);
}

// ── 배관 (세그먼트 모델) ──
// 배관 = 폴리라인. 각 점-점 구간(세그먼트)이 개별 속성/연장 단위.
// 선택은 세그먼트 키 'pipeId:i' (i = 세그먼트 인덱스 0..N-2).
let pipeSeq = 0;
const DEFAULT_ATTR = {
  material: 'PLP',    // 'PLP' | 'PE'
  diameter: '100A',
  use: 'supply',      // 'supply'(공급) | 'inlet'(인입)
  pressure: '중압',   // '저압' | '중압'
  status: 'planned',  // 'planned'(예정) | 'existing'(기존)
  review: 'none',     // 'target'(심의대상) | 'none'
  pavement: 'none',   // 'none' | 'asphalt'(아스팔트) | 'concrete'(콘크리트) | 'block'(보도블럭)
};
const newAttr = () => ({ ...DEFAULT_ATTR });

export function segKey(pipeId, i) { return `${pipeId}:${i}`; }
export function parseSeg(key) {
  const [pid, i] = key.split(':');
  return { pipeId: Number(pid), i: Number(i) };
}
export function getSegAttr(key) {
  const { pipeId, i } = parseSeg(key);
  const p = state.pipes.find((x) => x.id === pipeId);
  return p ? p.segs[i] : null;
}

// ── Undo/Redo 히스토리 (배관 스냅샷) ──
let history = [[]];
let histIdx = 0;
function clonePipes(arr) {
  return arr.map((p) => ({
    id: p.id,
    coords: p.coords.map((c) => [...c]),
    segs: p.segs.map((a) => ({ ...a })),
  }));
}
function commit() {
  history = history.slice(0, histIdx + 1);
  history.push(clonePipes(state.pipes));
  histIdx++;
}
function fixSelection() {
  state.ui.selectedSegs = state.ui.selectedSegs.filter((k) => {
    const { pipeId, i } = parseSeg(k);
    const p = state.pipes.find((x) => x.id === pipeId);
    return p && i < p.segs.length;
  });
}
export function undo() {
  if (histIdx <= 0) return;
  histIdx--;
  state.pipes = clonePipes(history[histIdx]);
  fixSelection();
  emit('pipes:changed', state.pipes);
  emit('ui:changed', state.ui);
}
export function redo() {
  if (histIdx >= history.length - 1) return;
  histIdx++;
  state.pipes = clonePipes(history[histIdx]);
  fixSelection();
  emit('pipes:changed', state.pipes);
  emit('ui:changed', state.ui);
}
export function canUndo() { return histIdx > 0; }
export function canRedo() { return histIdx < history.length - 1; }

// 폴리라인 1개 추가 (N점 → N-1 세그먼트). segs 미지정 시 기본 속성.
export function addPipe({ coords, segs } = {}) {
  const cs = coords || [];
  const n = Math.max(0, cs.length - 1);
  const pipe = {
    id: ++pipeSeq,
    coords: cs,
    segs: segs && segs.length === n ? segs : Array.from({ length: n }, newAttr),
  };
  state.pipes.push(pipe);
  commit();
  emit('pipes:changed', state.pipes);
  return pipe;
}

// 형상 편집 결과 반영 (coords + 재조정된 segs). modify 전용.
export function setPipeGeometry(id, coords, segs) {
  const p = state.pipes.find((x) => x.id === id);
  if (!p) return;
  p.coords = coords;
  p.segs = segs;
  commit();
  emit('pipes:changed', state.pipes);
}

// 선택된 세그먼트들에 속성 일괄 적용
export function updateSegs(keys, attrPatch) {
  let changed = false;
  for (const k of keys) {
    const { pipeId, i } = parseSeg(k);
    const p = state.pipes.find((x) => x.id === pipeId);
    if (p && p.segs[i]) { p.segs[i] = { ...p.segs[i], ...attrPatch }; changed = true; }
  }
  if (!changed) return;
  commit();
  emit('pipes:changed', state.pipes);
}

// 세그먼트 삭제 → 남은 연속 구간을 새 배관(들)로 재구성
export function removeSegs(keys) {
  const byPipe = new Map(); // pipeId -> Set(i)
  for (const k of keys) {
    const { pipeId, i } = parseSeg(k);
    if (!byPipe.has(pipeId)) byPipe.set(pipeId, new Set());
    byPipe.get(pipeId).add(i);
  }
  if (!byPipe.size) return;

  const next = [];
  for (const p of state.pipes) {
    const rm = byPipe.get(p.id);
    if (!rm) { next.push(p); continue; }
    // 유지되는 세그먼트들을 연속 구간(run)으로 묶어 각각 새 배관 생성
    let run = null;
    for (let i = 0; i < p.segs.length; i++) {
      if (rm.has(i)) { run = null; continue; }
      if (!run) { run = { start: i, segs: [] }; }
      run.segs.push(p.segs[i]);
      const isLast = i === p.segs.length - 1 || rm.has(i + 1);
      if (isLast) {
        next.push({
          id: ++pipeSeq,
          coords: p.coords.slice(run.start, i + 2).map((c) => [...c]),
          segs: run.segs.map((a) => ({ ...a })),
        });
        run = null;
      }
    }
  }
  state.pipes = next;
  state.ui.selectedSegs = [];
  commit();
  emit('pipes:changed', state.pipes);
  emit('ui:changed', state.ui);
}

// ── 세그먼트 선택 (다중) ──
export function selectSegs(keys) {
  setUI({ selectedSegs: [...new Set(keys)] });
}
export function selectSeg(key) {
  setUI({ selectedSegs: key == null ? [] : [key] });
}
export function toggleSeg(key) {
  const cur = state.ui.selectedSegs;
  const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
  setUI({ selectedSegs: next });
}
export function addSegsToSelection(keys) {
  setUI({ selectedSegs: [...new Set([...state.ui.selectedSegs, ...keys])] });
}
export function clearSegSelection() {
  setUI({ selectedSegs: [] });
}
export function setTool(tool) {
  setUI({ tool });
}

// ── 저장 / 불러오기 ──
export function exportProject() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    demands: state.demands.map((d) => ({ ...d })),
    pipes: clonePipes(state.pipes),
  };
}
export function importProject(data) {
  state.demands = Array.isArray(data?.demands) ? data.demands.map((d) => ({ ...d })) : [];
  state.pipes = Array.isArray(data?.pipes)
    ? data.pipes.map((p) => ({
        id: p.id,
        coords: (p.coords || []).map((c) => [...c]),
        segs: (p.segs || []).map((a) => ({ ...DEFAULT_ATTR, ...a })),
      }))
    : [];
  demandSeq = state.demands.reduce((m, d) => Math.max(m, d.id || 0), 0);
  pipeSeq = state.pipes.reduce((m, p) => Math.max(m, p.id || 0), 0);
  state.ui.selectedSegs = [];
  state.ui.selectedDemandId = null;
  history = [clonePipes(state.pipes)];
  histIdx = 0;
  emit('demands:changed', state.demands);
  emit('pipes:changed', state.pipes);
  emit('ui:changed', state.ui);
}

// ── UI ──
export function setUI(patch) {
  Object.assign(state.ui, patch);
  emit('ui:changed', state.ui);
}
