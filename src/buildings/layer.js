// ── 건축인허가 레이어 (건축HUB) ──
// 시군구(+법정동) 조회 → 주소를 VWorld로 지오코딩 → 마커. 좌표가 API에 없어 지오코딩 필수.
// '건축인허가' 탭에서 조회/필터.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { fromLonLat } from 'ol/proj.js';
import { Style, RegularShape, Fill, Stroke } from 'ol/style.js';
import { map, fitToLonLats } from '../map/map.js';
import { fetchBuildingPermits } from '../api/archpms.js';
import { geocode } from '../api/vworld.js';

const GREEN = 'rgba(22,163,74,0.92)';
const baseStyle = new Style({
  image: new RegularShape({ points: 4, radius: 6, angle: 0, fill: new Fill({ color: GREEN }), stroke: new Stroke({ color: '#fff', width: 1.1 }) }),
});
const selStyle = new Style({
  image: new RegularShape({ points: 4, radius: 9, angle: 0, fill: new Fill({ color: GREEN }), stroke: new Stroke({ color: '#1d4ed8', width: 2.5 }) }),
});
const HIDDEN = new Style();

const src = new VectorSource();
const layer = new VectorLayer({ source: src, zIndex: 6, visible: false });
map.addLayer(layer);

const COARSE = typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
const HIT_TOL = COARSE ? 18 : 6;

let records = [];           // { rec, feature, coord:[lon,lat] }
let ongoingOnly = false;
const geoCache = new Map(); // addr -> {x,y} | null

const setStatus = (t) => { const el = document.getElementById('bp-status'); if (el) el.textContent = t; };

// ── 상태 판별 ──
function fmtDate(s) { return !s || s.length < 8 ? (s || '-') : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }
function statusOf(r) {
  if (r.useAprDay && r.useAprDay.length >= 8) return { label: '사용승인', color: '#16a34a', ongoing: false };
  if (r.stcnsDay && r.stcnsDay.length >= 8) return { label: '공사중', color: '#ea580c', ongoing: true };
  if (r.pmsDay && r.pmsDay.length >= 8) return { label: '착공전(허가)', color: '#2563eb', ongoing: false };
  return { label: '미상', color: '#6b7280', ongoing: false };
}

// ── 동시성 제한 실행 ──
async function mapLimit(arr, limit, fn) {
  let i = 0;
  async function worker() { for (let k = i++; k < arr.length; k = i++) await fn(arr[k], k); }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
}

async function geocodeAddr(addr, type) {
  if (geoCache.has(addr)) return geoCache.get(addr);
  const g = await geocode(addr, type).catch(() => null);
  const out = g && Number.isFinite(g.x) && Number.isFinite(g.y) ? { x: g.x, y: g.y } : null;
  geoCache.set(addr, out);
  return out;
}

async function runQuery() {
  const sigunguCd = document.getElementById('bp-sigungu')?.value.trim();
  const bjdongCd = document.getElementById('bp-bjdong')?.value.trim() || '';
  const numOfRows = Math.min(300, Math.max(1, Number(document.getElementById('bp-rows')?.value) || 100));
  if (!sigunguCd) { setStatus('시군구코드를 입력하세요 (예: 11680 강남구)'); return; }

  setStatus('조회 중…');
  const { items, total, error } = await fetchBuildingPermits({ sigunguCd, bjdongCd, numOfRows });
  if (error) { setStatus(`조회 실패: ${error}`); return; }
  if (!items.length) { setStatus('결과 없음 (코드/조건 확인)'); src.clear(); records = []; return; }

  setStatus(`${items.length}건 조회 (전체 ${total.toLocaleString()}) · 주소→좌표 변환 중…`);
  records = [];
  let done = 0, ok = 0;
  await mapLimit(items, 4, async (rec) => {
    const road = rec.addrRoad, jibun = rec.addr;
    let coord = null;
    if (road) coord = await geocodeAddr(road, 'road');
    if (!coord && jibun) coord = await geocodeAddr(jibun, 'parcel');
    done++;
    if (coord) { records.push({ rec, lonlat: [coord.x, coord.y] }); ok++; }
    setStatus(`주소 변환 중… ${done}/${items.length} (성공 ${ok})`);
  });

  rebuild();
  const lls = records.map((r) => r.lonlat);
  if (lls.length) fitToLonLats(lls, { maxZoom: 15 });
  applyFilterStatus();
}

