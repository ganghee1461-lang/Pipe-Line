// ── 소유구분 조회 속도 측정 ──
// 자동 라우팅을 소유구분(공유지/사유지) 기준으로 짤 수 있는지는
// "필지 수백 개의 소유구분을 몇 초에 받는가"에 달렸다. 그걸 실제로 잰다.
//
// 절차: 현재 화면에 격자점 뿌리기 → getParcel로 PNU 수집(중복 제거)
//       → getPossession으로 소유구분 조회 → 단계별 소요시간 보고
// 측정 중에는 오버레이로 조작을 막고 진행률을 표시한다.

import { toLonLat } from 'ol/proj.js';
import { map } from '../map/map.js';
import { getParcel, getPossession, isPublicLand } from '../api/vworld.js';

const CONCURRENCY = 6;
const GRID = 12; // 12×12 = 144 지점 샘플링

let cancelled = false;

// ── 진행 오버레이 ──
function openOverlay() {
  cancelled = false;
  let el = document.getElementById('probe-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'probe-overlay';
    el.innerHTML = `
      <div class="pb-box">
        <div class="pb-title">소유구분 조회 속도 측정</div>
        <div class="pb-phase" id="pb-phase">준비 중…</div>
        <div class="pb-bar"><i id="pb-fill"></i></div>
        <div class="pb-meta"><span id="pb-count">0 / 0</span><span id="pb-time">0.0초</span></div>
        <button class="pb-cancel" id="pb-cancel">중단</button>
      </div>`;
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
  document.getElementById('pb-cancel').onclick = () => { cancelled = true; };
  return el;
}
function closeOverlay() {
  document.getElementById('probe-overlay')?.classList.add('hidden');
}
function setPhase(t) { const e = document.getElementById('pb-phase'); if (e) e.textContent = t; }
function setProgress(done, total, startedAt) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const fill = document.getElementById('pb-fill');
  if (fill) fill.style.width = `${pct}%`;
  const c = document.getElementById('pb-count');
  if (c) c.textContent = `${done.toLocaleString()} / ${total.toLocaleString()}`;
  const t = document.getElementById('pb-time');
  if (t) t.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}초`;
}

async function mapLimit(arr, limit, fn) {
  let i = 0;
  async function worker() {
    for (let k = i++; k < arr.length; k = i++) {
      if (cancelled) return;
      await fn(arr[k], k);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
}

const setStatus = (t) => { const el = document.getElementById('ar-status'); if (el) el.textContent = t; };

export async function runOwnershipProbe() {
  openOverlay();
  const t0 = performance.now();
  try {
    // 1) 화면에 격자점 생성
    const ext = map.getView().calculateExtent(map.getSize());
    const pts = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = ext[0] + ((ext[2] - ext[0]) * (i + 0.5)) / GRID;
        const y = ext[1] + ((ext[3] - ext[1]) * (j + 0.5)) / GRID;
        pts.push(toLonLat([x, y]));
      }
    }

    // 2) 필지(PNU) 수집
    setPhase('필지 조회 중 (getParcel)');
    const tParcel = performance.now();
    const pnuSet = new Map(); // pnu → jibun
    let done = 0;
    await mapLimit(pts, CONCURRENCY, async ([lon, lat]) => {
      const p = await getParcel(lon, lat).catch(() => null);
      if (p?.pnu) pnuSet.set(p.pnu, p.jibun || '');
      done++;
      setProgress(done, pts.length, t0);
    });
    const parcelMs = performance.now() - tParcel;
    if (cancelled) { setStatus('측정 중단됨'); return; }

    const pnus = [...pnuSet.keys()];
    if (!pnus.length) {
      setStatus('필지를 못 받았습니다 (줌을 키우거나 VWorld 키를 확인하세요).');
      return;
    }

    // 3) 소유구분 조회
    setPhase('소유구분 조회 중 (getPossession)');
    const tOwn = performance.now();
    let pub = 0, priv = 0, unknown = 0;
    done = 0;
    await mapLimit(pnus, CONCURRENCY, async (pnu) => {
      const o = await getPossession(pnu).catch(() => null);
      const v = o ? isPublicLand(o.code, o.name) : null;
      if (v === true) pub++; else if (v === false) priv++; else unknown++;
      done++;
      setProgress(done, pnus.length, t0);
    });
    const ownMs = performance.now() - tOwn;

    // 4) 보고
    const perCall = ownMs / Math.max(1, done);
    const est300 = (perCall * 300) / 1000;
    setStatus(
      `측정 완료 — 필지 ${pnus.length}개 (${(parcelMs / 1000).toFixed(1)}초) · `
      + `소유구분 ${done}개 ${(ownMs / 1000).toFixed(1)}초 (건당 ${perCall.toFixed(0)}ms, 동시 ${CONCURRENCY}) · `
      + `공유 ${pub}/사유 ${priv}/미확인 ${unknown} · 300필지 예상 ${est300.toFixed(0)}초`
      + (cancelled ? ' [중단됨]' : '')
    );
    console.info('[probe]', { 샘플점: pts.length, 필지: pnus.length, parcelMs, ownMs, perCall, pub, priv, unknown });
  } catch (err) {
    setStatus(`측정 실패: ${err.message}`);
  } finally {
    closeOverlay();
  }
}

export function initOwnershipProbe() {
  const btn = document.getElementById('ar-probe');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await runOwnershipProbe(); } finally { btn.disabled = false; }
  });
}
