'use strict';
// C드라이브 정리. C드라이브의 큰 동영상·설치파일을 찾아 지우거나(휴지통) 다른 드라이브로 옮긴다.
// 옮기기는 항상 되돌릴 수 있고, 바탕화면에 '○드라이브로 옮긴 파일' 폴더 바로가기를 하나만 만든다.
const fs = require('fs');
const path = require('path');

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.ts', '.mts', '.m2ts', '.flv', '.webm', '.mpg', '.mpeg', '.3gp', '.asf', '.vob']);
const PACKAGE_EXT = new Set(['.iso', '.msi', '.msix', '.msixbundle', '.appx', '.appxbundle']);
const SETUP_NAME = /setup|install|설치|_inst\b|update|업데이트|patch|패치/i;
const MIN_VIDEO = 50 * MB;
const MIN_INSTALLER = 5 * MB;
const MOVE_ROOT = 'C드라이브에서 옮긴 파일';
// C:\ 바로 아래에서 건너뛰는 폴더(Windows·프로그램·시스템 영역)
const SKIP_TOP = new Set(['windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', '$winreagent', '$windows.~bt', '$windows.~ws', 'system volume information',
  'recovery', 'perflogs', 'msocache', 'config.msi', 'windows.old', 'intel', 'amd', 'nvidia', 'drivers', 'onedrivetemp', 'boot', 'efi', 'documents and settings', '_trash']);
const SKIP_USERS = new Set(['default', 'default user', 'all users', 'defaultapppool']);
const SKIP_ANY = new Set(['appdata', 'node_modules', '.git']);

function levelOf(d) {
  if (!d || !d.total) return 'unknown';
  const pct = (d.free / d.total) * 100;
  if (pct < 10 || d.free < 10 * GB) return 'danger';
  if (pct < 15 || d.free < 20 * GB) return 'warn';
  return 'ok';
}

// 같은 파일 묶음 키: 이름 끝의 (1)·복사본 표시를 떼고 크기까지 같으면 같은 파일로 본다
function dupKey(name, size) {
  const ext = path.extname(name).toLowerCase();
  const base = name.slice(0, name.length - ext.length).replace(/\s*(\(\d+\)|- 복사본|복사본|사본|copy)$/i, '').trim().toLowerCase();
  return `${base}${ext}|${size}`;
}

// 파일 내용 지문: 256MB 이하는 전체, 그보다 크면 앞·중간·끝 1MB씩(+크기). 큰 파일 전체 비교는 너무 오래 걸린다
async function contentHash(file, size) {
  const crypto = require('crypto');
  const h = crypto.createHash('sha1');
  h.update(String(size));
  try {
    if (size <= 256 * MB) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(file, { highWaterMark: 4 * MB }).on('data', (d) => h.update(d)).on('end', resolve).on('error', reject);
      });
    } else {
      const fd = await fs.promises.open(file, 'r');
      try {
        const buf = Buffer.alloc(MB);
        for (const pos of [0, Math.floor(size / 2), size - MB]) {
          const { bytesRead } = await fd.read(buf, 0, MB, pos);
          h.update(buf.subarray(0, bytesRead));
        }
      } finally { await fd.close(); }
    }
    return h.digest('hex');
  } catch { return null; }
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), base = p.slice(0, p.length - ext.length);
  for (let i = 2; i < 1000; i++) { const c = `${base} (${i})${ext}`; if (!fs.existsSync(c)) return c; }
  return `${base} (${Date.now()})${ext}`;
}

