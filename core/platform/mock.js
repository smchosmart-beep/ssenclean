'use strict';
// 개발·테스트용 가짜 Windows 환경.
// 파일은 실제 임시 폴더(샌드박스)에 만들고, 레지스트리·계정·작업 스케줄러는 메모리(JSON)로 흉내 낸다.
// SENCLEAN_MOCK=1 이거나 Windows가 아닌 환경에서 사용된다.
const os = require('os');
const path = require('path');
const fs = require('fs');

const REG = { SZ: 1, EXPAND_SZ: 2, BINARY: 3, DWORD: 4, MULTI_SZ: 7, QWORD: 11 };

function createMockPlatform({ root, seed = true } = {}) {
  root = root || process.env.SENCLEAN_MOCK_ROOT || path.join(os.tmpdir(), 'senclean-mock');
  const U = path.join(root, 'Users', 'teacher');
  const appData = path.join(U, 'AppData', 'Roaming');
  const localAppData = path.join(U, 'AppData', 'Local');
  const paths = {
    home: U,
    desktop: path.join(U, 'Desktop'),
    documents: path.join(U, 'Documents'),
    downloads: path.join(U, 'Downloads'),
    appData,
    localAppData,
    temp: path.join(localAppData, 'Temp'),
    userData: path.join(appData, '쎈클린'),
    windowsFonts: path.join(root, 'Windows', 'Fonts'),
    userFonts: path.join(localAppData, 'Microsoft', 'Windows', 'Fonts'),
    startMenu: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    startup: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    taskbarPinned: path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    programFiles: path.join(root, 'Program Files'),
    programFilesX86: path.join(root, 'Program Files (x86)'),
    windir: path.join(root, 'Windows'),
    trash: path.join(root, '_Trash'),
    browserData: {
      chrome: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      edge: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    },
  };
  const statePath = path.join(root, 'mock-state.json');

  if (seed && !fs.existsSync(statePath)) {
    require('./mock-seed').seedMock(root, paths);
  }
  let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));
  const log = (entry) => { state.log.push({ t: Date.now(), ...entry }); save(); };

  const norm = (k) => k.replace(/^HKEY_CURRENT_USER/, 'HKCU').replace(/^HKEY_LOCAL_MACHINE/, 'HKLM').toLowerCase();
  const findKey = (key) => Object.keys(state.registry).find((k) => norm(k) === norm(key));

  const reg = {
    read(key, name) {
      const k = findKey(key);
      if (!k) return undefined;
      const vals = state.registry[k];
      const n = Object.keys(vals).find((x) => x.toLowerCase() === String(name).toLowerCase());
      return n === undefined ? undefined : vals[n];
    },
    values(key) { const k = findKey(key); return k ? { ...state.registry[k] } : null; },
    subkeys(key) {
      const pre = norm(key) + '\\';
      const set = new Set();
      for (const k of Object.keys(state.registry)) {
        if (norm(k).startsWith(pre)) set.add(k.slice(pre.length).split('\\')[0]);
      }
      return set.size || findKey(key) ? [...set] : null;
    },
    write(key, name, type, value) {
      const k = findKey(key) || key;
      state.registry[k] = state.registry[k] || {};
      state.registry[k][name] = { type, value: Buffer.isBuffer(value) ? [...value] : value };
      save();
      return true;
    },
    del(key, name) {
      const k = findKey(key);
      if (k) { delete state.registry[k][name]; save(); }
      return true;
    },
  };
  // BINARY 값은 JSON에 배열로 저장되므로 읽을 때 Buffer로 되돌린다.
  const origRead = reg.read;
  reg.read = (key, name) => {
    const v = origRead(key, name);
    if (v && v.type === REG.BINARY && Array.isArray(v.value)) return { type: v.type, value: Buffer.from(v.value) };
    return v;
  };
  const origValues = reg.values;
  reg.values = (key) => {
    const vals = origValues(key);
    if (!vals) return vals;
    for (const n of Object.keys(vals)) {
      if (vals[n].type === REG.BINARY && Array.isArray(vals[n].value)) vals[n] = { type: REG.BINARY, value: Buffer.from(vals[n].value) };
    }
    return vals;
  };

  const account = {
    async info({ probePassword = true } = {}) {
      const a = state.account;
      state.probeCount = (state.probeCount || 0) + (probePassword ? 1 : 0);
      save();
      const ageDays = a.passwordSetAt ? Math.floor((Date.now() - a.passwordSetAt) / 86400000) : null;
      return { type: a.type, userName: 'teacher', hasPassword: probePassword ? a.password !== '' : null, probed: probePassword, passwordAgeDays: a.type === 'local' && a.password !== '' ? ageDays : null };
    },
    async changePassword(oldPw, newPw) {
      const a = state.account;
      if ((oldPw || '') !== a.password) return 'wrong-password';
      if (newPw.length < (a.minLength || 0)) return 'policy';
      if (newPw === a.password) return 'policy';
      a.password = newPw;
      a.passwordSetAt = Date.now();
      save();
      return 'ok';
    },
  };

  function trash(p) {
    fs.mkdirSync(paths.trash, { recursive: true });
    if (state.lockedFiles.includes(p)) return Promise.reject(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));
    const dest = path.join(paths.trash, Date.now() + '_' + path.basename(p));
    fs.renameSync(p, dest);
    log({ op: 'trash', path: p });
    return Promise.resolve();
  }

  return {
    kind: 'mock',
    root,
    paths,
    user: { name: 'teacher', domain: 'SCHOOL-PC', computer: 'SCHOOL-PC' },
    REG,
    reg,
    account,
    screensaver: { apply: (o) => { log({ op: 'spi', ...o }); return true; } },
    fonts: {
      add: (p) => { log({ op: 'addFont', path: p }); return true; },
      remove: (p) => { log({ op: 'removeFont', path: p }); return true; },
      broadcast: () => true,
    },
    fileAttributes: (p) => {
      const base = path.basename(p);
      let a = 0;
      if (base.startsWith('.')) a |= 0x2;
      if ((state.cloudOnly || []).includes(p)) a |= 0x400000;
      return a;
    },
    shell: {
      trash,
      reveal: (p) => log({ op: 'reveal', path: p }),
      openPath: (p) => { log({ op: 'openPath', path: p }); return Promise.resolve(''); },
      openExternal: (u) => { log({ op: 'openExternal', url: u }); return Promise.resolve(); },
      readShortcut: (p) => {
        try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return { target: j.target || '', args: j.args || '', cwd: j.cwd || '', icon: j.icon || '', iconIndex: 0, description: '' }; } catch { return null; }
      },
      writeShortcut: (p, op, opts) => {
        let cur = {};
        try { cur = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* new */ }
        fs.writeFileSync(p, JSON.stringify({ ...cur, ...opts }));
        log({ op: 'writeShortcut', path: p, opts });
        return true;
      },
    },
    launch: (file, args) => {
      log({ op: 'launch', file, args });
      // 실제 크롬처럼, 다시 켜면 받아 둔 업데이트(new_chrome.exe)를 적용한다.
      if (/chrome\.exe$/i.test(file)) { try { fs.unlinkSync(path.join(path.dirname(file), 'new_chrome.exe')); } catch { /* none */ } }
      return true;
    },
    run: async (file, args) => { log({ op: 'run', file, args }); return { ok: true, code: 0, stdout: '', stderr: '' }; },
    processes: async () => state.processes.map((s) => s.toLowerCase()),
    requestClose: async (image) => { state.processes = state.processes.filter((p) => p.toLowerCase() !== image.toLowerCase()); save(); log({ op: 'close', image }); },
    signatures: async (files) => {
      const out = {};
      for (const f of files) out[f] = state.signatures[f] || { signed: true, company: 'Example Corp', created: new Date(Date.now() - 400 * 86400000).toISOString() };
      return out;
    },
    fileVersion: async (file) => state.fileVersions[file] || null,
    tasks: {
      listUser: async () => state.tasks,
      exportXml: async (p, name) => {
        const t = state.tasks.find((x) => x.path === p && x.name === name);
        return t ? JSON.stringify(t) : null;
      },
      remove: async (p, name) => { state.tasks = state.tasks.filter((x) => !(x.path === p && x.name === name)); save(); return true; },
      register: async (p, name, xml) => { state.tasks.push(JSON.parse(xml)); save(); return true; },
    },
    chromeUpdate: {
      async check() {
        const c = state.chromeUpdate || {};
        if (c.unavailable) return { phase: 'unavailable' };
        return c.available ? { phase: 'available', version: c.version } : { phase: 'latest', version: null };
      },
      async install(onProgress) {
        const c = state.chromeUpdate || {};
        if (c.unavailable) return { phase: 'unavailable' };
        if (!c.available) { onProgress({ phase: 'latest' }); return { phase: 'latest' }; }
        const steps = [{ phase: 'checking' }, { phase: 'available', version: c.version }, { phase: 'downloading', percent: 30 }, { phase: 'downloading', percent: 100 }, { phase: 'installing', percent: 60 }, { phase: 'done', version: c.version }];
        for (const st of steps) { await new Promise((r) => setTimeout(r, 60)); onProgress(st); }
        // 크롬이 쓰는 방식대로 새 실행 파일을 남겨 '다시 켜야 적용' 상태를 만든다.
        const dir = path.join(paths.programFiles, 'Google', 'Chrome', 'Application');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'new_chrome.exe'), 'exe');
        c.available = false; c.installedVersion = c.version; save();
        log({ op: 'chromeInstall' });
        return { phase: 'done', version: c.version };
      },
      async openHelpViaOmnibox(exe) { log({ op: 'omnibox', exe }); return true; },
    },
    windowsUpdate: {
      lastInstalled: async () => state.windowsUpdate.lastInstalled,
      pendingCount: async () => state.windowsUpdate.pending,
    },
    fetchJson: async (url) => {
      if (state.offline) return null;
      if (url.includes('versionhistory.googleapis.com')) return { versions: [{ version: state.chromeLatest }] };
      return null;
    },
    exists: (p) => { try { fs.accessSync(p); return true; } catch { return false; } },
    // 테스트 전용
    _state: () => state,
    _log: () => state.log,
  };
}

module.exports = { createMockPlatform };
