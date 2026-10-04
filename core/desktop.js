'use strict';
// 바탕화면 정리. 지우지 않고 옮기기만 하며, 항상 되돌릴 수 있다. spec 10장
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARCHIVE = '바탕화면 보관함';
const CATEGORIES = [
  ['한글', ['.hwp', '.hwpx', '.hwt', '.show', '.cell']],
  ['엑셀', ['.xlsx', '.xls', '.xlsm', '.csv']],
  ['파워포인트', ['.pptx', '.ppt', '.ppsx']],
  ['워드', ['.docx', '.doc', '.rtf']],
  ['PDF', ['.pdf']],
  ['사진', ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.heic', '.webp', '.tif', '.tiff']],
  ['영상', ['.mp4', '.mov', '.avi', '.wmv', '.mkv', '.m4v']],
  ['소리', ['.mp3', '.m4a', '.wav', '.wma', '.aac']],
  ['압축', ['.zip', '.7z', '.egg', '.alz', '.rar']],
];
const EXT_CAT = new Map(CATEGORIES.flatMap(([c, exts]) => exts.map((e) => [e, c])));
const NEVER_MOVE = new Set(['.lnk', '.url', '.ini', '.db']);
const ARCHIVE_EXT = new Set(['.zip', '.7z', '.egg', '.alz', '.rar']);

function semesterOf(ms) {
  const d = new Date(ms);
  const y = d.getFullYear(), m = d.getMonth() + 1;
  if (m >= 3 && m <= 8) return `${y}학년도 1학기`;
  if (m >= 9) return `${y}학년도 2학기`;
  return `${y - 1}학년도 2학기`;
}
const categoryOf = (name) => EXT_CAT.get(path.extname(name).toLowerCase()) || '기타';

function folderFor(file, groupBy) {
  const sem = semesterOf(file.mtimeMs);
  const cat = categoryOf(file.name);
  switch (groupBy) {
    case 'type': return [cat];
    case 'semester': return [sem];
    case 'none': return [];
    default: return [sem, cat];
  }
}

function sha1(file) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve(null));
  });
}

function uniquePath(p, taken) {
  if (!fs.existsSync(p) && !taken.has(p.toLowerCase())) return p;
  const ext = path.extname(p), base = p.slice(0, -ext.length || undefined);
  for (let i = 2; i < 1000; i++) {
    const c = `${base} (${i})${ext}`;
    if (!fs.existsSync(c) && !taken.has(c.toLowerCase())) return c;
  }
  return `${base} (${Date.now()})${ext}`;
}

