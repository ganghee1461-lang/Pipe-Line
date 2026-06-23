// ── 필지 클릭 조회 (소유지적도 ON 시) ──
// 폴리곤 클릭 → getParcel + getPossession(소유) → 하이라이트 + 팝업.
// Ctrl/⌘+클릭으로 여러 필지 다중 선택 후 일괄 마커 추가. 팝업은 필지 위치에 고정.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Style, Fill, Stroke } from 'ol/style.js';
import { toLonLat } from 'ol/proj.js';
import { map } from './map.js';
import { possLayer } from './wms.js';
import { pipeSource } from '../pipes/layer.js';
import { isMarkerAt } from '../demands/markers.js';
import { isConstructionAt } from '../construction/layer.js';
import { VWORLD } from '../config/vworld.js';
import { getState, addDemand } from '../state/store.js';
import { getParcel, getPossession, reverseGeocode, isPublicLand } from '../api/vworld.js';

const geojson = new GeoJSON();
const highlightSrc = new VectorSource();
const highlightLayer = new VectorLayer({
  source: highlightSrc,
  zIndex: 6,
  style: (f) => {
    const pub = f.get('public');
    const color = pub === true ? '29,78,216' : pub === false ? '185,28,28' : '139,148,158';
    return new Style({
      fill: new Fill({ color: `rgba(${color},0.25)` }),
      stroke: new Stroke({ color: `rgb(${color})`, width: 2.5 }),
    });
  },
});
map.addLayer(highlightLayer);

const popup = document.getElementById('parcel-popup');
let busy = false;
let selected = [];     // [{ pnu, parcel, poss, rev, pub, centroid(3857), feat }]
let anchor = null;     // 팝업 고정 좌표(3857)

