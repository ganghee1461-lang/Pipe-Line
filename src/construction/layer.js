// ── 건설공사현황 레이어 + 필터 (생활안전지도 IF_0043) ──
// 수요처 마커와 구분되는 별도 벡터 레이어. '공사현황' 탭에서 토글/필터.
// 토글 최초 ON 시 전체 데이터를 한 번 받아 캐싱하고, 이후엔 필터/표시만 갱신.
// 좌표는 EPSG:3857로 내려와 지도와 동일 좌표계라 변환이 필요 없다.
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { Style, RegularShape, Fill, Stroke } from 'ol/style.js';
import { map } from '../map/map.js';
import { fetchConstructions } from '../api/safemap.js';

// ── 구분(공공/민간 등)별 색 ──
const KIND_COLORS = { 공공: '#ea580c', 민간: '#9333ea' };
const DEFAULT_COLOR = '#0891b2';
const colorFor = (kind) => KIND_COLORS[kind] || DEFAULT_COLOR;

const HIDDEN = new Style(); // 빈 스타일 = 숨김(렌더·히트 제외)
const baseCache = new Map();
const selCache = new Map();
function baseStyleFor(kind) {
  if (!baseCache.has(kind)) {
    baseCache.set(kind, new Style({
      image: new RegularShape({
        points: 4, radius: 6, angle: Math.PI / 4,
        fill: new Fill({ color: colorFor(kind) }),
        stroke: new Stroke({ color: '#ffffff', width: 1.1 }),
      }),
    }));
  }
  return baseCache.get(kind);
}
function selStyleFor(kind) {
  if (!selCache.has(kind)) {
    selCache.set(kind, new Style({
      image: new RegularShape({
        points: 4, radius: 9, angle: Math.PI / 4,
        fill: new Fill({ color: colorFor(kind) }),
        stroke: new Stroke({ color: '#1d4ed8', width: 2.5 }),
      }),
    }));
  }
  return selCache.get(kind);
}

const src = new VectorSource();
const layer = new VectorLayer({ source: src, zIndex: 6, visible: false });
map.addLayer(layer);

// ── 주소 앞부분으로 시도/시군구 분류 ──
// 애매한 꼬리("…일원")는 안 쓰고, 표준화된 앞부분(시도·시군구)만 사용.
const SIDO = new Set([
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시',
  '세종특별자치시', '경기도', '강원도', '강원특별자치도', '충청북도', '충청남도',
  '전라북도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도', '제주도',
]);
function parseRegion(addr) {
  const t = String(addr || '').trim().split(/\s+/);
  if (!t[0] || !SIDO.has(t[0])) return { sido: '미분류', sigungu: '' };
  let sigungu = t[1] || '';
  // '포항시 북구', '수원시 장안구'처럼 시 + 구 2단계는 합쳐서 한 단위로
  if (sigungu.endsWith('시') && t[2] && t[2].endsWith('구')) sigungu = `${sigungu} ${t[2]}`;
  return { sido: t[0], sigungu };
}

// ── 필터 상태 ──
const filter = {
  kinds: null,        // Set<string> 체크된 구분 (null=전체 허용, 로딩 후 채움)
  sido: '',
  sigungu: '',
  yearMin: null,
  yearMax: null,
  ongoingOnly: false,
};
let features = [];     // 전체 피처(캐시)
let loaded = false;
let loading = false;

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function passes(c, today) {
  if (filter.kinds && !filter.kinds.has(c.kind || '')) return false;
  if (filter.sido && c.sido !== filter.sido) return false;
  if (filter.sigungu && c.sigungu !== filter.sigungu) return false;
  if (filter.ongoingOnly && !(c.end && c.end >= today)) return false;
  if (filter.yearMin || filter.yearMax) {
    const y = c.end && c.end.length >= 4 ? Number(c.end.slice(0, 4)) : null;
    if (!y) return false;
    if (filter.yearMin && y < filter.yearMin) return false;
    if (filter.yearMax && y > filter.yearMax) return false;
  }
  return true;
}

let selectedFeature = null;

function applyStyles() {
  const today = todayStr();
  let shown = 0;
  for (const f of features) {
    const c = f.get('c');
    if (!passes(c, today)) { f.setStyle(HIDDEN); continue; }
    shown++;
    f.setStyle(f === selectedFeature ? selStyleFor(c.kind) : baseStyleFor(c.kind));
  }
  setStatus(`표시 중 ${shown.toLocaleString()} / ${features.length.toLocaleString()}건 · 마커 클릭 시 상세`);
}

function selectFeature(f) {
  const prev = selectedFeature;
  selectedFeature = f;
  if (prev && prev !== f) {
    const c = prev.get('c');
    if (prev.getStyle() !== HIDDEN) prev.setStyle(baseStyleFor(c.kind));
  }
  if (f) f.setStyle(selStyleFor(f.get('c').kind));
}

// ── DOM ──
const setStatus = (t) => { const el = document.getElementById('cnstr-status'); if (el) el.textContent = t; };

async function ensureLoaded() {
  if (loaded || loading) return;
  loading = true;
  const items = await fetchConstructions({
    onProgress: (n, total) => setStatus(`불러오는 중… ${n.toLocaleString()} / ${total.toLocaleString()}`),
  });
  features = items.map((c) => {
    const { sido, sigungu } = parseRegion(c.addr);
    c.sido = sido; c.sigungu = sigungu;
    const f = new Feature({ geometry: new Point(c.coord) });
    f.set('c', c);
    return f;
  });
  src.addFeatures(features);
  loaded = true;
  loading = false;
  buildFacets();
  applyStyles();
}

