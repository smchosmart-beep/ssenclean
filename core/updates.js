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

function createUpdateService({ platform }) {
  const P = platform.paths;
  const R = platform.reg;

  function chromeExe() {
    const cands = [
      path.join(P.programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(P.programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(P.localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    return cands.find((c) => platform.exists(c)) || null;
  }

  async function checkChrome() {
    const exe = chromeExe();
    let version = (R.read('HKCU\\Software\\Google\\Chrome\\BLBeacon', 'version') || {}).value
      || (R.read('HKLM\\SOFTWARE\\Google\\Chrome\\BLBeacon', 'version') || {}).value || null;
    if (!exe && !version) return null;
    if (!version && exe) version = await platform.fileVersion(exe);
    const latestJson = await platform.fetchJson('https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions?pageSize=1');
    const latest = latestJson && latestJson.versions && latestJson.versions[0] && latestJson.versions[0].version;
    let state = 'unknown';
    if (version && latest) state = cmpVersion(version, latest) < 0 ? 'outdated' : 'latest';
    return { id: 'chrome', name: '크롬', version, latest: latest || null, state, offline: !latestJson, canUpdate: !!exe };
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

  function hancomUpdater(entry) {
    const roots = [P.programFilesX86, P.programFiles];
    const cands = [];
    for (const r of roots) {
      cands.push(path.join(r, 'Hnc', 'HncUtils', 'Update', 'HncUpdate.exe'));
      cands.push(path.join(r, 'HNC', 'HncUtils', 'Update', 'HncUpdate.exe'));
      cands.push(path.join(r, 'Hnc', 'Common', 'HncUpdate.exe'));
    }
    if (entry && entry.location) cands.push(path.join(entry.location, 'HncUpdate.exe'));
    return cands.find((c) => platform.exists(c)) || null;
  }

  async function checkHangul() {
    const e = uninstallEntries(platform).find((x) => /한컴오피스|hancom office|한글\s*20\d\d|hwp 20\d\d/i.test(x.name));
    if (!e) return null;
    const updater = hancomUpdater(e);
    return { id: 'hangul', name: '한글', version: e.version, product: e.name, state: 'unknown', canUpdate: !!updater };
  }

  async function check() {
    const results = await Promise.all([checkChrome(), checkWindows(), checkHangul(), checkOffice()].map((p) => p.catch(() => null)));
    return results.filter(Boolean);
  }

  async function run(id) {
    switch (id) {
      case 'chrome': {
        const exe = chromeExe();
        if (!exe) return { ok: false, guide: '크롬 오른쪽 위 ⋮ → 도움말 → Chrome 정보' };
        platform.launch(exe, ['chrome://settings/help']);
        return { ok: true, guide: '크롬 정보 화면에서 업데이트가 자동으로 시작돼요. 끝나면 [다시 시작]을 눌러 주세요.' };
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
        const e = uninstallEntries(platform).find((x) => /한컴오피스|hancom office/i.test(x.name));
        const u = hancomUpdater(e);
        if (!u) return { ok: false, guide: '한글을 열고 [도움말] → [업데이트]를 누르세요. 관리자 암호를 물으면 정보 담당 선생님께 요청하세요.' };
        platform.launch(u, []);
        return { ok: true, guide: '한컴 업데이트 창이 열려요. 관리자 암호를 물으면 정보 담당 선생님께 요청하세요.' };
      }
      default:
        return { ok: false };
    }
  }

  return { check, run };
}

module.exports = { createUpdateService, uninstallEntries, cmpVersion };
