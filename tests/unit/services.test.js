'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshEnv, waitFor } = require('./helpers');
const { createPrivacyService } = require('../../core/privacy/service');
const { createFontService } = require('../../core/fonts/service');
const { createPasswordService } = require('../../core/password');
const { createScreensaverService } = require('../../core/screensaver');
const { createUpdateService, cmpVersion } = require('../../core/updates');
const { createDesktopService, semesterOf } = require('../../core/desktop');
const { createBrowserService } = require('../../core/browser');

test('개인정보: 검사·미리보기·제외·지우기·잠긴 파일', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createPrivacyService(env);
  const { roots } = svc.start({ roots: svc.defaultRoots().map((r) => r.path) });
  assert.strictEqual(roots.length, 3);
  await waitFor(() => !svc.results().running);
  const res = svc.results().results;
  const found = res.filter((r) => r.status === 'found');
  const names = found.map((r) => r.name).sort();
  assert.ok(names.includes('3학년 2반 명단.xlsx'));
  assert.ok(names.includes('학부모 상담 기록.hwp'));
  assert.ok(names.includes('학생 기초조사서.hwp'), '하위 폴더도 검사');
  assert.ok(!names.includes('국어 학습지.hwpx'), '개인정보 없는 문서는 빠짐');
  assert.ok(!names.includes('번호 연습.txt'), '오탐 없음');
  const roster = found.find((r) => r.name === '3학년 2반 명단.xlsx');
  assert.strictEqual(roster.level, 3);
  assert.strictEqual(roster.counts.rrn, 3);
  assert.strictEqual(roster.where, '바탕화면');
  assert.ok(roster.previews.every((p) => !/\d{6}-\d{7}/.test(p.text)), '미리보기는 가려져 있어야 함');
  const issues = res.filter((r) => r.status !== 'found').map((r) => [r.name, r.status]);
  assert.ok(issues.some(([n, s]) => n === '배포용 문서.hwp' && s === 'locked'));
  assert.ok(issues.some(([n, s]) => n === '스캔_동의서.pdf' && s === 'scanned'));
  assert.ok(issues.some(([n, s]) => n === '깨진 파일.xlsx' && s === 'unreadable'));

  // 요약 저장: 원문 없이 개수만
  const last = svc.lastSummary();
  assert.strictEqual(last.files, found.length);
  assert.ok(!JSON.stringify(last).includes('900101'));

  // 제외
  const csv = found.find((r) => r.name.startsWith('연락처'));
  assert.ok(svc.exclude(csv.path));
  assert.strictEqual(svc.exclusions().length, 1);

  // 결과에 없는 경로는 지우지 않는다
  const outside = path.join(env.platform.paths.desktop, '메모.txt');
  const r0 = await svc.remove({ paths: [outside] });
  assert.strictEqual(r0[0].ok, false);
  assert.ok(fs.existsSync(outside));

  // 잠긴 파일
  const hwp = found.find((r) => r.name === '학부모 상담 기록.hwp');
  env.platform._state().lockedFiles.push(hwp.path);
  const r1 = await svc.remove({ paths: [hwp.path, roster.path] });
  assert.deepStrictEqual(r1.map((x) => [x.ok, x.reason]), [[false, 'locked'], [true, undefined]]);
  assert.ok(!fs.existsSync(roster.path), '휴지통으로 이동');

  // 복구하기 어렵게 지우기
  const docx = found.find((r) => r.name.endsWith('.docx') && r.name.startsWith('현장체험'));
  const r2 = await svc.remove({ paths: [docx.path], secure: true });
  assert.ok(r2[0].ok);
  assert.ok(!fs.existsSync(docx.path));

  // 다시 검사하면 제외 파일은 빠짐
  svc.start({ roots: [env.platform.paths.downloads] });
  await waitFor(() => !svc.results().running);
  assert.ok(!svc.results().results.some((r) => r.name.startsWith('연락처')));
  assert.strictEqual(svc.results().summary.excluded, 1);
});

