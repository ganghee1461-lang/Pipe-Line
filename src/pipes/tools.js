// ── 배관 작도/편집 도구 (세그먼트 모델) ──
// P=작도, V=선택, A=꼭짓점편집.
// 선택(V): 클릭=세그먼트 단일 / Ctrl·Shift+클릭=개별 추가 / Shift+드래그=박스 다중선택 / Del=삭제.
// 꼭짓점(A): 점 클릭=선택 / Del=선택 점 삭제 / 점 드래그=이동(자석 없음, 하이라이트 따라옴) / Ctrl+클릭=점 추가.
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import DragBox from 'ol/interaction/DragBox.js';
import DragPan from 'ol/interaction/DragPan.js';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import { Style, Stroke, RegularShape, Circle, Fill } from 'ol/style.js';
import {
  platformModifierKeyOnly, shiftKeyOnly, noModifierKeys, primaryAction,
} from 'ol/events/condition.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { pipeSource, setHoveredSeg } from './layer.js';
import { reconcileSegs } from './util.js';
import {
  getState, subscribe, addPipe, extendPipe, setPipeGeometry, removeSegs, insertVertex,
  selectSeg, selectSegs, toggleSeg, addSegsToSelection, clearSegSelection,
  setTool, undo, redo, segKey, toggleTerminal,
} from '../state/store.js';

let draw, modify, snap, dragBox;
let activeTool = null;
let ctrlDown = false;

// 꼭짓점 편집 상태
let selVertex = null;     // { id, idx } 클릭 선택된 점
let hoverCoord = null;    // 마우스 근처 점(3857)
let draggingCoord = null; // 드래그 중인 점(3857)
let modifying = false;

// 하이라이트 오버레이 (hover=옅음 / 선택·드래그=진함)
const hoverSrc = new VectorSource();
const hoverRing = new Style({
  image: new Circle({ radius: 9, fill: new Fill({ color: 'rgba(15,118,110,0.12)' }), stroke: new Stroke({ color: '#0f766e', width: 2 }) }),
});
const selRing = new Style({
  image: new Circle({ radius: 9, fill: new Fill({ color: 'rgba(29,78,216,0.22)' }), stroke: new Stroke({ color: '#1d4ed8', width: 3 }) }),
});
const hoverLayer = new VectorLayer({ source: hoverSrc, zIndex: 9, style: (f) => (f.get('sel') ? selRing : hoverRing) });

function nearestVertexInfo(pixel) {
  let best = null;
  let bestD = 14; // px
  pipeSource.forEachFeature((f) => {
    f.getGeometry().getCoordinates().forEach((c, idx) => {
      const px = map.getPixelFromCoordinate(c);
      if (!px) return;
      const d = Math.hypot(px[0] - pixel[0], px[1] - pixel[1]);
      if (d < bestD) { bestD = d; best = { id: f.getId(), idx, coord: c }; }
    });
  });
  return best;
}

function showVertexHighlight() {
  hoverSrc.clear();
  let coord = null;
  let sel = false;
  if (draggingCoord) { coord = draggingCoord; sel = true; }
  else if (hoverCoord) { coord = hoverCoord; sel = false; }
  else if (selVertex) {
    const p = getState().pipes.find((x) => x.id === selVertex.id);
    if (p && p.coords[selVertex.idx]) { coord = fromLonLat(p.coords[selVertex.idx]); sel = true; }
  }
  if (coord) {
    const f = new Feature(new Point(coord));
    f.set('sel', sel);
    hoverSrc.addFeature(f);
  }
}

function deleteVertex(id, idx) {
  const pipe = getState().pipes.find((p) => p.id === id);
  if (!pipe) return;
  if (pipe.coords.length <= 2) { removeSegs([segKey(id, 0)]); return; } // 1개 선분이면 배관 삭제
  const old3857 = pipe.coords.map((c) => fromLonLat(c));
  const new3857 = old3857.filter((_, i) => i !== idx);
  const segs = reconcileSegs(old3857, pipe.segs, new3857);
  setPipeGeometry(id, new3857.map((c) => toLonLat(c)), segs);
}

function sameCoords(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
}

function lineToLonLat(geom) {
  return geom.getCoordinates().map((c) => toLonLat(c));
}