function createCdriveService({ platform, store, emit = () => {} }) {
  const P = platform.paths;
  const sysRoot = P.systemDrive;
  const home = P.home;
  let results = [];
  let scanning = null;
  let stopFlag = false;
  let moveStop = false;

  const disks = () => { try { return platform.disks() || []; } catch { return []; } };
  const isSys = (d) => path.resolve(d.root).toLowerCase() === path.resolve(sysRoot).toLowerCase();

  // 사람이 읽기 쉬운 위치: 바탕화면 › 수업자료 / 다운로드 / C:\자료
  const KNOWN = () => [
    [P.desktop, '바탕화면'], [P.documents, '문서'], [P.downloads, '다운로드'],
    [path.join(home, 'Videos'), '내 동영상'], [path.join(home, 'Pictures'), '내 사진'], [path.join(home, 'Music'), '내 음악'],
    [path.join(home, 'OneDrive'), 'OneDrive'], [home, '내 폴더'],
  ];
  function placeOf(file) {
    const dir = path.dirname(file);
    for (const [base, label] of KNOWN()) {
      const rel = path.relative(base, dir);
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return [label, ...rel.split(/[\\/]/).filter(Boolean)];
    }
    const rel = path.relative(sysRoot, dir);
    return ['C드라이브', ...rel.split(/[\\/]/).filter(Boolean)];
  }

  function classify(file, size, inDownloads) {
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file);
    if (VIDEO_EXT.has(ext)) return size >= MIN_VIDEO ? 'video' : null;
    if (size < MIN_INSTALLER) return null;
    if (PACKAGE_EXT.has(ext)) return 'installer';
    if (ext === '.exe' && (SETUP_NAME.test(name) || inDownloads)) return 'installer';
    return null;
  }

  function status() {
    const list = disks();
    const sys = list.find(isSys) || null;
    const others = list.filter((d) => !isSys(d)).map((d) => ({ ...d, name: `${d.letter}드라이브` }));
    const recycle = recycleStatus(list);
    const hist = history();
    const prefs = store.read('cdrive-prefs.json', {});
    const fixed = others.filter((d) => !d.removable).sort((a, b) => b.free - a.free);
    return {
      prefs: { sort: prefs.sort || 'old', target: prefs.target || null, whySeen: !!prefs.whySeen, desktopLink: prefs.desktopLink !== false },
      recommended: fixed.length ? fixed[0].letter : (others[0] ? others[0].letter : null),
      lastScan: store.read('cdrive-last.json', null),
      system: sys ? { ...sys, name: `${sys.letter}드라이브`, level: levelOf(sys), freePct: Math.round((sys.free / sys.total) * 100) } : null,
      others,
      recycle,
      last: hist.find((x) => !x.undone) || null,
      scanning: !!scanning,
    };
  }

  async function scan() {
    if (scanning) return scanning;
    stopFlag = false;
    const found = [];
    const prog = { dirs: 0, files: 0, found: 0, current: '' };
    let lastEmit = 0;
    const tick = (force) => {
      const now = Date.now();
      if (!force && now - lastEmit < 200) return;
      lastEmit = now;
      emit('cdrive:event', { type: 'progress', ...prog });
    };
    const downloads = path.resolve(P.downloads).toLowerCase();
    const usersDir = path.resolve(path.dirname(home)).toLowerCase();
    const otherRoots = new Set(disks().filter((d) => !isSys(d)).map((d) => path.resolve(d.root).toLowerCase()));

    async function walk(dir, depth) {
      if (stopFlag) return;
      let ents;
      try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      prog.dirs++;
      prog.current = dir;
      tick();
      const lowDir = path.resolve(dir).toLowerCase();
      for (const e of ents) {
        if (stopFlag) return;
        const name = e.name;
        const low = name.toLowerCase();
        const p = path.join(dir, name);
        const ext = path.extname(low);
        const wanted = VIDEO_EXT.has(ext) || PACKAGE_EXT.has(ext) || ext === '.exe';
        let isFile = e.isFile();
        if (e.isSymbolicLink()) {
          if (!wanted) continue;
          // 연결 폴더(정션)는 따라가지 않는다. OneDrive 파일처럼 재분석 지점인 '파일'은 검사한다.
          try { isFile = (await fs.promises.stat(p)).isFile(); } catch { continue; }
          if (!isFile) continue;
        } else if (e.isDirectory()) {
          if (otherRoots.has(path.resolve(p).toLowerCase())) continue;
          if (depth === 0 && (SKIP_TOP.has(low) || low.startsWith('$'))) continue;
          if (lowDir === usersDir && SKIP_USERS.has(low)) continue;
          if (SKIP_ANY.has(low) || low.startsWith('.')) continue;
          await walk(p, depth + 1);
          continue;
        }
        if (!isFile) continue;
        prog.files++;
        if (!wanted) continue;
        let st;
        try { st = await fs.promises.stat(p); } catch { continue; }
        const inDl = (lowDir + path.sep).startsWith(downloads + path.sep) || lowDir === downloads;
        const kind = classify(p, st.size, inDl);
        if (!kind) continue;
        const attr = platform.fileAttributes(p) || 0;
        if (attr & (0x4 | 0x1000 | 0x40000 | 0x400000)) continue; // 시스템 파일, 클라우드에만 있는 파일
        found.push({ path: p, name, size: st.size, mtimeMs: st.mtimeMs, kind, place: placeOf(p).join(' › ') });
        prog.found = found.length;
      }
    }

    scanning = (async () => {
      emit('cdrive:event', { type: 'start' });
      await walk(sysRoot, 0);
      found.sort((a, b) => b.size - a.size);
      // 같은 파일: 이름·크기가 같은 후보끼리 내용까지 비교해서 같을 때만 표시
      const groups = new Map();
      for (const f of found) { const k = dupKey(f.name, f.size); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
      const cands = [...groups.values()].filter((g) => g.length > 1);
      if (cands.length && !stopFlag) {
        emit('cdrive:event', { type: 'progress', ...prog, phase: 'dup' });
        for (const g of cands) {
          const byHash = new Map();
          for (const f of g) {
            if (stopFlag) break;
            const h = await contentHash(f.path, f.size);
            if (!h) continue;
            if (!byHash.has(h)) byHash.set(h, []);
            byHash.get(h).push(f);
          }
          for (const same of byHash.values()) if (same.length > 1) same.forEach((f) => { f.dup = same.length; });
        }
      }
      results = found;
      const summary = { at: Date.now(), count: found.length, bytes: found.reduce((n, f) => n + f.size, 0), stopped: stopFlag };
      store.write('cdrive-last.json', summary);
      tick(true);
      emit('cdrive:event', { type: 'done', ...summary });
      scanning = null;
      return { results, summary };
    })();
    return scanning;
  }

  function stop() { stopFlag = true; moveStop = true; return true; }

  const known = (paths) => {
    const set = new Map(results.map((r) => [r.path, r]));
    return (paths || []).map((p) => set.get(p)).filter(Boolean);
  };

  async function copyWithProgress(from, to, size, onBytes) {
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(from, { highWaterMark: 4 * MB });
      const ws = fs.createWriteStream(to, { flags: 'wx' });
      let done = 0;
      rs.on('data', (chunk) => {
        if (moveStop) { rs.destroy(Object.assign(new Error('stopped'), { code: 'STOPPED' })); return; }
        done += chunk.length; onBytes(done, size);
      });
      rs.on('error', (e) => { ws.destroy(); reject(e); });
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(ws);
    });
  }

  async function moveOne(item, dest, onBytes) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.promises.rename(item.path, dest);
      onBytes(item.size, item.size);
      return;
    } catch (e) { if (e.code !== 'EXDEV') throw e; }
    try {
      await copyWithProgress(item.path, dest, item.size, onBytes);
      const st = await fs.promises.stat(dest);
      if (st.size !== item.size) throw Object.assign(new Error('size mismatch'), { code: 'VERIFY' });
      const src = await fs.promises.stat(item.path);
      await fs.promises.utimes(dest, src.atime, src.mtime);
      await fs.promises.unlink(item.path); // 열려 있으면 여기서 실패한다
    } catch (e) {
      try { await fs.promises.unlink(dest); } catch { /* none */ }
      throw e;
    }
  }

  function savePrefs(patch) { store.update('cdrive-prefs.json', {}, (p) => ({ ...p, ...patch })); return true; }

  const linkPath = (letter) => path.join(P.desktop, `${letter}드라이브로 옮긴 파일.lnk`);
  // 바탕화면에 옮긴 파일 폴더 바로가기를 하나만 만든다(이미 있으면 그대로)
  function ensureDesktopLink(disk) {
    const lp = linkPath(disk.letter);
    if (fs.existsSync(lp)) return lp;
    try {
      return platform.shell.writeShortcut(lp, 'create', { target: path.join(disk.root, MOVE_ROOT), description: `C드라이브에서 ${disk.letter}드라이브로 옮긴 파일` }) ? lp : null;
    } catch { return null; }
  }
  function countFiles(dir) {
    let n = 0;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
    for (const e of ents) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
    return n;
  }
  function removeEmptyDirs(dir) {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
    try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* not empty */ }
  }

  async function move({ paths, target, desktopLink = true } = {}) {
    const items = known(paths);
    const disk = disks().find((d) => d.letter === target && !isSys(d));
    if (!items.length || !disk) return { ok: false, code: 'bad-request' };
    const need = items.reduce((n, f) => n + f.size, 0);
    if (disk.free < need + 200 * MB) return { ok: false, code: 'no-space', need, free: disk.free };
    moveStop = false;
    const base = path.join(disk.root, MOVE_ROOT);
    const log = { id: String(Date.now()), at: Date.now(), target: disk.letter, folder: base, moves: [], failed: [] };
    let doneBytes = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (moveStop) { log.failed.push({ path: it.path, name: it.name, reason: 'stopped' }); continue; }
      const dest = uniquePath(path.join(base, ...placeOf(it.path), it.name));
      let lastPct = -1;
      try {
        await moveOne(it, dest, (b, total) => {
          const pct = Math.floor(((doneBytes + b) / need) * 100);
          if (pct !== lastPct) { lastPct = pct; emit('cdrive:event', { type: 'move', index: i + 1, total: items.length, name: it.name, percent: pct }); }
        });
        doneBytes += it.size;
        log.moves.push({ from: it.path, to: dest, size: it.size });
        results = results.filter((r) => r.path !== it.path);
      } catch (e) {
        const reason = e && e.code === 'STOPPED' ? 'stopped' : e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') ? 'locked' : e && e.code === 'ENOSPC' ? 'no-space' : 'error';
        log.failed.push({ path: it.path, name: it.name, reason });
      }
    }
    let link = null;
    if (log.moves.length) {
      if (desktopLink) link = ensureDesktopLink(disk);
      log.desktopLink = link;
      store.write(path.join('cdrive-undo', `${log.id}.json`), log);
    }
    savePrefs({ target: disk.letter, desktopLink: !!desktopLink });
    return {
      link: link ? path.basename(link, '.lnk') : null,
      ok: true, logId: log.moves.length ? log.id : null, target: disk.letter, folder: base,
      moved: log.moves.length, bytes: log.moves.reduce((n, m) => n + m.size, 0),
      failed: log.failed.map((f) => ({ name: f.name, reason: f.reason })),
    };
  }

  async function remove({ paths } = {}) {
    const out = [];
    for (const it of known(paths)) {
      try { await platform.shell.trash(it.path); out.push({ path: it.path, ok: true, size: it.size }); results = results.filter((r) => r.path !== it.path); } catch { out.push({ path: it.path, name: it.name, ok: false }); }
    }
    return out;
  }

  // 휴지통: Windows처럼 모든 드라이브 휴지통을 합쳐 보여 주고, 비울 때도 모두 비운다.
  function recycleStatus(list = disks()) {
    const drives = [];
    for (const d of list) {
      let q = null;
      try { q = platform.recycleBin.query(d.root); } catch { q = null; }
      if (q) drives.push({ letter: d.letter, size: q.size, count: q.count, system: isSys(d) });
    }
    if (!drives.length) {
      let q = null; try { q = platform.recycleBin.query(sysRoot); } catch { q = null; }
      if (!q) return null;
      drives.push({ letter: 'C', size: q.size, count: q.count, system: true });
    }
    const size = drives.reduce((n, d) => n + d.size, 0);
    const count = drives.reduce((n, d) => n + d.count, 0);
    const c = drives.find((d) => d.system);
    return { size, count, cSize: c ? c.size : 0, drives: drives.filter((d) => d.count > 0 || d.size > 0) };
  }

  function emptyRecycle() {
    const before = recycleStatus();
    let ok = false;
    try { ok = platform.recycleBin.empty(null); } catch { ok = false; }
    const after = recycleStatus();
    const left = after ? after.count : null;
    return { ok: ok && left === 0, partial: ok && left > 0, left, freed: before && after ? Math.max(0, before.size - after.size) : null };
  }

  function history() {
    return store.list('cdrive-undo').filter((f) => f.endsWith('.json')).reverse().map((f) => {
      const l = store.read(path.join('cdrive-undo', f), null);
      return l ? { id: l.id, at: l.at, target: l.target, folder: l.folder, moved: l.moves.length, bytes: l.moves.reduce((n, m) => n + m.size, 0), undone: !!l.undoneAt } : null;
    }).filter(Boolean);
  }

  async function undo(logId) {
    const id = logId || (history().find((x) => !x.undone) || {}).id;
    if (!id) return { ok: false };
    const rel = path.join('cdrive-undo', `${id}.json`);
    const log = store.read(rel, null);
    if (!log || log.undoneAt) return { ok: false };
    const need = log.moves.reduce((n, m) => n + m.size, 0);
    const sys = disks().find(isSys);
    if (sys && sys.free < need + 500 * MB) return { ok: false, code: 'no-space', need, free: sys.free };
    moveStop = false;
    let restored = 0, skipped = 0;
    for (const m of [...log.moves].reverse()) {
      try {
        if (!fs.existsSync(m.to) || fs.existsSync(m.from)) { skipped++; continue; }
        if (m.link) { try { await fs.promises.unlink(m.link); } catch { /* 이미 지움 */ } }
        await moveOne({ path: m.to, size: m.size, name: path.basename(m.to) }, m.from, () => {});
        restored++;
      } catch { skipped++; }
    }
    log.undoneAt = Date.now();
    store.write(rel, log);
    // 그 드라이브에 옮긴 파일이 하나도 남지 않으면 빈 폴더와 바탕화면 바로가기도 지운다
    const disk = disks().find((d) => d.letter === log.target);
    if (disk) {
      const root = path.join(disk.root, MOVE_ROOT);
      removeEmptyDirs(root);
      if (!countFiles(root)) { try { fs.unlinkSync(linkPath(disk.letter)); } catch { /* none */ } }
    }
    return { ok: true, restored, skipped };
  }

  function openFolder(letter) {
    const d = letter ? disks().find((x) => x.letter === letter) : null;
    const p = d ? path.join(d.root, MOVE_ROOT) : null;
    if (p && fs.existsSync(p)) { platform.shell.openPath(p); return true; }
    return false;
  }

  function reveal(p) {
    if (!known([p]).length) return false;
    platform.shell.reveal(p);
    return true;
  }

  return { savePrefs, status, scan, stop, results: () => results, move, remove, emptyRecycle, history, undo, openFolder, reveal, levelOf, MOVE_ROOT };
}

module.exports = { createCdriveService, levelOf, MOVE_ROOT };
