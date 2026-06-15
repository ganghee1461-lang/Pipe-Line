// ── 배관 작도/편집 도구 ──
// P=작도, V=선택, A=꼭짓점편집. Del=선택 삭제, Ctrl+Z/Y=실행취소/다시.
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Snap from 'ol/interaction/Snap.js';
import { toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { pipeSource } from './layer.js';
import {
  getState, subscribe, addPipe, updatePipe, removePipe,
  selectPipe, setTool, undo, redo,
} from '../state/store.js';

let draw, modify, snap;
let activeTool = null;

function lineToLonLat(geom) {
  return geom.getCoordinates().map((c) => toLonLat(c));
}

function applyTool() {
  const { tool } = getState().ui;
  if (tool === activeTool) return;
  activeTool = tool;

  map.removeInteraction(draw);
  map.removeInteraction(modify);
  map.removeInteraction(snap);

  if (tool === 'draw') {
    map.addInteraction(draw);
    map.addInteraction(snap);
  } else if (tool === 'vertex') {
    map.addInteraction(modify);
    map.addInteraction(snap);
  }
  map.getTargetElement().style.cursor = tool === 'draw' ? 'crosshair' : '';
}

function onClick(evt) {
  if (getState().ui.tool !== 'select') return;
  let hit = null;
  map.forEachFeatureAtPixel(
    evt.pixel,
    (f, lyr) => { if (lyr && lyr.getSource() === pipeSource) { hit = f; return true; } },
    { hitTolerance: 6 }
  );
  selectPipe(hit ? hit.getId() : null);
}

function onKey(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && e.code === 'KeyY') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod) return;

  switch (e.code) {
    case 'KeyP': setTool('draw'); break;
    case 'KeyV': setTool('select'); break;
    case 'KeyA': setTool('vertex'); break;
    case 'Escape':
      if (activeTool === 'draw') draw.abortDrawing();
      setTool('select');
      selectPipe(null);
      break;
    case 'Delete':
    case 'Backspace': {
      const id = getState().ui.selectedPipeId;
      if (id != null) { e.preventDefault(); removePipe(id); }
      break;
    }
  }
}

export function initPipeTools() {
  // source를 주지 않는다 — drawend 후 Draw가 소스에 또 추가해 중복되는 것을 방지.
  // 작도 결과는 addPipe로 store에 넣고 layer rebuild가 렌더한다.
  draw = new Draw({ type: 'LineString' });
  draw.on('drawend', (e) => {
    const coords = lineToLonLat(e.feature.getGeometry());
    const p = addPipe({ coords });
    setTool('select');
    selectPipe(p.id);
  });

  modify = new Modify({ source: pipeSource });
  modify.on('modifyend', (e) => {
    e.features.forEach((f) => {
      updatePipe(f.getId(), { coords: lineToLonLat(f.getGeometry()) });
    });
  });

  snap = new Snap({ source: pipeSource });

  applyTool();
  subscribe('ui:changed', applyTool);
  map.on('singleclick', onClick);
  window.addEventListener('keydown', onKey);
}
