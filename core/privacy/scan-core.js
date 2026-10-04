'use strict';
// 폴더를 돌며 지원 형식 파일의 개인정보를 찾는다. 화면이 멈추지 않도록 별도 프로세스(scan-worker)에서 실행된다.
const fs = require('fs');
const path = require('path');
const { extract, SUPPORTED } = require('./parsers');
const { analyze } = require('./detectors');

const MAX_SIZE = 100 * 1024 * 1024;
const SKIP_DIRS = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'appdata', '$recycle.bin',
  'system volume information', 'node_modules', '.git', 'recovery', '$windows.~bt', '$windows.~ws', 'msocache', 'perflogs']);
const ATTR_HIDDEN = 0x2, ATTR_SYSTEM = 0x4, ATTR_OFFLINE = 0x1000, ATTR_RECALL_OPEN = 0x40000, ATTR_RECALL_DATA = 0x400000;

const fileKey = (p, size, mtimeMs) => `${p}|${size}|${Math.round(mtimeMs)}`;

async function enumerate(roots, { recursive = true, fileAttributes = () => 0, shouldStop = () => false, limit = 300000 } = {}) {
  const files = [];
  const seen = new Set();
  async function walk(dir, depth) {
    if (shouldStop() || files.length >= limit) return;
    const real = dir.toLowerCase();
    if (seen.has(real)) return;
    seen.add(real);
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (shouldStop() || files.length >= limit) return;
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const attr = fileAttributes(p) || 0;
      if (attr & (ATTR_HIDDEN | ATTR_SYSTEM)) continue;
      if (e.isDirectory()) {
        if (!recursive) continue;
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        await walk(p, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!SUPPORTED.includes(ext)) continue;
        files.push({ path: p, cloud: !!(attr & (ATTR_OFFLINE | ATTR_RECALL_OPEN | ATTR_RECALL_DATA)) });
      }
    }
  }
  for (const r of roots) await walk(r, 0);
  return files;
}

async function scanFile(file, { cloud = false } = {}) {
  let st;
  try { st = await fs.promises.stat(file); } catch { return null; }
  const base = { path: file, name: path.basename(file), size: st.size, mtimeMs: st.mtimeMs, key: fileKey(file, st.size, st.mtimeMs) };
  if (cloud) return { ...base, status: 'skipped-cloud' };
  if (st.size > MAX_SIZE) return { ...base, status: 'skipped-large' };
  let buf;
  try { buf = await fs.promises.readFile(file); } catch (e) {
    return { ...base, status: e && (e.code === 'EBUSY' || e.code === 'EPERM') ? 'locked' : 'unreadable' };
  }
  const r = await extract(file, buf);
  buf = null;
  if (r.status !== 'ok') return { ...base, status: r.status };
  const a = analyze(r.segments);
  if (a.level === 0) return { ...base, status: 'clean' };
  return { ...base, status: 'found', counts: a.counts, level: a.level, previews: a.previews };
}

// 전체 검사. onEvent({type:'total'|'progress'|'result'|'done', ...})
async function scan({ roots, recursive = true, exclusions = [], fileAttributes, onEvent = () => {}, shouldStop = () => false }) {
  const excl = new Set(exclusions);
  const started = Date.now();
  onEvent({ type: 'phase', phase: 'listing' });
  const files = await enumerate(roots, { recursive, fileAttributes, shouldStop });
  onEvent({ type: 'total', total: files.length });
  const summary = { total: files.length, checked: 0, found: 0, issues: 0, excluded: 0 };
  let lastTick = 0;
  for (const f of files) {
    if (shouldStop()) break;
    const r = await scanFile(f.path, { cloud: f.cloud });
    summary.checked++;
    if (r) {
      if (excl.has(r.key)) summary.excluded++;
      else if (r.status === 'found') { summary.found++; onEvent({ type: 'result', result: r }); }
      else if (r.status !== 'clean') { summary.issues++; onEvent({ type: 'result', result: r }); }
    }
    const now = Date.now();
    if (now - lastTick > 120 || summary.checked === files.length) {
      lastTick = now;
      onEvent({ type: 'progress', checked: summary.checked, total: files.length, current: f.path });
    }
  }
  onEvent({ type: 'done', summary: { ...summary, stopped: shouldStop(), ms: Date.now() - started, at: Date.now() } });
  return summary;
}

module.exports = { scan, scanFile, enumerate, fileKey, MAX_SIZE };
