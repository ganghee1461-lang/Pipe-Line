// ── 샘플 속성에서 시군구코드 필드 자동 탐지 ──
// 도로명주소/지적 데이터는 배포본마다 필드명이 조금씩 달라서,
// "값이 대상 시도코드로 시작하는 5자리 문자열"인 필드를 찾아낸다.
// 사용: node tools/detect-field.mjs <sample.json> <시도코드>
//  출력: 탐지된 필드명 (없으면 빈 줄) + 사람이 볼 속성 목록은 stderr로

import { readFileSync } from 'node:fs';

const [file, sidoRaw] = process.argv.slice(2);
const sido = String(sidoRaw || '').slice(0, 2);
if (!file) { console.error('사용: node detect-field.mjs <sample.json> <시도코드>'); process.exit(1); }

let rows;
try { rows = JSON.parse(readFileSync(file, 'utf8')); } catch { rows = []; }
if (!Array.isArray(rows) || !rows.length) { console.error('샘플이 비어 있습니다.'); console.log(''); process.exit(0); }

// 사람이 확인할 수 있도록 첫 행 속성 출력
console.error('── 원본 속성 (첫 행) ──');
for (const [k, v] of Object.entries(rows[0])) {
  console.error(`  ${k.padEnd(14)} = ${JSON.stringify(v)}`);
}

// 후보: 값이 시도코드로 시작하는 5자리(또는 그 이상) 코드 문자열
const keys = Object.keys(rows[0]);
const score = new Map();
for (const k of keys) {
  let hit = 0, seen = 0;
  for (const r of rows) {
    const v = r[k];
    if (v === null || v === undefined) continue;
    seen++;
    const s = String(v).trim();
    if (/^\d{5,}$/.test(s) && (!sido || s.startsWith(sido))) hit++;
  }
  if (seen && hit === seen) score.set(k, hit);
}

// 시군구코드(5자리)에 가장 가까운 것 우선: 길이 5 → 이름이 SIG/SGG → 그 외
const width = (k) => {
  const lens = new Set(rows.map((r) => String(r[k] ?? '').trim().length).filter(Boolean));
  return lens.size === 1 ? [...lens][0] : 0;
};
const preferred = [...score.keys()].sort((a, b) => {
  const byLen = (k) => (width(k) === 5 ? 0 : 1);                 // 정확히 5자리 우선
  const byName = (k) => (/SIG|SGG/i.test(k) ? 0 : /ADM|CTP|BJD|EMD/i.test(k) ? 1 : 2);
  return byLen(a) - byLen(b) || byName(a) - byName(b) || a.localeCompare(b);
});

const picked = preferred[0] || '';
console.error(picked ? `→ 시군구 코드 필드로 '${picked}' 사용` : '→ 시군구 코드 필드를 못 찾음 (전체 처리)');
console.log(picked);
