// ── 필지 클릭 조회 (소유지적도 ON 시) ──
// 폴리곤 클릭 → getParcel(geometry) + getPossession(소유) → 하이라이트 + 팝업
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Style, Fill, Stroke } from 'ol/style.js';
import { toLonLat } from 'ol/proj.js';
import { map } from './map.js';
import { possLayer } from './wms.js';
import { pipeSource } from '../pipes/layer.js';
import { isMarkerAt } from '../demands/markers.js';
import { VWORLD } from '../config/vworld.js';
import { getState } from '../state/store.js';
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

export function initParcelClick() {
  map.on('singleclick', async (evt) => {
    // 마커 등 다른 피처 클릭은 demands 모듈이 처리 → 여기선 소유지적 ON일 때만
    if (getState().ui.tool !== 'select') return; // 작도/꼭짓점 편집 중엔 필지조회 안 함
    if (isMarkerAt(evt.pixel)) return; // 마커 클릭은 마커 팝업이 처리
    // 배관 위를 클릭하면 지적조회 대신 배관 선택만 (배관 오버레이 우선)
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
    highlightSrc.clear();
    hidePopup();

    const [lon, lat] = toLonLat(evt.coordinate);
    try {
      const parcel = await getParcel(lon, lat);
      if (!parcel) { flash('필지를 찾지 못했습니다'); return; }

      const [poss, rev] = await Promise.all([
        parcel.pnu ? getPossession(parcel.pnu) : null,
        reverseGeocode(lon, lat),
      ]);
      const pub = poss ? isPublicLand(poss.code, poss.name) : null;

      if (parcel.geometry) {
        const feat = geojson.readFeature(
          { type: 'Feature', geometry: parcel.geometry, properties: {} },
          { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
        );
        feat.set('public', pub);
        highlightSrc.addFeature(feat);
      }
      showPopup(evt.pixel, { parcel, poss, rev, pub });
    } finally {
      busy = false;
    }
  });
}

function showPopup(pixel, { parcel, poss, rev, pub }) {
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
      ${rows.map(([k, v]) => `<div class="pp-row"><span>${k}</span><b>${v}</b></div>`).join('')}
    </div>`;
  popup.classList.remove('hidden');
  popup.style.left = pixel[0] + 14 + 'px';
  popup.style.top = pixel[1] + 'px';
  popup.querySelector('.pp-close').onclick = () => { hidePopup(); highlightSrc.clear(); };
}

function hidePopup() {
  popup.classList.add('hidden');
  popup.innerHTML = '';
}

let flashTimer = null;
function flash(msg) {
  popup.innerHTML = `<div class="pp-body" style="text-align:center;color:#b45309">${msg}</div>`;
  popup.classList.remove('hidden');
  popup.style.left = '50%';
  popup.style.top = '14px';
  popup.style.transform = 'translateX(-50%)';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { hidePopup(); popup.style.transform = ''; }, 2000);
}