test('개인정보: 클라우드 전용 파일은 건너뛴다', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const target = path.join(env.platform.paths.desktop, '3학년 2반 명단.xlsx');
  env.platform._state().cloudOnly = [target];
  const svc = createPrivacyService(env);
  svc.start({ roots: [env.platform.paths.desktop] });
  await waitFor(() => !svc.results().running);
  const r = svc.results().results.find((x) => x.path === target);
  assert.strictEqual(r.status, 'skipped-cloud');
});

test('폰트: 분류·정리·되돌리기·학교안심 설치', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createFontService(env);
  const l = svc.list();
  const by = Object.fromEntries(l.items.filter((i) => i.scope === 'user' || !l.items.some((x) => x.name === i.name && x.scope === 'user')).map((i) => [i.name, i]));
  assert.strictEqual(by['산돌테스트고딕'].class, 'caution');
  assert.strictEqual(by['윤테스트명조'].class, 'caution');
  assert.strictEqual(by['오픈테스트'].class, 'safe');
  assert.strictEqual(by['수상한글꼴'].class, 'unknown');
  assert.strictEqual(by['Cafe24 PRO Slim'].class, 'safe');
  const sysSandoll = l.items.find((i) => i.scope === 'system' && i.class === 'caution');
  assert.ok(sysSandoll && sysSandoll.removable && sysSandoll.needsAdmin, '이 PC 전체 폰트도 확인 창을 거쳐 정리 가능');
  const userCaution = l.items.filter((i) => i.class === 'caution' && i.scope === 'user');
  assert.strictEqual(userCaution.length, 2);
  assert.strictEqual(l.summary.cautionRemovable, 3);
  const sysUnknown = l.items.find((i) => i.scope === 'system' && i.class === 'unknown');
  if (sysUnknown) assert.strictEqual(sysUnknown.removable, false, '정보 없는 PC 전체 폰트는 정리하지 않음');

  // 내 계정 폰트: 확인 창 없이
  const res = await svc.clean(userCaution.map((i) => i.id));
  assert.strictEqual(res.results.filter((x) => x.ok).length, 2);
  assert.ok(!fs.existsSync(by['산돌테스트고딕'].file));
  assert.ok(!env.platform._log().some((x) => x.op === 'elevated'));
  const l2 = svc.list();
  assert.strictEqual(l2.summary.cautionRemovable, 1);
  assert.strictEqual(l2.undo.length, 1);

  // PC 전체 폰트: 확인 창에서 [아니요] → 그대로
  env.platform._state().elevate = 'no';
  const r2 = await svc.clean([sysSandoll.id]);
  assert.strictEqual(r2.canceled, true);
  assert.strictEqual(r2.results[0].ok, false);
  assert.ok(fs.existsSync(sysSandoll.file));
  // [예] → 레지스트리(HKLM)와 파일이 지워짐, 백업 후 되돌리기 가능
  env.platform._state().elevate = 'yes';
  const r3 = await svc.clean([sysSandoll.id]);
  assert.strictEqual(r3.results[0].ok, true);
  assert.ok(!fs.existsSync(sysSandoll.file));
  assert.strictEqual(env.platform.reg.read('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', sysSandoll.regName), undefined);
  const u3 = await svc.undo(r3.batchId);
  assert.ok(u3.ok && u3.restored === 1);
  assert.ok(fs.existsSync(sysSandoll.file));
  assert.ok(env.platform.reg.read('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', sysSandoll.regName));

  const u = await svc.undo(res.batchId);
  assert.strictEqual(u.restored, 2);
  assert.ok(fs.existsSync(by['산돌테스트고딕'].file));
  assert.strictEqual(svc.list().summary.cautionRemovable, 3);

  assert.strictEqual(l.school.allInstalled, false);
  const inst = svc.installSchool();
  assert.ok(inst.length >= 1 && inst.every((x) => x.ok));
  assert.strictEqual(svc.list().school.allInstalled, true);
});

