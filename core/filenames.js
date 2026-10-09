'use strict';
// [파일명 정리] 한 번에 깔끔하게. 계획 31
// 찾기 → 미리보기(지금 이름 → 바뀔 이름) → [한 번에 정리] → [되돌리기]
const fs = require('fs');
const path = require('path');
const F = require('./filename-fix');

const SKIP = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'appdata', '$recycle.bin', 'node_modules', '.git', 'system volume information']);
const UNDO = 'filename-undo.json';
const MAX_ENTRIES = 30000;
const MAX_PATH = 250;
const pad = (n, w) => String(n).padStart(w, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;

// 사진 찍은 날(JPEG 사진 정보의 DateTimeOriginal). 없으면 null
function photoDate(file) {
  if (!/\.jpe?g$/i.test(file)) return null;
  let buf;
  try { const fd = fs.openSync(file, 'r'); buf = Buffer.alloc(131072); const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd); buf = buf.subarray(0, n); } catch { return null; }
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xFF) return null;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker === 0xE1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      const t = i + 10;
      const le = buf.toString('latin1', t, t + 2) === 'II';
      const u16 = (o) => (le ? buf.readUInt16LE(t + o) : buf.readUInt16BE(t + o));
      const u32 = (o) => (le ? buf.readUInt32LE(t + o) : buf.readUInt32BE(t + o));
      const findTag = (ifd, tag) => {
        if (t + ifd + 2 > buf.length) return null;
        const n = u16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (t + e + 12 > buf.length) return null;
          if (u16(e) === tag) return { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8) };
        }
        return null;
      };
      try {
        const ifd0 = u32(4);
        const exif = findTag(ifd0, 0x8769);
        const dt = (exif && findTag(exif.value, 0x9003)) || findTag(ifd0, 0x0132);
        if (!dt) return null;
        const s = buf.toString('latin1', t + dt.value, t + dt.value + 19);
        const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
      } catch { return null; }
    }
    i += 2 + len;
  }
  return null;
}

