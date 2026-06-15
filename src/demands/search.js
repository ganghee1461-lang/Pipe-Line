// ── 수요처 검색 (다중 일괄 입력) ──
import { geocode } from '../api/vworld.js';
import { fitToLonLats } from '../map/map.js';
import { addDemand, clearDemands } from '../state/store.js';

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
  btn.textContent = '검색 중…';
  const found = [];
  for (const q of lines) {
    // 도로명 우선, 실패 시 지번
    const res = (await geocode(q, 'road')) || (await geocode(q, 'parcel'));
    if (res) {
      addDemand({ query: q, address: res.address, lon: res.x, lat: res.y });
      found.push([res.x, res.y]);
    } else {
      addDemand({ query: q, address: '검색 결과 없음', lon: NaN, lat: NaN, notFound: true });
    }
  }
  btn.disabled = false;
  btn.textContent = '검색';
  fitToLonLats(found); // 조회된 수요처로 시점 이동
}
