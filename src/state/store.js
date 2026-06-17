// ── 중앙 상태 + 경량 pub/sub ──
// 모든 기능 모듈은 여기를 단일 소스로 읽고 쓴다. 직접 DOM 전역변수 금지.

const state = {
  demands: [],          // { id, query, address, lon, lat, memo }
  pipes: [],            // { id, coords:[[lon,lat]...], segs:[attr×(N-1)] }  세그먼트=점-점 구간
  terminals: [],        // 구간 종점 표시 { pipeId, idx } (배관망 모드, 우클릭 지정)
  ui: {
    mode: 'sales',      // 'sales' | 'excavation' | 'network'
    colorBy: 'diameter', // 영업 모드 색상 기준: 'diameter' | 'pavement'
    tool: 'select',     // 'select' | 'draw' | 'vertex'
    basemap: 'Base',
    filterMemoOnly: false,
    selectedDemandId: null,
    selectedSegs: [],   // 선택된 세그먼트 키 'pipeId:i' (다중)
    markerStyle: { color: 'transparent', borderColor: '#b91c1c', shape: 'circle', border: 'solid', showNum: true },
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

// ── 구간 종점 표시 (배관망 모드, 꼭짓점 우클릭으로 지정/해제) ──
// 한 점에 여러 구간이 겹치므로 section을 함께 저장(같은 점에 구간별 종점 가능).
export function toggleTerminal(pipeId, idx, section) {
  const i = state.terminals.findIndex((t) => t.pipeId === pipeId && t.idx === idx && t.section === section);
  if (i >= 0) state.terminals.splice(i, 1);
  else state.terminals.push({ pipeId, idx, section });
  emit('terminals:changed', state.terminals);
}

// ── 계량기 (수요처별 다중) ──  meter = { use, grade, qty }
export function addMeter(demandId) {
  const d = state.demands.find((x) => x.id === demandId);
  if (!d) return;
  d.meters = [...(d.meters || []), { use: '일반', grade: 4, qty: 1 }];
  emit('demands:changed', state.demands);
}
export function updateMeter(demandId, idx, patch) {
  const d = state.demands.find((x) => x.id === demandId);
  if (!d || !d.meters || !d.meters[idx]) return;
  d.meters[idx] = { ...d.meters[idx], ...patch };
  emit('demands:changed', state.demands);
}
export function removeMeter(demandId, idx) {
  const d = state.demands.find((x) => x.id === demandId);
  if (!d || !d.meters) return;
  d.meters.splice(idx, 1);
  emit('demands:changed', state.demands);
}

// ── 배관 (세그먼트 모델) ──
// 배관 = 폴리라인. 각 점-점 구간(세그먼트)이 개별 속성/연장 단위.
// 선택은 세그먼트 키 'pipeId:i' (i = 세그먼트 인덱스 0..N-2).
let pipeSeq = 0;
const DEFAULT_ATTR = {
  material: 'PE',     // 'PLP' | 'PE'
  diameter: '63A',
  use: 'supply',      // 'supply'(공급) | 'inlet'(인입)
  pressure: '저압',   // '저압' | '중압'
  status: 'planned',  // 'planned'(예정) | 'existing'(기존)
  review: 'target',   // 'target'(심의대상) | 'none'
  pavement: 'asphalt', // 'none' | 'asphalt' | 'concrete' | 'block'
  section: 1,         // N번 구간 (배관망 분석에서 구간별 색상)
  markerNo: '',       // 인입관 전용: 연결된 수요처 표시번호 (계량기 집계용)
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

// 기존 배관 끝점에서 이어 그리기 (끝/시작에 점·세그먼트 추가)
export function extendPipe(id, addedCoords, atStart) {
  const p = state.pipes.find((x) => x.id === id);
  if (!p) return null;
  const added = addedCoords.map((c) => [...c]);
  const newSegs = added.map(newAttr);
  if (atStart) {
    p.coords = [...added.slice().reverse(), ...p.coords];
    p.segs = [...newSegs, ...p.segs];
  } else {
    p.coords = [...p.coords, ...added];
    p.segs = [...p.segs, ...newSegs];
  }
  commit();
  emit('pipes:changed', state.pipes);
  return p;
}

// 선분 i 위(꼭짓점 i ~ i+1 사이)에 점 삽입 → 그 선분을 둘로 분할(속성 동일).
// 작도 모드 Ctrl+분기 시작 시 기존 배관에 접속점 추가용.
export function insertVertex(pipeId, i, lonlat) {
  const p = state.pipes.find((x) => x.id === pipeId);
  if (!p || i < 0 || i >= p.segs.length) return;
  p.coords = [...p.coords.slice(0, i + 1), [...lonlat], ...p.coords.slice(i + 1)];
  p.segs = [...p.segs.slice(0, i + 1), { ...p.segs[i] }, ...p.segs.slice(i + 1)];
  commit();
  emit('pipes:changed', state.pipes);
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
export function setMarkerStyle(patch) {
  setUI({ markerStyle: { ...state.ui.markerStyle, ...patch } });
}

// ── 저장 / 불러오기 ──
export function exportProject() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    demands: state.demands.map((d) => ({ ...d })),
    pipes: clonePipes(state.pipes),
    terminals: state.terminals.map((t) => ({ ...t })),
    markerStyle: { ...state.ui.markerStyle },
  };
}
export function importProject(data) {
  if (data?.markerStyle) state.ui.markerStyle = { color: 'transparent', borderColor: '#b91c1c', shape: 'circle', border: 'solid', showNum: true, ...data.markerStyle };
  state.demands = Array.isArray(data?.demands) ? data.demands.map((d) => ({ ...d })) : [];
  state.pipes = Array.isArray(data?.pipes)
    ? data.pipes.map((p) => ({
        id: p.id,
        coords: (p.coords || []).map((c) => [...c]),
        segs: (p.segs || []).map((a) => ({ ...DEFAULT_ATTR, ...a })),
      }))
    : [];
  state.terminals = Array.isArray(data?.terminals) ? data.terminals.map((t) => ({ ...t })) : [];
  demandSeq = state.demands.reduce((m, d) => Math.max(m, d.id || 0), 0);
  pipeSeq = state.pipes.reduce((m, p) => Math.max(m, p.id || 0), 0);
  state.ui.selectedSegs = [];
  state.ui.selectedDemandId = null;
  history = [clonePipes(state.pipes)];
  histIdx = 0;
  emit('demands:changed', state.demands);
  emit('pipes:changed', state.pipes);
  emit('terminals:changed', state.terminals);
  emit('ui:changed', state.ui);
}

// ── UI ──
export function setUI(patch) {
  Object.assign(state.ui, patch);
  emit('ui:changed', state.ui);
}
