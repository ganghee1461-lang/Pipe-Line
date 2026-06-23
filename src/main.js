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
import { initPipeLayer } from './pipes/layer.js';
import { initPipeTools } from './pipes/tools.js';
import { initPipeToolbar } from './pipes/toolbar.js';
import { initAttrPanel } from './pipes/attrPanel.js';
import { initTotals } from './pipes/totals.js';
import { initModePanel } from './pipes/modePanel.js';
import { initLegend } from './pipes/legend.js';
import { initSectionLabels } from './pipes/sectionLabels.js';
import { initSavePanel } from './io/savePanel.js';
import { initTabs } from './ui/tabs.js';
import { initMarkerStyle } from './demands/markerStyle.js';
import { initConstruction } from './construction/layer.js';

// 기능 모듈 초기화
initTabs();
initMarkers();
initMarkerStyle();
initSearch();
initList();
initLayerPanel();
initParcelClick();
initConstruction();

// 배관 작도/편집 (2단계)
initPipeLayer();
initPipeTools();
initPipeToolbar();
initAttrPanel();
initTotals();
initModePanel();
initLegend();
initSectionLabels();
initSavePanel();

// 환경 안내 (키 유무)
const note = document.getElementById('env-note');
if (IS_MOCK) {
  note.innerHTML = '⚠ <b>Mock 모드</b> — VWorld 키 미설정. 검색/필지 정보는 가짜 데이터입니다. <code>.env</code>에 키를 넣으면 실데이터로 전환됩니다.';
  note.classList.add('mock');
} else {
  note.textContent = 'VWorld 연결됨';
}
