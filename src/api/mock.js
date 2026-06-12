// ── Mock 데이터 (키 없을 때 개발용) ──
// 실제 좌표는 서울/수도권 근방으로 흩뿌려 마커·리스트 동작을 확인할 수 있게 한다.

const SEOUL = { lon: 126.978, lat: 37.5665 };

function jitter(base, spread = 0.03) {
  return base + (Math.random() - 0.5) * spread;
}

export async function geocode(address, type) {
  await wait(120);
  // 빈 문자열이나 "없음" 포함 시 검색 실패 흉내
  if (!address || address.includes('없음')) return null;
  return {
    x: jitter(SEOUL.lon),
    y: jitter(SEOUL.lat),
    address: `${address} (mock ${type === 'road' ? '도로명' : '지번'})`,
    type,
  };
}

export async function reverseGeocode() {
  await wait(80);
  return { parcel: '서울특별시 중구 mock동 1-1', road: '서울특별시 중구 mock로 10' };
}

export async function getParcel(lon, lat) {
  await wait(100);
  const d = 0.0006;
  return {
    pnu: '1114000000' + Math.floor(Math.random() * 1e5),
    jibun: 'mock동 ' + (1 + Math.floor(Math.random() * 50)) + '번지',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lon - d, lat - d], [lon + d, lat - d],
        [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d],
      ]],
    },
  };
}

export async function getPossession() {
  await wait(90);
  const pub = Math.random() > 0.5;
  return {
    code: pub ? '1' : '5',
    name: pub ? '국유지' : '개인',
    jimok: pub ? '도로' : '대',
    area: String(100 + Math.floor(Math.random() * 400)),
  };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
