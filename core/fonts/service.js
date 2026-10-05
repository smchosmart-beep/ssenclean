'use strict';
// 폰트 메뉴 서비스. 내 계정 폰트는 바로, 이 PC 전체에 설치된 폰트는 Windows 확인 창([예])을 거쳐 정리한다. spec 5장
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readFontInfo } = require('./fontinfo');
const { compile, classify } = require('./classify');

const USER_FONTS_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';
const SYS_FONTS_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';
const FONT_EXT = new Set(['.ttf', '.otf', '.ttc', '.otc']);
const APPS_USING_FONTS = { 'hwp.exe': '한글', 'hcell.exe': '한셀', 'hshow.exe': '한쇼', 'winword.exe': '워드', 'excel.exe': '엑셀', 'powerpnt.exe': '파워포인트', 'photoshop.exe': '포토샵', 'illustrator.exe': '일러스트레이터' };

function createFontService({ platform, store, dataDir, assetsDir }) {
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'font-db.json'), 'utf8'));
  const cdb = compile(db);
  const P = platform.paths;
  let lastList = new Map(); // id -> item (미리보기·정리에 사용)

  // ── 폰트 보관함: 정리한 폰트 파일을 사용자가 찾을 수 있는 곳(D드라이브 등)에 날짜별로 모아 둔다 ──
  const ARCHIVE_NAME = '쎈Clean 폰트 보관함';
  function archiveRoot() {
    let disks = [];
    try { disks = platform.disks ? platform.disks() || [] : []; } catch { disks = []; }
    const sys = path.resolve(P.systemDrive || 'C:\\').toLowerCase();
    const others = disks.filter((d) => !d.removable && path.resolve(d.root).toLowerCase() !== sys);
    const pref = (store.read('cdrive-prefs.json', {}) || {}).target;
    const pick = others.find((d) => d.letter === pref) || others.sort((a, b) => b.free - a.free)[0];
    return pick ? path.join(pick.root, ARCHIVE_NAME) : path.join(P.documents, ARCHIVE_NAME);
  }
  const dayName = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function uniqueIn(dir, name) {
    const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
    let p = path.join(dir, name);
    for (let i = 2; fs.existsSync(p) && i < 1000; i++) p = path.join(dir, `${base} (${i})${ext}`);
    return p;
  }
  // 복사하고 크기가 같은지 확인한다. 실패하면 null
  function archiveCopy(src, dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const dest = uniqueIn(dir, path.basename(src));
      fs.copyFileSync(src, dest);
      if (fs.statSync(dest).size !== fs.statSync(src).size) { try { fs.unlinkSync(dest); } catch { /* ignore */ } return null; }
      return dest;
    } catch { return null; }
  }
  function appendList(dir, rows) {
    const f = path.join(dir, '정리한 폰트 목록.txt');
    const head = fs.existsSync(f) ? '' : '\uFEFF쎈Clean으로 정리한 폰트 (파일을 더블클릭하고 [설치]를 누르면 다시 설치돼요)\r\n\r\n';
    const lines = rows.map((r) => `${r.name} · ${path.basename(r.backup)} · ${r.manufacturer || '제작사 정보 없음'} · ${r.scope === 'system' ? '이 PC 전체' : '내 계정'} · ${new Date().toLocaleString('ko-KR')}`).join('\r\n');
    try { fs.appendFileSync(f, head + lines + '\r\n', 'utf8'); } catch { /* ignore */ }
  }
  function archiveInfo() {
    const root = archiveRoot();
    let count = 0;
    try {
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        count += fs.readdirSync(path.join(root, d.name)).filter((f) => FONT_EXT.has(path.extname(f).toLowerCase())).length;
      }
    } catch { return null; }
    return count ? { path: root, count } : null;
  }
  function openArchive() {
    const root = archiveRoot();
    if (!fs.existsSync(root)) return false;
    platform.shell.openPath(root);
    return true;
  }
  // 1.3.0까지 AppData에 둔 백업을 보관함으로 옮긴다(C드라이브 공간 확보)
  function migrateBackups() {
    const oldRoot = path.join(store.dir, 'font-backup');
    if (!fs.existsSync(oldRoot)) return { moved: 0 };
    const batches = store.read('font-undo.json', []);
    let moved = 0;
    for (const b of batches) {
      const rows = [];
      for (const e of b.entries) {
        if (!e.backup || !e.backup.toLowerCase().startsWith(oldRoot.toLowerCase()) || !fs.existsSync(e.backup)) continue;
        const dir = path.join(archiveRoot(), dayName(b.at));
        const fileName = path.basename(e.file);
        try {
          fs.mkdirSync(dir, { recursive: true });
          const dest = uniqueIn(dir, fileName);
          fs.copyFileSync(e.backup, dest);
          if (fs.statSync(dest).size !== fs.statSync(e.backup).size) continue;
          e.backup = dest; moved++;
          rows.push({ name: e.name, backup: dest, scope: e.scope });
        } catch { /* 다음에 다시 */ }
      }
      if (rows.length) appendList(path.join(archiveRoot(), dayName(b.at)), rows);
    }
    store.write('font-undo.json', batches);
    const stillUsed = batches.some((b) => b.entries.some((e) => e.backup && e.backup.toLowerCase().startsWith(oldRoot.toLowerCase())));
    if (!stillUsed) { try { fs.rmSync(oldRoot, { recursive: true, force: true }); } catch { /* ignore */ } }
    return { moved };
  }

  const idOf = (file) => crypto.createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 16);

  function cachedInfo(file, cache) {
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    const k = file.toLowerCase();
    const c = cache[k];
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.info;
    const info = readFontInfo(file);
    cache[k] = { size: st.size, mtimeMs: st.mtimeMs, info };
    return info;
  }

  function registered() {
    const out = [];
    const u = platform.reg.values(USER_FONTS_KEY) || {};
    for (const [name, v] of Object.entries(u)) {
      const val = String(v.value || '');
      const file = path.isAbsolute(val) ? val : path.join(P.userFonts, val);
      out.push({ regName: name, file, scope: path.isAbsolute(val) && !val.toLowerCase().startsWith(P.windowsFonts.toLowerCase()) ? 'user' : (val.toLowerCase().startsWith(P.windowsFonts.toLowerCase()) ? 'system' : 'user') });
    }
    const s = platform.reg.values(SYS_FONTS_KEY) || {};
    for (const [name, v] of Object.entries(s)) {
      const val = String(v.value || '');
      const file = path.isAbsolute(val) ? val : path.join(P.windowsFonts, val);
      out.push({ regName: name, file, scope: 'system' });
    }
    return out;
  }

  function list() {
    // 1.5: 이름표 해석(완성형 한글)이 바뀌어 예전 캐시는 버린다
    let cache = store.read('font-cache.json', {});
    if (cache.__v !== 2) cache = { __v: 2 };
    const items = [];
    const seen = new Set();
    for (const r of registered()) {
      const ext = path.extname(r.file).toLowerCase();
      if (!FONT_EXT.has(ext)) continue; // .fon 등 비트맵 시스템 글꼴 제외
      const key = r.file.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const info = cachedInfo(r.file, cache);
      if (!info) continue;
      const c = classify(info, cdb);
      const id = idOf(r.file);
      const item = {
        id,
        file: r.file,
        fileName: path.basename(r.file),
        regName: r.regName,
        scope: r.scope,
        // 안심(특히 Windows·오피스·한컴 글꼴)은 정리하지 않는다. 이 PC 전체 폰트는 '사용 주의'만, 정보가 없는 폰트는 내 계정 것만.
        removable: c.class !== 'safe' && !c.bundled && (r.scope === 'user' || c.class === 'caution'),
        // 처음부터 체크: 내 계정에 설치한 사용 주의 폰트만(이 PC 전체 폰트는 다른 프로그램이 함께 설치했을 수 있어 체크 해제)
        defaultOn: c.class === 'caution' && r.scope === 'user',
        basis: c.basis || '',
        needsAdmin: r.scope === 'system',
        name: info.familyKo || info.family || info.familyEn || path.basename(r.file),
        nameEn: info.familyEn,
        manufacturer: info.manufacturer || '',
        class: c.class,
        reason: c.reason,
        group: c.group,
      };
      items.push(item);
    }
    store.write('font-cache.json', cache);
    lastList = new Map(items.map((i) => [i.id, i]));
    const order = { caution: 0, unknown: 1, safe: 2 };
    items.sort((a, b) => order[a.class] - order[b.class] || a.name.localeCompare(b.name, 'ko'));
    const count = (cls) => items.filter((i) => i.class === cls).length;
    return {
      items,
      summary: { total: items.length, safe: count('safe'), caution: count('caution'), unknown: count('unknown'), cautionRemovable: items.filter((i) => i.class === 'caution' && i.removable).length, needsAdmin: items.filter((i) => i.class === 'caution' && i.needsAdmin).length },
      school: schoolStatus(items),
      pending: store.read('font-pending.json', []).length,
      undo: store.read('font-undo.json', []).map((b) => ({ id: b.id, at: b.at, count: b.entries.length })),
      archive: archiveInfo(),
      archivePath: archiveRoot(),
    };
  }

  function fileFor(id) { const i = lastList.get(id); return i ? i.file : null; }

  async function runningApps() {
    const procs = await platform.processes();
    return [...new Set(procs.filter((p) => APPS_USING_FONTS[p]).map((p) => APPS_USING_FONTS[p]))];
  }

  async function clean(ids) {
    const batch = { id: String(Date.now()), at: Date.now(), entries: [] };
    const backupDir = path.join(archiveRoot(), dayName(batch.at));
    const results = [];
    const sys = [];
    const listRows = [];
    for (const id of ids || []) {
      const item = lastList.get(id);
      if (!item || !item.removable || item.class === 'safe') { results.push({ id, ok: false, reason: item ? 'not-removable' : 'unknown' }); continue; }
      // 보관함에 복사하고 확인된 뒤에만 정리한다
      const backup = archiveCopy(item.file, backupDir);
      if (!backup) { results.push({ id, ok: false, reason: 'backup' }); continue; }
      if (item.scope === 'system') { sys.push({ id, item, backup }); continue; }
      const regVal = platform.reg.read(USER_FONTS_KEY, item.regName);
      platform.reg.del(USER_FONTS_KEY, item.regName);
      platform.fonts.remove(item.file);
      let moved = false;
      try { fs.unlinkSync(item.file); moved = true; } catch {
        store.update('font-pending.json', [], (l) => { l.push(item.file); return l; });
      }
      listRows.push({ name: item.name, backup, manufacturer: item.manufacturer, scope: 'user' });
      batch.entries.push({ scope: 'user', name: item.name, regName: item.regName, regValue: regVal ? regVal.value : item.file, file: item.file, backup, pending: !moved });
      results.push({ id, ok: true, pending: !moved });
    }
    // 이 PC 전체에 설치된 폰트: 한 번의 확인 창으로 모두 처리
    let canceled = false;
    if (sys.length) {
      const ops = [];
      for (const { item } of sys) {
        ops.push({ op: 'regDelete', key: SYS_FONTS_KEY, name: item.regName });
        ops.push({ op: 'delete', path: item.file, delayIfLocked: true });
      }
      const regVals = sys.map(({ item }) => platform.reg.read(SYS_FONTS_KEY, item.regName));
      sys.forEach(({ item }) => platform.fonts.remove(item.file));
      const r = await platform.elevated(ops);
      if (!r.ok && r.canceled) canceled = true;
      sys.forEach(({ id, item, backup }, i) => {
        const regOk = r.results && r.results[i * 2] && r.results[i * 2].ok;
        const del = r.results && r.results[i * 2 + 1];
        if (!r.ok || !regOk) {
          platform.fonts.add(item.file); // 그대로 두기
          try { fs.unlinkSync(backup); } catch { /* ignore */ }
          results.push({ id, ok: false, reason: canceled ? 'canceled' : 'error' });
          return;
        }
        const pending = !!(del && del.pending) || !(del && del.ok);
        listRows.push({ name: item.name, backup, manufacturer: item.manufacturer, scope: 'system' });
        batch.entries.push({ scope: 'system', name: item.name, regName: item.regName, regValue: regVals[i] ? regVals[i].value : item.fileName, file: item.file, backup, pending });
        results.push({ id, ok: true, pending });
      });
    }
    platform.fonts.broadcast();
    if (listRows.length) appendList(backupDir, listRows);
    if (batch.entries.length) store.update('font-undo.json', [], (l) => { l.push(batch); return l.slice(-10); });
    return { batchId: batch.entries.length ? batch.id : null, results, canceled, archive: batch.entries.length ? archiveRoot() : null };
  }

  async function undo(batchId) {
    const batches = store.read('font-undo.json', []);
    const batch = batches.find((b) => b.id === batchId) || batches[batches.length - 1];
    if (!batch) return { ok: false };
    let restored = 0;
    const missing = batch.entries.filter((e) => !fs.existsSync(e.backup)).length;
    if (missing === batch.entries.length) return { ok: false, code: 'missing' };
    const sys = batch.entries.filter((e) => e.scope === 'system' && fs.existsSync(e.backup));
    if (sys.length) {
      const ops = [];
      for (const e of sys) {
        ops.push({ op: 'copy', from: e.backup, to: e.file });
        ops.push({ op: 'regSet', key: SYS_FONTS_KEY, name: e.regName, type: 'String', value: e.regValue });
      }
      const r = await platform.elevated(ops);
      if (!r.ok) return { ok: false, canceled: !!r.canceled };
      sys.forEach((e) => { platform.fonts.add(e.file); restored++; });
    }
    for (const e of batch.entries.filter((x) => x.scope !== 'system' && fs.existsSync(x.backup))) {
      try {
        if (!fs.existsSync(e.file)) { fs.mkdirSync(path.dirname(e.file), { recursive: true }); fs.copyFileSync(e.backup, e.file); }
        platform.reg.write(USER_FONTS_KEY, e.regName, platform.REG.SZ, e.regValue);
        platform.fonts.add(e.file);
        store.update('font-pending.json', [], (l) => l.filter((f) => f.toLowerCase() !== e.file.toLowerCase()));
        restored++;
      } catch { /* skip */ }
    }
    platform.fonts.broadcast();
    store.write('font-undo.json', batches.filter((b) => b.id !== batch.id));
    return { ok: true, restored, missing };
  }

  // 지난번에 잠겨 있어 못 지운 폰트 파일을 다시 지워 본다(앱 시작 시).
  function retryPending() {
    const pending = store.read('font-pending.json', []);
    const left = [];
    for (const f of pending) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { left.push(f); }
    }
    store.write('font-pending.json', left);
    return { done: pending.length - left.length, left: left.length };
  }

  // ── 학교안심 글꼴 ──
  function bundledSchoolFonts() {
    const dir = path.join(assetsDir, 'fonts');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /^hakgyoansim/i.test(f) && FONT_EXT.has(path.extname(f).toLowerCase())); } catch { /* none */ }
    return files.map((f) => {
      const file = path.join(dir, f);
      const info = readFontInfo(file) || {};
      return { file, fileName: f, name: info.familyKo || info.family || f, nameEn: info.familyEn || '' };
    });
  }

  function schoolStatus(items) {
    const res = new RegExp(db.schoolFonts.patterns.join('|'), 'i');
    const installedNames = new Set(items.filter((i) => res.test(i.name) || res.test(i.nameEn || '')).map((i) => i.name));
    const bundled = bundledSchoolFonts().map((b) => ({ name: b.name, installed: installedNames.has(b.name) }));
    return { bundled, installedCount: installedNames.size, allInstalled: bundled.length > 0 && bundled.every((b) => b.installed), officialUrl: db.schoolFonts.officialUrl };
  }

  function installSchool() {
    const results = [];
    fs.mkdirSync(P.userFonts, { recursive: true });
    for (const b of bundledSchoolFonts()) {
      const dest = path.join(P.userFonts, b.fileName);
      try {
        if (!fs.existsSync(dest)) fs.copyFileSync(b.file, dest);
        platform.reg.write(USER_FONTS_KEY, `${b.nameEn || b.name} (TrueType)`, platform.REG.SZ, dest);
        platform.fonts.add(dest);
        results.push({ name: b.name, ok: true });
      } catch { results.push({ name: b.name, ok: false }); }
    }
    platform.fonts.broadcast();
    return results;
  }

  return { migrateBackups, openArchive, archiveRoot, list, clean, undo, retryPending, installSchool, runningApps, fileFor };
}

module.exports = { createFontService, USER_FONTS_KEY };
