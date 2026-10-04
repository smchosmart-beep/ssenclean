'use strict';
// 개인정보 파일 메뉴의 메인 프로세스 쪽 서비스.
// 화면에서 넘어온 경로는 이번 검사 결과에 있는 파일만 처리한다(임의 경로 삭제 방지).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createPrivacyService({ platform, store, spawnScan, emit }) {
  let current = null; // { id, results: Map(path -> result), running, summary }
  let worker = null;

  function defaultRoots() {
    const P = platform.paths;
    return [
      { path: P.desktop, label: '바탕화면', checked: true },
      { path: P.documents, label: '문서', checked: true },
      { path: P.downloads, label: '다운로드', checked: true },
    ];
  }

  function exclusions() { return store.read('exclusions.json', []); }

  function start({ roots, recursive = true, tag = 'privacy' }) {
    stop();
    const validRoots = (roots || []).filter((r) => typeof r === 'string' && fs.existsSync(r));
    const id = Date.now();
    current = { id, tag, results: new Map(), running: true, summary: null, roots: validRoots };
    const handle = (ev) => {
      if (!current || current.id !== id) return;
      if (ev.type === 'result') {
        ev.result.where = friendlyDir(ev.result.path);
        current.results.set(ev.result.path, ev.result);
      }
      if (ev.type === 'done' || ev.type === 'error') {
        current.running = false;
        current.summary = ev.summary || null;
        if (ev.type === 'done' && tag === 'privacy') saveSummary();
        worker = null;
      }
      emit(`${tag}:event`, { id, ...ev });
    };
    worker = spawnScan({
      roots: validRoots,
      recursive,
      exclusions: exclusions().map((x) => x.key),
      platform: platform.kind,
      cloudOnly: platform.kind === 'mock' ? (platform._state().cloudOnly || []) : [],
    }, handle);
    return { id, roots: validRoots };
  }

  function stop() {
    if (worker) { try { worker.stop(); } catch { /* ignore */ } }
  }

  function saveSummary() {
    const res = [...current.results.values()];
    const found = res.filter((r) => r.status === 'found');
    store.write('privacy-last.json', {
      at: Date.now(),
      files: found.length,
      danger: found.filter((r) => r.level === 3).length,
      stopped: !!(current.summary && current.summary.stopped),
    });
  }

  function lastSummary() { return store.read('privacy-last.json', null); }

  function results() {
    if (!current) return { running: false, results: [], summary: null };
    return { id: current.id, running: current.running, results: [...current.results.values()], summary: current.summary };
  }

  async function secureErase(p) {
    const st = await fs.promises.stat(p);
    const fh = await fs.promises.open(p, 'r+');
    try {
      const chunk = 1024 * 1024;
      for (let off = 0; off < st.size; off += chunk) {
        const len = Math.min(chunk, st.size - off);
        await fh.write(crypto.randomBytes(len), 0, len, off);
      }
      await fh.sync();
    } finally { await fh.close(); }
    await fs.promises.unlink(p);
  }

  async function remove({ paths, secure = false }) {
    if (!current) return [];
    const out = [];
    for (const p of paths || []) {
      if (!current.results.has(p)) { out.push({ path: p, ok: false, reason: 'unknown' }); continue; }
      try {
        if (secure) await secureErase(p);
        else await platform.shell.trash(p);
        current.results.delete(p);
        out.push({ path: p, ok: true });
      } catch (e) {
        const code = e && e.code;
        out.push({ path: p, ok: false, reason: code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || /busy|in use|사용 중/i.test(String(e && e.message)) ? 'locked' : 'error' });
      }
    }
    if (current.tag === 'privacy' && !current.running) saveSummary();
    return out;
  }

  function exclude(p) {
    if (!current || !current.results.has(p)) return false;
    const r = current.results.get(p);
    store.update('exclusions.json', [], (list) => {
      if (!list.some((x) => x.key === r.key)) list.push({ key: r.key, path: r.path, name: r.name, at: Date.now() });
      return list;
    });
    current.results.delete(p);
    if (!current.running) saveSummary();
    return true;
  }

  function unexclude(key) {
    store.update('exclusions.json', [], (list) => list.filter((x) => x.key !== key));
    return true;
  }

  function reveal(p) {
    if (!current || !current.results.has(p)) return false;
    platform.shell.reveal(p);
    return true;
  }

  // 사용자 폴더 기준 쉬운 경로: 바탕화면 › 2025 업무
  function friendlyDir(p) {
    const P = platform.paths;
    const map = [[P.desktop, '바탕화면'], [P.documents, '문서'], [P.downloads, '다운로드'], [P.home, '내 폴더']];
    const dir = path.dirname(p);
    for (const [base, label] of map) {
      const rel = path.relative(base, dir);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) return [label, ...rel.split(path.sep).filter(Boolean)].join(' › ');
    }
    return dir;
  }

  return { defaultRoots, start, stop, results, remove, exclude, unexclude, exclusions, reveal, lastSummary, friendlyDir, _current: () => current };
}

module.exports = { createPrivacyService };
