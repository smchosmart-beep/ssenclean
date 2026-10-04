'use strict';
// 서비스 조립과 IPC 채널 표. 화면은 이 표에 있는 채널만 호출할 수 있다.
const path = require('path');
const { createStore } = require('../core/store');
const { createPrivacyService } = require('../core/privacy/service');
const { createFontService } = require('../core/fonts/service');
const { createPasswordService } = require('../core/password');
const { createScreensaverService } = require('../core/screensaver');
const { createUpdateService } = require('../core/updates');
const { createUninstallService } = require('../core/uninstall');
const { createDesktopService } = require('../core/desktop');
const { createBrowserService } = require('../core/browser');
const { createDashboard } = require('../core/dashboard');

const ROOT = path.join(__dirname, '..');

function createServices({ platform, spawnScan, emit }) {
  const store = createStore(platform.paths.userData);
  const privacy = createPrivacyService({ platform, store, spawnScan, emit });

  // 바탕화면 정리용 개인정보 검사(하위 폴더 제외). 결과: Map(path -> {level, counts})
  function scanPrivacy(roots) {
    return new Promise((resolve) => {
      const found = new Map();
      spawnScan({ roots, recursive: false, exclusions: [], platform: platform.kind, cloudOnly: [] }, (ev) => {
        if (ev.type === 'result' && ev.result.status === 'found') found.set(ev.result.path, { level: ev.result.level, counts: ev.result.counts });
        if (ev.type === 'done' || ev.type === 'error') resolve(found);
      });
    });
  }

  const s = {
    store,
    privacy,
    fonts: createFontService({ platform, store, dataDir: path.join(ROOT, 'data'), assetsDir: path.join(ROOT, 'assets') }),
    password: createPasswordService({ platform, store }),
    screensaver: createScreensaverService({ platform, store }),
    updates: createUpdateService({ platform }),
    uninstall: createUninstallService({ platform }),
    desktop: createDesktopService({ platform, store, scanPrivacy }),
    browser: createBrowserService({ platform, store, dataDir: path.join(ROOT, 'data') }),
  };
  s.dashboard = createDashboard(s);

  const ALLOWED_EXTERNAL = [/^https:\/\/account\.microsoft\.com\//];

  const channels = {
    'app:info': () => ({ version: require('../package.json').version, mock: platform.kind === 'mock', user: platform.user.name }),
    'app:openExternal': (url) => (ALLOWED_EXTERNAL.some((re) => re.test(String(url))) ? platform.shell.openExternal(url) : false),
    'settings:get': () => store.settings.get(),
    'settings:set': (patch) => {
      const allowed = {};
      if (patch && [30, 60, 90, 180].includes(patch.passwordCycleDays)) allowed.passwordCycleDays = patch.passwordCycleDays;
      if (patch && [5, 10, 15].includes(patch.screensaverMinutes)) allowed.screensaverMinutes = patch.screensaverMinutes;
      return store.settings.set(allowed);
    },

    'dashboard:items': () => s.dashboard.ITEMS,
    'dashboard:check': (id) => s.dashboard.check(id),

    'privacy:roots': () => privacy.defaultRoots(),
    'privacy:start': (o) => privacy.start({ roots: o && o.roots, recursive: true }),
    'privacy:stop': () => privacy.stop(),
    'privacy:results': () => privacy.results(),
    'privacy:delete': (o) => privacy.remove({ paths: o && o.paths, secure: !!(o && o.secure) }),
    'privacy:exclude': (p) => privacy.exclude(p),
    'privacy:exclusions': () => privacy.exclusions(),
    'privacy:unexclude': (key) => privacy.unexclude(key),
    'privacy:reveal': (p) => privacy.reveal(p),
    'privacy:openTrash': () => platform.launch('explorer.exe', ['shell:RecycleBinFolder']),
    'privacy:last': () => privacy.lastSummary(),

    'fonts:list': () => s.fonts.list(),
    'fonts:running': () => s.fonts.runningApps(),
    'fonts:clean': (ids) => s.fonts.clean(ids),
    'fonts:undo': (id) => s.fonts.undo(id),
    'fonts:installSchool': () => s.fonts.installSchool(),

    'password:status': () => s.password.status({ refresh: true }),
    'password:change': (o) => s.password.change(o || {}),
    'password:setDate': (d) => s.password.setManualDate(d),
    'password:openSettings': () => s.password.openSettings(),
    'password:openMicrosoft': () => s.password.openMicrosoftAccount(),

    'screensaver:status': () => s.screensaver.status(),
    'screensaver:secure': () => s.screensaver.secureSetup(),
    'screensaver:undo': () => s.screensaver.undo(),
    'screensaver:open': () => s.screensaver.openSettings(),

    'updates:check': () => s.updates.check(),
    'updates:run': (id) => s.updates.run(id),

    'uninstall:open': () => s.uninstall.open(),

    'desktop:status': () => s.desktop.quickStatus(),
    'desktop:plan': (o) => s.desktop.plan(o || {}, (p) => emit('desktop:progress', p)),
    'desktop:apply': (o) => s.desktop.apply(o || {}),
    'desktop:undo': (id) => s.desktop.undo(id),
    'desktop:history': () => s.desktop.history(),
    'desktop:openArchive': () => platform.shell.openPath(path.join(platform.paths.desktop, s.desktop.ARCHIVE)),

    'browser:scan': () => s.browser.scan(),
    'browser:fix': (ids) => s.browser.fix(ids),
    'browser:undo': () => s.browser.undo(),
    'browser:reset': (b) => s.browser.openReset(b === 'edge' ? 'edge' : 'chrome'),
    'browser:running': () => s.browser.runningBrowsers(),
    'browser:close': () => s.browser.closeBrowsers(),
    'browser:sizes': () => s.browser.historySizes(),
    'browser:clean': (o) => s.browser.cleanHistory(o || {}),
  };

  // 앱 시작 때 할 일
  try { s.fonts.retryPending(); } catch { /* ignore */ }

  return { services: s, channels };
}

module.exports = { createServices };
