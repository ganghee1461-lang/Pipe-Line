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

export async function getPossession(pnu) {
  await wait(90);
  // pnu 기반 결정적 분류(같은 필지는 항상 같은 결과) — 데모에서 색이 안 흔들리게
  const pub = pnu ? hash(pnu) % 100 < 35 : Math.random() > 0.6;
  const names = pub ? ['국유지', '시유지', '군유지', '도유지'] : ['개인', '법인', '종중'];
  const name = names[pnu ? hash(pnu) % names.length : 0];
  return {
    code: pub ? '1' : '5',
    name,
    jimok: pub ? '도로' : '대',
    area: String(100 + (pnu ? hash(pnu) % 400 : Math.floor(Math.random() * 400))),
  };
}

// 영역 내 필지 grid mock (격자형 가짜 필지)
export async function getParcelsInBox(minLon, minLat, maxLon, maxLat) {
  await wait(250);
  const out = [];
  const cols = 7, rows = 7;
  const dx = (maxLon - minLon) / cols;
  const dy = (maxLat - minLat) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x0 = minLon + i * dx + dx * 0.05;
      const y0 = minLat + j * dy + dy * 0.05;
      const x1 = x0 + dx * 0.9;
      const y1 = y0 + dy * 0.9;
      out.push({
        pnu: `MOCK_${i}_${j}_${Math.round(minLon * 1e4)}`,
        jibun: `mock ${i * rows + j + 1}번지`,
        geometry: {
          type: 'Polygon',
          coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
        },
      });
    }
  }
  return out;
}

// 소유구분 일괄조회 mock — 격자 필지에 공유/사유를 바로 박아 반환(빠른 경로 데모)
export async function getOwnershipParcels(minLon, minLat, maxLon, maxLat) {
  await wait(220);
  const parcels = await getParcelsInBox(minLon, minLat, maxLon, maxLat);
  return parcels.map((p) => ({
    geometry: p.geometry,
    pub: hash(p.pnu) % 100 < 35,
  }));
}

// 간단 문자열 해시
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
