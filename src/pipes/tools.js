// ── 배관 작도/편집 도구 (세그먼트 모델) ──
// P=작도, V=선택, A=꼭짓점편집.
// 선택(V): 클릭=세그먼트 단일 / Ctrl·Shift+클릭=개별 추가 / Shift+드래그=박스 다중선택 / Del=삭제.
// 꼭짓점(A): 점 클릭=선택 / Del=선택 점 삭제 / 점 드래그=이동(자석 없음, 하이라이트 따라옴) / Ctrl+클릭=점 추가.
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import DragBox from 'ol/interaction/DragBox.js';
import DragPan from 'ol/interaction/DragPan.js';
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
  getState, subscribe, addPipe, setPipeGeometry, removeSegs,
  selectSeg, selectSegs, toggleSeg, addSegsToSelection, clearSegSelection,
  setTool, undo, redo, segKey,
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
  if (activeTool === 'draw') el.style.cursor = 'crosshair';
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

  // 모드 떠나면 꼭짓점 편집 상태 초기화
  if (tool !== 'vertex') { selVertex = null; hoverCoord = null; draggingCoord = null; }
  hoverSrc.clear();
  showVertexHighlight();
  updateCursor();
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
  // 좌클릭(primaryAction)에서만 점 추가 → 우클릭은 점 없이 종료만.
  draw = new Draw({ type: 'LineString', condition: (e) => noModifierKeys(e) && primaryAction(e) });
  draw.on('drawend', (e) => {
    const coords = lineToLonLat(e.feature.getGeometry());
    const p = addPipe({ coords });
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

  // DragPan을 '보조키 없을 때만' 패닝으로 교체 → Shift 드래그=박스선택
  map.getInteractions().getArray().slice().forEach((i) => {
    if (i instanceof DragPan) map.removeInteraction(i);
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

  // 우클릭: 작도 종료
  map.getViewport().addEventListener('contextmenu', (e) => {
    if (activeTool === 'draw') {
      e.preventDefault();
      try { draw.finishDrawing(); } catch { /* 점 부족 시 무시 */ }
    }
  });

  // Ctrl 시각 피드백 (점 추가 가능 + 미리보기 갱신)
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Control' || e.key === 'Meta') && !ctrlDown) { ctrlDown = true; updateCursor(); map.render(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') { ctrlDown = false; updateCursor(); map.render(); }
  });
}
