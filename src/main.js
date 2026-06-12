import 'ol/ol.css';
import './styles.css';

import { IS_MOCK } from './config/vworld.js';
import './map/map.js';
import './map/wms.js';
import { initParcelClick } from './map/parcel.js';
import { initMarkers } from './demands/markers.js';
import { initSearch } from './demands/search.js';
import { initList } from './demands/list.js';
import { initLayerPanel } from './layers/panel.js';
import { initOwnershipPanel } from './layers/ownershipPanel.js';

// 기능 모듈 초기화
initMarkers();
initSearch();
initList();
initLayerPanel();
initOwnershipPanel();
initParcelClick();

// 환경 안내 (키 유무)
const note = document.getElementById('env-note');
if (IS_MOCK) {
  note.innerHTML = '⚠ <b>Mock 모드</b> — VWorld 키 미설정. 검색/필지 정보는 가짜 데이터입니다. <code>.env</code>에 키를 넣으면 실데이터로 전환됩니다.';
  note.classList.add('mock');
} else {
  note.textContent = 'VWorld 연결됨';
}
