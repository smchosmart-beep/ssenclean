'use strict';
// 폰트 메뉴 서비스. 관리자 권한 없이 내 계정 폰트만 정리한다. spec 5장
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
    const cache = store.read('font-cache.json', {});
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
        removable: r.scope === 'user',
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
      summary: { total: items.length, safe: count('safe'), caution: count('caution'), unknown: count('unknown'), cautionRemovable: items.filter((i) => i.class === 'caution' && i.removable).length },
      school: schoolStatus(items),
      pending: store.read('font-pending.json', []).length,
      undo: store.read('font-undo.json', []).map((b) => ({ id: b.id, at: b.at, count: b.entries.length })),
    };
  }

  function fileFor(id) { const i = lastList.get(id); return i ? i.file : null; }

  async function runningApps() {
    const procs = await platform.processes();
    return [...new Set(procs.filter((p) => APPS_USING_FONTS[p]).map((p) => APPS_USING_FONTS[p]))];
  }

  async function clean(ids) {
    const batch = { id: String(Date.now()), at: Date.now(), entries: [] };
    const backupDir = path.join(store.dir, 'font-backup', batch.id);
    const results = [];
    for (const id of ids || []) {
      const item = lastList.get(id);
      if (!item || !item.removable) { results.push({ id, ok: false, reason: item ? 'system' : 'unknown' }); continue; }
      const regVal = platform.reg.read(USER_FONTS_KEY, item.regName);
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, item.fileName);
      let moved = false;
      try {
        fs.copyFileSync(item.file, backup);
      } catch { results.push({ id, ok: false, reason: 'error' }); continue; }
      platform.reg.del(USER_FONTS_KEY, item.regName);
      platform.fonts.remove(item.file);
      try { fs.unlinkSync(item.file); moved = true; } catch {
        store.update('font-pending.json', [], (l) => { l.push(item.file); return l; });
      }
      batch.entries.push({ name: item.name, regName: item.regName, regValue: regVal ? regVal.value : item.file, file: item.file, backup, pending: !moved });
      results.push({ id, ok: true, pending: !moved });
    }
    platform.fonts.broadcast();
    if (batch.entries.length) store.update('font-undo.json', [], (l) => { l.push(batch); return l.slice(-10); });
    return { batchId: batch.entries.length ? batch.id : null, results };
  }

  function undo(batchId) {
    const batches = store.read('font-undo.json', []);
    const batch = batches.find((b) => b.id === batchId) || batches[batches.length - 1];
    if (!batch) return { ok: false };
    let restored = 0;
    for (const e of batch.entries) {
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
    return { ok: true, restored };
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

  return { list, clean, undo, retryPending, installSchool, runningApps, fileFor };
}

module.exports = { createFontService, USER_FONTS_KEY };
