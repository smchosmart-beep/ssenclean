'use strict';
// Electron utilityProcess에서 실행되는 개인정보 검사 프로세스.
// 메인 프로세스와 메시지로만 통신하며, 개인정보 원문은 화면 표시용 가림 문맥으로만 넘긴다.
const { scan } = require('./scan-core');

const port = process.parentPort;
let stopRequested = false;

function attrsFor(platform, cloudOnly) {
  if (platform === 'win32') {
    try { const native = require('../platform/native'); return (p) => native.fileAttributes(p) || 0; } catch { return () => 0; }
  }
  const set = new Set(cloudOnly || []);
  return (p) => (set.has(p) ? 0x400000 : 0);
}

port.on('message', async (e) => {
  const msg = e.data;
  if (msg.type === 'stop') { stopRequested = true; return; }
  if (msg.type !== 'start') return;
  stopRequested = false;
  try {
    await scan({
      roots: msg.roots,
      recursive: msg.recursive !== false,
      exclusions: msg.exclusions || [],
      fileAttributes: attrsFor(msg.platform, msg.cloudOnly),
      shouldStop: () => stopRequested,
      onEvent: (ev) => port.postMessage(ev),
    });
  } catch (err) {
    port.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
});
