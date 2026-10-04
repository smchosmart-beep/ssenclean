'use strict';
// 화면보호기 메뉴. 내 계정 설정(HKCU)만 바꾼다. spec 7장
const path = require('path');

const KEY = 'HKCU\\Control Panel\\Desktop';
const POLICY_KEY = 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop';
const NAMES = ['ScreenSaveActive', 'ScreenSaveTimeOut', 'ScreenSaverIsSecure', 'SCRNSAVE.EXE'];

function createScreensaverService({ platform, store }) {
  const R = platform.reg;

  function readAll() {
    const out = {};
    for (const n of NAMES) { const v = R.read(KEY, n); out[n] = v ? String(v.value) : null; }
    return out;
  }

  function status() {
    const v = readAll();
    const policy = R.values(POLICY_KEY);
    const managed = !!(policy && Object.keys(policy).some((k) => NAMES.map((x) => x.toLowerCase()).includes(k.toLowerCase())));
    const timeoutSec = Number(v.ScreenSaveTimeOut) || 0;
    // SCRNSAVE.EXE 값이 비어 있으면 Windows는 화면보호기를 실행하지 않는다.
    const hasSaver = !!(v['SCRNSAVE.EXE'] && v['SCRNSAVE.EXE'].trim());
    const active = v.ScreenSaveActive === '1' && hasSaver;
    const secure = v.ScreenSaverIsSecure === '1';
    const want = (store.settings.get().screensaverMinutes || 10) * 60;
    const safe = active && secure && timeoutSec > 0 && timeoutSec <= Math.max(want, 600);
    return {
      active, secure, minutes: Math.round(timeoutSec / 60), hasSaver, managed, safe,
      level: safe ? 'ok' : 'danger',
      canUndo: !!store.read('screensaver-undo.json', null),
    };
  }

  function secureSetup() {
    const st = status();
    if (st.managed) return { ok: false, code: 'managed' };
    store.write('screensaver-undo.json', readAll());
    const minutes = store.settings.get().screensaverMinutes || 10;
    const saver = path.join(platform.paths.windir, 'System32', 'scrnsave.scr');
    const ok = [
      R.write(KEY, 'SCRNSAVE.EXE', platform.REG.SZ, saver),
      R.write(KEY, 'ScreenSaveTimeOut', platform.REG.SZ, String(minutes * 60)),
      R.write(KEY, 'ScreenSaverIsSecure', platform.REG.SZ, '1'),
      R.write(KEY, 'ScreenSaveActive', platform.REG.SZ, '1'),
    ].every(Boolean);
    platform.screensaver.apply({ active: true, timeoutSec: minutes * 60, secure: true });
    return { ok, status: status() };
  }

  function undo() {
    const prev = store.read('screensaver-undo.json', null);
    if (!prev) return { ok: false };
    for (const n of NAMES) {
      if (prev[n] == null) R.del(KEY, n); else R.write(KEY, n, platform.REG.SZ, prev[n]);
    }
    platform.screensaver.apply({ active: prev.ScreenSaveActive === '1', timeoutSec: Number(prev.ScreenSaveTimeOut) || 0, secure: prev.ScreenSaverIsSecure === '1' });
    store.write('screensaver-undo.json', null);
    return { ok: true, status: status() };
  }

  function openSettings() { return platform.launch('control.exe', ['desk.cpl,,@screensaver']); }

  return { status, secureSetup, undo, openSettings };
}

module.exports = { createScreensaverService };