function updateCursor() {
  const el = map.getTargetElement();
  if (!el) return;
  if (activeTool === 'draw') el.style.cursor = ctrlDown ? 'copy' : 'crosshair';
  else if (activeTool === 'vertex') el.style.cursor = ctrlDown ? 'copy' : '';
  else el.style.cursor = '';
}

// 꼭짓점 편집 오버레이: 평소 숨김, Ctrl일 때만 '점 추가' 미리보기(초록 +)
function modifyOverlayStyle() {
  if (!ctrlDown) return [];
  return new Style({
    image: new RegularShape({ points: 4, radius: 8, radius2: 0, angle: 0, stroke: new Stroke({ color: '#0f766e', width: 2.5 }) }),
  });
}

function applyTool() {
  const { tool } = getState().ui;
  if (tool === activeTool) return;
  activeTool = tool;

  [draw, modify, snap, dragBox].forEach((i) => map.removeInteraction(i));

  if (tool === 'draw') {
    map.addInteraction(draw);
    map.addInteraction(snap); // 작도는 스냅으로 연결 편의
  } else if (tool === 'vertex') {
    map.addInteraction(modify); // 자석(Snap) 없음 — 미세 이동 자유
  } else if (tool === 'select') {
    map.addInteraction(dragBox);
  }

  // 모드 떠나면 꼭짓점 편집 상태 초기화 + 선택 해제(작도/꼭짓점 진입 시 V선택 초기화)
  if (tool !== 'vertex') { selVertex = null; hoverCoord = null; draggingCoord = null; }
  if (tool !== 'select') clearSegSelection();
  hoverSrc.clear();
  showVertexHighlight();
  updateCursor();
}

