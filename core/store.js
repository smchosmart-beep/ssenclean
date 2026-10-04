'use strict';
// userData 폴더의 JSON 저장소. 개인정보 원문·암호는 절대 저장하지 않는다.
const fs = require('fs');
const path = require('path');

function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (name) => path.join(dir, name);

  function read(name, fallback) {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
  }
  function write(name, data) {
    const p = file(name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, p);
  }
  function update(name, fallback, fn) {
    const cur = read(name, fallback);
    const next = fn(cur) ?? cur;
    write(name, next);
    return next;
  }
  function list(sub) {
    try { return fs.readdirSync(file(sub)).sort(); } catch { return []; }
  }

  const DEFAULT_SETTINGS = {
    passwordCycleDays: 90,
    screensaverMinutes: 10,
    desktop: { scope: 'old', olderThanMonths: 3, groupBy: 'semester-type', finds: { installers: true, duplicates: true, brokenShortcuts: true, privacy: true } },
    privacyRoots: null,
    manualPasswordDate: null,
  };
  const settings = {
    get: () => ({ ...DEFAULT_SETTINGS, ...read('settings.json', {}), desktop: { ...DEFAULT_SETTINGS.desktop, ...(read('settings.json', {}).desktop || {}) } }),
    set: (patch) => update('settings.json', {}, (cur) => ({ ...cur, ...patch })),
  };

  return { dir, path: file, read, write, update, list, settings };
}

module.exports = { createStore };
