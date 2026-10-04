'use strict';
// 관리자 권한이 필요한 작업을 Windows 확인 창(UAC)을 거쳐 실행한다.
// - 실행할 작업(ops)은 쎈클린이 만든 정해진 종류만 쓴다: 레지스트리 값 쓰기/지우기, 파일 복사/지우기, netsh.
// - 스크립트 본문은 -EncodedCommand로 넘겨 파일 바꿔치기를 막고, 작업 목록 파일은 SHA-256으로 확인한 뒤 실행한다.
// - 사용자가 확인 창에서 [아니요]를 누르면 { ok:false, canceled:true }.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runPowerShell } = require('./exec');

const ELEVATED_SCRIPT = String.raw`
param([string]$OpsFile, [string]$OutFile, [string]$Hash)
$ErrorActionPreference = 'Stop'
function RegPath($k) { 'Registry::' + ($k -replace '^HKLM\\', 'HKEY_LOCAL_MACHINE\' -replace '^HKCU\\', 'HKEY_CURRENT_USER\') }
$res = New-Object System.Collections.ArrayList
try {
  $bytes = [IO.File]::ReadAllBytes($OpsFile)
  $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLower()
  if ($h -ne $Hash) { throw 'ops-changed' }
  $ops = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
  foreach ($o in $ops) {
    try {
      switch ($o.op) {
        'regDelete' {
          Remove-ItemProperty -LiteralPath (RegPath $o.key) -Name $o.name -ErrorAction Stop
          [void]$res.Add(@{ ok = $true })
        }
        'regSet' {
          $p = RegPath $o.key
          if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null }
          $v = $o.value
          if ($o.type -eq 'Binary') { $v = [byte[]]@($o.value) }
          New-ItemProperty -LiteralPath $p -Name $o.name -PropertyType $o.type -Value $v -Force | Out-Null
          [void]$res.Add(@{ ok = $true })
        }
        'copy' {
          $d = Split-Path -Parent $o.to
          if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
          Copy-Item -LiteralPath $o.from -Destination $o.to -Force
          [void]$res.Add(@{ ok = $true })
        }
        'delete' {
          try {
            Remove-Item -LiteralPath $o.path -Force -ErrorAction Stop
            [void]$res.Add(@{ ok = $true })
          } catch {
            if (-not $o.delayIfLocked) { throw }
            Add-Type -Namespace SenClean -Name K32 -MemberDefinition '[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool MoveFileEx(string a, string b, int f);' -ErrorAction SilentlyContinue
            if ([SenClean.K32]::MoveFileEx($o.path, $null, 4)) { [void]$res.Add(@{ ok = $true; pending = $true }) } else { throw }
          }
        }
        'netsh' {
          $text = (& netsh.exe @($o.args) 2>&1 | Out-String)
          $ok = ($LASTEXITCODE -eq 0) -or ($o.allowAlready -and $text -match 'already|이미')
          [void]$res.Add(@{ ok = [bool]$ok; text = $text })
        }
        default { [void]$res.Add(@{ ok = $false; error = 'unknown-op' }) }
      }
    } catch { [void]$res.Add(@{ ok = $false; error = $_.Exception.Message }) }
  }
  $out = @{ ok = $true; results = @($res) }
} catch {
  $out = @{ ok = $false; error = $_.Exception.Message; results = @($res) }
}
[IO.File]::WriteAllText($OutFile, (ConvertTo-Json -InputObject $out -Depth 5 -Compress), (New-Object Text.UTF8Encoding($false)))
`;

function psStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

async function runElevated(ops, { timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!ops || !ops.length) return { ok: true, results: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'senclean-admin-'));
  const opsFile = path.join(dir, 'ops.json');
  const outFile = path.join(dir, 'out.json');
  const json = Buffer.from(JSON.stringify(ops), 'utf8');
  fs.writeFileSync(opsFile, json);
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  // 관리자 쪽 스크립트: 본문을 그대로 EncodedCommand에 싣고 인자는 스크립트 블록 호출로 넘긴다.
  const inner = `& { ${ELEVATED_SCRIPT} } -OpsFile ${psStr(opsFile)} -OutFile ${psStr(outFile)} -Hash ${psStr(hash)}`;
  const enc = Buffer.from(inner, 'utf16le').toString('base64');
  const outer = `
try {
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${enc}')
  @{ started = $true; code = $p.ExitCode } | ConvertTo-Json -Compress
} catch {
  @{ started = $false; msg = [string]$_.Exception.Message } | ConvertTo-Json -Compress
}`;
  try {
    const r = await runPowerShell(outer, { timeoutMs });
    if (!r) return { ok: false, error: 'no-response' };
    if (!r.started) return { ok: false, canceled: true };
    let text = '';
    try { text = fs.readFileSync(outFile, 'utf8').replace(/^﻿/, ''); } catch { return { ok: false, error: 'no-result' }; }
    const out = JSON.parse(text);
    return { ok: !!out.ok, results: Array.isArray(out.results) ? out.results : (out.results ? [out.results] : []), error: out.error };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { runElevated, ELEVATED_SCRIPT };