// 연속 중복 좌표 제거 (같은 위치 점 두 개 방지)
function dedupe(coords) {
  const out = [];
  for (const c of coords) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - c[0]) > 1e-9 || Math.abs(last[1] - c[1]) > 1e-9) out.push(c);
  }
  return out;
}
function samePt(a, b) {
  return a && b && Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

// 픽셀 위치에서 가장 가까운 세그먼트 키
function segAtPixel(pixel, coordinate) {
  let hit = null;
  map.forEachFeatureAtPixel(
    pixel,
    (f, lyr) => { if (lyr && lyr.getSource() === pipeSource) { hit = f; return true; } },
    { hitTolerance: 6 }
  );
  if (!hit) return null;
  const p = hit.get('pipe');
  const cs = hit.getGeometry().getCoordinates();
  let best = 0, bestD = Infinity;
  for (let i = 0; i < p.segs.length; i++) {
    const d = distToSeg(coordinate, cs[i], cs[i + 1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return segKey(p.id, best);
}

// 작도 시작점이 기존 배관 선분 위(Ctrl 분기)면 그 선분에 접속점을 삽입.
// 끝/꼭짓점에 가까우면(=이미 노드) 삽입하지 않음.
function insertJunctionNear(coord3857) {
  const px0 = map.getPixelFromCoordinate(coord3857);
  if (!px0) return;
  let best = null, bestD = 8; // px
  for (const p of getState().pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      const a = map.getPixelFromCoordinate(fromLonLat(p.coords[i]));
      const b = map.getPixelFromCoordinate(fromLonLat(p.coords[i + 1]));
      if (!a || !b) continue;
      const d = distToSeg(px0, a, b);
      if (d < bestD) { bestD = d; best = { p, i, a, b }; }
    }
  }
  if (!best) return;
  const nearA = Math.hypot(px0[0] - best.a[0], px0[1] - best.a[1]) < 8;
  const nearB = Math.hypot(px0[0] - best.b[0], px0[1] - best.b[1]) < 8;
  if (nearA || nearB) return; // 이미 꼭짓점/끝점 → 분할 불필요
  insertVertex(best.p.id, best.i, toLonLat(coord3857));
}

// 좌표를 기존 배관 꼭짓점에 정확히 스냅(픽셀 허용오차 내) → 저장 좌표 그대로 반환.
// 작도 끝점이 기존 점과 정확히 일치해야 연장/분기 연결(그래프 노드 공유)이 성립.
function snapToVertex(lonlat) {
  const px0 = map.getPixelFromCoordinate(fromLonLat(lonlat));
  if (!px0) return null;
  let best = null, bestD = 10; // px
  for (const p of getState().pipes) {
    for (const c of p.coords) {
      const px = map.getPixelFromCoordinate(fromLonLat(c));
      if (!px) continue;
      const d = Math.hypot(px[0] - px0[0], px[1] - px0[1]);
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  return best ? [...best] : null;
}

// 3857 좌표를 선분(a~b) 위로 정사영
function projectOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}

// 작도 점을 기존 배관에 연결:
//  1) 기존 꼭짓점 근처 → 그 꼭짓점 좌표 반환
//  2) 기존 선분 '모서리'에 닿음 → 그 선분에 접속점 삽입 후 삽입 좌표 반환
//  3) 아무 데도 안 닿음 → null
function connectPointToPipe(lonlat) {
  const v = snapToVertex(lonlat);
  if (v) return v;

  const pt = fromLonLat(lonlat);
  const px0 = map.getPixelFromCoordinate(pt);
  if (!px0) return null;
  let best = null, bestD = 8; // px
  for (const p of getState().pipes) {
    for (let i = 0; i < p.segs.length; i++) {
      const a = fromLonLat(p.coords[i]);
      const b = fromLonLat(p.coords[i + 1]);
      const pa = map.getPixelFromCoordinate(a);
      const pb = map.getPixelFromCoordinate(b);
      if (!pa || !pb) continue;
      const d = distToSeg(px0, pa, pb);
      if (d < bestD) { bestD = d; best = { p, i, a, b }; }
    }
  }
  if (!best) return null;
  const proj = projectOnSeg(pt, best.a, best.b);
  const ppx = map.getPixelFromCoordinate(proj);
  const paPx = map.getPixelFromCoordinate(best.a);
  const pbPx = map.getPixelFromCoordinate(best.b);
  // 끝/꼭짓점에 가까우면 분할 불필요(꼭짓점 스냅이 처리)
  if (Math.hypot(ppx[0] - paPx[0], ppx[1] - paPx[1]) < 8) return null;
  if (Math.hypot(ppx[0] - pbPx[0], ppx[1] - pbPx[1]) < 8) return null;
  const projLL = toLonLat(proj);
  insertVertex(best.p.id, best.i, projLL);
  return [...projLL];
}

// 한 꼭짓점(좌표)에 닿는 모든 세그먼트의 구간번호 모음 (신설관만, 오름차순)
function incidentSections(coord3857) {
  const ll = toLonLat(coord3857);
  const key = `${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
  const secs = new Set();
  for (const p of getState().pipes) {
    for (let vi = 0; vi < p.coords.length; vi++) {
      const k = `${p.coords[vi][0].toFixed(6)},${p.coords[vi][1].toFixed(6)}`;
      if (k !== key) continue;
      for (const si of [vi - 1, vi]) {
        if (si >= 0 && si < p.segs.length && p.segs[si].status !== 'existing') {
          secs.add(p.segs[si].section || 1);
        }
      }
    }
  }
  return [...secs].sort((a, b) => a - b);
}

// 분기 꼭짓점: 겹친 구간 중 어느 구간의 종점인지 선택하는 작은 메뉴
let pickEl = null;
function hideSectionPicker() {
  if (!pickEl) return;
  pickEl.remove();
  pickEl = null;
  document.removeEventListener('pointerdown', onPickOutside, true);
}
function onPickOutside(e) {
  if (pickEl && !pickEl.contains(e.target)) hideSectionPicker();
}
function showSectionPicker(clientX, clientY, secs, pipeId, idx) {
  hideSectionPicker();
  const marked = new Set(getState().terminals.filter((t) => t.pipeId === pipeId && t.idx === idx).map((t) => t.section));
  pickEl = document.createElement('div');
  pickEl.className = 'sec-pick';
  pickEl.innerHTML = `<div class="sec-pick-h">구간 종점 지정</div>`
    + secs.map((s) => `<button data-sec="${s}">${marked.has(s) ? '✓ ' : ''}${s}구간 종점</button>`).join('');
  document.body.appendChild(pickEl);
  pickEl.style.left = `${clientX}px`;
  pickEl.style.top = `${clientY}px`;
  pickEl.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { toggleTerminal(pipeId, idx, Number(b.dataset.sec)); hideSectionPicker(); });
  });
  setTimeout(() => document.addEventListener('pointerdown', onPickOutside, true), 0);
}

function distToSeg(pt, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return Math.hypot(pt[0] - cx, pt[1] - cy);
}

function onClick(evt) {
  const tool = getState().ui.tool;
  if (tool === 'vertex') {
    const v = nearestVertexInfo(evt.pixel);
    selVertex = v ? { id: v.id, idx: v.idx } : null;
    hoverCoord = v ? v.coord : null;
    showVertexHighlight();
    return;
  }
  if (tool !== 'select') return;
  const oe = evt.originalEvent;
  const additive = oe && (oe.ctrlKey || oe.metaKey || oe.shiftKey);
  const key = segAtPixel(evt.pixel, evt.coordinate);
  if (additive) {
    if (key) toggleSeg(key);
  } else {
    selectSeg(key);
  }
}

function onKey(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
  if (mod) return;

  switch (e.code) {
    case 'KeyP': setTool('draw'); break;
    case 'KeyV': setTool('select'); break;
    case 'KeyA': setTool('vertex'); break;
    case 'Escape':
      if (activeTool === 'draw') draw.abortDrawing();
      setTool('select');
      clearSegSelection();
      break;
    case 'Delete':
    case 'Backspace': {
      if (getState().ui.tool === 'vertex') {
        if (selVertex) {
          e.preventDefault();
          deleteVertex(selVertex.id, selVertex.idx);
          selVertex = null; hoverCoord = null;
          showVertexHighlight();
        }
      } else {
        const keys = getState().ui.selectedSegs;
        if (keys.length) { e.preventDefault(); removeSegs(keys); }
      }
      break;
    }
  }
}

export function initPipeTools() {
  // 좌클릭에서 점 추가(Ctrl 포함) → 우클릭은 점 없이 종료만.
  draw = new Draw({ type: 'LineString', condition: (e) => primaryAction(e) });
  // Ctrl로 작도 시작 시: 시작점이 기존 선분 위면 그 선분에 접속점을 삽입(분기)
  draw.on('drawstart', (e) => {
    if (!ctrlDown) return;
    const c = e.feature.getGeometry().getCoordinates();
    const first = Array.isArray(c[0]) ? c[0] : c;
    if (first) insertJunctionNear(first);
  });
  draw.on('drawend', (e) => {
    let coords = dedupe(lineToLonLat(e.feature.getGeometry()));
    if (coords.length < 2) return;
    // 새 선의 각 점이 기존 배관(꼭짓점 또는 선분 모서리)에 닿으면 자동으로 접속점 생성·연결
    for (let k = 0; k < coords.length; k++) {
      const c = connectPointToPipe(coords[k]);
      if (c) coords[k] = c;
    }
    coords = dedupe(coords);
    if (coords.length < 2) return;
    // 기존 배관의 끝점에서 시작했으면 그 배관을 이어서 연장 (같은 점 중복 없이)
    const first = coords[0];
    let p = null;
    for (const pp of getState().pipes) {
      if (samePt(pp.coords[pp.coords.length - 1], first)) { p = extendPipe(pp.id, coords.slice(1), false); break; }
      if (samePt(pp.coords[0], first)) { p = extendPipe(pp.id, coords.slice(1), true); break; }
    }
    if (!p) p = addPipe({ coords });
    setTool('select');
    selectSegs(p.segs.map((_, i) => segKey(p.id, i)));
  });

  // Ctrl일 때만 점 삽입. 자체 점삭제 비활성(Del 키로 처리).
  modify = new Modify({
    source: pipeSource,
    insertVertexCondition: platformModifierKeyOnly,
    deleteCondition: () => false,
    style: modifyOverlayStyle,
  });
  modify.on('modifystart', (e) => {
    modifying = true;
    const px = e.mapBrowserEvent && e.mapBrowserEvent.pixel;
    if (px) { const v = nearestVertexInfo(px); if (v) selVertex = { id: v.id, idx: v.idx }; }
  });
  modify.on('modifyend', (e) => {
    modifying = false;
    draggingCoord = null;
    e.features.forEach((f) => {
      const id = f.getId();
      const pipe = getState().pipes.find((x) => x.id === id);
      if (!pipe) return;
      const oldC = pipe.coords.map((c) => fromLonLat(c));
      const newC = f.getGeometry().getCoordinates();
      if (sameCoords(oldC, newC)) return; // 이동 없는 클릭이면 커밋 안 함
      const segs = reconcileSegs(oldC, pipe.segs, newC);
      setPipeGeometry(id, newC.map((c) => toLonLat(c)), segs);
    });
    showVertexHighlight();
  });

  snap = new Snap({ source: pipeSource });

  // Shift+드래그 박스 선택
  dragBox = new DragBox({ condition: shiftKeyOnly });
  dragBox.on('boxend', () => {
    const ext = dragBox.getGeometry().getExtent();
    const keys = [];
    pipeSource.forEachFeatureIntersectingExtent(ext, (f) => {
      const p = f.get('pipe');
      const cs = f.getGeometry().getCoordinates();
      for (let i = 0; i < p.segs.length; i++) {
        if (new LineString([cs[i], cs[i + 1]]).intersectsExtent(ext)) keys.push(segKey(p.id, i));
      }
    });
    if (keys.length) addSegsToSelection(keys);
  });

  // DragPan을 '보조키 없을 때만' 패닝으로 교체 → Shift 드래그=박스선택.
  // 더블클릭 확대(DoubleClickZoom)는 제거.
  map.getInteractions().getArray().slice().forEach((i) => {
    if (i instanceof DragPan || i instanceof DoubleClickZoom) map.removeInteraction(i);
  });
  map.addInteraction(new DragPan({ condition: noModifierKeys }));

  map.addLayer(hoverLayer);

  applyTool();
  subscribe('ui:changed', applyTool);
  map.on('singleclick', onClick);

  // hover: V=선분 강조 / A=근처 점 강조
  map.on('pointermove', (evt) => {
    if (evt.dragging) return;
    const tool = getState().ui.tool;
    const el = map.getTargetElement();
    if (tool === 'select') {
      const key = segAtPixel(evt.pixel, evt.coordinate);
      setHoveredSeg(key);
      if (el) el.style.cursor = key ? 'pointer' : '';
    } else if (tool === 'vertex') {
      setHoveredSeg(null);
      const v = nearestVertexInfo(evt.pixel);
      hoverCoord = v ? v.coord : null;
      draggingCoord = null;
      showVertexHighlight();
      if (el) el.style.cursor = v ? 'move' : (ctrlDown ? 'copy' : '');
    } else {
      setHoveredSeg(null);
    }
  });

  // 드래그 중: 하이라이트가 점을 따라오게
  map.on('pointerdrag', (evt) => {
    if (getState().ui.tool === 'vertex' && modifying) {
      draggingCoord = evt.coordinate;
      showVertexHighlight();
    }
  });

  window.addEventListener('keydown', onKey);

  // 우클릭: 작도 중이면 작도 종료 / 그 외엔 꼭짓점 종점 표시(배관망 분석용)
  map.getViewport().addEventListener('contextmenu', (e) => {
    if (activeTool === 'draw') {
      e.preventDefault();
      try { draw.finishDrawing(); } catch { /* 점 부족 시 무시 */ }
      return;
    }
    if (getState().ui.mode !== 'network') return; // 종점 표시는 배관망 모드 전용
    const v = nearestVertexInfo(map.getEventPixel(e));
    if (!v) return;
    e.preventDefault();
    const secs = incidentSections(v.coord);
    if (!secs.length) return;
    if (secs.length === 1) toggleTerminal(v.id, v.idx, secs[0]); // 단일 구간 → 바로 토글
    else showSectionPicker(e.clientX, e.clientY, secs, v.id, v.idx); // 분기 → 구간 선택
  });

  // Ctrl 시각 피드백 (점 추가 가능 + 미리보기 갱신)
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Control' || e.key === 'Meta') && !ctrlDown) { ctrlDown = true; updateCursor(); map.render(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') { ctrlDown = false; updateCursor(); map.render(); }
  });
}