test('PC암호: 없음 → 만들기 → D-day, 틀린 암호·정책 위반', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createPasswordService(env);
  let st = await svc.status();
  assert.strictEqual(st.hasPassword, false);
  assert.strictEqual(st.level, 'danger');
  assert.strictEqual((await svc.change({ current: '', next: 'ab', confirm: 'ab' })).code, 'policy');
  assert.strictEqual((await svc.change({ current: '', next: 'abcd1', confirm: 'abcd2' })).code, 'mismatch');
  const ok = await svc.change({ current: '', next: 'school2026', confirm: 'school2026' });
  assert.ok(ok.ok);
  st = ok.status;
  assert.strictEqual(st.hasPassword, true);
  assert.strictEqual(st.dday, 90);
  assert.strictEqual(st.level, 'ok');
  // 틀린 암호 3번이면 잠시 막는다
  for (let i = 0; i < 2; i++) assert.strictEqual((await svc.change({ current: 'x', next: 'new12345', confirm: 'new12345' })).code, 'wrong-password');
  const third = await svc.change({ current: 'x', next: 'new12345', confirm: 'new12345' });
  assert.ok(third.warnLock);
  assert.strictEqual((await svc.change({ current: 'school2026', next: 'new12345', confirm: 'new12345' })).code, 'cooldown');
  // 암호 유무 확인(빈 암호 로그인 시도)은 하루 1회만
  const before = env.platform._state().probeCount;
  for (let i = 0; i < 5; i++) await svc.status({ refresh: true });
  assert.strictEqual(env.platform._state().probeCount, before, '여러 번 열어도 다시 확인하지 않음');
  // 저장소에 암호가 남지 않는다
  const all = fs.readdirSync(env.store.dir).map((f) => { try { return fs.readFileSync(path.join(env.store.dir, f), 'utf8'); } catch { return ''; } }).join('');
  assert.ok(!all.includes('school2026'));
});

test('PC암호: 변경일 경과·임박', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const a = env.platform._state().account;
  a.password = 'pw'; a.passwordSetAt = Date.now() - 80 * 86400000;
  const svc = createPasswordService(env);
  let st = await svc.status({ refresh: true });
  assert.strictEqual(st.level, 'warn');
  assert.ok(st.dday <= 10 && st.dday >= 9);
  a.passwordSetAt = Date.now() - 100 * 86400000;
  st = await svc.status({ refresh: true });
  assert.strictEqual(st.level, 'danger');
  assert.ok(st.dday < 0);
  // Microsoft 계정은 직접 입력한 날짜 사용
  a.type = 'microsoft';
  svc.setManualDate(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  st = await svc.status({ refresh: true });
  assert.strictEqual(st.source, 'manual');
  assert.strictEqual(st.canChangeHere, false);
});

test('화면보호기: 꺼짐 → 안전 설정 → 되돌리기', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createScreensaverService(env);
  assert.strictEqual(svc.status().safe, false);
  const r = svc.secureSetup();
  assert.ok(r.ok && r.status.safe && r.status.minutes === 10);
  assert.ok(env.platform._log().some((l) => l.op === 'spi' && l.secure === true));
  const u = svc.undo();
  assert.strictEqual(u.status.safe, false);
});

test('업데이트: 크롬은 이 PC의 구글 업데이트 답을 따른다', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  assert.strictEqual(cmpVersion('128.0.6613.120', '141.0.7390.65'), -1);
  const st = env.platform._state();
  const svc = createUpdateService(env);
  const chrome = async () => (await svc.check()).find((u) => u.id === 'chrome');

  // 구글 업데이트가 '최신'이라고 하면, 서버 최신 번호가 더 높아도 최신으로 본다(학교 PC 오판 사례).
  st.chromeUpdate.available = false;
  let c = await chrome();
  assert.strictEqual(c.state, 'latest');
  assert.strictEqual(c.via, 'updater');

  // 받을 업데이트가 있으면 '업데이트 있음' + 새 버전
  st.chromeUpdate.available = true;
  c = await chrome();
  assert.strictEqual(c.state, 'outdated');
  assert.strictEqual(c.latest, '140.0.7339.128');
});

