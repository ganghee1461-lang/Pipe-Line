// ── 추출된 읍면동별 필지 GeoJSON → manifest.json ──
// 앱이 "지금 보는 영역에 필요한 읍면동 파일"만 골라 받도록 bbox 목록을 만든다.
// 사용: node tools/make-manifest.mjs <폴더>

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('사용: node make-manifest.mjs <폴더>'); process.exit(1); }

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
const entries = [];

for (const f of files) {
  const path = join(dir, f);
  const gj = JSON.parse(readFileSync(path, 'utf8'));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;

  const scan = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords) scan(c);
  };

  for (const feat of gj.features || []) {
    if (!feat.geometry) continue;
    count++;
    scan(feat.geometry.coordinates);
  }
  if (!count) continue;

  entries.push({
    code: f.replace(/\.json$/, ''),     // 읍면동 코드 (PNU 앞 10자리)
    sgg: f.slice(0, 5),                 // 시군구 코드
    bbox: [minX, minY, maxX, maxY].map((v) => Number(v.toFixed(6))),
    count,
    bytes: statSync(path).size,
  });
}

entries.sort((a, b) => a.code.localeCompare(b.code));
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 1, entries }, null, 0));

const total = entries.reduce((s, e) => s + e.bytes, 0);
const parcels = entries.reduce((s, e) => s + e.count, 0);
console.log(`manifest: ${entries.length}개 읍면동 · 필지 ${parcels.toLocaleString()}개 · ${(total / 1e6).toFixed(1)}MB`);
for (const e of entries.slice(0, 5)) {
  console.log(`  ${e.code}  필지 ${String(e.count).padStart(6)}  ${(e.bytes / 1e6).toFixed(2)}MB`);
}
if (entries.length > 5) console.log(`  … 외 ${entries.length - 5}개`);
