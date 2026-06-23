// ── 건축인허가 레이어 (건축HUB) ──
// 시군구(+법정동) 조회 → 주소를 VWorld로 지오코딩 → 마커. 좌표가 API에 없어 지오코딩 필수.
// '건축인허가' 탭에서 조회/필터.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { Style, RegularShape, Fill, Stroke } from 'ol/style.js';
import { map, fitToLonLats } from '../map/map.js';
import { fetchBuildingPermits } from '../api/archpms.js';
import { geocode, getParcel } from '../api/vworld.js';

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

let records = [];           // { rec, feature, lonlat:[lon,lat] }
let ongoingOnly = false;
let recentOnly = true;
let areaName = '';          // 조회 지역명(서울 강남구 삼성동)
const RECENT_YEARS = 5;
const geoCache = new Map(); // addr -> {x,y} | null

function shortRegion(addr) { return String(addr || '').trim().split(/\s+/).slice(0, 3).join(' '); }

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

const recentKey = (r) => (r.pmsDay || '') + (r.stcnsDay || '');

// 좌표(lon,lat) → 필지조회로 법정동코드·지역명 확보 후 조회
async function resolveAndQuery(lon, lat, nameHint) {
  const toggle = document.getElementById('bp-toggle');
  if (toggle && !toggle.checked) { toggle.checked = true; layer.setVisible(true); }
  const p = await getParcel(lon, lat).catch(() => null);
  if (!p || !p.pnu || p.pnu.length < 10) { setStatus('지역을 못 찾았어요 — 동까지 넣거나 지도를 확대해 보세요'); return; }
  document.getElementById('bp-sigungu').value = p.pnu.slice(0, 5);
  document.getElementById('bp-bjdong').value = p.pnu.slice(5, 10);
  areaName = shortRegion(p.jibun || nameHint);
  await runQuery();
}

// 입력한 지역명 → 지오코딩 → resolveAndQuery
async function searchByName(text) {
  if (!text) { setStatus('지역을 입력하세요 (예: 강남구 삼성동)'); return; }
  setStatus(`'${text}' 위치 검색 중…`);
  let g = await geocode(text, 'parcel').catch(() => null);
  if (!g || !Number.isFinite(g.x)) g = await geocode(text, 'road').catch(() => null);
  if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) {
    setStatus(`'${text}' 를 못 찾았어요 — 시/구/동을 더 정확히 입력하세요`);
    return;
  }
  await resolveAndQuery(g.x, g.y, g.address || text);
}

async function runQuery() {
  const sigunguCd = document.getElementById('bp-sigungu')?.value.trim();
  const bjdongCd = document.getElementById('bp-bjdong')?.value.trim() || '';
  const cap = Math.min(300, Math.max(1, Number(document.getElementById('bp-rows')?.value) || 100));
  if (!sigunguCd || !bjdongCd) { setStatus('지역을 먼저 선택하세요 — 📍 버튼을 누르세요'); return; }

  const tag = areaName ? `[${areaName}] ` : '';
  setStatus(`${tag}조회 중…`);
  const PAGE = 100, MAX_PAGES = 8;

  // 1) 전체 건수 확인
  const head = await fetchBuildingPermits({ sigunguCd, bjdongCd, numOfRows: 1, pageNo: 1 });
  if (head.error) { setStatus(`조회 실패: ${head.error}`); return; }
  const total = head.total;
  if (!total) { setStatus(`${tag}결과 없음`); src.clear(); records = []; return; }

  // 2) 최근 건은 등록순 뒤쪽 페이지에 있음 → 마지막 MAX_PAGES 페이지만 수집
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const pageNos = [];
  for (let p = Math.max(1, totalPages - MAX_PAGES + 1); p <= totalPages; p++) pageNos.push(p);
  const all = [];
  await mapLimit(pageNos, 4, async (p) => {
    const r = await fetchBuildingPermits({ sigunguCd, bjdongCd, numOfRows: PAGE, pageNo: p });
    if (r.items) all.push(...r.items);
  });

  // 3) 허가일 최신순 정렬 + (옵션) 최근 N년만
  let list = all.sort((a, b) => recentKey(b).localeCompare(recentKey(a)));
  if (recentOnly) {
    const cut = String(new Date().getFullYear() - RECENT_YEARS);
    list = list.filter((r) => (r.pmsDay && r.pmsDay.slice(0, 4) >= cut) || (r.stcnsDay && r.stcnsDay.slice(0, 4) >= cut));
  }
  list = list.slice(0, cap);
  if (!list.length) {
    setStatus(`${tag}최근 ${RECENT_YEARS}년 내 건 없음 (전체 ${total.toLocaleString()}건) · '최근 5년만' 끄고 다시`);
    src.clear(); records = [];
    return;
  }

  // 4) 주소 → 좌표 (지번주소 지오코딩)
  setStatus(`${tag}${list.length}건 · 주소→좌표 변환 중…`);
  records = [];
  let done = 0, ok = 0;
  await mapLimit(list, 4, async (rec) => {
    const coord = rec.addr ? await geocodeAddr(rec.addr, 'parcel') : null;
    done++;
    if (coord) { records.push({ rec, lonlat: [coord.x, coord.y] }); ok++; }
    setStatus(`${tag}주소 변환 중… ${done}/${list.length} (성공 ${ok})`);
  });

  rebuild();
  const lls = records.map((r) => r.lonlat);
  if (lls.length) fitToLonLats(lls, { maxZoom: 16 });
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
  const tag = areaName ? `[${areaName}] ` : '';
  setStatus(`${tag}표시 ${shown}건 / 좌표 ${records.length}건 · 마커 클릭 시 상세`);
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
  const stcns = r.stcnsDay
    ? fmtDate(r.stcnsDay)
    : (r.schedDay ? `${fmtDate(r.schedDay)} (예정)` : '-');
  const area = Number(r.totArea) > 0 ? `${Number(r.totArea).toLocaleString()} ㎡` : null;
  const rows = [
    r.purpose ? ['용도', r.purpose] : null,
    r.archGb ? ['구분', r.archGb] : null,
    ['허가일', fmtDate(r.pmsDay)],
    ['착공일', stcns],
    ['사용승인', fmtDate(r.useAprDay)],
    area ? ['연면적', area] : null,
    Number(r.hhldCnt) > 0 ? ['세대수', `${r.hhldCnt}세대`] : null,
    ['주소', r.addr || '-'],
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
  const recent = document.getElementById('bp-recent');
  const hereBtn = document.getElementById('bp-here');
  if (!hereBtn) return;

  toggle?.addEventListener('change', (e) => { layer.setVisible(e.target.checked); if (!e.target.checked) hidePopup(); });

  // 지역명 입력 → 조회
  const regionInput = document.getElementById('bp-region');
  const goBtn = document.getElementById('bp-go');
  goBtn?.addEventListener('click', () => searchByName(regionInput?.value.trim()));
  regionInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchByName(regionInput.value.trim()); });

  // 지도 중심으로 조회
  hereBtn.addEventListener('click', () => {
    const c = map.getView().getCenter();
    if (!c) return;
    setStatus('지도 중심 지역 확인 중…');
    const [lon, lat] = toLonLat(c);
    resolveAndQuery(lon, lat, '');
  });

  searchBtn?.addEventListener('click', () => {
    if (toggle && !toggle.checked) { toggle.checked = true; layer.setVisible(true); }
    areaName = '';
    runQuery();
  });
  recent?.addEventListener('change', () => { recentOnly = recent.checked; });
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
