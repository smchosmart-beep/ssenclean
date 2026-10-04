'use strict';
// 크롬 업데이트: 크롬 정보 화면(chrome://settings/help)이 쓰는 것과 같은 구글 업데이트 COM 통로를 쓴다.
// 관리자 권한 없이 "확인 → 내려받기 → 설치"를 요청할 수 있다(학교 PC에서 실기 확인: 상태 16 응답).
const { runPowerShell, runPowerShellLines, psQuote } = require('./exec');

const CHROME_APP_ID = '{8A69D345-D564-463C-AFF1-A69D9E530F96}';
// 모든 사용자용 설치(옛 방식·새 방식) → 내 계정용 설치 순서로 시도
const PROG_IDS = ['GoogleUpdate.Update3WebMachine', 'GoogleUpdater.Update3WebSystem', 'GoogleUpdate.Update3WebUser', 'GoogleUpdater.Update3WebUser'];

// 구글 업데이트 상태값 → 쎈클린 단계
const STATE = {
  1: 'checking', 2: 'checking', 3: 'checking', 4: 'available',
  5: 'downloading', 6: 'downloading', 7: 'downloading', 8: 'preparing', 9: 'preparing', 10: 'preparing',
  11: 'preparing', 12: 'preparing', 13: 'installing', 14: 'done', 15: 'paused', 16: 'latest', 17: 'error',
};

function script({ install, maxPolls }) {
  return `
$ids=@(${PROG_IDS.map(psQuote).join(',')})
$b=$null; $used=$null
foreach($p in $ids){
  try { $u=New-Object -ComObject $p; $bb=$u.createAppBundleWeb(); $bb.initialize(); $bb.createInstalledApp('${CHROME_APP_ID}'); $b=$bb; $used=$p; break } catch {}
}
if(-not $b){ Emit @{state=-1}; exit }
try { $b.checkForUpdate() } catch { Emit @{state=17; err='check'}; exit }
function P($s,$n){ try { return $s.$n } catch { return $null } }
$installed=$false
for($i=0; $i -lt ${maxPolls}; $i++){
  Start-Sleep -Milliseconds 500
  try { $s=$b.appWeb(0).currentState } catch { Emit @{state=17; err='poll'}; break }
  $v=[int](P $s 'stateValue')
  $o=@{state=$v; ver=[string](P $s 'availableVersion'); com=$used}
  if($v -ge 5 -and $v -le 7){ $o.dl=[double](P $s 'bytesDownloaded'); $o.total=[double](P $s 'totalBytesToDownload') }
  if($v -eq 13){ $o.ip=[int](P $s 'installProgress') }
  if($v -eq 17){ $o.err=[string](P $s 'errorCode'); $o.msg=[string](P $s 'completionMessage') }
  Emit $o
  if($v -eq 4){
    if(${install ? '$true' : '$false'}){ if(-not $installed){ try { $b.install(); $installed=$true } catch { Emit @{state=17; err='install'}; break } } }
    else { break }
  }
  if($v -eq 14 -or $v -eq 16 -or $v -eq 17){ break }
}`;
}

function toEvent(raw) {
  if (!raw) return null;
  if (raw.state === -1) return { phase: 'unavailable' };
  const phase = STATE[raw.state] || 'checking';
  const ev = { phase, version: raw.ver || null, raw: raw.state };
  if (phase === 'downloading' && raw.total > 0) ev.percent = Math.min(100, Math.round((raw.dl / raw.total) * 100));
  if (phase === 'installing' && raw.ip >= 0) ev.percent = raw.ip;
  if (phase === 'error') ev.error = raw.err || raw.msg || '';
  return ev;
}

function createChromeUpdater() {
  return {
    // 받을 업데이트가 있는지만 묻는다. → { phase: 'latest'|'available'|'error'|'unavailable', version }
    async check() {
      const last = await runPowerShellLines(script({ install: false, maxPolls: 120 }), () => {}, { timeoutMs: 90000 });
      const ev = toEvent(last);
      if (!ev) return { phase: 'unavailable' };
      if (ev.phase === 'checking') return { phase: 'error', error: 'timeout' };
      return ev;
    },
    // 내려받기·설치까지. onProgress(ev)로 단계별 진행률을 넘긴다.
    async install(onProgress) {
      const last = await runPowerShellLines(script({ install: true, maxPolls: 1800 }), (raw) => { const ev = toEvent(raw); if (ev) onProgress(ev); });
      return toEvent(last) || { phase: 'unavailable' };
    },
    // COM을 못 쓰는 PC용: 크롬 새 창을 띄우고 주소창에 크롬 정보 주소를 붙여 넣는다.
    async openHelpViaOmnibox(exe) {
      const r = await runPowerShell(`
$old=$null; try { $old=Get-Clipboard -Raw } catch {}
Set-Clipboard -Value 'chrome://settings/help'
Start-Process -FilePath ${psQuote(exe)} -ArgumentList '--new-window','about:blank'
Start-Sleep -Milliseconds 2000
$w=New-Object -ComObject WScript.Shell
$ok=$w.AppActivate('about:blank')
if($ok){ Start-Sleep -Milliseconds 300; $w.SendKeys('^l'); Start-Sleep -Milliseconds 250; $w.SendKeys('^v'); Start-Sleep -Milliseconds 250; $w.SendKeys('{ENTER}') }
Start-Sleep -Milliseconds 600
if($old -ne $null){ Set-Clipboard -Value $old }
@{ok=[bool]$ok} | ConvertTo-Json -Compress`, { timeoutMs: 20000 });
      return !!(r && r.ok);
    },
  };
}

module.exports = { createChromeUpdater, toEvent, CHROME_APP_ID };
