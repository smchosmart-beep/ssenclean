'use strict';
// 실제 Windows 어댑터. 기본은 일반 권한으로 동작하고, 관리자 권한이 필요한 작업만 Windows 확인 창(elevate-win)을 거친다.
const os = require('os');
const path = require('path');
const fs = require('fs');
const native = require('./native');
const { runPowerShell, psQuote, run, launch } = require('./exec');
const { createChromeUpdater } = require('./google-update');
const networkWin = require('./network-win');
const { runElevated } = require('./elevate-win');

function createWin32Platform({ electron }) {
  const { shell, app, net } = electron;
  const env = process.env;
  const home = os.homedir();
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  const paths = {
    home,
    desktop: app.getPath('desktop'),
    documents: app.getPath('documents'),
    downloads: app.getPath('downloads'),
    appData,
    localAppData,
    temp: os.tmpdir(),
    userData: app.getPath('userData'),
    windowsFonts: path.join(env.WINDIR || 'C:\\Windows', 'Fonts'),
    userFonts: path.join(localAppData, 'Microsoft', 'Windows', 'Fonts'),
    startMenu: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    startup: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    taskbarPinned: path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    programFiles: env.ProgramFiles || 'C:\\Program Files',
    programFilesX86: env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    windir: env.WINDIR || 'C:\\Windows',
    systemDrive: (env.SystemDrive || 'C:') + '\\',
    browserData: {
      chrome: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      edge: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    },
  };

  const user = {
    name: env.USERNAME || os.userInfo().username,
    domain: env.USERDOMAIN || '',
    computer: env.COMPUTERNAME || os.hostname(),
  };

  const reg = {
    read: (key, name) => native.regRead(key, name),
    values: (key) => native.regValues(key),
    subkeys: (key) => native.regSubkeys(key),
    write: (key, name, type, value) => native.regWrite(key, name, type, value),
    del: (key, name) => native.regDelete(key, name),
  };

  // probePassword=false면 암호 유무 확인(빈 암호 로그인 1회 시도)을 하지 않는다.
  // 실패한 로그인은 계정 잠금 횟수에 들어가므로 호출하는 쪽에서 하루 1회 이하로 제한한다.
  async function accountInfo({ probePassword = true } = {}) {
    // PC를 Microsoft 계정으로 로그인하면 이 키 아래에 계정 항목이 생긴다.
    const msa = reg.subkeys('HKCU\\Software\\Microsoft\\IdentityCRL\\UserExtendedProperties');
    const type = msa && msa.length > 0 ? 'microsoft' : 'local';
    let hasPw = null;
    let ageDays = null;
    if (probePassword) hasPw = native.hasPassword(user.name);
    const age = native.passwordAgeSeconds(user.name);
    if (age != null) ageDays = Math.floor(age / 86400);
    return { type, userName: user.name, hasPassword: hasPw, probed: !!probePassword, passwordAgeDays: type === 'local' ? ageDays : null };
  }

  async function changePassword(oldPw, newPw) {
    return native.changePassword(user.name, oldPw || '', newPw);
  }

  async function processes() {
    const r = await run('tasklist.exe', ['/fo', 'csv', '/nh'], { timeoutMs: 10000 });
    if (!r.ok) return [];
    return r.stdout.split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map((s) => s.toLowerCase());
  }

  async function requestClose(imageName) {
    // 강제 종료(/F)하지 않고 정상 종료를 요청한다.
    await run('taskkill.exe', ['/IM', imageName], { timeoutMs: 10000 });
  }

  async function signatures(files) {
    if (!files.length) return {};
    const list = files.map(psQuote).join(',');
    const res = await runPowerShell(`
$out=@{}
foreach($f in @(${list})){
  $s=Get-AuthenticodeSignature -LiteralPath $f
  $v=(Get-Item -LiteralPath $f).VersionInfo
  $c=(Get-Item -LiteralPath $f).CreationTime
  $out[$f]=@{signed=($s.Status -eq 'Valid');signer=$s.SignerCertificate.Subject;company=$v.CompanyName;product=$v.ProductName;created=$c.ToString('o')}
}
$out | ConvertTo-Json -Depth 4 -Compress`, { timeoutMs: 60000 });
    return res || {};
  }

  async function fileVersion(file) {
    const res = await runPowerShell(`@{v=(Get-Item -LiteralPath ${psQuote(file)}).VersionInfo.ProductVersion} | ConvertTo-Json -Compress`);
    return res && res.v ? String(res.v) : null;
  }

  const tasks = {
    async listUser() {
      const res = await runPowerShell(`
$me=$env:USERNAME
$r=@()
Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' } | ForEach-Object {
  $u=$_.Principal.UserId
  $acts=@($_.Actions | ForEach-Object { @{exec=$_.Execute;args=$_.Arguments} })
  $r+=@{name=$_.TaskName;path=$_.TaskPath;user=$u;state=[string]$_.State;author=$_.Author;actions=$acts}
}
ConvertTo-Json -InputObject @($r) -Depth 5 -Compress`, { timeoutMs: 45000 });
      return Array.isArray(res) ? res : [];
    },
    async exportXml(taskPath, name) {
      const res = await runPowerShell(`@{xml=(Export-ScheduledTask -TaskPath ${psQuote(taskPath)} -TaskName ${psQuote(name)})} | ConvertTo-Json -Compress`);
      return res && res.xml ? res.xml : null;
    },
    async remove(taskPath, name) {
      const res = await runPowerShell(`Unregister-ScheduledTask -TaskPath ${psQuote(taskPath)} -TaskName ${psQuote(name)} -Confirm:$false; @{ok=-not (Get-ScheduledTask -TaskPath ${psQuote(taskPath)} -TaskName ${psQuote(name)})} | ConvertTo-Json -Compress`);
      return !!(res && res.ok);
    },
    async register(taskPath, name, xml) {
      const res = await runPowerShell(`Register-ScheduledTask -TaskPath ${psQuote(taskPath)} -TaskName ${psQuote(name)} -Xml ${psQuote(xml)} | Out-Null; @{ok=[bool](Get-ScheduledTask -TaskPath ${psQuote(taskPath)} -TaskName ${psQuote(name)})} | ConvertTo-Json -Compress`);
      return !!(res && res.ok);
    },
  };

  const windowsUpdate = {
    async lastInstalled() {
      const res = await runPowerShell(`$h=Get-HotFix | Where-Object {$_.InstalledOn} | Sort-Object InstalledOn -Descending | Select-Object -First 1; @{d=if($h){$h.InstalledOn.ToString('o')}else{$null}} | ConvertTo-Json -Compress`, { timeoutMs: 30000 });
      return res && res.d ? res.d : null;
    },
    async pendingCount() {
      const res = await runPowerShell(`$s=(New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher(); $r=$s.Search("IsInstalled=0 and IsHidden=0 and Type='Software'"); @{n=$r.Updates.Count} | ConvertTo-Json -Compress`, { timeoutMs: 90000 });
      return res && typeof res.n === 'number' ? res.n : null;
    },
  };

  async function fetchJson(url) {
    try {
      const r = await net.fetch(url, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  return {
    kind: 'win32',
    paths,
    user,
    REG: native.REG,
    reg,
    account: { info: accountInfo, changePassword },
    screensaver: { apply: (o) => native.applyScreenSaver(o) },
    fonts: { add: native.addFont, remove: native.removeFont, broadcast: native.broadcastFontChange },
    fileAttributes: (p) => native.fileAttributes(p),
    disks: () => native.disks(),
    recycleBin: { query: (root) => native.recycleBinQuery(root), empty: (root) => native.recycleBinEmpty(root) },
    shell: {
      trash: (p) => shell.trashItem(p),
      reveal: (p) => shell.showItemInFolder(p),
      openPath: (p) => shell.openPath(p),
      openExternal: (u) => shell.openExternal(u),
      readShortcut: (p) => { try { return shell.readShortcutLink(p); } catch { return null; } },
      writeShortcut: (p, op, opts) => { try { return shell.writeShortcutLink(p, op, opts); } catch { return false; } },
    },
    launch,
    run,
    processes,
    requestClose,
    signatures,
    fileVersion,
    tasks,
    windowsUpdate,
    chromeUpdate: createChromeUpdater(),
    network: { adapters: networkWin.adapters, apply: networkWin.apply, applyElevated: (cfg) => networkWin.applyElevated(cfg, runElevated), connectivity: networkWin.connectivity },
    elevated: (ops) => runElevated(ops),
    // 더블클릭과 같은 방식(ShellExecute)으로 실행: 관리자 권한이 필요한 프로그램이면 Windows 확인 창이 뜬다
    shellRun: async (file, args) => {
      const r = await runPowerShell(`try { Start-Process -FilePath ${psQuote(file)}${args ? ` -ArgumentList ${psQuote(args)}` : ''} -ErrorAction Stop; @{ ok = $true } | ConvertTo-Json -Compress } catch { @{ ok = $false } | ConvertTo-Json -Compress }`, { timeoutMs: 60000 });
      return !!(r && r.ok);
    },
    clipboard: { write: (t) => electron.clipboard.writeText(String(t)), read: () => electron.clipboard.readText() },
    fetchJson,
    exists: (p) => { try { fs.accessSync(p); return true; } catch { return false; } },
  };
}

module.exports = { createWin32Platform };
