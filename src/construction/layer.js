// ── 건설공사현황 레이어 (생활안전지도) ──
// 수요처 마커와 구분되는 별도 벡터 레이어. 디자인 탭의 토글로 On/Off.
// 토글 최초 ON 시 전체 데이터를 한 번 받아 캐싱하고, 이후엔 표시/숨김만 전환한다.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { Style, RegularShape, Fill, Stroke } from 'ol/style.js';
import { map } from '../map/map.js';
import { fetchConstructions } from '../api/safemap.js';

const ORANGE = 'rgba(234,88,12,0.92)';

// 공통 스타일(주황 다이아몬드) — 5만건 규모라 텍스트 없이 단일 스타일로 가볍게 렌더.
const baseStyle = new Style({
  image: new RegularShape({
    points: 4, radius: 6, angle: Math.PI / 4,
    fill: new Fill({ color: ORANGE }),
    stroke: new Stroke({ color: '#ffffff', width: 1.2 }),
  }),
});
const selStyle = new Style({
  image: new RegularShape({
    points: 4, radius: 9, angle: Math.PI / 4,
    fill: new Fill({ color: ORANGE }),
    stroke: new Stroke({ color: '#1d4ed8', width: 2.5 }),
  }),
});

const src = new VectorSource();
const layer = new VectorLayer({ source: src, zIndex: 6, visible: false, style: baseStyle });
map.addLayer(layer);

let loaded = false;
let loading = false;

const statusEl = () => document.getElementById('cnstr-status');

async function ensureLoaded() {
  if (loaded || loading) return;
  loading = true;
  const el = statusEl();
  const items = await fetchConstructions({
    onProgress: (n, total) => {
      if (el) el.textContent = `불러오는 중… ${n.toLocaleString()} / ${total.toLocaleString()}`;
    },
  });
  src.addFeatures(items.map((c) => {
    const f = new Feature({ geometry: new Point(c.coord) });
    f.set('c', c);
    return f;
  }));
  loaded = true;
  loading = false;
  if (el) {
    el.textContent = items.length
      ? `${items.length.toLocaleString()}건 표시 중 · 마커 클릭 시 준공예정일 등 상세`
      : '데이터를 불러오지 못했습니다 (인증키·네트워크 확인).';
  }
}

// ── 클릭 팝업 ──
const popup = document.getElementById('construction-popup');
let selected = null;

function selectFeature(f) {
  if (selected) selected.setStyle(undefined);
  selected = f;
  if (f) f.setStyle(selStyle);
}

function hidePopup() {
  popup.classList.add('hidden');
  popup.innerHTML = '';
  selectFeature(null);
}

function fmtDate(s) {
  if (!s || s.length < 8) return s || '-';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function dday(end) {
  if (!end || end.length < 8) return '';
  const d = new Date(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6, 8));
  if (isNaN(d.getTime())) return '';
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return 'D-day';
  return `준공 ${-diff}일 경과`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function showPopup(pixel, c) {
  const ddays = dday(c.end);
  const rows = [
    ['구분', c.kind || '-'],
    ['착공일', fmtDate(c.start)],
    ['준공예정', `${fmtDate(c.end)}${ddays ? ` · ${ddays}` : ''}`],
    ['주소', c.addr || '-'],
    c.owner ? ['발주자', c.owner] : null,
  ].filter(Boolean);
  popup.innerHTML = `
    <div class="pp-bar" style="color:#c2410c">
      <strong title="${esc(c.name)}">🚧 ${esc(c.name) || '건설공사'}</strong>
      <button class="pp-close">✕</button>
    </div>
    <div class="pp-body">
      ${rows.map(([k, v]) => `<div class="pp-row"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
    </div>`;
  popup.classList.remove('hidden');
  popup.style.left = `${pixel[0] + 14}px`;
  popup.style.top = `${pixel[1]}px`;
  popup.querySelector('.pp-close').onclick = hidePopup;
}

function featureAt(pixel) {
  let hit = null;
  map.forEachFeatureAtPixel(
    pixel,
    (f, l) => { if (l === layer) { hit = f; return true; } },
    { hitTolerance: 5 }
  );
  return hit;
}

export function initConstruction() {
  const toggle = document.getElementById('cnstr-toggle');
  if (!toggle) return;

  toggle.addEventListener('change', async (e) => {
    const on = e.target.checked;
    layer.setVisible(on);
    if (on) await ensureLoaded();
    else hidePopup();
  });

  map.on('singleclick', (evt) => {
    if (!layer.getVisible()) return;
    const f = featureAt(evt.pixel);
    if (!f) { hidePopup(); return; }
    showPopup(evt.pixel, f.get('c'));
    selectFeature(f);
  });
}

// 필지 클릭 등 다른 핸들러가 공사 마커 클릭을 건너뛰도록.
export function isConstructionAt(pixel) {
  return layer.getVisible() && !!featureAt(pixel);
}
