// ── 중앙 상태 + 경량 pub/sub ──
// 모든 기능 모듈은 여기를 단일 소스로 읽고 쓴다. 직접 DOM 전역변수 금지.

const state = {
  demands: [],          // { id, query, address, lon, lat, memo }
  pipes: [],            // { id, coords:[[lon,lat]...], attr:{material,diameter,use,pressure,status,review} }
  ui: {
    mode: 'sales',      // 'sales' | 'excavation' | 'network'
    tool: 'select',     // 'select' | 'draw' | 'vertex'
    basemap: 'Base',
    filterMemoOnly: false,
    selectedDemandId: null,
    selectedPipeIds: [], // 다중 선택 (첫 요소 = 주 선택)
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

// ── 배관 ──
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

// ── Undo/Redo 히스토리 (배관 스냅샷) ──
let history = [[]];
let histIdx = 0;
function clonePipes(arr) {
  return arr.map((p) => ({ ...p, coords: p.coords.map((c) => [...c]), attr: { ...p.attr } }));
}
function commit() {
  history = history.slice(0, histIdx + 1);
  history.push(clonePipes(state.pipes));
  histIdx++;
}
function fixSelection() {
  const ids = new Set(state.pipes.map((p) => p.id));
  state.ui.selectedPipeIds = state.ui.selectedPipeIds.filter((id) => ids.has(id));
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

export function addPipe({ coords, attr } = {}) {
  const pipe = { id: ++pipeSeq, coords: coords || [], attr: { ...DEFAULT_ATTR, ...(attr || {}) } };
  state.pipes.push(pipe);
  commit();
  emit('pipes:changed', state.pipes);
  return pipe;
}
export function updatePipe(id, patch) {
  const p = state.pipes.find((x) => x.id === id);
  if (!p) return;
  if (patch.coords) p.coords = patch.coords;
  if (patch.attr) p.attr = { ...p.attr, ...patch.attr };
  commit();
  emit('pipes:changed', state.pipes);
}
// 여러 배관에 같은 속성 일괄 적용
export function updatePipes(ids, attrPatch) {
  const set = new Set(ids);
  let changed = false;
  for (const p of state.pipes) {
    if (set.has(p.id)) { p.attr = { ...p.attr, ...attrPatch }; changed = true; }
  }
  if (!changed) return;
  commit();
  emit('pipes:changed', state.pipes);
}
export function removePipe(id) {
  removePipes([id]);
}
export function removePipes(ids) {
  const del = new Set(ids);
  const before = state.pipes.length;
  state.pipes = state.pipes.filter((p) => !del.has(p.id));
  if (state.pipes.length === before) return;
  state.ui.selectedPipeIds = state.ui.selectedPipeIds.filter((id) => !del.has(id));
  commit();
  emit('pipes:changed', state.pipes);
  emit('ui:changed', state.ui);
}

// ── 배관 선택 (다중) ──
export function selectPipes(ids) {
  setUI({ selectedPipeIds: [...new Set(ids)] });
}
export function selectPipe(id) {
  setUI({ selectedPipeIds: id == null ? [] : [id] });
}
export function togglePipe(id) {
  const cur = state.ui.selectedPipeIds;
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  setUI({ selectedPipeIds: next });
}
export function addToSelection(ids) {
  setUI({ selectedPipeIds: [...new Set([...state.ui.selectedPipeIds, ...ids])] });
}
export function clearPipeSelection() {
  setUI({ selectedPipeIds: [] });
}
export function setTool(tool) {
  setUI({ tool });
}

// ── UI ──
export function setUI(patch) {
  Object.assign(state.ui, patch);
  emit('ui:changed', state.ui);
}
