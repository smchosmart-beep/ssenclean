'use strict';
const { execFile, spawn } = require('child_process');

// PowerShell 스크립트를 실행하고 JSON 결과를 돌려준다. 실패하면 null.
// -EncodedCommand를 써서 실행 정책(스크립트 파일 차단)의 영향을 받지 않게 한다.
function runPowerShell(script, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const full = `$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;\n${script}`;
    const encoded = Buffer.from(full, 'utf16le').toString('base64');
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err && !stdout) return resolve(null);
        const text = String(stdout || '').trim();
        if (!text) return resolve(null);
        try { resolve(JSON.parse(text)); } catch { resolve(null); }
      });
  });
}

function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function run(file, args = [], { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// 결과를 기다리지 않고 프로그램을 띄운다.
function launch(file, args = []) {
  try {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

module.exports = { runPowerShell, psQuote, run, launch };
