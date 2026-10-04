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
const { createNetworkService } = require('../core/network');
const { createCdriveService } = require('../core/cdrive');

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
    updates: createUpdateService({ platform, emit }),
    uninstall: createUninstallService({ platform }),
    desktop: createDesktopService({ platform, store, scanPrivacy }),
    browser: createBrowserService({ platform, store, dataDir: path.join(ROOT, 'data') }),
    network: createNetworkService({ platform, store }),
    cdrive: createCdriveService({ platform, store, emit }),
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
      if (patch && ['user', 'admin'].includes(patch.role)) allowed.role = patch.role;
      if (patch && typeof patch.room === 'string') allowed.room = patch.room.trim().slice(0, 40);
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
    'cdrive:status': () => s.cdrive.status(),
    'cdrive:scan': async () => (await s.cdrive.scan()).summary,
    'cdrive:stop': () => s.cdrive.stop(),
    'cdrive:results': () => s.cdrive.results(),
    'cdrive:move': (o) => s.cdrive.move({ paths: o && o.paths, target: o && o.target, desktopLink: !(o && o.desktopLink === false) }),
    'cdrive:prefs': (o) => {
      const p = {};
      if (o && ['old', 'size'].includes(o.sort)) p.sort = o.sort;
      if (o && typeof o.whySeen === 'boolean') p.whySeen = o.whySeen;
      if (o && typeof o.desktopLink === 'boolean') p.desktopLink = o.desktopLink;
      return s.cdrive.savePrefs(p);
    },
    'cdrive:remove': (o) => s.cdrive.remove({ paths: o && o.paths }),
    'cdrive:emptyRecycle': () => s.cdrive.emptyRecycle(),
    'cdrive:openRecycle': () => platform.launch('explorer.exe', ['shell:RecycleBinFolder']),
    'cdrive:undo': (id) => s.cdrive.undo(id),
    'cdrive:openFolder': (letter) => s.cdrive.openFolder(letter),
    'cdrive:reveal': (p) => s.cdrive.reveal(p),

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

    'app:copy': (text) => { platform.clipboard.write(String(text || '')); return true; },
    'app:paste': () => platform.clipboard.read(),
    'network:info': () => s.network.info(),
    'network:myMessage': (room) => s.network.myMessage(room),
    'network:parse': (text) => s.network.parse(String(text || '')),
    'network:apply': (cfg) => s.network.apply(cfg || {}),
    'network:validate': (cfg) => require('../core/network-msg').validate(cfg || {}),
    'network:undo': () => s.network.undo(),
    'network:check': () => s.network.check(),
    'registry:list': () => s.network.registryList(),
    'registry:import': (text) => s.network.registryImport(String(text || '')),
    'registry:update': (o) => s.network.registryUpdate(o && o.id, o || {}),
    'registry:delete': (id) => s.network.registryDelete(id),
    'registry:defaults': (d) => s.network.setDefaults(d || {}),
    'registry:assign': (o) => s.network.assign(o && o.id, o || {}),
  };

  // 앱 시작 때 할 일
  try { s.fonts.retryPending(); } catch { /* ignore */ }

  return { services: s, channels };
}

module.exports = { createServices };
