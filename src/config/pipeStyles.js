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

const EXISTING_COLOR = '#868e96';

// info = { use, pressure, material, diameter, status, review }
export function pipeStyle(info) {
  if (!info) return { color: EXISTING_COLOR, dash: 'solid' };

  // 기존관: 회색 실선 (status 기반)
  if (info.status === 'existing' && !info.use) {
    return { color: EXISTING_COLOR, dash: 'solid' };
  }

  const diams = DIAMETERS[info.material] || DIAMETERS.PLP;
  const idx = Math.max(0, diams.indexOf(info.diameter));
  const color = DIAM_COLORS[idx] || '#888888';

  // 대시: 공급관 저압=파선 / 공급관 중압=실선 / 인입관=실선(+화살표)
  let dash = 'solid';
  if (info.use === 'supply') dash = info.pressure === '저압' ? 'dashed' : 'solid';

  return { color, dash, arrow: info.use === 'inlet' };
}

// 배관 라벨(범례·연장 집계 키)
export function pipeKey(info) {
  if (!info) return '미지정';
  if (info.status === 'existing' && !info.use) return '기존관';
  const useK = info.use === 'supply' ? '공급관' : '인입관';
  const press = info.use === 'supply' && info.pressure ? ` ${info.pressure}` : '';
  return `${useK}${press} ${info.material} ${info.diameter}`;
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
