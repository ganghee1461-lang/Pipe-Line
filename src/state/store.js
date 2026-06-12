// ── 중앙 상태 + 경량 pub/sub ──
// 모든 기능 모듈은 여기를 단일 소스로 읽고 쓴다. 직접 DOM 전역변수 금지.

const state = {
  demands: [],          // { id, query, address, lon, lat, memo }
  pipes: [],            // { id, points:[[x,y]], attr:{...}, segStyles:[] }
  ui: {
    mode: 'sales',      // 'sales' | 'excavation' | 'network'
    tool: 'select',     // 'select' | 'direct' | 'draw'
    basemap: 'Base',
    filterMemoOnly: false,
    selectedDemandId: null,
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

// ── UI ──
export function setUI(patch) {
  Object.assign(state.ui, patch);
  emit('ui:changed', state.ui);
}
