// ── 배관 작도/편집 도구 ──
// P=작도, V=선택, A=꼭짓점편집. Del=선택 삭제, Ctrl+Z/Y=실행취소/다시.
// 선택(V): 클릭=단일 / Ctrl·Shift+클릭=개별 추가 / Shift+드래그=박스 다중선택.
// 꼭짓점(A): 점 드래그=형상수정 / Ctrl+클릭=점 추가 / Alt+클릭=점 삭제.
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import DragBox from 'ol/interaction/DragBox.js';
import DragPan from 'ol/interaction/DragPan.js';
import { platformModifierKeyOnly, shiftKeyOnly, altKeyOnly, singleClick } from 'ol/events/condition.js';
import { toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { pipeSource } from './layer.js';
import {
  getState, subscribe, addPipe, updatePipe, removePipes,
  selectPipe, togglePipe, addToSelection, clearPipeSelection, setTool, undo, redo,
} from '../state/store.js';

let draw, modify, snap, dragBox, dragPan;
let activeTool = null;
let ctrlDown = false;

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

function pipeAtPixel(pixel) {
  let id = null;
  map.forEachFeatureAtPixel(
    pixel,
    (f, lyr) => { if (lyr && lyr.getSource() === pipeSource) { id = f.getId(); return true; } },
    { hitTolerance: 6 }
  );
  return id;
}

function onClick(evt) {
  if (getState().ui.tool !== 'select') return;
  const oe = evt.originalEvent;
  const additive = oe && (oe.ctrlKey || oe.metaKey || oe.shiftKey);
  const id = pipeAtPixel(evt.pixel);
  if (additive) {
    if (id != null) togglePipe(id); // Ctrl/Shift+클릭: 개별 추가/해제
  } else {
    selectPipe(id); // 단일 선택 (빈 곳이면 해제)
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
      clearPipeSelection();
      break;
    case 'Delete':
    case 'Backspace': {
      const ids = getState().ui.selectedPipeIds;
      if (ids.length) { e.preventDefault(); removePipes(ids); }
      break;
    }
  }
}

export function initPipeTools() {
  // source를 주지 않는다 — drawend 후 Draw가 소스에 또 추가해 중복되는 것을 방지.
  draw = new Draw({ type: 'LineString' });
  draw.on('drawend', (e) => {
    const coords = lineToLonLat(e.feature.getGeometry());
    const p = addPipe({ coords });
    setTool('select');
    selectPipe(p.id);
  });

  // Ctrl 누른 상태에서만 새 꼭짓점 삽입, Alt+클릭으로 꼭짓점 삭제
  modify = new Modify({
    source: pipeSource,
    insertVertexCondition: platformModifierKeyOnly,
    deleteCondition: (e) => altKeyOnly(e) && singleClick(e),
  });
  modify.on('modifyend', (e) => {
    e.features.forEach((f) => updatePipe(f.getId(), { coords: lineToLonLat(f.getGeometry()) }));
  });

  snap = new Snap({ source: pipeSource });

  // Shift+드래그 박스 선택 (기존 선택에 추가)
  dragBox = new DragBox({ condition: shiftKeyOnly });
  dragBox.on('boxend', () => {
    const ext = dragBox.getGeometry().getExtent();
    const ids = [];
    pipeSource.forEachFeatureIntersectingExtent(ext, (f) => ids.push(f.getId()));
    if (ids.length) addToSelection(ids);
  });

  // 기본 DragPan 참조 (Shift 드래그 시 패닝을 꺼서 박스선택이 동작하도록)
  map.getInteractions().forEach((i) => { if (i instanceof DragPan) dragPan = i; });

  applyTool();
  subscribe('ui:changed', applyTool);
  map.on('singleclick', onClick);
  window.addEventListener('keydown', onKey);

  // 보조키 시각/동작 피드백
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Control' || e.key === 'Meta') && !ctrlDown) { ctrlDown = true; updateCursor(); }
    if (e.key === 'Shift' && dragPan && getState().ui.tool === 'select') dragPan.setActive(false);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') { ctrlDown = false; updateCursor(); }
    if (e.key === 'Shift' && dragPan) dragPan.setActive(true);
  });
}
