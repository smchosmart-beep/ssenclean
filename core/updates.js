'use strict';
// 업데이트 메뉴. 설치파일을 직접 받지 않고, 각 프로그램의 공식 업데이트 기능만 실행한다. spec 8장
const path = require('path');
const fs = require('fs');

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function uninstallEntries(platform) {
  const out = [];
  for (const k of UNINSTALL_KEYS) {
    for (const sub of platform.reg.subkeys(k) || []) {
      const v = platform.reg.values(`${k}\\${sub}`) || {};
      const g = (n) => (v[n] ? String(v[n].value) : '');
      if (!g('DisplayName')) continue;
      out.push({ key: `${k}\\${sub}`, hive: k.slice(0, 4), name: g('DisplayName'), version: g('DisplayVersion'), publisher: g('Publisher'), uninstall: g('UninstallString'), location: g('InstallLocation'), icon: g('DisplayIcon') });
    }
  }
  return out;
}

const CHROME_APP_ID = '{8A69D345-D564-463C-AFF1-A69D9E530F96}';
const CHROME_POLICY_KEY = 'HKLM\\SOFTWARE\\Policies\\Google\\Update';

function createUpdateService({ platform, emit = () => {} }) {
  const P = platform.paths;
  const R = platform.reg;
  let chromeJob = null;      // 진행 중인 크롬 업데이트
  let chromeProgress = null; // 마지막 진행 상황
  let justUpdated = null;    // 쎈Clean 안에서 업데이트를 마친 새 버전(대기 파일이 늦게 생겨도 바로 '다시 시작 필요')
  let restartTried = null;   // [크롬 다시 시작]을 누른 시각

  function chromeExe() {
    const cands = [
      path.join(P.programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(P.programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(P.localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    return cands.find((c) => platform.exists(c)) || null;
  }

  // 업데이트는 끝났지만 크롬을 다시 시작해야 적용되는 상태.
  // 크롬이 업데이트를 마친 직후에는 구글 업데이트가 '최신'이라고 답하는데 대기 파일(new_chrome.exe)은 조금 뒤에 생긴다.
  // 그 시차에도 틀리지 않게 여러 신호를 본다(하나라도 맞으면 대기):
  //  ① new_chrome.exe  ② 구글 업데이트 등록 정보의 opv·cmd(이름 바꾸기 대기)  ③ 설치된 버전 폴더가 지금 쓰는 버전보다 높음  ④ 쎈Clean 안에서 막 업데이트함
  const CLIENT_KEYS = [`HKLM\\SOFTWARE\\WOW6432Node\\Google\\Update\\Clients\\${CHROME_APP_ID}`, `HKLM\\SOFTWARE\\Google\\Update\\Clients\\${CHROME_APP_ID}`, `HKCU\\Software\\Google\\Update\\Clients\\${CHROME_APP_ID}`];
  const VER_RE = /^\d+\.\d+\.\d+\.\d+$/;
  function chromePending(exe, current) {
    if (!exe) return null;
    const dir = path.dirname(exe);
    let newest = null;
    try { for (const d of fs.readdirSync(dir)) if (VER_RE.test(d) && (!newest || cmpVersion(d, newest) > 0)) newest = d; } catch { /* none */ }
    const val = (k, n) => { try { const v = R.read(k, n); return v && v.value != null ? String(v.value) : ''; } catch { return ''; } };
    let renamePending = false, pv = '';
    for (const k of CLIENT_KEYS) {
      if (val(k, 'opv') || val(k, 'cmd')) renamePending = true;
      const x = val(k, 'pv');
      if (x && VER_RE.test(x) && (!pv || cmpVersion(x, pv) > 0)) pv = x;
    }
    const target = [newest, pv, justUpdated && justUpdated.version].filter((x) => x && VER_RE.test(x)).sort(cmpVersion).pop() || null;
    const newer = !!(current && target && cmpVersion(target, current) > 0);
    if (justUpdated && current && justUpdated.version && cmpVersion(current, justUpdated.version) >= 0) justUpdated = null; // 이미 바뀜
    const pending = platform.exists(path.join(dir, 'new_chrome.exe')) || renamePending || newer || !!justUpdated;
    return pending ? { newVersion: newer ? target : (justUpdated && justUpdated.version) || null } : null;
  }

  // 학교 정책: 0 = 업데이트 끔, 1 = 항상, 2 = 수동만, 3 = 자동만
  function chromePolicy() {
    const v = R.values(CHROME_POLICY_KEY) || {};
    const get = (n) => { const k = Object.keys(v).find((x) => x.toLowerCase() === n.toLowerCase()); return k != null ? Number(v[k].value) : null; };
    const app = get(`Update${CHROME_APP_ID}`);
    return app != null ? app : get('UpdateDefault');
  }

  // 지금 쓰는(마지막으로 실행한) 크롬 버전
  function currentChromeVersion() {
    return (R.read('HKCU\\Software\\Google\\Chrome\\BLBeacon', 'version') || {}).value
      || (R.read('HKLM\\SOFTWARE\\Google\\Chrome\\BLBeacon', 'version') || {}).value || null;
  }

  async function checkChrome() {
    const exe = chromeExe();
    let version = currentChromeVersion();
    if (!exe && !version) return null;
    if (!version && exe) version = await platform.fileVersion(exe);
    const base = { id: 'chrome', name: '크롬', version, canUpdate: !!exe };
    if (chromeJob) return { ...base, state: 'updating', progress: chromeProgress };
    const pend = chromePending(exe, version);
    if (pend) return { ...base, state: 'restart', newVersion: pend.newVersion, restartTried: !!restartTried && Date.now() - restartTried < 30 * 60000 };
    restartTried = null;
    const policy = chromePolicy();

    // 이 PC의 구글 업데이트에 직접 묻는다(크롬 정보 화면과 같은 답).
    const r = await platform.chromeUpdate.check();
    if (r.phase === 'latest') return { ...base, state: 'latest', via: 'updater' };
    if (r.phase === 'available') return { ...base, state: 'outdated', latest: r.version || null, via: 'updater', autoOnly: policy === 3 };

    // 구글 업데이트에 물을 수 없는 PC: 서버의 최신 번호는 참고만 하고,
    // 순차 배포 때문에 큰 번호가 2 이상 뒤처졌을 때만 '업데이트 있음'으로 본다.
    const json = await platform.fetchJson('https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions?pageSize=1');
    const latest = json && json.versions && json.versions[0] && json.versions[0].version;
    let state = 'unknown';
    if (version && latest) {
      const behind = Number(String(latest).split('.')[0]) - Number(String(version).split('.')[0]);
      if (behind >= 2) state = 'outdated';
    }
    return { ...base, state, latest: latest || null, via: 'server', offline: !json };
  }

  let winCache = null;
  async function checkWindows() {
    // 대기 업데이트 개수는 1분 넘게 걸릴 수 있어 30분 동안 기억해 둔다(다시 점검 때 빠르게)
    const fresh = winCache && Date.now() - winCache.at < 30 * 60000;
    const [last, pending] = fresh ? [winCache.last, winCache.pending]
      : await Promise.all([platform.windowsUpdate.lastInstalled(), platform.windowsUpdate.pendingCount()]);
    if (!fresh && pending != null) winCache = { at: Date.now(), last, pending };
    let state = 'unknown';
    if (pending != null) state = pending > 0 ? 'outdated' : 'latest';
    else if (last) state = (Date.now() - Date.parse(last)) / 86400000 > 30 ? 'outdated' : 'unknown';
    return { id: 'windows', name: 'Windows', lastInstalled: last, pending, state, canUpdate: true };
  }

  async function checkOffice() {
    const c2r = R.read('HKLM\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration', 'VersionToReport');
    if (c2r) return { id: 'office', name: 'MS오피스', version: String(c2r.value), state: 'unknown', clickToRun: true, canUpdate: true };
    const msi = uninstallEntries(platform).find((e) => /^Microsoft Office/i.test(e.name) || /^Microsoft 365/i.test(e.name));
    if (msi) return { id: 'office', name: 'MS오피스', version: msi.version, state: 'unknown', clickToRun: false, canUpdate: false };
    return null;
  }

  // ── 한컴오피스 ──
  // 실기 확인 경로: C:\Program Files (x86)\Hnc\Office 2022\HncUtils\Service\HncUpdater.exe
  function hancomOfficeDirs() {
    const out = [];
    const seen = new Set();
    for (const root of [P.programFilesX86, P.programFiles]) {
      for (const vendor of ['Hnc', 'HNC']) {
        const base = path.join(root, vendor);
        let ents = [];
        try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
          if (!e.isDirectory() || !/^office/i.test(e.name)) continue;
          const dir = path.join(base, e.name);
          if (seen.has(dir.toLowerCase())) continue;
          seen.add(dir.toLowerCase());
          out.push(dir);
        }
      }
    }
    // 최신 버전 폴더(Office 2024 > 2022 > 2020)를 먼저
    return out.sort((a, b) => path.basename(b).localeCompare(path.basename(a), undefined, { numeric: true }));
  }

  function hancomUpdater() {
    for (const dir of hancomOfficeDirs()) {
      const p = path.join(dir, 'HncUtils', 'Service', 'HncUpdater.exe');
      if (platform.exists(p)) return p;
    }
    return null;
  }

  async function hwpVersion() {
    for (const dir of hancomOfficeDirs()) {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (!e.isDirectory() || !/^hoffice/i.test(e.name)) continue;
        const exe = path.join(dir, e.name, 'Bin', 'Hwp.exe');
        if (platform.exists(exe)) { const v = await platform.fileVersion(exe); if (v) return v; }
      }
    }
    return null;
  }

  async function checkHangul() {
    const e = uninstallEntries(platform).find((x) => /한컴오피스|hancom office|한글\s*20\d\d|hwp 20\d\d/i.test(x.name));
    const updater = hancomUpdater();
    if (!e && !updater) return null;
    const version = (await hwpVersion()) || (e && e.version) || null;
    return { id: 'hangul', name: '한글', version, product: e ? e.name : '한컴오피스', state: 'unknown', canUpdate: true, hasUpdater: !!updater };
  }

  async function check() {
    const results = await Promise.all([checkChrome(), checkWindows(), checkHangul(), checkOffice()].map((p) => p.catch(() => null)));
    return results.filter(Boolean);
  }

  // ── 크롬 업데이트 실행 ──
  function startChromeUpdate(exe) {
    chromeProgress = { phase: 'checking' };
    emit('updates:progress', { id: 'chrome', ...chromeProgress });
    chromeJob = platform.chromeUpdate.install((ev) => {
      chromeProgress = ev;
      emit('updates:progress', { id: 'chrome', ...ev });
    }).then(async (res) => {
      chromeJob = null;
      chromeProgress = null;
      if (res.phase === 'unavailable') {
        // 구글 업데이트에 연결할 수 없으면 크롬 주소창에 크롬 정보 주소를 대신 넣는다.
        const opened = await platform.chromeUpdate.openHelpViaOmnibox(exe);
        emit('updates:progress', { id: 'chrome', phase: opened ? 'opened' : 'guide', final: true });
        return;
      }
      if (res.phase === 'done') justUpdated = { version: res.version || null, at: Date.now() };
      emit('updates:progress', { id: 'chrome', ...res, final: true });
    }).catch(() => {
      chromeJob = null;
      chromeProgress = null;
      emit('updates:progress', { id: 'chrome', phase: 'error', final: true });
    });
  }

  async function run(id) {
    switch (id) {
      case 'chrome': {
        const exe = chromeExe();
        if (!exe) return { ok: false, guide: '크롬 오른쪽 위 ⋮ → 설정 → Chrome 정보에서 업데이트하세요.' };
        if (chromeJob) return { ok: true, inline: true };
        if (chromePending(exe, currentChromeVersion())) return { ok: true, restart: true };
        startChromeUpdate(exe);
        return { ok: true, inline: true };
      }
      // 크롬의 [다시 시작]과 같게: 크롬이 스스로 다시 시작하도록 주소창에 chrome://restart를 넣는다(열린 탭이 돌아옴).
      // 쎈Clean이 크롬을 강제로 끄고 켜면 새 버전으로 바뀌지 않으므로(1.4까지의 문제) 그렇게 하지 않는다.
      case 'chrome-restart': {
        const exe = chromeExe();
        if (!exe) return { ok: false };
        restartTried = Date.now();
        const running = (await platform.processes()).includes('chrome.exe');
        if (!running) { platform.launch(exe, []); return { ok: true, launched: true }; }
        const ok = await platform.chromeUpdate.openUrlViaOmnibox(exe, 'chrome://restart');
        if (ok) return { ok: true, restarted: true };
        const help = await platform.chromeUpdate.openUrlViaOmnibox(exe, 'chrome://settings/help');
        return { ok: true, guide: help ? '크롬 정보 화면을 열었어요. 오른쪽 [다시 시작]을 누르세요.' : '크롬 오른쪽 위 ⋮ → 도움말 → Chrome 정보에서 [다시 시작]을 누르세요.' };
      }
      case 'windows':
        winCache = null;
        await platform.shell.openExternal('ms-settings:windowsupdate');
        return { ok: true, guide: 'Windows 업데이트 화면에서 [업데이트 확인]을 누르세요.' };
      case 'office': {
        const c2r = path.join(P.programFiles, 'Common Files', 'microsoft shared', 'ClickToRun', 'OfficeC2RClient.exe');
        if (platform.exists(c2r)) { platform.launch(c2r, ['/update', 'user']); return { ok: true, guide: '오피스 업데이트 창이 열려요. 안내에 따라 진행하세요.' }; }
        await platform.shell.openExternal('ms-settings:windowsupdate');
        return { ok: true, guide: '오피스는 Windows 업데이트로 업데이트돼요.' };
      }
      case 'hangul': {
        const u = hancomUpdater();
        if (!u) return { ok: false, howto: true };
        // 더블클릭(Win+R)과 같은 방식으로 실행한다. 학교 PC 실기: 일반 실행으로는 창이 뜨지 않음.
        const image = path.basename(u).toLowerCase();
        const err = await platform.shell.openPath(u);
        if (err) return { ok: false, howto: true };
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 250));
          if ((await platform.processes()).includes(image)) {
            return { ok: true, guide: '한컴오피스 업데이트 창을 열었어요. Windows 확인 창이 뜨면 [예]를 누르세요.' };
          }
        }
        return { ok: false, howto: true };
      }
      default:
        return { ok: false };
    }
  }

  return { check, run };
}

module.exports = { createUpdateService, uninstallEntries, cmpVersion };
