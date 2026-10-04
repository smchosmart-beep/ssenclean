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

  function chromeExe() {
    const cands = [
      path.join(P.programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(P.programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(P.localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    return cands.find((c) => platform.exists(c)) || null;
  }

  // 업데이트는 끝났지만 크롬을 다시 켜야 적용되는 상태(크롬이 new_chrome.exe를 남겨 둠)
  function chromeNeedsRestart(exe) {
    return !!exe && platform.exists(path.join(path.dirname(exe), 'new_chrome.exe'));
  }

  // 학교 정책: 0 = 업데이트 끔, 1 = 항상, 2 = 수동만, 3 = 자동만
  function chromePolicy() {
    const v = R.values(CHROME_POLICY_KEY) || {};
    const get = (n) => { const k = Object.keys(v).find((x) => x.toLowerCase() === n.toLowerCase()); return k != null ? Number(v[k].value) : null; };
    const app = get(`Update${CHROME_APP_ID}`);
    return app != null ? app : get('UpdateDefault');
  }

  async function checkChrome() {
    const exe = chromeExe();
    let version = (R.read('HKCU\\Software\\Google\\Chrome\\BLBeacon', 'version') || {}).value
      || (R.read('HKLM\\SOFTWARE\\Google\\Chrome\\BLBeacon', 'version') || {}).value || null;
    if (!exe && !version) return null;
    if (!version && exe) version = await platform.fileVersion(exe);
    const base = { id: 'chrome', name: '크롬', version, canUpdate: !!exe };
    if (chromeJob) return { ...base, state: 'updating', progress: chromeProgress };
    if (chromeNeedsRestart(exe)) return { ...base, state: 'restart' };
    const policy = chromePolicy();
    if (policy === 0) return { ...base, state: 'managed' };

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

  async function checkWindows() {
    const managed = !!R.values('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate');
    const [last, pending] = await Promise.all([platform.windowsUpdate.lastInstalled(), platform.windowsUpdate.pendingCount()]);
    let state = 'unknown';
    if (pending != null) state = pending > 0 ? 'outdated' : 'latest';
    else if (last) state = (Date.now() - Date.parse(last)) / 86400000 > 30 ? 'outdated' : 'unknown';
    return { id: 'windows', name: 'Windows', lastInstalled: last, pending, state, managed, canUpdate: true };
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
      emit('updates:progress', { id: 'chrome', ...res, final: true });
    }).catch(() => {
      chromeJob = null;
      chromeProgress = null;
      emit('updates:progress', { id: 'chrome', phase: 'error', final: true });
    });
  }

  async function restartChrome(exe) {
    const running = (await platform.processes()).includes('chrome.exe');
    if (running) {
      await platform.requestClose('chrome.exe');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (!(await platform.processes()).includes('chrome.exe')) break;
      }
    }
    platform.launch(exe, running ? ['--restore-last-session'] : []);
    return { ok: true, guide: '크롬을 다시 켰어요.' };
  }

  async function run(id) {
    switch (id) {
      case 'chrome': {
        const exe = chromeExe();
        if (!exe) return { ok: false, guide: '크롬 오른쪽 위 ⋮ → 설정 → Chrome 정보에서 업데이트하세요.' };
        if (chromeJob) return { ok: true, inline: true };
        if (chromeNeedsRestart(exe)) return restartChrome(exe);
        startChromeUpdate(exe);
        return { ok: true, inline: true };
      }
      case 'chrome-restart': {
        const exe = chromeExe();
        if (!exe) return { ok: false };
        return restartChrome(exe);
      }
      case 'windows':
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
            return { ok: true, guide: '한컴오피스 업데이트 창을 열었어요. 관리자 암호를 물으면 정보 담당 선생님께 요청하세요.' };
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
