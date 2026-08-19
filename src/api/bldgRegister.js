// ── 건축HUB 건축물대장 조회 → 계량기 수 추정 ──
// PNU(19자리)로 표제부(getBrTitleInfo)를 조회해 동별 세대/가구/호수를 합산하고,
// 이 앱의 계량기 모델({ use, grade, qty })로 변환한다. (building-counter 로직 이식)
//
// 호출은 프록시 경유(/datago/*) — apis.data.go.kr는 브라우저 직접호출이 막히는 경우가 있다.
//   dev: vite.config.js의 /datago,  운영: functions/datago/[[path]].js

const KEY = import.meta.env.VITE_DATAGO_KEY || '';
export const BLDG_ENABLED = !!KEY;

const BASE = '/datago/1613000/BldRgstHubService';

// PNU 19자리 → 건축물대장 API 파라미터
// 시도(2) 시군구(3) 읍면동(3) 리(2) 대장구분(1) 본번(4) 부번(4)
export function parsePnu(pnu) {
  const s = String(pnu || '').trim();
  if (s.length !== 19) return null;
  return {
    sigunguCd: s.slice(0, 5),
    bjdongCd: s.slice(5, 10),
    platGbCd: s[10] === '2' ? '1' : '0', // 1=산(임야대장) → platGbCd 1
    bun: s.slice(11, 15),
    ji: s.slice(15, 19),
  };
}

async function call(path, params) {
  const qs = new URLSearchParams({
    serviceKey: KEY, ...params, numOfRows: '100', pageNo: '1', _type: 'json',
  });
  const r = await fetch(`${BASE}${path}?${qs}`);
  if (!r.ok) return null;
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (j?.response?.header?.resultCode !== '00') return null;
  let item = j?.response?.body?.items?.item ?? [];
  if (!Array.isArray(item)) item = item ? [item] : [];
  return item;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// 용도 분류 (building-counter calcMeters 기준)
// 01000/01001/01002 단독 · 02000/02001/02002 공동 · 01003/02003/02004·고시원/기숙사 등 원룸
function classify(it) {
  const code = String(it.mainPurpsCd || '').trim();
  const nm = `${it.mainPurpsCdNm || ''} ${it.etcPurps || ''}`;
  if (['01000', '01001', '01002'].includes(code)) return 'single';
  if (['02000', '02001', '02002'].includes(code)) return 'multi';
  if (['01003', '02003', '02004'].includes(code)) return 'oneroom';
  if (/고시원|기숙사|다중주택|노인복지|원룸/.test(nm)) return 'oneroom';
  if (/단독/.test(nm)) return 'single';
  if (/공동|아파트|연립|다세대/.test(nm)) return 'multi';
  return 'general';
}

// 동별 항목 → 분류별 호수 합계
function tally(items) {
  const sum = { single: 0, multi: 0, oneroom: 0, general: 0 };
  for (const it of items) {
    const hhld = num(it.hhldCnt); // 세대수
    const ho = num(it.hoCnt);     // 호수
    const fmly = num(it.fmlyCnt); // 가구수
    const kind = classify(it);
    let cnt = 0;
    if (kind === 'single') cnt = fmly || hhld || ho;        // 단독: 가구 > 세대
    else if (kind === 'multi') cnt = hhld || ho || fmly;    // 공동: 세대 > 호
    else if (kind === 'oneroom') cnt = fmly || hhld || ho;  // 원룸: 가구 > 세대 > 호
    else cnt = ho || hhld || fmly;                          // 일반: 호수
    sum[kind] += cnt;
  }
  return sum;
}

// 분류별 합계 → 계량기 배열 (주택 4호 / 일반 6호)
export function toMeters(sum) {
  const out = [];
  if (sum.single) out.push({ use: '단독', grade: 4, qty: sum.single });
  if (sum.multi || sum.oneroom) out.push({ use: '공동', grade: 4, qty: sum.multi + sum.oneroom });
  if (sum.general) out.push({ use: '일반', grade: 6, qty: sum.general });
  // 전부 0이면 일반 1호로 (건물은 있으나 수치가 비어있는 경우)
  if (!out.length) out.push({ use: '일반', grade: 6, qty: 1 });
  return out;
}

// PNU → 계량기 배열. 조회 실패 시 null (마커는 계량기 없이 생성)
export async function metersForPnu(pnu) {
  if (!BLDG_ENABLED) return null;
  const p = parsePnu(pnu);
  if (!p) return null;
  try {
    let items = await call('/getBrTitleInfo', p);
    // 표제부가 없으면 총괄표제부로 폴백
    if (!items || !items.length) items = await call('/getBrRecapTitleInfo', p);
    if (!items || !items.length) return null;
    return toMeters(tally(items));
  } catch {
    return null;
  }
}
