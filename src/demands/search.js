// ── 수요처 검색 (다중 일괄 입력) ──
// 검색으로 마커를 만들 때 그 좌표의 필지 PNU를 찾아 건축물대장에서 세대/호수를 읽고
// 계량기를 자동으로 채운다(실패하면 계량기 없이 생성 — 검색 자체는 항상 성공).
import { geocode, getParcel } from '../api/vworld.js';
import { fitToLonLats } from '../map/map.js';
import { addDemand, clearDemands } from '../state/store.js';
import { metersForPnu, BLDG_ENABLED } from '../api/bldgRegister.js';

const input = document.getElementById('search-input');
const btn = document.getElementById('search-btn');
const clearBtn = document.getElementById('search-clear');

export function initSearch() {
  btn.addEventListener('click', runSearch);
  clearBtn.addEventListener('click', () => {
    clearDemands();
    input.value = '';
  });
}

async function runSearch() {
  const lines = input.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return;

  btn.disabled = true;
  const found = [];
  let done = 0;
  for (const q of lines) {
    btn.textContent = lines.length > 1 ? `검색 중… ${done + 1}/${lines.length}` : '검색 중…';
    // 도로명 우선, 실패 시 지번
    const res = (await geocode(q, 'road')) || (await geocode(q, 'parcel'));
    if (res) {
      const meters = await autoMeters(res.x, res.y);
      addDemand({ query: q, address: res.address, lon: res.x, lat: res.y, ...(meters ? { meters } : {}) });
      found.push([res.x, res.y]);
    } else {
      addDemand({ query: q, address: '검색 결과 없음', lon: NaN, lat: NaN, notFound: true });
    }
    done++;
  }
  btn.disabled = false;
  btn.textContent = '검색';
  fitToLonLats(found); // 조회된 수요처로 시점 이동
}

// 좌표 → 필지 PNU → 건축물대장 → 계량기. 어느 단계든 실패하면 null.
async function autoMeters(lon, lat) {
  if (!BLDG_ENABLED) return null;
  try {
    const parcel = await getParcel(lon, lat);
    if (!parcel?.pnu) return null;
    return await metersForPnu(parcel.pnu);
  } catch {
    return null;
  }
}
