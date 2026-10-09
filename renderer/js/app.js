import { h, btn, api, setHeaderActions } from './ui.js';

// 파일을 놓을 수 있는 곳(대장 등)이 아닌 데서 놓으면 아무 일도 하지 않게
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
import dashboard from './views/dashboard.js';
import privacy from './views/privacy.js';
import fonts from './views/fonts.js';
import password from './views/password.js';
import screensaver from './views/screensaver.js';
import updates from './views/updates.js';
import cdrive from './views/cdrive.js';
import desktop from './views/desktop.js';
import browser from './views/browser.js';
import filenames from './views/filenames.js';
import settings from './views/settings.js';
import network from './views/network.js';

const MENUS = [
  { id: 'dashboard', label: '점검 현황', icon: 'home', view: dashboard },
  { id: 'privacy', label: '개인정보 파일', icon: 'file', view: privacy },
  { id: 'fonts', label: '폰트 정리', icon: 'font', view: fonts },
  { id: 'password', label: 'PC암호', icon: 'lock', view: password },
  { id: 'screensaver', label: '화면보호기', icon: 'monitor', view: screensaver },
  { id: 'updates', label: '업데이트', icon: 'up', view: updates },
  { id: 'cdrive', label: 'C드라이브 정리', icon: 'disk', view: cdrive },
  { id: 'browser', label: '브라우저 청소', icon: 'globe', view: browser },
  { id: 'desktop', label: '바탕화면 정리', icon: 'folder', view: desktop },
  { id: 'filenames', label: '파일명 정리', icon: 'rename', view: filenames },
  { id: 'network', label: 'IP 주소', icon: 'network', view: network },
];
const HIDDEN = { settings: { id: 'settings', view: settings }, uninstall: { id: 'cdrive', view: cdrive } };

const dots = {};
let current = null;
let cleanup = null;

function renderNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...MENUS.map((m) => {
    const b = btn(m.icon, m.label, () => go(m.id), { variant: current === m.id ? 'on' : '', testid: `nav-${m.id}` });
    if (dots[m.id]) b.append(h('span', { class: `dot ${dots[m.id]}`, title: dots[m.id] === 'ok' ? '문제없음' : dots[m.id] === 'pending' ? '점검 중' : '확인 필요' }));
    if (current === m.id) b.setAttribute('aria-current', 'page');
    return b;
  }));
}

export function setDot(id, level) {
  dots[id] = ['danger', 'warn', 'ok', 'pending'].includes(level) ? level : null;
  renderNav();
}

export async function go(id, params = {}) {
  const m = MENUS.find((x) => x.id === id) || HIDDEN[id] || MENUS[0];
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  current = m.id;
  renderNav();
  const main = document.getElementById('view');
  main.replaceChildren();
  main.scrollTop = 0;
  setHeaderActions(btn('gear', '설정', () => go('settings'), { testid: 'open-settings' }));
  const ctx = { go, setDot, params, main };
  const r = await m.view(ctx);
  if (typeof r === 'function') cleanup = r;
  main.focus({ preventScroll: true });
}

async function init() {
  const info = await api('app:info');
  document.getElementById('ver').textContent = info.version;
  if (info.mock) document.getElementById('mock-badge').hidden = false;
  go('dashboard');
}

init();
