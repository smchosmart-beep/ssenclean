'use strict';
// 바탕화면 정리. 지우지 않고 옮기기만 하며, 항상 되돌릴 수 있다. spec 10장
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARCHIVE = '바탕화면 보관함';
const TOPICS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'desktop-topics.json'), 'utf8'));
const GROUPS = ['year-topic', 'topic', 'type'];
const KEEP_DAYS = [7, 14, 30, 90];
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
// 학년도: 3월 ~ 다음 해 2월
function schoolYearOf(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1}학년도`;
}
const categoryOf = (name) => EXT_CAT.get(path.extname(name).toLowerCase()) || '기타';

// 하는 일: 파일 이름에 들어 있는 가장 긴 낱말의 폴더(같으면 목록 위쪽). 낱말 없는 사진·영상은 '사진·영상'
function topicOf(name) {
  const low = path.basename(name, path.extname(name)).toLowerCase().replace(/\s+/g, '');
  let best = null;
  TOPICS.topics.forEach((t, i) => {
    for (const w of t.words) {
      const k = w.toLowerCase().replace(/\s+/g, '');
      if (low.includes(k) && (!best || k.length > best.len || (k.length === best.len && i < best.i))) best = { name: t.name, len: k.length, i };
    }
  });
  if (best) return best.name;
  const cat = categoryOf(name);
  return cat === '사진' || cat === '영상' ? TOPICS.media : TOPICS.other;
}

// 비슷한 이름 묶음 키: 번호·(수정)·최종·복사본·날짜·버전을 떼어 낸 이름
function similarBase(name) {
  let b = path.basename(name, path.extname(name));
  const strip = [
    /[\s_\-.]*\(\s*\d+\s*\)$/, /[\s_\-.]*\((수정|최종|복사본|사본)[^)]*\)$/, /[\s_\-.]*(최종|수정본|수정|복사본|사본|copy|final|ver\.?\s*\d+|v\d+)$/i,
    /[\s_\-.]*\d{6}$/, /[\s_\-.]*\d{4}[.\-_]?\d{2}[.\-_]?\d{2}$/, /[\s_\-.]*\d{2}[.\-_]\d{2}[.\-_]\d{2}$/, /[\s_\-.]+\d{1,3}$/, /[\s_\-.]*\d{1,2}(차|회|번)$/,
  ];
  for (let i = 0; i < 6; i++) { const before = b; for (const re of strip) b = b.replace(re, ''); if (b === before) break; }
  return b.trim();
}

function normalizeOpts(o) {
  const out = { ...o };
  if (!GROUPS.includes(out.groupBy)) out.groupBy = 'year-topic'; // 예전 '학기별' 등은 추천으로
  if (out.scope !== 'all') out.scope = 'recent';
  if (!KEEP_DAYS.includes(Number(out.keepDays))) out.keepDays = 14;
  out.keepDays = Number(out.keepDays);
  return out;
}

function folderFor(file, groupBy) {
  switch (groupBy) {
    case 'type': return [categoryOf(file.name)];
    case 'topic': return [topicOf(file.name)];
    default: return [schoolYearOf(file.mtimeMs), topicOf(file.name)];
  }
}

const cleanName = (n) => String(n || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

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
    const opt = normalizeOpts(store.settings.get().desktop);
    const cutoff = Date.now() - opt.keepDays * 86400000;
    const movable = files.filter((f) => !NEVER_MOVE.has(path.extname(f.name).toLowerCase()));
    return { total: files.length, old: movable.filter((f) => f.mtimeMs < cutoff).length, keepDays: opt.keepDays };
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
    const opt = normalizeOpts({ ...s, ...options, finds: { ...s.finds, ...(options.finds || {}) } });
    store.settings.set({ desktop: opt });
    const files = listDesktop();
    const cutoff = Date.now() - opt.keepDays * 86400000;
    onProgress({ phase: 'files' });
    const extras = await findExtras(files, opt.finds);

    let privacy = new Map();
    if (opt.finds.privacy) {
      onProgress({ phase: 'privacy' });
      privacy = await scanPrivacy([P.desktop]);
    }

    const moves = [];
    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if (NEVER_MOVE.has(ext)) continue;
      if (opt.scope === 'recent' && f.mtimeMs >= cutoff) continue;
      const pv = privacy.get(f.path);
      moves.push({ id: String(moves.length), from: f.path, name: f.name, folders: folderFor(f, opt.groupBy), privacy: pv ? pv.level : 0, privacyCounts: pv ? pv.counts : null });
    }
    // 비슷한 이름 3개 이상이면 그 이름의 폴더로 한 번 더 묶는다
    const groups = new Map();
    for (const m of moves) {
      const base = similarBase(m.name);
      if (!base) continue;
      const k = `${m.folders.join('/')}|${base.toLowerCase()}`;
      if (!groups.has(k)) groups.set(k, { base, list: [] });
      groups.get(k).list.push(m);
    }
    for (const g of groups.values()) if (g.list.length >= 3) g.list.forEach((m) => { m.folders = [...m.folders, cleanName(g.base)]; m.similar = true; });

    lastPlan = { id: String(Date.now()), options: opt, moves, extras, createdAt: Date.now() };
    const privacyOnDesktop = files.filter((f) => privacy.has(f.path)).map((f) => ({ path: f.path, name: f.name, size: f.size, level: privacy.get(f.path).level, counts: privacy.get(f.path).counts }));
    return {
      id: lastPlan.id,
      options: opt,
      total: files.length,
      moveCount: moves.length,
      keepCount: files.length - moves.length,
      moves: moves.map((m) => ({ id: m.id, from: m.from, name: m.name, folders: m.folders, folder: [ARCHIVE, ...m.folders].join(' › '), privacy: m.privacy, similar: !!m.similar })),
      tree: buildTree(moves.map((m) => ({ ...m, folders: m.folders }))),
      extras,
      privacy: privacyOnDesktop,
    };
  }

  // 미리보기 나무: [{ path:'2026학년도/수업', label, count, privacy, children:[…], files:[{id,name,privacy}] }]
  function buildTree(moves) {
    const root = { children: new Map(), files: [] };
    for (const m of moves) {
      let node = root;
      const acc = [];
      for (const seg of m.folders) {
        acc.push(seg);
        if (!node.children.has(seg)) node.children.set(seg, { path: acc.join('/'), label: seg, count: 0, privacy: 0, children: new Map(), files: [] });
        node = node.children.get(seg);
        node.count++;
        if (m.privacy) node.privacy++;
      }
      node.files.push({ id: m.id, name: m.name, privacy: m.privacy });
    }
    const out = (n) => [...n.children.values()].sort((a, b) => b.label.localeCompare(a.label, 'ko', { numeric: true }) * (/학년도$/.test(a.label) ? 1 : -1))
      .map((c) => ({ path: c.path, label: c.label, count: c.count, privacy: c.privacy, children: out(c), files: c.files }));
    return { children: out(root), files: root.files };
  }

  async function moveFile(from, to) {
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    try { await fs.promises.rename(from, to); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fs.promises.copyFile(from, to);
      await fs.promises.unlink(from);
    }
  }

  // overrides: { [moveId]: { keep:true } | { folder:'2026학년도/수업' } }, renames: { '2026학년도/기타': '방과후' }
  function finalFolders(m, overrides, renames) {
    const o = overrides[m.id];
    let folders = o && typeof o.folder === 'string' ? o.folder.split('/').map(cleanName).filter(Boolean) : [...m.folders];
    // 깊은 경로부터 이름 바꾸기 적용
    const keys = Object.keys(renames).sort((a, b) => b.split('/').length - a.split('/').length);
    for (const k of keys) {
      const segs = k.split('/');
      const name = cleanName(renames[k]);
      if (!name) continue;
      if (segs.length <= folders.length && segs.every((x, i) => folders[i] === x)) folders[segs.length - 1] = name;
    }
    return folders;
  }

  async function apply({ planId, deletePaths = [], overrides = {}, renames = {} }) {
    if (!lastPlan || lastPlan.id !== planId) return { ok: false, code: 'stale' };
    const extrasPaths = new Set(Object.values(lastPlan.extras).flat().map((x) => x.path));
    const toDelete = deletePaths.filter((p) => extrasPaths.has(p));
    const delSet = new Set(toDelete);
    const log = { id: String(Date.now()), at: Date.now(), moves: [], trashed: [], failed: [] };
    for (const p of toDelete) {
      try { await platform.shell.trash(p); log.trashed.push(p); } catch { log.failed.push({ path: p, op: 'trash' }); }
    }
    const archiveRoot = path.join(P.desktop, ARCHIVE);
    const taken = new Set();
    let kept = 0;
    for (const m of lastPlan.moves) {
      if (delSet.has(m.from)) continue;
      if (overrides[m.id] && overrides[m.id].keep) { kept++; continue; }
      const to = uniquePath(path.join(archiveRoot, ...finalFolders(m, overrides || {}, renames || {}), m.name), taken);
      taken.add(to.toLowerCase());
      try { await moveFile(m.from, to); log.moves.push({ from: m.from, to }); } catch (e) {
        log.failed.push({ path: m.from, op: 'move', reason: e && (e.code === 'EBUSY' || e.code === 'EPERM') ? 'locked' : 'error' });
      }
    }
    store.write(path.join('desktop-undo', `${log.id}.json`), log);
    lastPlan = null;
    return { ok: true, logId: log.id, moved: log.moves.length, kept, trashed: log.trashed.length, failed: log.failed.length, failedItems: log.failed.map((f) => ({ name: path.basename(f.path), reason: f.reason || 'error' })) };
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

module.exports = { createDesktopService, semesterOf, schoolYearOf, categoryOf, topicOf, similarBase };