test('업데이트: 크롬 업데이트 진행률 → 다시 켜기', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const events = [];
  const svc = createUpdateService({ ...env, emit: (ch, p) => events.push(p) });
  const r = await svc.run('chrome');
  assert.ok(r.inline);
  assert.strictEqual((await svc.check()).find((u) => u.id === 'chrome').state, 'updating');
  await waitFor(() => events.some((e) => e.final));
  const phases = events.map((e) => e.phase);
  assert.ok(phases.includes('downloading') && phases.includes('installing'));
  assert.ok(events.some((e) => e.phase === 'downloading' && e.percent === 100));
  assert.strictEqual(events[events.length - 1].phase, 'done');
  assert.strictEqual((await svc.check()).find((u) => u.id === 'chrome').state, 'restart');
  // 다시 켜기: 크롬을 정상 종료 요청 후 탭 복원 옵션으로 실행
  const rr = await svc.run('chrome');
  assert.ok(rr.ok);
  const log = env.platform._log();
  assert.ok(log.some((l) => l.op === 'close' && l.image === 'chrome.exe'));
  assert.ok(log.some((l) => l.op === 'launch' && /chrome\.exe$/.test(l.file) && l.args.includes('--restore-last-session')));
  assert.strictEqual((await svc.check()).find((u) => u.id === 'chrome').state, 'latest');
});

test('업데이트: 구글 업데이트를 못 쓰면 주소창 대체, 서버 번호는 2판 이상 뒤처질 때만', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const st = env.platform._state();
  st.chromeUpdate.unavailable = true;
  const events = [];
  const svc = createUpdateService({ ...env, emit: (ch, p) => events.push(p) });
  let c = (await svc.check()).find((u) => u.id === 'chrome');
  assert.strictEqual(c.via, 'server');
  assert.strictEqual(c.state, 'outdated', '128 vs 141: 크게 뒤처짐');
  st.chromeLatest = '129.0.1.1';
  c = (await svc.check()).find((u) => u.id === 'chrome');
  assert.strictEqual(c.state, 'unknown', '한 판 차이는 순차 배포일 수 있음');
  await svc.run('chrome');
  await waitFor(() => events.some((e) => e.final));
  assert.strictEqual(events[events.length - 1].phase, 'opened');
  assert.ok(env.platform._log().some((l) => l.op === 'omnibox'));
});

test('업데이트: 한글은 실제 업데이트 프로그램 경로와 Hwp.exe 버전', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createUpdateService(env);
  const hg = (await svc.check()).find((u) => u.id === 'hangul');
  assert.strictEqual(hg.version, '12.0.0.3650', '설치 목록 번호가 아니라 Hwp.exe 버전');
  assert.strictEqual(hg.hasUpdater, true);
  const r = await svc.run('hangul');
  assert.ok(r.ok);
  assert.ok(env.platform._log().some((l) => l.op === 'openPath' && /Office 2022[\\/]HncUtils[\\/]Service[\\/]HncUpdater\.exe$/.test(l.path)), '더블클릭 방식으로 실행');
  // 실행했는데 프로세스가 뜨지 않으면 '열었어요' 대신 방법 안내
  env.platform._state().openFails = ['hncupdater.exe'];
  env.platform._state().processes = env.platform._state().processes.filter((p) => p.toLowerCase() !== 'hncupdater.exe');
  const fail = await svc.run('hangul');
  assert.strictEqual(fail.ok, false);
  assert.ok(fail.howto);
  fs.unlinkSync(path.join(env.platform.paths.programFilesX86, 'Hnc', 'Office 2022', 'HncUtils', 'Service', 'HncUpdater.exe'));
  const hg2 = (await svc.check()).find((u) => u.id === 'hangul');
  assert.strictEqual(hg2.hasUpdater, false);
  assert.ok((await svc.run('hangul')).howto, '못 찾으면 방법 안내');
});

test('업데이트: Windows·오피스', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const list = await createUpdateService(env).check();
  assert.strictEqual(list.find((u) => u.id === 'windows').state, 'latest');
  assert.strictEqual(list.find((u) => u.id === 'office').clickToRun, true);
});

