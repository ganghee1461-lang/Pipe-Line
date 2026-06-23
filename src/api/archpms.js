// ── 건축HUB 건축인허가 기본개요 조회 (국토교통부/세움터) ──
// 시군구코드(+법정동코드) 단위로 조회. 좌표가 없어 주소는 별도 지오코딩 필요.
// 응답: { response: { header:{resultCode,resultMsg}, body:{ items:{item:[…]}, totalCount } } }
import { DATAGO_KEY, DATAGO_ENABLED, DATAGO_BASE } from '../config/datago.js';

const PATH = '/1613000/ArchPmsHubService/getApBasisOulnInfo';

const str = (v) => (v == null ? '' : String(v).trim());

function normalize(r) {
  return {
    pk: str(r.mgmBldrgstPk) || `${str(r.sigunguCd)}-${str(r.bjdongCd)}-${str(r.bun)}-${str(r.ji)}-${str(r.bldNm)}`,
    name: str(r.bldNm),
    addr: str(r.platPlc),       // 지번주소
    addrRoad: str(r.newPlatPlc), // 도로명주소
    purpose: str(r.mainPurpsCdNm), // 주용도
    archGb: str(r.archGbCdNm),   // 건축구분(신축/증축/…)
    pmsDay: str(r.pmsDay),       // 허가일 YYYYMMDD
    stcnsDay: str(r.stcnsDay),   // 착공일
    useAprDay: str(r.useAprDay), // 사용승인일
    totArea: str(r.totArea),     // 연면적
    archArea: str(r.archArea),   // 건축면적
    hhldCnt: str(r.hhldCnt),     // 세대수
  };
}

// 한 시군구(+법정동)의 건축인허가 기본개요를 가져온다.
export async function fetchBuildingPermits({ sigunguCd, bjdongCd = '', numOfRows = 100, pageNo = 1 }) {
  if (!DATAGO_ENABLED) return { items: [], total: 0, error: '인증키 미설정(VITE_DATAGO_KEY)' };
  const qs = new URLSearchParams({
    serviceKey: DATAGO_KEY,
    sigunguCd: String(sigunguCd),
    ...(bjdongCd ? { bjdongCd: String(bjdongCd) } : {}),
    numOfRows: String(numOfRows),
    pageNo: String(pageNo),
    _type: 'json',
  });
  let text;
  try {
    const r = await fetch(`${DATAGO_BASE}${PATH}?${qs}`);
    text = await r.text();
  } catch (e) {
    return { items: [], total: 0, error: `네트워크 오류: ${e}` };
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    // JSON이 아니면(Forbidden/HTML/XML 에러 등) 본문 앞부분을 그대로 노출 → 진단
    return { items: [], total: 0, error: `비정상 응답: ${text.slice(0, 140)}` };
  }
  const header = j?.response?.header;
  if (header && header.resultCode !== '00') {
    return { items: [], total: 0, error: `${header.resultCode} ${header.resultMsg || ''}`.trim() };
  }
  const body = j?.response?.body || {};
  let items = body?.items?.item ?? [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  return { items: items.map(normalize), total: Number(body.totalCount) || items.length };
}