// 로딩된 데이터에서 구분/지역 목록을 만들어 필터 UI 채우기
const sidoMap = new Map(); // sido -> Set(sigungu)
function buildFacets() {
  const kinds = new Set();
  sidoMap.clear();
  for (const f of features) {
    const c = f.get('c');
    if (c.kind) kinds.add(c.kind);
    if (!sidoMap.has(c.sido)) sidoMap.set(c.sido, new Set());
    if (c.sigungu) sidoMap.get(c.sido).add(c.sigungu);
  }

  // 구분 체크박스
  filter.kinds = new Set(kinds);
  const kindsWrap = document.getElementById('cnstr-kinds');
  if (kindsWrap) {
    kindsWrap.innerHTML = [...kinds].sort().map((k) => `
      <label class="cf-chk"><input type="checkbox" value="${k}" checked /> <span style="color:${colorFor(k)}">●</span> ${k}</label>
    `).join('') || '<span class="cf-empty">구분 정보 없음</span>';
    kindsWrap.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
      const on = new Set();
      kindsWrap.querySelectorAll('input:checked').forEach((x) => on.add(x.value));
      filter.kinds = on;
      applyStyles();
    }));
  }

  // 시도 드롭다운 (가나다 정렬, 미분류는 끝으로)
  const sidoSel = document.getElementById('cnstr-sido');
  if (sidoSel) {
    const sidos = [...sidoMap.keys()].sort((a, b) => (a === '미분류') - (b === '미분류') || a.localeCompare(b, 'ko'));
    sidoSel.innerHTML = '<option value="">시도 전체</option>' + sidos.map((s) => `<option value="${s}">${s}</option>`).join('');
  }
  fillSigungu('');
}

function fillSigungu(sido) {
  const sel = document.getElementById('cnstr-sigungu');
  if (!sel) return;
  const set = sido ? sidoMap.get(sido) : null;
  const list = set ? [...set].sort((a, b) => a.localeCompare(b, 'ko')) : [];
  sel.innerHTML = '<option value="">시군구 전체</option>' + list.map((s) => `<option value="${s}">${s}</option>`).join('');
  sel.disabled = !sido;
}

// ── 클릭 팝업 ──
const popup = document.getElementById('construction-popup');

function fmtDate(s) { return !s || s.length < 8 ? (s || '-') : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }
function dday(end) {
  if (!end || end.length < 8) return '';
  const d = new Date(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6, 8));
  if (isNaN(d.getTime())) return '';
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return 'D-day';
  return `준공 ${-diff}일 경과`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function hidePopup() { popup.classList.add('hidden'); popup.innerHTML = ''; selectFeature(null); }

function showPopup(pixel, c) {
  const dd = dday(c.end);
  const rows = [
    ['구분', c.kind || '-'],
    ['지역', [c.sido, c.sigungu].filter(Boolean).join(' ') || '-'],
    ['착공일', fmtDate(c.start)],
    ['준공예정', `${fmtDate(c.end)}${dd ? ` · ${dd}` : ''}`],
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
  map.forEachFeatureAtPixel(pixel, (f, l) => { if (l === layer) { hit = f; return true; } }, { hitTolerance: 5 });
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

  // 필터: 진행중 / 준공연도 / 시도·시군구 / 초기화
  const ongoing = document.getElementById('cnstr-ongoing');
  const yMin = document.getElementById('cnstr-year-min');
  const yMax = document.getElementById('cnstr-year-max');
  const sido = document.getElementById('cnstr-sido');
  const sigungu = document.getElementById('cnstr-sigungu');
  const reset = document.getElementById('cnstr-reset');

  ongoing?.addEventListener('change', () => { filter.ongoingOnly = ongoing.checked; if (loaded) applyStyles(); });
  const onYear = () => {
    filter.yearMin = yMin.value ? Number(yMin.value) : null;
    filter.yearMax = yMax.value ? Number(yMax.value) : null;
    if (loaded) applyStyles();
  };
  yMin?.addEventListener('change', onYear);
  yMax?.addEventListener('change', onYear);
  sido?.addEventListener('change', () => {
    filter.sido = sido.value;
    filter.sigungu = '';
    fillSigungu(sido.value);
    if (loaded) applyStyles();
  });
  sigungu?.addEventListener('change', () => { filter.sigungu = sigungu.value; if (loaded) applyStyles(); });
  reset?.addEventListener('click', () => {
    filter.sido = ''; filter.sigungu = ''; filter.yearMin = null; filter.yearMax = null; filter.ongoingOnly = false;
    if (loaded) filter.kinds = collectKinds();
    if (ongoing) ongoing.checked = false;
    if (yMin) yMin.value = ''; if (yMax) yMax.value = '';
    if (sido) sido.value = ''; fillSigungu('');
    document.querySelectorAll('#cnstr-kinds input').forEach((cb) => { cb.checked = true; });
    if (loaded) applyStyles();
  });

  map.on('singleclick', (evt) => {
    if (!layer.getVisible()) return;
    const f = featureAt(evt.pixel);
    if (!f) { hidePopup(); return; }
    selectFeature(f);
    showPopup(evt.pixel, f.get('c'));
  });
}

function collectKinds() {
  const k = new Set();
  for (const f of features) { const c = f.get('c'); if (c.kind) k.add(c.kind); }
  return k;
}

// 필지 클릭 등 다른 핸들러가 공사 마커 클릭을 건너뛰도록.
export function isConstructionAt(pixel) {
  return layer.getVisible() && !!featureAt(pixel);
}
