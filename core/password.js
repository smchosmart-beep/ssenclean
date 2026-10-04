'use strict';
// PC암호 메뉴. 쎈클린은 암호를 저장하지 않는다. spec 6장
const DAY = 86400000;

function createPasswordService({ platform, store }) {
  let cache = null;

  const PROBE_TTL = 24 * 3600 * 1000;

  // 암호 유무 확인은 실패한 로그인 1회로 계산되므로 하루 1회만 하고 결과(있음/없음)만 저장한다.
  async function readAccount() {
    const saved = store.read('pw-probe.json', null);
    const probe = !saved || Date.now() - saved.at > PROBE_TTL;
    const info = await platform.account.info({ probePassword: probe });
    if (info.probed && info.hasPassword != null) store.write('pw-probe.json', { at: Date.now(), hasPassword: info.hasPassword });
    else if (!info.probed && saved) info.hasPassword = saved.hasPassword;
    return info;
  }

  async function status({ refresh = false } = {}) {
    if (!cache || refresh) cache = await readAccount();
    const a = cache;
    const s = store.settings.get();
    const cycle = s.passwordCycleDays || 90;
    let lastChanged = null;
    let source = null;
    if (a.passwordAgeDays != null && a.hasPassword) { lastChanged = Date.now() - a.passwordAgeDays * DAY; source = 'system'; }
    else if (s.manualPasswordDate) { lastChanged = Date.parse(s.manualPasswordDate); source = 'manual'; }
    let dday = null, due = null, level = 'unknown';
    if (a.hasPassword === false) level = 'danger';
    else if (lastChanged) {
      due = lastChanged + cycle * DAY;
      dday = Math.ceil((startOfDay(due) - startOfDay(Date.now())) / DAY);
      level = dday < 0 ? 'danger' : dday <= 14 ? 'warn' : 'ok';
    } else if (a.hasPassword === true) level = 'info';
    return {
      accountType: a.type, // local | microsoft | domain | unknown
      hasPassword: a.hasPassword, // true | false | null
      lastChanged, due, dday, cycle, source, level,
      canChangeHere: a.type === 'local' || (a.type === 'unknown' && a.hasPassword !== null),
    };
  }

  function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

  const attempts = { count: 0, lockedUntil: 0 };

  async function change({ current, next, confirm }) {
    if (Date.now() < attempts.lockedUntil) return { ok: false, code: 'cooldown', wait: Math.ceil((attempts.lockedUntil - Date.now()) / 1000) };
    if (!next) return { ok: false, code: 'empty' };
    if (next !== confirm) return { ok: false, code: 'mismatch' };
    const st = await status();
    if (!st.canChangeHere) return { ok: false, code: 'not-local' };
    let code = await platform.account.changePassword(current || '', next);
    // 입력값을 더 이상 들고 있지 않는다.
    current = next = confirm = null;
    if (code === 'ok') {
      attempts.count = 0;
      store.write('pw-probe.json', { at: Date.now(), hasPassword: true });
      store.settings.set({ manualPasswordDate: null });
      cache = null;
      return { ok: true, status: await status({ refresh: true }) };
    }
    if (code === 'wrong-password') {
      attempts.count++;
      if (attempts.count >= 3) { attempts.lockedUntil = Date.now() + 30000; attempts.count = 0; return { ok: false, code: 'wrong-password', warnLock: true }; }
      return { ok: false, code };
    }
    if (code === 'policy' || code === 'denied') return { ok: false, code };
    return { ok: false, code: 'error' };
  }

  function setManualDate(dateStr) {
    if (dateStr && Number.isNaN(Date.parse(dateStr))) return false;
    store.settings.set({ manualPasswordDate: dateStr || null });
    return true;
  }

  function openSettings() { return platform.shell.openExternal('ms-settings:signinoptions'); }
  function openMicrosoftAccount() { return platform.shell.openExternal('https://account.microsoft.com/security'); }

  return { status, change, setManualDate, openSettings, openMicrosoftAccount };
}

module.exports = { createPasswordService };
