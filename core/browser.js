'use strict';
// 브라우저 청소: 광고 없애기 + 기록 지우기. spec 11장
// 모든 처리는 내 계정 범위(HKCU·내 폴더·내 예약 작업)에서만 한다.
const fs = require('fs');
const path = require('path');
const { uninstallEntries } = require('./updates');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUNONCE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce';
const APPROVED_RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const APPROVED_FOLDER = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder';
const INET_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const INET_POLICY = ['HKCU\\Software\\Policies\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'];
const BROWSER_EXE = { 'chrome.exe': '크롬', 'msedge.exe': '엣지', 'whale.exe': '웨일' };
const DISABLED_VALUE = Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const HKLM_RUN = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
const HKLM_APPROVED_RUN = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s"']+/gi;

function exeFromCommand(cmd) {
  if (!cmd) return '';
  const s = String(cmd).trim();
  if (s.startsWith('"')) return s.slice(1, s.indexOf('"', 1));
  const m = s.match(/^(.+?\.exe)\b/i);
  return m ? m[1] : s.split(' ')[0];
}

function createBrowserService({ platform, store, dataDir }) {
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'adware-db.json'), 'utf8'));
  const P = platform.paths;
  const R = platform.reg;
  const lc = (s) => String(s || '').toLowerCase();
  const BASES = { ProgramFiles: P.programFiles, ProgramFilesX86: P.programFilesX86, LocalAppData: P.localAppData };
  const resolveDir = (d) => { const [head, ...rest] = d.split('\\'); const base = BASES[head.replace(/[{}]/g, '')]; return base ? path.join(base, ...rest) : path.join(head, ...rest); };
  const legitDirs = db.legitBrowserDirs.map((d) => lc(resolveDir(d)));
  const isProtected = (...texts) => { const t = lc(texts.join(' ')); return db.protect.some((p) => t.includes(p)); };
  const dbName = (...texts) => { const t = lc(texts.join(' ')); return db.names.find((n) => t.includes(n)) || db.publishers.find((n) => t.includes(n)) || null; };
  const dbDomain = (url) => { const u = lc(url); return db.domains.find((d) => u.includes(d)) || null; };
  const tracking = (url) => { const u = lc(url); return db.trackingParams.find((p) => u.includes(p)) || null; };
  const inUserTemp = (p) => { const x = lc(p); return x.startsWith(lc(P.appData)) || x.startsWith(lc(P.localAppData)) || x.startsWith(lc(P.temp)); };
  let lastScan = null;

  function legitBrowser(exe) {
    const d = lc(path.dirname(exe));
    return legitDirs.includes(d);
  }
  function findBrowserExe(base) {
    for (const d of db.legitBrowserDirs) {
      const p = path.join(resolveDir(d), base);
      if (platform.exists(p)) return p;
    }
    return null;
  }

  function listLinks(dir, depth = 1) {
    const out = [];
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0) out.push(...listLinks(p, depth - 1));
      else if (e.isFile()) out.push(p);
    }
    return out;
  }

  // 브라우저 실행 옵션 중 정상적인 것(앱 모드·프로필)은 남기고 URL만 찾는다.
  function injectedUrls(args) {
    const cleaned = String(args || '').replace(/--(app|app-id|profile-directory|user-data-dir)=("[^"]*"|\S+)/gi, '');
    return cleaned.match(URL_RE) || [];
  }

  function checkShortcuts(items) {
    const files = [
      ...listLinks(P.desktop, 0),
      ...listLinks(P.startMenu, 2),
      ...listLinks(P.taskbarPinned, 0),
    ].filter((f) => f.toLowerCase().endsWith('.lnk'));
    for (const f of files) {
      if (lc(f).startsWith(lc(P.startup))) continue; // 시작 프로그램 폴더는 따로 본다
      const link = platform.shell.readShortcut(f);
      if (!link || !link.target) continue;
      const base = lc(path.basename(link.target));
      const name = path.basename(f, '.lnk');
      if (BROWSER_EXE[base]) {
        const urls = injectedUrls(link.args);
        const wrongDir = !legitBrowser(link.target);
        if (!urls.length && !wrongDir) continue;
        const reasons = [];
        if (urls.length) reasons.push(`켤 때마다 ${urls[0].replace(/^https?:\/\//, '').split('/')[0]} 사이트가 열리도록 바뀌어 있어요`);
        if (wrongDir) reasons.push('정식 설치 위치가 아닌 프로그램을 실행해요');
        items.push({ id: 'lnk:' + f, kind: 'shortcut', title: `${BROWSER_EXE[base]} 바로가기가 바뀌어 있어요`, detail: `${where(f)} › ${name}`, reason: reasons.join(', '), verdict: urls.length ? 'adware' : 'suspect', checked: !!urls.length, fixable: true, data: { file: f, link, base } });
      } else if (/chrome|크롬|edge|엣지|whale|웨일|internet explorer|인터넷/i.test(name) && /\.exe$/i.test(base) && inUserTemp(link.target)) {
        items.push({ id: 'lnk:' + f, kind: 'fake-shortcut', title: '브라우저인 척하는 바로가기가 있어요', detail: `${where(f)} › ${name}`, reason: '이름은 브라우저인데 다른 프로그램을 실행해요', verdict: 'suspect', checked: false, fixable: true, data: { file: f } });
      }
    }
  }

  function checkUrlFiles(items) {
    for (const f of listLinks(P.desktop, 0).filter((x) => x.toLowerCase().endsWith('.url'))) {
      let url = '';
      try { url = (fs.readFileSync(f, 'utf8').match(/^URL=(.+)$/mi) || [])[1] || ''; } catch { continue; }
      const name = path.basename(f, '.url');
      const dom = dbDomain(url);
      const tr = tracking(url);
      if (!dom && !tr) continue;
      const host = url.replace(/^\w+:\/\//, '').split('/')[0];
      items.push({ id: 'url:' + f, kind: 'url', title: dom ? '광고 사이트 아이콘이 있어요' : '광고로 의심되는 쇼핑 아이콘이 있어요', detail: `바탕화면 › ${name} (${host})`, reason: dom ? '광고 프로그램이 만드는 사이트로 알려져 있어요' : '광고 추적 주소가 붙어 있어요', verdict: dom ? 'adware' : 'suspect', checked: !!dom, fixable: true, data: { file: f } });
    }
  }

  async function checkStartup(items) {
    const cands = [];
    for (const [key, once] of [[RUN_KEY, false], [RUNONCE_KEY, true]]) {
      for (const [name, v] of Object.entries(R.values(key) || {})) {
        const exe = exeFromCommand(v.value);
        cands.push({ kind: 'run', key, once, name, command: String(v.value), exe });
      }
    }
    for (const f of listLinks(P.startup, 0)) {
      const link = f.toLowerCase().endsWith('.lnk') ? platform.shell.readShortcut(f) : null;
      cands.push({ kind: 'folder', name: path.basename(f), file: f, exe: link ? link.target : f, command: link ? `${link.target} ${link.args || ''}` : f });
    }
    const approvedRun = R.values(APPROVED_RUN) || {};
    const approvedFolder = R.values(APPROVED_FOLDER) || {};
    const isDisabled = (c) => {
      const v = c.kind === 'folder' ? approvedFolder[c.name] : approvedRun[c.name];
      return !!(v && Buffer.isBuffer(v.value) && (v.value[0] & 1));
    };
    const pending = [];
    for (const c of cands) {
      if (isDisabled(c)) continue;
      if (isProtected(c.name, c.exe)) continue;
      const hit = dbName(c.name, c.exe);
      if (hit) { pending.push({ c, verdict: 'adware' }); continue; }
      if (inUserTemp(c.exe)) pending.push({ c, verdict: 'check' });
    }
    const toCheck = pending.filter((p) => p.verdict === 'check').map((p) => p.c.exe);
    const sigs = toCheck.length ? await platform.signatures(toCheck) : {};
    for (const { c, verdict } of pending) {
      let v = verdict;
      let reason = '광고 프로그램으로 알려져 있어요';
      if (v === 'check') {
        const s = sigs[c.exe] || {};
        if (isProtected(s.company, s.signer)) continue;
        const recent = s.created && (Date.now() - Date.parse(s.created)) < 30 * 86400000;
        const noCompany = !s.company;
        if (s.signed === false && (recent || noCompany)) {
          v = 'suspect';
          reason = ['켤 때마다 자동으로 실행돼요', '제작사 서명이 없어요', recent ? '최근에 설치됐어요' : '제작사 정보가 없어요'].join(', ');
        } else continue;
      }
      items.push({ id: `startup:${c.kind}:${c.key || ''}:${c.name}`, kind: 'startup', title: v === 'adware' ? '광고 프로그램이 켤 때마다 실행돼요' : '의심되는 프로그램이 켤 때마다 실행돼요', detail: `${c.name} (${path.basename(c.exe)})`, reason, verdict: v, checked: v === 'adware', fixable: true, data: c });
    }
    // 이 PC 전체 시작 프로그램(HKLM): 고칠 때 Windows 확인 창([예])을 거친다
    const approvedMachine = R.values(HKLM_APPROVED_RUN) || {};
    for (const [name, v] of Object.entries(R.values(HKLM_RUN) || {})) {
      if (isProtected(name, v.value)) continue;
      const ap = approvedMachine[name];
      if (ap && Buffer.isBuffer(ap.value) && (ap.value[0] & 1)) continue;
      if (dbName(name, v.value)) {
        const exe = exeFromCommand(v.value);
        items.push({ id: `startup:machine:${name}`, kind: 'startup-machine', title: '광고 프로그램이 켤 때마다 실행돼요', detail: `${name} (${path.basename(exe)})`, reason: '광고 프로그램으로 알려져 있어요', verdict: 'adware', checked: true, fixable: true, admin: true, data: { name } });
      }
    }
  }

  async function checkTasks(items) {
    const tasks = await platform.tasks.listUser();
    const me = lc(platform.user.name);
    const cands = [];
    for (const t of tasks) {
      const owner = lc(t.user);
      if (owner && !owner.endsWith(me)) continue;
      for (const a of t.actions || []) {
        const exe = String(a.exec || '').replace(/"/g, '');
        if (isProtected(t.name, t.author, exe)) continue;
        const hit = dbName(t.name, exe);
        const opensUrl = BROWSER_EXE[lc(path.basename(exe))] && injectedUrls(a.args).length;
        if (hit || opensUrl) cands.push({ t, exe, verdict: 'adware', reason: opensUrl ? '정해진 시간마다 광고 사이트를 열어요' : '광고 프로그램으로 알려져 있어요' });
        else if (inUserTemp(exe)) cands.push({ t, exe, verdict: 'check' });
        break;
      }
    }
    const sigs = await platform.signatures(cands.filter((c) => c.verdict === 'check').map((c) => c.exe));
    for (const c of cands) {
      let { verdict, reason } = c;
      if (verdict === 'check') {
        const s = sigs[c.exe] || {};
        if (isProtected(s.company, s.signer)) continue;
        if (s.signed !== false || s.company) continue;
        verdict = 'suspect';
        reason = '정해진 시간마다 서명 없는 프로그램을 실행해요';
      }
      items.push({ id: `task:${c.t.path}${c.t.name}`, kind: 'task', title: verdict === 'adware' ? '광고 프로그램 예약 작업이 있어요' : '의심되는 예약 작업이 있어요', detail: `${c.t.name} (${path.basename(c.exe)})`, reason, verdict, checked: verdict === 'adware', fixable: true, data: { path: c.t.path, name: c.t.name } });
    }
  }

  function checkPrograms(items) {
    for (const e of uninstallEntries(platform)) {
      if (isProtected(e.name, e.publisher)) continue;
      if (!dbName(e.name, e.publisher)) continue;
      if (!e.uninstall) continue;
      items.push({ id: 'prog:' + e.key, kind: 'program', title: '광고 프로그램이 설치되어 있어요', detail: e.name, reason: '광고 프로그램으로 알려져 있어요. 제거 창이 열리면 안내에 따라 지워 주세요', verdict: 'adware', checked: true, fixable: true, admin: e.hive !== 'HKCU', data: { uninstall: e.uninstall, name: e.name } });
    }
  }

  function checkProxy(items) {
    if (INET_POLICY.some((k) => { const v = R.values(k); return v && Object.keys(v).length; })) return;
    const en = R.read(INET_KEY, 'ProxyEnable');
    const srv = R.read(INET_KEY, 'ProxyServer');
    const pac = R.read(INET_KEY, 'AutoConfigURL');
    const on = en && Number(en.value) === 1 && srv && srv.value;
    if (!on && !(pac && pac.value)) return;
    items.push({ id: 'proxy', kind: 'proxy', title: '인터넷 연결 설정이 바뀌어 있어요', detail: on ? `연결 경유지: ${srv.value}` : `자동 설정 주소: ${pac.value}`, reason: '인터넷이 느리거나 광고가 끼어드는 원인일 수 있어요. 학교에서 쓰는 설정일 수도 있으니 모르면 그대로 두세요', verdict: 'suspect', checked: false, fixable: true, data: {} });
  }

  function profiles(browser) {
    const root = P.browserData[browser];
    let ls = null;
    try { ls = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8')); } catch { /* no browser */ }
    const names = ls && ls.profile && ls.profile.info_cache ? Object.keys(ls.profile.info_cache) : [];
    if (!names.length && fs.existsSync(path.join(root, 'Default'))) names.push('Default');
    return names.map((n) => ({ dir: path.join(root, n), id: n, name: (ls && ls.profile.info_cache[n] && ls.profile.info_cache[n].name) || n }));
  }

  function checkBrowserSettings(items) {
    for (const [browser, label] of [['chrome', '크롬'], ['edge', '엣지']]) {
      for (const pr of profiles(browser)) {
        let pref = null;
        try { pref = JSON.parse(fs.readFileSync(path.join(pr.dir, 'Preferences'), 'utf8')); } catch { continue; }
        const exts = (pref.extensions && pref.extensions.settings) || {};
        for (const [id, x] of Object.entries(exts)) {
          const name = x.manifest && x.manifest.name;
          if (!name || x.location === 5 || x.location === 10) continue; // 내장·구성요소
          const fromStore = x.from_webstore === true || x.location === 1;
          const hit = dbName(name);
          if (fromStore && !hit) continue;
          items.push({ id: `ext:${browser}:${pr.id}:${id}`, kind: 'extension', title: `${label}에 ${hit ? '광고' : '출처를 알 수 없는'} 확장 프로그램이 있어요`, detail: `${name}${profiles(browser).length > 1 ? ` (${pr.name})` : ''}`, reason: hit ? '광고 프로그램으로 알려져 있어요' : '웹 스토어가 아닌 곳에서 설치됐어요', verdict: hit ? 'adware' : 'suspect', checked: false, fixable: false, guide: browser, data: {} });
        }
        const urls = [];
        const st = pref.session && pref.session.startup_urls;
        if (pref.session && pref.session.restore_on_startup === 4 && Array.isArray(st)) urls.push(...st);
        if (pref.homepage && pref.homepage_is_newtabpage === false) urls.push(pref.homepage);
        const odd = urls.filter((u) => !db.standardSearch.some((s) => lc(u).includes(s)));
        if (odd.length) items.push({ id: `home:${browser}:${pr.id}`, kind: 'homepage', title: `${label} 시작 페이지가 바뀌어 있어요`, detail: odd[0], reason: '켤 때 처음 보이는 페이지가 낯선 주소예요', verdict: dbDomain(odd[0]) ? 'adware' : 'suspect', checked: false, fixable: false, guide: browser, data: {} });
        const sp = pref.default_search_provider_data && pref.default_search_provider_data.template_url_data;
        if (sp && sp.url && !db.standardSearch.some((s) => lc(sp.url).includes(s))) {
          items.push({ id: `search:${browser}:${pr.id}`, kind: 'search', title: `${label} 검색 엔진이 바뀌어 있어요`, detail: `${sp.short_name || ''} ${sp.url.replace(/^\w+:\/\//, '').split('/')[0]}`.trim(), reason: '검색할 때 광고 팝업이 뜨는 원인일 수 있어요', verdict: 'suspect', checked: false, fixable: false, guide: browser, data: {} });
        }
      }
    }
  }

  function where(f) {
    const map = [[P.desktop, '바탕화면'], [P.taskbarPinned, '작업 표시줄'], [P.startMenu, '시작 메뉴']];
    for (const [b, l] of map) if (lc(f).startsWith(lc(b))) return l;
    return path.dirname(f);
  }

  async function scan() {
    const items = [];
    const steps = [
      () => checkShortcuts(items), () => checkUrlFiles(items), () => checkStartup(items),
      () => checkTasks(items), () => checkPrograms(items), () => checkProxy(items), () => checkBrowserSettings(items),
    ];
    for (const s of steps) { try { await s(); } catch { /* 한 항목 실패해도 나머지는 계속 */ } }
    const order = { adware: 0, suspect: 1 };
    items.sort((a, b) => order[a.verdict] - order[b.verdict]);
    lastScan = { at: Date.now(), items: new Map(items.map((i) => [i.id, i])) };
    store.write('browser-last.json', { at: lastScan.at, count: items.filter((i) => i.fixable).length, adware: items.filter((i) => i.verdict === 'adware').length, total: items.length });
    return {
      at: lastScan.at,
      items: items.map(({ data, ...rest }) => rest),
      running: await runningBrowsers(),
      canUndo: store.list('browser-undo').length > 0,
    };
  }

  function quickCount() {
    // 대시보드용 빠른 점검: 바로가기·인터넷 아이콘·시작 프로그램(DB 일치)만
    const items = [];
    try { checkShortcuts(items); } catch { /* ignore */ }
    try { checkUrlFiles(items); } catch { /* ignore */ }
    let startup = 0;
    for (const [name, v] of Object.entries(R.values(RUN_KEY) || {})) {
      if (!isProtected(name, v.value) && dbName(name, v.value)) startup++;
    }
    const last = store.read('browser-last.json', null);
    const fromLast = last && Date.now() - last.at < 7 * 86400000 ? last.count : 0;
    const count = Math.max(items.length + startup, fromLast);
    return { count, shortcut: items.filter((i) => i.kind === 'shortcut').length, url: items.filter((i) => i.kind === 'url').length };
  }

  async function runningBrowsers() {
    const procs = await platform.processes();
    return Object.entries(BROWSER_EXE).filter(([exe]) => procs.includes(exe)).map(([exe, label]) => ({ exe, label }));
  }

  async function closeBrowsers() {
    for (const b of await runningBrowsers()) await platform.requestClose(b.exe);
    await new Promise((r) => setTimeout(r, 1500));
    return runningBrowsers();
  }

  async function fix(ids) {
    if (!lastScan) return { ok: false, code: 'stale' };
    const machine = [];
    const undo = { id: String(Date.now()), at: Date.now(), entries: [] };
    const results = [];
    for (const id of ids || []) {
      const it = lastScan.items.get(id);
      if (!it || !it.fixable) { results.push({ id, ok: false }); continue; }
      try {
        const d = it.data;
        switch (it.kind) {
          case 'shortcut': {
            const urls = injectedUrls(d.link.args);
            let args = String(d.link.args || '');
            for (const u of urls) args = args.replace(u, '');
            args = args.replace(/\s+/g, ' ').trim();
            const target = legitBrowser(d.link.target) ? d.link.target : (findBrowserExe(d.base) || d.link.target);
            undo.entries.push({ kind: 'shortcut', file: d.file, link: d.link });
            const ok = platform.shell.writeShortcut(d.file, 'update', { target, args });
            results.push({ id, ok: !!ok });
            break;
          }
          case 'fake-shortcut':
          case 'url':
            await platform.shell.trash(d.file);
            undo.entries.push({ kind: 'trash', file: d.file });
            results.push({ id, ok: true });
            break;
          case 'startup': {
            if (d.kind === 'run' && !d.once) {
              const prev = R.read(APPROVED_RUN, d.name);
              R.write(APPROVED_RUN, d.name, platform.REG.BINARY, DISABLED_VALUE);
              undo.entries.push({ kind: 'approved', key: APPROVED_RUN, name: d.name, prev: prev ? [...prev.value] : null });
            } else if (d.kind === 'run' && d.once) {
              R.del(d.key, d.name);
              undo.entries.push({ kind: 'regvalue', key: d.key, name: d.name, value: d.command });
            } else {
              const prev = R.read(APPROVED_FOLDER, d.name);
              R.write(APPROVED_FOLDER, d.name, platform.REG.BINARY, DISABLED_VALUE);
              undo.entries.push({ kind: 'approved', key: APPROVED_FOLDER, name: d.name, prev: prev ? [...prev.value] : null });
            }
            results.push({ id, ok: true });
            break;
          }
          case 'task': {
            const xml = await platform.tasks.exportXml(d.path, d.name);
            if (!xml) { results.push({ id, ok: false }); break; }
            const ok = await platform.tasks.remove(d.path, d.name);
            if (ok) undo.entries.push({ kind: 'task', path: d.path, name: d.name, xml });
            results.push({ id, ok });
            break;
          }
          case 'program': {
            // 제거 프로그램이 관리자 권한을 요구하면 Windows 확인 창이 뜨도록 셸로 실행한다
            const cmd = d.uninstall;
            const exe = exeFromCommand(cmd);
            const args = cmd.slice(cmd.indexOf(exe) + exe.length).replace(/^"/, '').trim();
            const ok = await platform.shellRun(exe, args);
            results.push({ id, ok: !!ok, launched: true });
            break;
          }
          case 'startup-machine':
            machine.push({ id, name: d.name, prev: R.read(HKLM_APPROVED_RUN, d.name) });
            break;
          case 'proxy': {
            const prev = { ProxyEnable: R.read(INET_KEY, 'ProxyEnable'), AutoConfigURL: R.read(INET_KEY, 'AutoConfigURL') };
            R.write(INET_KEY, 'ProxyEnable', platform.REG.DWORD, 0);
            if (prev.AutoConfigURL) R.del(INET_KEY, 'AutoConfigURL');
            undo.entries.push({ kind: 'proxy', prev: { ProxyEnable: prev.ProxyEnable ? prev.ProxyEnable.value : null, AutoConfigURL: prev.AutoConfigURL ? prev.AutoConfigURL.value : null } });
            results.push({ id, ok: true });
            break;
          }
          default: results.push({ id, ok: false });
        }
      } catch { results.push({ id, ok: false }); }
    }
    // 이 PC 전체 시작 프로그램은 한 번의 확인 창으로 끈다
    let canceled = false;
    if (machine.length) {
      const r = await platform.elevated(machine.map((m) => ({ op: 'regSet', key: HKLM_APPROVED_RUN, name: m.name, type: 'Binary', value: [...DISABLED_VALUE] })));
      canceled = !!r.canceled;
      machine.forEach((m, i) => {
        const ok = r.ok && r.results[i] && r.results[i].ok;
        if (ok) undo.entries.push({ kind: 'approved-machine', name: m.name, prev: m.prev ? [...m.prev.value] : null });
        results.push({ id: m.id, ok: !!ok });
      });
    }
    if (undo.entries.length) store.write(path.join('browser-undo', `${undo.id}.json`), undo);
    store.write('browser-last.json', { at: Date.now(), count: Math.max(0, lastScan.items.size - results.filter((r) => r.ok).length), adware: 0, total: lastScan.items.size });
    return { ok: true, undoId: undo.entries.length ? undo.id : null, results, fixed: results.filter((r) => r.ok).length, canceled };
  }

  async function undoFix() {
    const files = store.list('browser-undo').filter((f) => f.endsWith('.json'));
    if (!files.length) return { ok: false };
    const rel = path.join('browser-undo', files[files.length - 1]);
    const u = store.read(rel, null);
    let restored = 0, manual = 0;
    const machine = u.entries.filter((e) => e.kind === 'approved-machine');
    if (machine.length) {
      const r = await platform.elevated(machine.map((e) => (e.prev ? { op: 'regSet', key: HKLM_APPROVED_RUN, name: e.name, type: 'Binary', value: e.prev } : { op: 'regDelete', key: HKLM_APPROVED_RUN, name: e.name })));
      if (!r.ok) return { ok: false, canceled: !!r.canceled };
      restored += r.results.filter((x) => x && x.ok).length;
    }
    for (const e of [...u.entries].reverse()) {
      try {
        if (e.kind === 'shortcut') { platform.shell.writeShortcut(e.file, 'replace', { target: e.link.target, args: e.link.args || '', cwd: e.link.cwd || '', icon: e.link.icon || '', iconIndex: e.link.iconIndex || 0, description: e.link.description || '' }); restored++; }
        else if (e.kind === 'approved') { if (e.prev) R.write(e.key, e.name, platform.REG.BINARY, Buffer.from(e.prev)); else R.del(e.key, e.name); restored++; }
        else if (e.kind === 'regvalue') { R.write(e.key, e.name, platform.REG.SZ, e.value); restored++; }
        else if (e.kind === 'task') { if (await platform.tasks.register(e.path, e.name, e.xml)) restored++; }
        else if (e.kind === 'proxy') {
          if (e.prev.ProxyEnable != null) R.write(INET_KEY, 'ProxyEnable', platform.REG.DWORD, e.prev.ProxyEnable);
          if (e.prev.AutoConfigURL != null) R.write(INET_KEY, 'AutoConfigURL', platform.REG.SZ, e.prev.AutoConfigURL);
          restored++;
        } else if (e.kind === 'trash') manual++;
      } catch { /* skip */ }
    }
    try { fs.unlinkSync(store.path(rel)); } catch { /* ignore */ }
    return { ok: true, restored, manual };
  }

  function openReset(browser) {
    const exe = findBrowserExe(browser === 'edge' ? 'msedge.exe' : 'chrome.exe');
    if (!exe) return false;
    platform.launch(exe, [browser === 'edge' ? 'edge://settings/resetProfileSettings' : 'chrome://settings/resetProfileSettings']);
    return true;
  }

  // ── 기록 지우기 ──
  const TARGETS = {
    history: ['History', 'History-journal', 'Visited Links'],
    cache: ['Cache', 'Code Cache', 'GPUCache', path.join('Service Worker', 'CacheStorage')],
    cookies: [path.join('Network', 'Cookies'), path.join('Network', 'Cookies-journal'), 'Cookies', 'Cookies-journal'],
  };
  function sizeOf(p) {
    let st; try { st = fs.lstatSync(p); } catch { return 0; }
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    let total = 0;
    for (const e of fs.readdirSync(p)) total += sizeOf(path.join(p, e));
    return total;
  }

  function historySizes() {
    const out = [];
    for (const [browser, label] of [['chrome', '크롬'], ['edge', '엣지']]) {
      const prs = profiles(browser);
      if (!prs.length) continue;
      const sizes = { history: 0, cache: 0, cookies: 0 };
      for (const pr of prs) for (const [k, list] of Object.entries(TARGETS)) for (const t of list) sizes[k] += sizeOf(path.join(pr.dir, t));
      out.push({ browser, label, profiles: prs.length, sizes });
    }
    return out;
  }

  async function cleanHistory({ browsers = ['chrome', 'edge'], history = true, cache = true, cookies = false }) {
    const running = (await runningBrowsers()).filter((b) => browsers.includes(b.exe === 'chrome.exe' ? 'chrome' : b.exe === 'msedge.exe' ? 'edge' : 'x'));
    if (running.length) return { ok: false, code: 'running', running };
    const kinds = Object.entries({ history, cache, cookies }).filter(([, v]) => v).map(([k]) => k);
    const freed = {};
    for (const browser of browsers) {
      let total = 0;
      for (const pr of profiles(browser)) {
        for (const k of kinds) for (const t of TARGETS[k]) {
          const p = path.join(pr.dir, t);
          const sz = sizeOf(p);
          try { fs.rmSync(p, { recursive: true, force: true }); total += sz; } catch { /* locked */ }
        }
      }
      freed[browser] = total;
    }
    return { ok: true, freed };
  }

  return { scan, quickCount, fix, undo: undoFix, openReset, runningBrowsers, closeBrowsers, historySizes, cleanHistory };
}

module.exports = { createBrowserService, exeFromCommand };
