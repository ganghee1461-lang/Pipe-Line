// ── '배관 가능 부지(공유지) 찾기' 패널 ──
import { scanOwnership, clearOwnership } from '../map/ownership.js';

export function initOwnershipPanel() {
  const btn = document.getElementById('own-scan');
  const clearBtn = document.getElementById('own-clear');
  const status = document.getElementById('own-status');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '확인 중…';
    await scanOwnership((s) => render(status, clearBtn, s));
    btn.disabled = false;
    btn.textContent = '현재 화면에서 공유지 찾기';
  });

  clearBtn.addEventListener('click', () => {
    clearOwnership();
    status.innerHTML = '';
    clearBtn.classList.add('hidden');
  });
}

function render(status, clearBtn, s) {
  switch (s.state) {
    case 'zoom':
      status.innerHTML = '<div class="own-warn">지도를 더 확대하세요 (줌 16 이상)</div>';
      return;
    case 'loading':
      status.innerHTML = `<div class="own-muted">${s.msg || '조회 중…'}</div>`;
      return;
    case 'empty':
      status.innerHTML = '<div class="own-warn">이 영역에서 필지를 찾지 못했습니다</div>';
      return;
    case 'error':
      status.innerHTML = '<div class="own-warn">조회 실패 — 잠시 후 다시 시도하세요</div>';
      return;
    case 'done':
      clearBtn.classList.remove('hidden');
      status.innerHTML = `
        <div class="own-legend">
          <div class="own-li"><span class="own-dot pub"></span>공유지 <b>${s.pub}</b><small>배관 가능</small></div>
          <div class="own-li"><span class="own-dot priv"></span>사유지 <b>${s.priv}</b></div>
          ${s.unknown ? `<div class="own-li"><span class="own-dot unk"></span>미확인 <b>${s.unknown}</b></div>` : ''}
        </div>
        ${s.capped ? '<div class="own-warn">필지가 많아 일부만 표시 — 더 확대 후 다시 확인하세요</div>' : ''}`;
      return;
  }
}