export function initParcelClick() {
  map.on('singleclick', async (evt) => {
    if (getState().ui.tool !== 'select') return;     // 작도/꼭짓점 편집 중엔 조회 안 함
    if (isMarkerAt(evt.pixel)) return;               // 마커 클릭은 마커 팝업이 처리
    if (isConstructionAt(evt.pixel)) return;         // 공사현황 마커는 공사 팝업이 처리
    let onPipe = false;
    map.forEachFeatureAtPixel(
      evt.pixel,
      (f, lyr) => { if (lyr && lyr.getSource() === pipeSource) { onPipe = true; return true; } },
      { hitTolerance: 6 }
    );
    if (onPipe) return;
    if (!possLayer.getVisible()) return;
    if (map.getView().getZoom() < VWORLD.minZoom.possession) {
      flash('필지 조회는 줌 16 이상에서 가능합니다');
      return;
    }
    if (busy) return;
    busy = true;

    const additive = !!(evt.originalEvent && (evt.originalEvent.ctrlKey || evt.originalEvent.metaKey));
    const [lon, lat] = toLonLat(evt.coordinate);
    try {
      const parcel = await getParcel(lon, lat);
      if (!parcel) { if (!additive) clearSelection(); flash('필지를 찾지 못했습니다'); return; }

      // 이미 선택된 필지를 Ctrl+클릭 → 선택 해제(토글)
      if (additive && parcel.pnu) {
        const idx = selected.findIndex((s) => s.pnu === parcel.pnu);
        if (idx >= 0) { highlightSrc.removeFeature(selected[idx].feat); selected.splice(idx, 1); renderPopup(); return; }
      }

      const [poss, rev] = await Promise.all([
        parcel.pnu ? getPossession(parcel.pnu) : null,
        reverseGeocode(lon, lat),
      ]);
      const pub = poss ? isPublicLand(poss.code, poss.name) : null;

      let feat = null;
      let centroid = evt.coordinate;
      if (parcel.geometry) {
        feat = geojson.readFeature(
          { type: 'Feature', geometry: parcel.geometry, properties: {} },
          { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
        );
        feat.set('public', pub);
        try { centroid = centroidOf(feat.getGeometry()) || evt.coordinate; } catch { centroid = evt.coordinate; }
      }

      if (!additive) clearSelection();
      const item = { pnu: parcel.pnu, parcel, poss, rev, pub, centroid, feat };
      if (feat) highlightSrc.addFeature(feat);
      selected.push(item);
      renderPopup();
    } catch (err) {
      console.error('[parcel] 조회 실패', err);
      flash('필지 조회 중 오류가 발생했습니다');
    } finally {
      busy = false;
    }
  });

  // 소유지적 레이어를 끄면 팝업/하이라이트도 함께 닫기
  possLayer.on('change:visible', () => {
    if (!possLayer.getVisible()) { hidePopup(); clearSelection(); }
  });

  // 팝업을 필지 위치에 고정 (지도 이동/확대 시 따라감)
  map.on('postrender', () => {
    if (!anchor || popup.classList.contains('hidden')) return;
    const px = map.getPixelFromCoordinate(anchor);
    if (!px) return;
    popup.style.left = `${px[0] + 14}px`;
    popup.style.top = `${px[1]}px`;
  });
}

function centroidOf(geom) {
  const t = geom.getType();
  if (t === 'Polygon') return geom.getInteriorPoint().getCoordinates().slice(0, 2);
  if (t === 'MultiPolygon') {
    const pts = geom.getInteriorPoints().getCoordinates();
    if (pts.length) return pts[0].slice(0, 2);
  }
  const e = geom.getExtent();
  return [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];
}

function addrOf(item) {
  const jibun = item.rev.parcel || item.parcel.jibun || '-';
  return { query: item.rev.road || jibun, address: item.rev.parcel || jibun };
}

function addMarkerFor(item) {
  const [lon, lat] = toLonLat(item.centroid);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const { query, address } = addrOf(item);
  addDemand({ query, address, lon, lat });
}

function clearSelection() {
  selected = [];
  highlightSrc.clear();
  anchor = null;
}

function renderPopup() {
  if (!selected.length) { hidePopup(); anchor = null; return; }
  anchor = selected[selected.length - 1].centroid;

  if (selected.length === 1) {
    const { parcel, poss, rev, pub } = selected[0];
    const tag = pub === true ? ['공유지', '#1d4ed8'] : pub === false ? ['사유지', '#b91c1c'] : ['미확인', '#8a8578'];
    const rows = [
      ['지번', rev.parcel || parcel.jibun || '-'],
      rev.road ? ['도로명', rev.road] : null,
      ['소유구분', poss?.name || '미확인'],
      poss?.jimok ? ['지목', poss.jimok] : null,
      poss?.area ? ['면적', `${Number(poss.area).toLocaleString()} ㎡`] : null,
      ['PNU', parcel.pnu || '-'],
    ].filter(Boolean);
    popup.innerHTML = `
      <div class="pp-bar" style="color:${tag[1]}">
        <strong>● ${tag[0]}</strong>
        <button class="pp-close">✕</button>
      </div>
      <div class="pp-body">
        ${rows.map(([k, v]) => `<div class="pp-row"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
      </div>
      <div class="pp-hint">Ctrl+클릭으로 여러 필지 선택</div>
      <div class="pp-actions"><button class="pp-addmarker">+ 수요처 마커 추가</button></div>`;
  } else {
    const items = selected.map((s, i) => {
      const j = s.rev.parcel || s.parcel.jibun || '-';
      return `<div class="pp-row"><span>${i + 1}</span><b>${esc(j)}</b></div>`;
    }).join('');
    popup.innerHTML = `
      <div class="pp-bar"><strong>${selected.length}개 필지 선택됨</strong><button class="pp-close">✕</button></div>
      <div class="pp-body pp-multi">${items}</div>
      <div class="pp-hint">Ctrl+클릭으로 추가/해제</div>
      <div class="pp-actions"><button class="pp-addmarker">+ ${selected.length}개 수요처 마커 추가</button></div>`;
  }

  popup.classList.remove('hidden');
  popup.style.transform = '';
  const px = map.getPixelFromCoordinate(anchor);
  if (px) { popup.style.left = `${px[0] + 14}px`; popup.style.top = `${px[1]}px`; }

  popup.querySelector('.pp-close').onclick = () => { hidePopup(); clearSelection(); };
  const addBtn = popup.querySelector('.pp-addmarker');
  addBtn.onclick = () => {
    selected.forEach(addMarkerFor);
    addBtn.textContent = '✓ 추가됨';
    addBtn.disabled = true;
  };
}

function hidePopup() {
  popup.classList.add('hidden');
  popup.innerHTML = '';
}

let flashTimer = null;
function flash(msg) {
  anchor = null;
  popup.innerHTML = `<div class="pp-body" style="text-align:center;color:#b45309">${msg}</div>`;
  popup.classList.remove('hidden');
  popup.style.left = '50%';
  popup.style.top = '14px';
  popup.style.transform = 'translateX(-50%)';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { hidePopup(); popup.style.transform = ''; }, 2000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