function rebuild() {
  src.clear();
  for (const r of records) {
    const f = new Feature({ geometry: new Point(fromLonLat(r.lonlat)) });
    f.set('r', r.rec);
    r.feature = f;
  }
  src.addFeatures(records.map((r) => r.feature));
  applyStyles();
}

function applyStyles() {
  let shown = 0;
  for (const r of records) {
    const hide = ongoingOnly && !statusOf(r.rec).ongoing;
    if (hide) { r.feature.setStyle(HIDDEN); continue; }
    shown++;
    r.feature.setStyle(r.feature === selectedFeature ? selStyle : baseStyle);
  }
  return shown;
}

function applyFilterStatus() {
  const shown = applyStyles();
  setStatus(`표시 중 ${shown}건 / 좌표변환 ${records.length}건 · 마커 클릭 시 상세`);
}

// ── 팝업 (마커 위치 고정) ──
const popup = document.getElementById('permit-popup');
let anchorCoord = null;
let selectedFeature = null;

function selectFeature(f) {
  const prev = selectedFeature;
  selectedFeature = f;
  if (prev && prev !== f && prev.getStyle() !== HIDDEN) prev.setStyle(baseStyle);
  if (f) f.setStyle(selStyle);
}
function hidePopup() { popup.classList.add('hidden'); popup.innerHTML = ''; anchorCoord = null; selectFeature(null); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function showPopup(coord3857, r) {
  const st = statusOf(r);
  const rows = [
    ['용도', r.purpose || '-'],
    ['구분', r.archGb || '-'],
    ['허가일', fmtDate(r.pmsDay)],
    ['착공일', fmtDate(r.stcnsDay)],
    ['사용승인', fmtDate(r.useAprDay)],
    r.totArea ? ['연면적', `${Number(r.totArea).toLocaleString()} ㎡`] : null,
    r.hhldCnt && r.hhldCnt !== '0' ? ['세대수', r.hhldCnt] : null,
    ['주소', r.addrRoad || r.addr || '-'],
  ].filter(Boolean);
  popup.innerHTML = `
    <div class="pp-bar" style="color:#15803d">
      <strong title="${esc(r.name)}">🏗 ${esc(r.name) || '건축물'}</strong>
      <span class="cf-badge" style="background:${st.color}">${st.label}</span>
      <button class="pp-close">✕</button>
    </div>
    <div class="pp-body">${rows.map(([k, v]) => `<div class="pp-row"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
  popup.classList.remove('hidden');
  anchorCoord = coord3857;
  positionPopup();
  popup.querySelector('.pp-close').onclick = hidePopup;
}

function positionPopup() {
  if (!anchorCoord) return;
  const px = map.getPixelFromCoordinate(anchorCoord);
  if (!px) return;
  const size = map.getSize() || [window.innerWidth, window.innerHeight];
  const pw = popup.offsetWidth || 280, ph = popup.offsetHeight || 220;
  let left = px[0] + 14, top = px[1];
  if (left + pw > size[0] - 6) left = px[0] - pw - 14;
  if (left < 6) left = 6;
  if (top + ph > size[1] - 6) top = Math.max(6, size[1] - ph - 6);
  if (top < 6) top = 6;
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function featureAt(pixel) {
  let hit = null;
  map.forEachFeatureAtPixel(pixel, (f, l) => { if (l === layer) { hit = f; return true; } }, { hitTolerance: HIT_TOL });
  return hit;
}

export function initBuildingPermits() {
  const toggle = document.getElementById('bp-toggle');
  const searchBtn = document.getElementById('bp-search');
  const ongoing = document.getElementById('bp-ongoing');
  if (!searchBtn) return;

  toggle?.addEventListener('change', (e) => { layer.setVisible(e.target.checked); if (!e.target.checked) hidePopup(); });
  searchBtn.addEventListener('click', () => {
    if (toggle && !toggle.checked) { toggle.checked = true; layer.setVisible(true); }
    runQuery();
  });
  ongoing?.addEventListener('change', () => { ongoingOnly = ongoing.checked; applyFilterStatus(); });

  map.on('singleclick', (evt) => {
    if (!layer.getVisible()) return;
    const f = featureAt(evt.pixel);
    if (!f) { hidePopup(); return; }
    selectFeature(f);
    showPopup(f.getGeometry().getCoordinates(), f.get('r'));
  });
  map.on('postrender', () => { if (anchorCoord && !popup.classList.contains('hidden')) positionPopup(); });
}

export function isPermitAt(pixel) { return layer.getVisible() && !!featureAt(pixel); }
