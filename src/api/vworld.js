// ── VWorld 호출 추상화 (단일 진입점) ──
// 어느 경로든 동작하도록 여기 한 곳만 교체하면 됨:
//   - jsonp : 브라우저 직접호출 (레거시에서 검증, 기본값)
//   - proxy : /vw 또는 /api/vworld 경유 (Cloudflare Functions / Vite proxy)
//   - mock  : 키 없을 때 가짜 데이터
//
// 외부에는 geocode / reverseGeocode / getParcel / getPossession 만 노출한다.

import { VWORLD, base, IS_MOCK } from '../config/vworld.js';
import * as mock from './mock.js';

// ---- JSONP 유틸 (레거시 패턴) ----
function jsonp(url, timeout = 12000) {
  return new Promise((resolve) => {
    const cb = '_vw_' + Math.random().toString(36).slice(2, 10);
    const s = document.createElement('script');
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    const t = setTimeout(() => { cleanup(); resolve(null); }, timeout);
    window[cb] = (d) => { clearTimeout(t); cleanup(); resolve(d); };
    s.onerror = () => { clearTimeout(t); cleanup(); resolve(null); };
    document.head.appendChild(s);
    function cleanup() {
      delete window[cb];
      if (s.parentNode) s.parentNode.removeChild(s);
    }
  });
}

// proxy 모드: fetch JSON. (Functions/Vite proxy가 CORS를 처리)
async function fetchJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function call(url) {
  return VWORLD.apiMode === 'proxy' ? fetchJson(url) : jsonp(url);
}

function withKey(params) {
  return new URLSearchParams({
    ...params,
    key: VWORLD.key,
    domain: VWORLD.domain,
    format: 'json',
  }).toString();
}

// ── 1. 지오코딩 (주소/장소 → 좌표) ──
// type: 'road' | 'parcel'
export async function geocode(address, type = 'road') {
  if (IS_MOCK) return mock.geocode(address, type);
  const qs = withKey({ service: 'address', request: 'getcoord', address, type });
  const data = await call(`${base().geocode}?${qs}`);
  if (data?.response?.status === 'OK') {
    const pt = data.response.result.point;
    const ref = data.response.refined?.text || address;
    return { x: parseFloat(pt.x), y: parseFloat(pt.y), address: ref, type };
  }
  return null;
}

// ── 2. 역지오코딩 (좌표 → 지번/도로명) ──
export async function reverseGeocode(lon, lat) {
  if (IS_MOCK) return mock.reverseGeocode(lon, lat);
  const qs = withKey({
    service: 'address', request: 'getAddress',
    point: `${lon},${lat}`, type: 'both',
  });
  const data = await call(`${base().geocode}?${qs}`);
  const out = { parcel: '', road: '' };
  if (data?.response?.status === 'OK') {
    for (const it of data.response.result || []) {
      if (it.type === 'parcel' && it.text) out.parcel = it.text;
      if (it.type === 'road' && it.text) out.road = it.text;
    }
  }
  return out;
}

// ── 3. 필지 정보 (점 → 필지 geometry + 지번) ──
export async function getParcel(lon, lat) {
  if (IS_MOCK) return mock.getParcel(lon, lat);
  const qs = withKey({
    service: 'data', request: 'GetFeature', data: VWORLD.layers.parcel,
    geomfilter: `POINT(${lon} ${lat})`,
    columns: 'pnu,jibun,addr', geometry: 'true', attribute: 'true',
  });
  const gf = await call(`${base().data}?${qs}`);
  if (gf?.response?.status !== 'OK') return null;
  const feats = gf.response.result?.featureCollection?.features || [];
  if (!feats.length) return null;
  const f = feats[0];
  const p = f.properties || {};
  return {
    pnu: String(p.pnu || ''),
    jibun: String(p.jibun || p.addr || ''),
    geometry: f.geometry || null,
  };
}

// ── 4. 소유 속성 (PNU → 소유구분/지목/면적) ──
export async function getPossession(pnu) {
  if (IS_MOCK) return mock.getPossession(pnu);
  const qs = withKey({ pnu, numOfRows: '10', pageNo: '1' });
  const j = await call(`${base().possAttr}?${qs}`);
  const field = j?.possessions?.field;
  if (!field) return null;
  const item = Array.isArray(field) ? field[0] : field;
  if (!item) return null;
  return {
    code: String(item.posesnSeCode || ''),
    name: String(item.posesnSeCodeNm || ''),
    jimok: String(item.lndcgrCodeNm || ''),
    area: String(item.lndpclAr || ''),
  };
}

// ── 5. 도로 중심선 (BBOX → LineString 배열) ──
// 자동 배관 연결의 도로 그래프용. api.vworld.kr는 CORS 헤더가 없어 반드시 call()(JSONP/proxy) 경유.
const ROAD_LAYERS = ['LT_L_MOCTLINK', 'LT_L_SPRD_MANAGE'];

export async function getRoadLines([minLon, minLat, maxLon, maxLat]) {
  if (IS_MOCK) return [];
  for (const layer of ROAD_LAYERS) {
    const qs = withKey({
      service: 'data', request: 'GetFeature', data: layer,
      geomfilter: `BOX(${minLon},${minLat},${maxLon},${maxLat})`,
      size: '1000', geometry: 'true', attribute: 'false', crs: 'EPSG:4326',
    });
    const j = await call(`${base().data}?${qs}`);
    if (j?.response?.status !== 'OK') continue;
    const feats = j.response.result?.featureCollection?.features || [];
    const lines = [];
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'LineString' && g.coordinates.length >= 2) lines.push(g.coordinates);
      else if (g.type === 'MultiLineString') for (const c of g.coordinates) if (c.length >= 2) lines.push(c);
    }
    if (lines.length) return lines;
  }
  return [];
}

// 국공유/사유 판별 (레거시 로직)
export function isPublicLand(code, name) {
  const n = String(name || '');
  if (!n && !code) return null;
  if (['개인', '법인', '종중', '비법인', '외국인'].some((w) => n.includes(w))) return false;
  if (['국유', '도유', '시유', '군유', '공유', '지자체', '국가'].some((w) => n.includes(w))) return true;
  return null;
}
