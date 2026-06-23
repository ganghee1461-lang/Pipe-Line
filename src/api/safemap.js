// ── 건설공사현황 데이터 호출 (생활안전지도 IF_0043) ──
// API에 영역(bbox)·지역 필터가 없어 전체를 페이지네이션으로 모두 받아 캐싱한다.
// 응답 구조: { header:{resultCode,resultMsg}, body:{ items:{item:[…]}, totalCount, … } }

import { SAFEMAP_KEY, SAFEMAP_ENABLED, SAFEMAP_BASE } from '../config/safemap.js';

const PAGE_SIZE = 1000;   // 요청 페이지 크기(서버가 더 작게 캡하면 1페이지 응답 크기에 자동 적응)
const CONCURRENCY = 6;    // 동시 요청 수

async function fetchPage(pageNo, size) {
  const qs = new URLSearchParams({
    serviceKey: SAFEMAP_KEY,
    pageNo: String(pageNo),
    numOfRows: String(size),
    returnType: 'json',
  });
  try {
    const r = await fetch(`${SAFEMAP_BASE}?${qs}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.header?.resultCode !== '00') return null;
    const body = j.body || {};
    let item = body?.items?.item ?? [];
    if (!Array.isArray(item)) item = item ? [item] : [];
    return { items: item, totalCount: Number(body.totalCount) || item.length };
  } catch {
    return null;
  }
}

function normalize(r) {
  const x = parseFloat(r.x);
  const y = parseFloat(r.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    id: r.objt_id,
    name: String(r.cntwrk_nm || ''),
    kind: String(r.cntwrk_se || ''),      // 건설공사구분 (공공/민간 등)
    start: String(r.strwrk_de || ''),     // 착공일 YYYYMMDD
    end: String(r.compet_de || ''),       // 준공(예정)일 YYYYMMDD
    addr: String(r.wrk_adres || ''),
    addrRn: String(r.wrk_adres_rn || ''),
    owner: r.balju_name ? String(r.balju_name) : '',
    coord: [x, y],                        // EPSG:3857 — 지도와 동일, 변환 불필요
  };
}

// 전체 건설공사현황을 모두 가져온다. onProgress(받은수, 총수)로 진행률 통지.
export async function fetchConstructions({ onProgress } = {}) {
  if (!SAFEMAP_ENABLED) return mockConstructions();

  const first = await fetchPage(1, PAGE_SIZE);
  if (!first || !first.items.length) return [];

  const size = first.items.length;        // 서버가 실제로 준 페이지 크기에 맞춤
  const total = first.totalCount;
  const pages = Math.max(1, Math.ceil(total / size));

  const out = [];
  for (const it of first.items) { const n = normalize(it); if (n) out.push(n); }
  onProgress?.(out.length, total);

  let next = 2;
  async function worker() {
    for (let p = next++; p <= pages; p = next++) {
      const r = await fetchPage(p, size);
      if (r) for (const it of r.items) { const n = normalize(it); if (n) out.push(n); }
      onProgress?.(out.length, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages - 1) }, worker));
  return out;
}

// 키 없을 때 데모용 가짜 공사 (서울 인근, EPSG:3857 좌표)
function mockConstructions() {
  return [
    { id: 1, name: '[데모] 도시가스 배관 정비공사', kind: '공공', start: '20250301', end: '20261130', addr: '서울특별시 종로구 세종대로 일원', addrRn: '', owner: '○○도시가스', coord: [14135800, 4518400] },
    { id: 2, name: '[데모] 상수도 관로 교체공사', kind: '공공', start: '20240901', end: '20260815', addr: '서울특별시 중구 태평로 일원', addrRn: '', owner: '서울특별시', coord: [14138500, 4516500] },
    { id: 3, name: '[데모] 공동주택 신축공사', kind: '민간', start: '20250601', end: '20271201', addr: '서울특별시 용산구 한강대로 일원', addrRn: '', owner: '△△건설', coord: [14133200, 4514000] },
  ];
}
