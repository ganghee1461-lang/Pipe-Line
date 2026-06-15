// ── 배관 작도/편집 도구 (세그먼트 모델) ──
// P=작도, V=선택, A=꼭짓점편집. Del=선택 세그먼트 삭제, Ctrl+Z/Y=실행취소/다시.
// 선택(V): 클릭=세그먼트 단일 / Ctrl·Shift+클릭=개별 추가 / Shift+드래그=박스 다중선택.
// 꼭짓점(A): 점 드래그=형상수정(연결 유지) / Ctrl+클릭=점 추가 / Alt+클릭=점 삭제.
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
  platformModifierKeyOnly, shiftKeyOnly, altKeyOnly, singleClick, noModifierKeys,
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

// A모드: 마우스 근처의 대상 꼭짓점 하이라이트 오버레이
const hoverSrc = new VectorSource();
const hoverLayer = new VectorLayer({
  source: hoverSrc,
  zIndex: 9,
  style: new Style({
    image: new Circle({
      radius: 9,
      fill: new Fill({ color: 'rgba(15,118,110,0.18)' }),
      stroke: new Stroke({ color: '#0f766e', width: 3 }),
    }),
  }),
});

function nearestVertex(pixel) {
  let best = null;
  let bestD = 14; // px
  pipeSource.forEachFeature((f) => {
    for (const c of f.getGeometry().getCoordinates()) {
      const px = map.getPixelFromCoordinate(c);
      if (!px) continue;
      const d = Math.hypot(px[0] - pixel[0], px[1] - pixel[1]);
      if (d < bestD) { bestD = d; best = c; }
    }
  });
  return best;
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

// 꼭짓점 편집 오버레이: 평소엔 숨기고, Ctrl 누를 때만 '점 추가' 미리보기(초록 +)
function modifyOverlayStyle() {
  if (!ctrlDown) return [];
  return new Style({
    image: new RegularShape({
      points: 4, radius: 8, radius2: 0, angle: 0,
      stroke: new Stroke({ color: '#0f766e', width: 2.5 }),
    }),
  });
}

function applyTool() {
  const { tool } = getState().ui;
  if (tool === activeTool) return;
  activeTool = tool;

  [draw, modify, snap, dragBox].forEach((i) => map.removeInteraction(i));

  if (tool === 'draw') {
    map.addInteraction(draw);
    map.addInteraction(snap);
  } else if (tool === 'vertex') {
    map.addInteraction(modify);
    map.addInteraction(snap);
  } else if (tool === 'select') {
    map.addInteraction(dragBox);
  }
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
  if (getState().ui.tool !== 'select') return;
  const oe = evt.originalEvent;
  const additive = oe && (oe.ctrlKey || oe.metaKey || oe.shiftKey);
  const key = segAtPixel(evt.pixel, evt.coordinate);
  if (additive) {
    if (key) toggleSeg(key);
  } else {
    selectSeg(key); // null이면 해제
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
      const keys = getState().ui.selectedSegs;
      if (keys.length) { e.preventDefault(); removeSegs(keys); }
      break;
    }
  }
}

export function initPipeTools() {
  // source 미지정 — drawend 후 Draw가 소스에 중복 추가하는 것 방지
  draw = new Draw({ type: 'LineString' });
  draw.on('drawend', (e) => {
    const coords = lineToLonLat(e.feature.getGeometry());
    const p = addPipe({ coords });
    setTool('select');
    selectSegs(p.segs.map((_, i) => segKey(p.id, i))); // 그린 배관의 모든 세그먼트 선택
  });

  // Ctrl 누른 상태에서만 점 삽입, Alt+클릭으로 점 삭제. 형상 변경 시 세그먼트 속성 재조정.
  modify = new Modify({
    source: pipeSource,
    insertVertexCondition: platformModifierKeyOnly,
    deleteCondition: (ev) => altKeyOnly(ev) && singleClick(ev),
    style: modifyOverlayStyle,
  });
  modify.on('modifyend', (e) => {
    e.features.forEach((f) => {
      const id = f.getId();
      const pipe = getState().pipes.find((x) => x.id === id);
      if (!pipe) return;
      const oldC = pipe.coords.map((c) => fromLonLat(c));   // 변경 전 좌표(3857)
      const newC = f.getGeometry().getCoordinates();        // 변경 후 좌표(3857)
      const segs = reconcileSegs(oldC, pipe.segs, newC);
      setPipeGeometry(id, newC.map((c) => toLonLat(c)), segs);
    });
  });

  snap = new Snap({ source: pipeSource });

  // Shift+드래그 박스 선택 → 박스에 걸친 세그먼트들을 선택에 추가
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

  // 기본 DragPan을 '보조키 없을 때만' 패닝으로 교체 → Shift 드래그가 박스선택으로 동작
  map.getInteractions().getArray().slice().forEach((i) => {
    if (i instanceof DragPan) map.removeInteraction(i);
  });
  map.addInteraction(new DragPan({ condition: noModifierKeys }));

  map.addLayer(hoverLayer);

  applyTool();
  subscribe('ui:changed', applyTool);
  map.on('singleclick', onClick);
  // V모드=선분 미리 강조 / A모드=근처 대상 꼭짓점 하이라이트
  map.on('pointermove', (evt) => {
    if (evt.dragging) return;
    const tool = getState().ui.tool;
    const el = map.getTargetElement();
    if (tool === 'select') {
      hoverSrc.clear();
      const key = segAtPixel(evt.pixel, evt.coordinate);
      setHoveredSeg(key);
      if (el) el.style.cursor = key ? 'pointer' : '';
    } else if (tool === 'vertex') {
      setHoveredSeg(null);
      const v = nearestVertex(evt.pixel);
      hoverSrc.clear();
      if (v) hoverSrc.addFeature(new Feature(new Point(v)));
    } else {
      setHoveredSeg(null);
      hoverSrc.clear();
    }
  });
  window.addEventListener('keydown', onKey);

  // 우클릭으로 작도 종료
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
