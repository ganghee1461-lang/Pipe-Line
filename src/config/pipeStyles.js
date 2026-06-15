// ── 배관 스타일 매핑 테이블 ──
// 색상 = 관경(적록색약 친화 8색), 대시 = 용도/압력. 재질(PLP/PE)은 색상 공유.
// 이 파일만 고치면 전체 배관 시각표현이 바뀐다.

export const DIAMETERS = {
  PLP: ['50A', '80A', '100A', '150A', '200A', '300A', '400A', '500A'],
  PE: ['63A', '90A', '110A', '160A', '225A', '280A', '315A', '355A'],
};

// 관경 인덱스(0~7) → 색상
export const DIAM_COLORS = [
  '#1565C0', // 진파랑
  '#00ACC1', // 청록
  '#2E7D32', // 진초록
  '#F9A825', // 진노랑
  '#E65100', // 진오렌지
  '#AD1457', // 진자홍
  '#6A1B9A', // 진보라
  '#4E342E', // 진갈색
];

// 대시 패턴 (OpenLayers Stroke.lineDash 와 동일 단위)
export const DASH = {
  solid: undefined,
  dashed: [10, 6],
  dotted: [2, 6],
};

const EXISTING_COLOR = '#868e96'; // 기존관 회색 (영업 모드)
const EXISTING_BLUE = '#0d47a1';  // 기존관 파랑 (굴착심의/배관망)
const REVIEW_RED = '#d32f2f';     // 굴착심의 예정관 빨강

// N번 구간별 색상 (배관망 분석). 구간 번호로 순환.
export const SECTION_COLORS = [
  '#e6194B', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#00838f', '#f032e6', '#9A6324', '#808000', '#000075',
];
export function sectionColor(n) {
  const i = (Number(n) || 1) - 1;
  const len = SECTION_COLORS.length;
  return SECTION_COLORS[((i % len) + len) % len];
}

// info = { use, pressure, material, diameter, status, review }
// mode = 'sales' | 'excavation' | 'network' — 모드별로 색/대시가 달라진다.
export function pipeStyle(info, mode = 'sales') {
  if (!info) return { color: EXISTING_COLOR, dash: 'solid' };
  const arrow = info.use === 'inlet';

  // ── 굴착심의: 기존=파란점선 / 예정·심의대상=빨간실선 / 예정·미대상=빨간점선 ──
  if (mode === 'excavation') {
    if (info.status === 'existing') return { color: EXISTING_BLUE, dash: 'dotted', arrow };
    if (info.review === 'target') return { color: REVIEW_RED, dash: 'solid', arrow };
    return { color: REVIEW_RED, dash: 'dotted', arrow };
  }

  // ── 배관망 분석: 기존관=파란실선 / 신설관=N번 구간별 색상 점선 ──
  if (mode === 'network') {
    if (info.status === 'existing') return { color: EXISTING_BLUE, dash: 'solid', arrow };
    return { color: sectionColor(info.section), dash: 'dashed', arrow };
  }

  // ── 영업: 기존관=회색실선 ──
  if (info.status === 'existing') {
    return { color: EXISTING_COLOR, dash: 'solid', arrow };
  }

  // ── 영업 신설관: 관경색, 공급관 저압=파선 ──
  const diams = DIAMETERS[info.material] || DIAMETERS.PLP;
  const idx = Math.max(0, diams.indexOf(info.diameter));
  const color = DIAM_COLORS[idx] || '#888888';
  let dash = 'solid';
  if (info.use === 'supply') dash = info.pressure === '저압' ? 'dashed' : 'solid';
  return { color, dash, arrow };
}

// 배관 라벨(범례·연장 집계 키)
export function pipeKey(info) {
  if (!info) return '미지정';
  const tail = `${info.material} ${info.diameter}`;
  if (info.status === 'existing') return `기존관 ${tail}`;
  const useK = info.use === 'supply' ? '공급관' : '인입관';
  const press = info.use === 'supply' && info.pressure ? ` ${info.pressure}` : '';
  return `${useK}${press} ${tail}`;
}

// ── 모드별 강조 규칙 ── (시각표현만, 원본 데이터 불변)
// 반환: { dim:bool, emphasize:bool } → 렌더 시 투명도/두께 조절
export function modeEmphasis(mode, info) {
  if (mode === 'excavation') {
    // 굴착심의: 심의 대상만 강조
    return info?.review === 'target'
      ? { emphasize: true, dim: false }
      : { emphasize: false, dim: true };
  }
  if (mode === 'network') {
    // 배관망 분석: 설치예정 강조
    return info?.status === 'planned'
      ? { emphasize: true, dim: false }
      : { emphasize: false, dim: false };
  }
  return { emphasize: false, dim: false }; // sales(영업) = 기본
}
