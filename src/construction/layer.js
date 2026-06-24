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
        points: 4, radius: 9, angle: Math.PI / 4,
        fill: new Fill({ color: colorFor(kind) }),
        stroke: new Stroke({ color: '#ffffff', width: 1.6 }),
      }),
    }));
  }
  return baseCache.get(kind);
}
function selStyleFor(kind) {
  if (!selCache.has(kind)) {
    selCache.set(kind, new Style({
      image: new RegularShape({
        points: 4, radius: 13, angle: Math.PI / 4,
        fill: new Fill({ color: colorFor(kind) }),
        stroke: new Stroke({ color: '#1d4ed8', width: 3 }),
      }),
    }));
  }
  return selCache.get(kind);
}

const src = new VectorSource();
const layer = new VectorLayer({ source: src, zIndex: 6, visible: false });
map.addLayer(layer);

// 터치(모바일)는 손가락이 두꺼워 작은 마커를 정확히 못 맞히므로 히트 영역을 넉넉히.
const COARSE = typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
const HIT_TOL = COARSE ? 18 : 6;

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
let anchorCoord = null;   // 팝업이 고정될 마커 지리좌표(EPSG:3857)

function fmtDate(s) { return !s || s.length < 8 ? (s || '-') : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }
function toDate(s) {
  if (!s || s.length < 8) return null;
  const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  return isNaN(d.getTime()) ? null : d;
}
function dday(end) {
  const d = toDate(end);
  if (!d) return '';
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return 'D-day';
  return `준공 ${-diff}일 경과`;
}
function statusOf(c, today) {
  if (!c.end || c.end.length < 8) return { label: '미상', color: '#6b7280' };
  if (c.end < today) return { label: '준공완료', color: '#16a34a' };
  if (c.start && c.start.length >= 8 && c.start > today) return { label: '착공예정', color: '#2563eb' };
  return { label: '진행중', color: '#ea580c' };
}
function progressPct(start, end) {
  const s = toDate(start), e = toDate(end);
  if (!s || !e || e <= s) return null;
  const p = (Date.now() - s.getTime()) / (e.getTime() - s.getTime()) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}
function durationText(start, end) {
  const s = toDate(start), e = toDate(end);
  if (!s || !e || e < s) return '';
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y}년` : '', m ? `${m}개월` : ''].filter(Boolean).join(' ') || '1개월 미만';
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function hidePopup() { popup.classList.add('hidden'); popup.innerHTML = ''; anchorCoord = null; selectFeature(null); }

function showPopup(c) {
  const today = todayStr();
  const st = statusOf(c, today);
  const dd = dday(c.end);
  const pct = progressPct(c.start, c.end);
  const dur = durationText(c.start, c.end);
  const region = [c.sido, c.sigungu].filter(Boolean).join(' ');
  const hasRoad = c.addrRn && c.addrRn.trim() && c.addrRn.trim() !== (c.addr || '').trim();

  const rows = [];
  rows.push(`<div class="pp-row"><span>구분</span><b>${esc(c.kind || '-')}</b></div>`);
  if (region) rows.push(`<div class="pp-row"><span>지역</span><b>${esc(region)}</b></div>`);
  rows.push(`<div class="pp-row"><span>착공일</span><b>${fmtDate(c.start)}</b></div>`);
  rows.push(`<div class="pp-row"><span>준공예정</span><b>${fmtDate(c.end)}${dd ? ` · ${dd}` : ''}</b></div>`);
  if (dur) rows.push(`<div class="pp-row"><span>공사기간</span><b>${dur}</b></div>`);
  if (pct != null && st.label === '진행중') {
    rows.push(`<div class="pp-prog-row"><div class="pp-prog-head"><span>진행률</span><b>약 ${pct}%</b></div><div class="cf-prog"><i style="width:${pct}%"></i></div></div>`);
  }
  rows.push(`<div class="pp-row"><span>주소</span><b>${esc(c.addr || '-')}</b></div>`);
  if (hasRoad) rows.push(`<div class="pp-row"><span>도로명</span><b>${esc(c.addrRn)}</b></div>`);
  if (c.owner) rows.push(`<div class="pp-row"><span>발주자</span><b>${esc(c.owner)}</b></div>`);

  popup.innerHTML = `
    <div class="pp-bar" style="color:#c2410c">
      <strong title="${esc(c.name)}">🚧 ${esc(c.name) || '건설공사'}</strong>
      <span class="cf-badge" style="background:${st.color}">${st.label}</span>
      <button class="pp-close">✕</button>
    </div>
    <div class="pp-body">${rows.join('')}</div>`;
  popup.classList.remove('hidden');
  anchorCoord = c.coord;     // 마커 지리좌표에 고정 → 지도 이동 시 따라감
  positionPopup();
  popup.querySelector('.pp-close').onclick = hidePopup;
}

// 앵커(마커 좌표) → 현재 화면 픽셀로 변환해 팝업 위치 갱신. 화면 밖으로 안 나가게 보정.
function positionPopup() {
  if (!anchorCoord) return;
  const px = map.getPixelFromCoordinate(anchorCoord);
  if (!px) return;
  const size = map.getSize() || [window.innerWidth, window.innerHeight];
  const pw = popup.offsetWidth || 280;
  const ph = popup.offsetHeight || 220;
  let left = px[0] + 14;
  let top = px[1];
  if (left + pw > size[0] - 6) left = px[0] - pw - 14;  // 오른쪽 넘치면 왼쪽으로
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

export function initConstruction() {
  const toggle = document.getElementById('cnstr-toggle');
  if (!toggle) return;

  toggle.addEventListener('change', async (e) => {
    const on = e.target.checked;
    layer.setVisible(on);
    document.getElementById('cnstr-settings')?.classList.toggle('hidden', !on); // ON일 때만 설정 표시
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
    showPopup(f.get('c'));
  });

  // 지도 이동/확대 시 팝업을 마커 위치에 계속 고정
  map.on('postrender', () => {
    if (anchorCoord && !popup.classList.contains('hidden')) positionPopup();
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