test('바탕화면: 학기 계산', () => {
  assert.strictEqual(semesterOf(new Date(2026, 2, 1).getTime()), '2026학년도 1학기');
  assert.strictEqual(semesterOf(new Date(2026, 7, 31).getTime()), '2026학년도 1학기');
  assert.strictEqual(semesterOf(new Date(2026, 8, 1).getTime()), '2026학년도 2학기');
  assert.strictEqual(semesterOf(new Date(2027, 1, 28).getTime()), '2026학년도 2학기');
});

test('바탕화면: 미리보기·정리·되돌리기', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const scanPrivacy = (roots) => new Promise((resolve) => {
    const m = new Map();
    env.spawnScan({ roots, recursive: false, exclusions: [] }, (ev) => {
      if (ev.type === 'result' && ev.result.status === 'found') m.set(ev.result.path, ev.result);
      if (ev.type === 'done') resolve(m);
    });
  });
  const svc = createDesktopService({ ...env, scanPrivacy });
  const D = env.platform.paths.desktop;
  const before = fs.readdirSync(D).sort();
  const plan = await svc.plan({ scope: 'old', olderThanMonths: 3, groupBy: 'semester-type' });
  assert.ok(plan.moveCount > 5);
  assert.ok(!plan.moves.some((m) => m.name.endsWith('.lnk') || m.name.endsWith('.url')), '바로가기는 옮기지 않음');
  assert.ok(!plan.moves.some((m) => m.name === '메모.txt'), '최근 파일은 그대로');
  assert.ok(plan.tree.length >= 2);
  assert.ok(plan.extras.installers.some((x) => x.name === 'HncSetup_2024.exe'));
  assert.ok(plan.extras.extracted.some((x) => x.name === '수업자료 모음.zip'));
  assert.ok(plan.extras.duplicates.some((x) => x.name === '현장학습 사진 - 복사본.jpg'));
  assert.ok(plan.extras.broken.some((x) => x.name === '옛날 프로그램.lnk'));
  assert.ok(plan.privacy.some((x) => x.name === '3학년 2반 명단.xlsx'));
  assert.ok(plan.tree.some((n) => n.privacy > 0), '미리보기에 개인정보 표시');

  // 계획에 없는 경로는 지우지 않는다
  const memo = path.join(D, '메모.txt');
  const dup = plan.extras.duplicates[0].path;
  const res = await svc.apply({ planId: plan.id, deletePaths: [dup, memo] });
  assert.ok(res.ok);
  assert.strictEqual(res.trashed, 1);
  assert.ok(fs.existsSync(memo));
  assert.ok(fs.existsSync(path.join(D, '바탕화면 보관함')));
  assert.ok(fs.existsSync(path.join(D, 'Chrome.lnk')));

  // 같은 계획 두 번 적용 불가
  assert.strictEqual((await svc.apply({ planId: plan.id })).ok, false);

  const u = await svc.undo(res.logId);
  assert.strictEqual(u.restored, res.moved);
  assert.ok(!fs.existsSync(path.join(D, '바탕화면 보관함')), '빈 보관함 정리');
  const after = fs.readdirSync(D).sort();
  assert.deepStrictEqual(after, before.filter((n) => n !== path.basename(dup)));
  assert.strictEqual(svc.history()[0].undone, true);
});

test('바탕화면: 이름이 겹치면 (2)를 붙인다', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createDesktopService({ ...env, scanPrivacy: async () => new Map() });
  const D = env.platform.paths.desktop;
  fs.mkdirSync(path.join(D, '바탕화면 보관함'), { recursive: true });
  fs.writeFileSync(path.join(D, '바탕화면 보관함', '메모.txt'), 'old');
  const plan = await svc.plan({ scope: 'all', groupBy: 'none', finds: { installers: false, duplicates: false, brokenShortcuts: false, privacy: false } });
  const memo = plan.moves.find((m) => m.name === '메모.txt');
  assert.ok(memo);
  const res = await svc.apply({ planId: plan.id });
  assert.ok(fs.existsSync(path.join(D, '바탕화면 보관함', '메모 (2).txt')));
  await svc.undo(res.logId);
  assert.ok(fs.existsSync(path.join(D, '메모.txt')));
  assert.strictEqual(fs.readFileSync(path.join(D, '바탕화면 보관함', '메모.txt'), 'utf8'), 'old');
});