function createFilenameService({ platform, store }) {
  const P = platform.paths;
  let last = null; // 마지막 찾기 결과 { items, roots, custom }

  function defaultRoots() {
    return [P.desktop, P.downloads, P.documents].filter((d, i, a) => d && a.indexOf(d) === i && platform.exists(d));
  }

  // 파일·폴더 이름 모으기. 폴더는 안쪽까지(시스템·숨김·클라우드 전용 제외)
  function collect(roots, { recursive = true, maxDepth = 8, limit = MAX_ENTRIES } = {}) {
    const out = [];
    const seen = new Set();
    const attrOf = (p) => { try { return (platform.fileAttributes && platform.fileAttributes(p)) || 0; } catch { return 0; } };
    const walk = (dir, depth) => {
      if (out.length >= limit) return;
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (out.length >= limit) return;
        const p = path.join(dir, e.name);
        const low = e.name.toLowerCase();
        if (e.isSymbolicLink()) continue;
        const a = attrOf(p);
        if (a & 0x6) continue;                 // 숨김·시스템
        if (a & (0x400000 | 0x40000 | 0x1000)) continue; // 클라우드에만 있는 파일
        if (e.isDirectory()) {
          if (SKIP.has(low) || low.startsWith('.') || low.startsWith('$')) continue;
          out.push({ path: p, dir, name: e.name, isDir: true, depth });
          if (recursive && depth < maxDepth) walk(p, depth + 1);
        } else if (e.isFile()) {
          if (/^desktop\.ini$|^thumbs\.db$|^~\$/i.test(e.name)) continue;
          out.push({ path: p, dir, name: e.name, isDir: false, depth });
        }
      }
    };
    for (const r of roots) {
      const key = r.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let st; try { st = fs.statSync(r); } catch { continue; }
      if (st.isDirectory()) walk(r, 0);
      else if (st.isFile()) out.push({ path: r, dir: path.dirname(r), name: path.basename(r), isDir: false, depth: 0 });
    }
    return out;
  }

  // 선택 규칙(D·E·F): 고른 폴더나 끌어다 놓은 파일에만, 하위 폴더 없이, 파일에만
  function applyRules(entries, rules) {
    if (!rules) return new Map();
    const files = entries.filter((e) => !e.isDir && e.depth === 0 && e.fix); // 위장 실행 파일은 이름을 바꾸지 않음
    const out = new Map();
    const dateOf = (e, kind) => {
      if (kind === 'photo') { const d = photoDate(e.path); if (d) return d; }
      try { return fs.statSync(e.path).mtime; } catch { return new Date(); }
    };
    const orderBy = rules.order === 'photo' ? (e) => (dateOf(e, 'photo') || new Date(0)).getTime() : null;
    const sorted = [...files].sort((a, b) => (orderBy ? orderBy(a) - orderBy(b) : 0) || a.name.localeCompare(b.name, 'ko', { numeric: true }));
    const roster = (rules.roster || '').split(/\r?\n/).map((x) => x.split('\t')[0].trim()).filter(Boolean);
    const width = Math.max(2, String(sorted.length).length);
    sorted.forEach((e, idx) => {
      const base = out.get(e.path) || e.fixedName || e.name;
      const { stem: s0, ext } = F.splitExt(base, false);
      let stem = s0;
      const reasons = [];
      if (rules.find) { const t = stem.split(rules.find).join(rules.replace || ''); if (t !== stem) { stem = t; reasons.push('찾아 바꾸기'); } }
      if (roster.length) { if (idx < roster.length) { stem = `${pad(idx + 1, width)}_${roster[idx]}`; reasons.push('명단'); } }
      else if (rules.number) { stem = `${stem}_${pad(idx + 1, width)}`; reasons.push('번호'); }
      if (rules.prefix) { stem = rules.prefix + stem; reasons.push('앞 글자'); }
      if (rules.suffix) { stem = stem + rules.suffix; reasons.push('뒤 글자'); }
      if (rules.date && !/^(\d{4}[-.]?\d{2}[-.]?\d{2}|\d{6})/.test(stem)) { stem = `${ymd(dateOf(e, rules.date))}_${stem}`; reasons.push(rules.date === 'photo' ? '찍은 날' : '날짜'); }
      stem = F.cleanStem(stem) || stem;
      if (reasons.length) out.set(e.path, { name: stem + ext, reasons });
    });
    return out;
  }

  // 찾기: { roots?, custom?, rules? } → 미리보기
  async function scan({ roots, rules } = {}) {
    // 고른 폴더: 절대 경로만, 드라이브 맨 위·시스템 폴더는 받지 않음
    const okRoot = (r) => path.isAbsolute(r) && !/^[A-Za-z]:\\?$/.test(r) && path.parse(r).root !== r
      && !/[\\/](windows|program files( \(x86\))?|programdata|appdata)([\\/]|$)/i.test(r);
    const picked = Array.isArray(roots) ? roots.map(String).filter(okRoot).slice(0, 2000) : [];
    const custom = picked.length > 0;
    const rootList = custom ? picked : defaultRoots();
    const entries = collect(rootList, { recursive: true });
    const items = [];
    const warnings = [];
    for (const e of entries) {
      const r = F.fixName(e.name, { isDir: e.isDir });
      if (r.warn === 'disguised') { warnings.push({ path: e.path, dir: e.dir, name: e.name }); continue; }
      e.fixedName = r.name;
      e.fix = r;
    }
    const ruleMap = custom ? applyRules(entries, rules) : new Map();
    // 폴더 안 이름 겹침 확인용
    const byDir = new Map();
    const takenIn = (dir) => {
      if (!byDir.has(dir)) {
        let names = [];
        try { names = fs.readdirSync(dir); } catch { /* none */ }
        byDir.set(dir, new Set(names.map((n) => n.toLowerCase())));
      }
      return byDir.get(dir);
    };
    let id = 0;
    for (const e of entries) {
      if (!e.fix) continue;
      const rule = ruleMap.get(e.path);
      let target = rule ? rule.name : e.fixedName;
      const reasons = [...(e.fix.reasons || []).map((x) => x.label), ...(rule ? rule.reasons : [])];
      if (target === e.name || !reasons.length) continue;
      // 경로가 너무 길면 이름을 줄인다
      if (path.join(e.dir, target).length > MAX_PATH) {
        const r2 = F.fixName(target, { isDir: e.isDir, maxLen: Math.max(24, MAX_PATH - e.dir.length - 1) });
        target = r2.name;
        if (!reasons.includes('너무 긴 이름')) reasons.push('너무 긴 이름');
      }
      const taken = takenIn(e.dir);
      const sameIgnoringCase = target.toLowerCase() === e.name.toLowerCase();
      if (!sameIgnoringCase) {
        const uniq = F.uniqueName(target, taken, e.isDir);
        if (uniq !== target) reasons.push('같은 이름이 있어 번호 붙임');
        target = uniq;
        taken.add(target.toLowerCase());
      }
      items.push({ id: String(++id), path: e.path, dir: e.dir, name: e.name, newName: target, isDir: e.isDir, depth: e.depth, reasons, sure: e.fix.sure !== false, rule: !!rule });
    }
    items.sort((a, b) => (b.sure - a.sure) || a.dir.localeCompare(b.dir, 'ko') || a.name.localeCompare(b.name, 'ko'));
    last = { items, roots: rootList, custom };
    const fileCount = custom ? entries.filter((x) => !x.isDir && x.depth === 0).length : null;
    const roster = rules && rules.roster ? rules.roster.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).length : 0;
    return {
      items, warnings, roots: rootList, custom, scanned: entries.length, truncated: entries.length >= MAX_ENTRIES,
      sure: items.filter((i) => i.sure).length, check: items.filter((i) => !i.sure).length,
      rosterMismatch: custom && roster && fileCount !== roster ? { files: fileCount, names: roster } : null,
    };
  }

  // 정리하기: 고른 항목만. 안쪽(깊은 곳)부터, 파일 먼저 → 폴더
  async function apply(ids) {
    if (!last) return { ok: false, code: 'no-scan' };
    const want = new Set((ids || []).map(String));
    const pick = last.items.filter((i) => want.has(i.id));
    pick.sort((a, b) => (b.path.split(path.sep).length - a.path.split(path.sep).length) || (a.isDir - b.isDir));
    const done = [], failed = [];
    for (const it of pick) {
      const to = path.join(it.dir, it.newName);
      try {
        if (it.newName.toLowerCase() !== it.name.toLowerCase() && fs.existsSync(to)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        fs.renameSync(it.path, to);
        done.push({ from: it.path, to, name: it.name, newName: it.newName });
      } catch (e) {
        failed.push({ name: it.name, reason: e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES' ? 'locked' : e.code === 'EEXIST' ? 'exists' : e.code === 'ENOENT' ? 'gone' : 'error' });
      }
    }
    if (done.length) {
      const log = store.read(UNDO, []);
      log.unshift({ id: String(Date.now()), at: Date.now(), entries: done });
      store.write(UNDO, log.slice(0, 10));
    }
    last = null;
    return { ok: done.length > 0, renamed: done.length, failed, batchId: done.length ? store.read(UNDO, [])[0].id : null };
  }

  // 되돌리기: 바꾼 반대 순서(폴더 먼저 → 안쪽)
  async function undo(batchId) {
    const log = store.read(UNDO, []);
    const b = batchId ? log.find((x) => x.id === batchId) : log[0];
    if (!b) return { ok: false };
    let restored = 0; const failed = [];
    for (const e of [...b.entries].reverse()) {
      try {
        if (fs.existsSync(e.from) && e.from.toLowerCase() !== e.to.toLowerCase()) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        fs.renameSync(e.to, e.from); restored++;
      } catch (err) { failed.push({ name: e.newName, reason: err.code === 'EBUSY' || err.code === 'EPERM' ? 'locked' : 'error' }); }
    }
    store.write(UNDO, log.filter((x) => x.id !== b.id));
    return { ok: restored > 0, restored, failed };
  }

  function lastUndo() { const l = store.read(UNDO, []); return l[0] ? { id: l[0].id, at: l[0].at, count: l[0].entries.length } : null; }

  // 점검 현황: 바탕화면·다운로드만 빠르게(두 단계까지)
  function quickCount() {
    const entries = collect([P.desktop, P.downloads].filter((d) => d && platform.exists(d)), { maxDepth: 1, limit: 4000 });
    let fix = 0, warn = 0;
    for (const e of entries) {
      const r = F.fixName(e.name, { isDir: e.isDir });
      if (r.warn) warn++;
      else if (r.name !== e.name && r.sure) fix++;
    }
    return { fix, warn };
  }

  function openFolder(p) { return platform.shell.reveal(String(p)); }

  return { scan, apply, undo, lastUndo, quickCount, openFolder, defaultRoots };
}

module.exports = { createFilenameService, photoDate };
