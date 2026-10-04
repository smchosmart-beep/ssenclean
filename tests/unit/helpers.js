'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createMockPlatform } = require('../../core/platform/mock');
const { createStore } = require('../../core/store');
const { scan } = require('../../core/privacy/scan-core');

const ROOT = path.join(__dirname, '..', '..');

function freshEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'senclean-test-'));
  const platform = createMockPlatform({ root });
  const store = createStore(platform.paths.userData);
  // utilityProcess 대신 같은 프로세스에서 검사
  const spawnScan = (msg, onEvent) => {
    let stop = false;
    const cloud = new Set(msg.cloudOnly || []);
    scan({ roots: msg.roots, recursive: msg.recursive !== false, exclusions: msg.exclusions, fileAttributes: (p) => (cloud.has(p) ? 0x400000 : 0), shouldStop: () => stop, onEvent });
    return { stop() { stop = true; } };
  };
  const events = [];
  const emit = (ch, p) => events.push([ch, p]);
  return { root, platform, store, spawnScan, emit, events, dataDir: path.join(ROOT, 'data'), assetsDir: path.join(ROOT, 'assets'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function waitFor(fn, ms = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => { const v = fn(); if (v) return resolve(v); if (Date.now() - t0 > ms) return reject(new Error('timeout')); setTimeout(tick, 30); };
    tick();
  });
}

module.exports = { freshEnv, waitFor, ROOT };