function createDesktopService({ platform, store, scanPrivacy }) {
  const P = platform.paths;
  let lastPlan = null;

  function listDesktop() {
    let ents = [];
    try { ents = fs.readdirSync(P.desktop, { withFileTypes: true }); } catch { return []; }
    const out = [];
    for (const e of ents) {
      if (!e.isFile()) continue;
      if (e.name.startsWith('~$') || e.name.startsWith('.')) continue;
      const p = path.join(P.desktop, e.name);
      const attr = platform.fileAttributes(p) || 0;
      if (attr & 0x6) continue; // 숨김·시스템
      let st; try { st = fs.statSync(p); } catch { continue; }
      out.push({ path: p, name: e.name, size: st.size, mtimeMs: st.mtimeMs });
    }
    return out;
  }

  function quickStatus() {
    const files = listDesktop();
    const months = store.settings.get().desktop.olderThanMonths || 3;
    const cutoff = Date.now() - months * 30 * 86400000;
    const movable = files.filter((f) => !NEVER_MOVE.has(path.extname(f.name).toLowerCase()));
    return { total: files.length, old: movable.filter((f) => f.mtimeMs < cutoff).length, months };
  }

  async function findExtras(files, finds) {
    const out = { installers: [], extracted: [], duplicates: [], broken: [] };
    if (finds.installers) {
      for (const f of files) {
        const ext = path.extname(f.name).toLowerCase();
        if ((ext === '.exe' || ext === '.msi') && /setup|install|설치|installer|_inst|update/i.test(f.name)) {
          out.installers.push({ path: f.path, name: f.name, size: f.size, reason: '이미 설치에 쓴 설치파일로 보여요' });
        }
      }
      for (const f of files) {
        const ext = path.extname(f.name).toLowerCase();
        if (!ARCHIVE_EXT.has(ext)) continue;
        const dir = path.join(P.desktop, path.basename(f.name, path.extname(f.name)));
        try { if (fs.statSync(dir).isDirectory()) out.extracted.push({ path: f.path, name: f.name, size: f.size, reason: '이미 압축을 푼 폴더가 있어요' }); } catch { /* none */ }
      }
    }
    if (finds.duplicates) {
      const bySize = new Map();
      for (const f of files) {
        if (f.size === 0 || f.size > 500 * 1024 * 1024 || NEVER_MOVE.has(path.extname(f.name).toLowerCase())) continue;
        if (!bySize.has(f.size)) bySize.set(f.size, []);
        bySize.get(f.size).push(f);
      }
      for (const group of bySize.values()) {
        if (group.length < 2) continue;
        const byHash = new Map();
        for (const f of group) {
          const h = await sha1(f.path);
          if (!h) continue;
          if (!byHash.has(h)) byHash.set(h, []);
          byHash.get(h).push(f);
        }
        for (const same of byHash.values()) {
          if (same.length < 2) continue;
          // 이름에 복사본 표시가 없는 것을 남기고, 그다음은 최근 것을 남긴다.
          const copyMark = (n) => (/(복사본|사본|\(\d+\)|[ _-]copy\b|copy of)/i.test(n) ? 1 : 0);
          same.sort((a, b) => copyMark(a.name) - copyMark(b.name) || b.mtimeMs - a.mtimeMs);
          const keep = same[0];
          for (const d of same.slice(1)) out.duplicates.push({ path: d.path, name: d.name, size: d.size, reason: `'${keep.name}'과 내용이 똑같아요` });
        }
      }
    }
    if (finds.brokenShortcuts) {
      for (const f of files) {
        if (path.extname(f.name).toLowerCase() !== '.lnk') continue;
        const link = platform.shell.readShortcut(f.path);
        if (!link || !link.target) continue;
        const t = link.target;
        if (t.startsWith('\\\\') || /^[a-z]+:\/\//i.test(t)) continue; // 네트워크 경로는 판단하지 않음
        if (!path.isAbsolute(t)) continue;
        if (!platform.exists(t)) out.broken.push({ path: f.path, name: f.name, size: f.size, reason: '연결된 프로그램이나 파일이 없어요' });
      }
    }
    return out;
  }

  async function plan(options = {}, onProgress = () => {}) {
    const s = store.settings.get().desktop;
    const opt = { ...s, ...options, finds: { ...s.finds, ...(options.finds || {}) } };
    store.settings.set({ desktop: opt });
    const files = listDesktop();
    const cutoff = Date.now() - (opt.olderThanMonths || 3) * 30 * 86400000;
    onProgress({ phase: 'files' });
    const extras = await findExtras(files, opt.finds);

    let privacy = new Map();
    if (opt.finds.privacy) {
      onProgress({ phase: 'privacy' });
      privacy = await scanPrivacy([P.desktop]);
    }

    const archiveRoot = path.join(P.desktop, ARCHIVE);
    const taken = new Set();
    const moves = [];
    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if (NEVER_MOVE.has(ext)) continue;
      if (opt.scope === 'old' && f.mtimeMs >= cutoff) continue;
      const folders = folderFor(f, opt.groupBy);
      const to = uniquePath(path.join(archiveRoot, ...folders, f.name), taken);
      taken.add(to.toLowerCase());
      const pv = privacy.get(f.path);
      moves.push({ from: f.path, to, name: f.name, folders, privacy: pv ? pv.level : 0, privacyCounts: pv ? pv.counts : null });
    }

    // 나무 모양 미리보기
    const tree = new Map();
    for (const m of moves) {
      const top = m.folders[0] || ARCHIVE;
      const sub = m.folders[1] || null;
      if (!tree.has(top)) tree.set(top, { label: top, count: 0, privacy: 0, children: new Map() });
      const node = tree.get(top);
      node.count++;
      if (m.privacy) node.privacy++;
      if (sub) {
        if (!node.children.has(sub)) node.children.set(sub, { label: sub, count: 0, privacy: 0 });
        const c = node.children.get(sub); c.count++; if (m.privacy) c.privacy++;
      }
    }
    const treeOut = [...tree.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true }))
      .map((n) => ({ label: n.label, count: n.count, privacy: n.privacy, children: [...n.children.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko')) }));

    const privacyOnDesktop = files.filter((f) => privacy.has(f.path)).map((f) => ({ path: f.path, name: f.name, size: f.size, level: privacy.get(f.path).level, counts: privacy.get(f.path).counts }));

    lastPlan = { id: String(Date.now()), options: opt, moves, extras, createdAt: Date.now() };
    return {
      id: lastPlan.id,
      options: opt,
      total: files.length,
      moveCount: moves.length,
      keepCount: files.length - moves.length,
      moves: moves.map((m) => ({ from: m.from, name: m.name, folder: [ARCHIVE, ...m.folders].join(' › '), privacy: m.privacy })),
      tree: treeOut,
      extras,
      privacy: privacyOnDesktop,
    };
  }

  async function moveFile(from, to) {
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    try { await fs.promises.rename(from, to); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fs.promises.copyFile(from, to);
      await fs.promises.unlink(from);
    }
  }

  async function apply({ planId, deletePaths = [] }) {
    if (!lastPlan || lastPlan.id !== planId) return { ok: false, code: 'stale' };
    const extrasPaths = new Set(Object.values(lastPlan.extras).flat().map((x) => x.path));
    const toDelete = deletePaths.filter((p) => extrasPaths.has(p));
    const delSet = new Set(toDelete);
    const log = { id: String(Date.now()), at: Date.now(), moves: [], trashed: [], failed: [] };
    for (const p of toDelete) {
      try { await platform.shell.trash(p); log.trashed.push(p); } catch { log.failed.push({ path: p, op: 'trash' }); }
    }
    for (const m of lastPlan.moves) {
      if (delSet.has(m.from)) continue;
      try { await moveFile(m.from, m.to); log.moves.push({ from: m.from, to: m.to }); } catch (e) {
        log.failed.push({ path: m.from, op: 'move', reason: e && (e.code === 'EBUSY' || e.code === 'EPERM') ? 'locked' : 'error' });
      }
    }
    store.write(path.join('desktop-undo', `${log.id}.json`), log);
    lastPlan = null;
    return { ok: true, logId: log.id, moved: log.moves.length, trashed: log.trashed.length, failed: log.failed.length, failedItems: log.failed.map((f) => ({ name: path.basename(f.path), reason: f.reason || 'error' })) };
  }

  function history() {
    return store.list('desktop-undo').filter((f) => f.endsWith('.json')).reverse().map((f) => {
      const l = store.read(path.join('desktop-undo', f), null);
      return l ? { id: l.id, at: l.at, moved: l.moves.length, trashed: l.trashed.length, undone: !!l.undoneAt } : null;
    }).filter(Boolean);
  }

  function removeEmptyDirs(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
    try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* not empty */ }
  }

  async function undo(logId) {
    const h = history().filter((x) => !x.undone);
    const id = logId || (h[0] && h[0].id);
    if (!id) return { ok: false };
    const rel = path.join('desktop-undo', `${id}.json`);
    const log = store.read(rel, null);
    if (!log || log.undoneAt) return { ok: false };
    let restored = 0, skipped = 0;
    for (const m of [...log.moves].reverse()) {
      try {
        if (!fs.existsSync(m.to) || fs.existsSync(m.from)) { skipped++; continue; }
        await moveFile(m.to, m.from);
        restored++;
      } catch { skipped++; }
    }
    removeEmptyDirs(path.join(P.desktop, ARCHIVE));
    log.undoneAt = Date.now();
    store.write(rel, log);
    return { ok: true, restored, skipped, trashed: log.trashed.length };
  }

  return { quickStatus, plan, apply, undo, history, ARCHIVE };
}

module.exports = { createDesktopService, semesterOf, categoryOf };