test('브라우저: 찾기·치료·되돌리기·기록 지우기', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createBrowserService(env);
  const s = await svc.scan();
  const kinds = s.items.map((i) => `${i.verdict}:${i.kind}`);
  assert.ok(kinds.includes('adware:shortcut'));
  assert.ok(kinds.includes('adware:url'));
  assert.ok(kinds.includes('suspect:startup'));
  assert.ok(kinds.includes('suspect:task'));
  assert.ok(kinds.includes('suspect:proxy'));
  assert.ok(!s.items.some((i) => i.detail.includes('나이스')), '앱 모드 바로가기는 정상');
  assert.ok(!s.items.some((i) => i.detail.includes('Microsoft Edge')), '정상 엣지 바로가기는 제외');
  assert.ok(!s.items.some((i) => /kakao/i.test(i.detail)), '서명된 정상 프로그램은 제외');
  assert.ok(!s.items.some((i) => i.detail.includes('학교 홈페이지')), '일반 인터넷 바로가기는 제외');
  assert.ok(!s.items.some((i) => /google/i.test(i.detail)), '보호 목록은 제외');
  const proxy = s.items.find((i) => i.kind === 'proxy');
  assert.strictEqual(proxy.checked, false, '인터넷 연결 설정은 기본 해제');

  const ids = s.items.filter((i) => i.fixable).map((i) => i.id);
  const f = await svc.fix(ids);
  assert.strictEqual(f.fixed, ids.length);
  const link = JSON.parse(fs.readFileSync(path.join(env.platform.paths.desktop, 'Chrome.lnk'), 'utf8'));
  assert.strictEqual(link.args, '');
  assert.strictEqual((await svc.scan()).items.filter((i) => i.fixable).length, 0);
  const u = await svc.undo();
  assert.ok(u.restored >= 5);
  assert.strictEqual(u.manual, 2, '휴지통으로 보낸 아이콘은 직접 꺼내야 함');
  assert.ok((await svc.scan()).items.some((i) => i.kind === 'shortcut'));

  const c1 = await svc.cleanHistory({ browsers: ['chrome'] });
  assert.strictEqual(c1.code, 'running');
  await svc.closeBrowsers();
  const c2 = await svc.cleanHistory({ browsers: ['chrome', 'edge'], history: true, cache: true, cookies: false });
  assert.ok(c2.ok && c2.freed.chrome > 0);
  const prof = path.join(env.platform.paths.browserData.chrome, 'Default');
  assert.ok(fs.existsSync(path.join(prof, 'Login Data')), '저장된 비밀번호는 지우지 않음');
  assert.ok(fs.existsSync(path.join(prof, 'Network', 'Cookies')), '쿠키는 선택하지 않으면 남김');
  assert.ok(!fs.existsSync(path.join(prof, 'History')));
});

test('브라우저: 이 PC 전체 시작 프로그램(HKLM)도 확인 창을 거쳐 끄고 되돌린다', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const run = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
  const approved = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
  env.platform.reg.write(run, 'MyWebSearch', 1, '"C:\\Program Files\\MyWebSearch\\mws.exe" /startup');
  const svc = createBrowserService(env);
  const sc = await svc.scan();
  const it = sc.items.find((i) => i.kind === 'startup-machine');
  assert.ok(it && it.admin && it.fixable);
  assert.strictEqual(sc.admin, undefined, '따로 안내하는 목록은 없앰');
  const r = await svc.fix([it.id]);
  assert.ok(r.results.find((x) => x.id === it.id).ok);
  const v = env.platform.reg.read(approved, 'MyWebSearch');
  assert.ok(v && v.value[0] === 3, '꺼짐 표시');
  assert.ok(!(await svc.scan()).items.some((i) => i.kind === 'startup-machine'));
  const u = await svc.undo();
  assert.ok(u.ok);
  assert.strictEqual(env.platform.reg.read(approved, 'MyWebSearch'), undefined);
});
