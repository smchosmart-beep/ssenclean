// 가짜 PC에서 쎈Clean을 실제로 띄워 주요 흐름을 확인한다.
const { test, expect, _electron } = require('@playwright/test');
const os = require('os');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const SHOTS = process.env.SENCLEAN_SHOTS || '';

let app, win, root, errors;

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'senclean-e2e-'));
  // SENCLEAN_EXE를 주면 패키징된 실행 파일(ASAR)로 테스트한다.
  const exe = process.env.SENCLEAN_EXE;
  const args = exe ? [] : [APP];
  if (process.platform === 'linux') args.push('--no-sandbox');
  app = await _electron.launch({ executablePath: exe || undefined, args, env: { ...process.env, SENCLEAN_MOCK: '1', SENCLEAN_MOCK_ROOT: root } });
  win = await app.firstWindow();
  errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.setViewportSize({ width: 1280, height: 800 });
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function shot(name) { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `${name}.png`) }); }
const mockLog = () => app.evaluate(() => global.__sen.platform._log());

test('대시보드: 메뉴 순서대로 고정, 점검 중 표시', async () => {
  await expect(win.getByTestId('dash-hero')).toContainText(/해결할 일이|점검하고 있어요/, { timeout: 20000 });
  const rows = win.getByTestId('dash-rows').locator('.row:not(.pending)');
  await expect(rows).toHaveCount(9, { timeout: 30000 });
  await expect(win.getByTestId('dash-rows').locator('.row.pending')).toHaveCount(0);
  await expect(win.getByTestId('recheck')).toHaveText('다시 점검');
  const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(ids).toEqual(['dash-privacy', 'dash-fonts', 'dash-password', 'dash-screensaver', 'dash-updates', 'dash-cdrive', 'dash-browser', 'dash-desktop', 'dash-network']);
  const nav = await win.locator('#nav .btn').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(nav).toEqual(['nav-dashboard', 'nav-privacy', 'nav-fonts', 'nav-password', 'nav-screensaver', 'nav-updates', 'nav-cdrive', 'nav-browser', 'nav-desktop', 'nav-network']);
  await expect(win.getByTestId('dash-fonts')).toContainText('사용 주의 폰트 3개');
  await expect(win.getByTestId('dash-password')).toContainText('PC암호가 없어요');
  await expect(win.getByTestId('nav-password').locator('.dot')).toHaveClass(/danger/);
  await shot('01-dashboard');
});

test('화면보호기: 대시보드에서 바로 안전 설정', async () => {
  await win.getByTestId('dash-action-screensaver').click();
  await expect(win.getByTestId('dash-screensaver')).toContainText('10분 후 잠겨요');
  const log = await mockLog();
  expect(log.some((l) => l.op === 'spi' && l.secure)).toBeTruthy();
});

test('개인정보 파일: 검사(별도 프로세스) → 미리보기 → 제외 → 지우기', async () => {
  await win.getByTestId('nav-privacy').click();
  await win.getByTestId('privacy-start').click();
  await expect(win.locator('.hero h1')).toContainText('찾았어요', { timeout: 60000 });
  const items = win.getByTestId('file-item');
  const n = await items.count();
  expect(n).toBeGreaterThanOrEqual(7);
  // PDF도 별도 검사 프로세스에서 실제로 읽혀야 한다
  await expect(items.filter({ hasText: '교직원 비상연락망.pdf' })).toHaveCount(1);
  await expect(items.first()).toHaveClass(/tone-danger/);
  await items.filter({ hasText: '3학년 2반 명단.xlsx' }).click();
  const preview = win.getByTestId('preview');
  await expect(preview).toContainText('900101-1******');
  await expect(preview).not.toContainText('1234567');
  await shot('02-privacy');
  await items.filter({ hasText: '연락처 명단' }).getByTestId('file-ok').click();
  await expect(items).toHaveCount(n - 1);
  // 전체 해제 후 하나만 골라 지우기
  await win.getByTestId('select-all').click();
  await items.filter({ hasText: '3학년 2반 명단.xlsx' }).getByTestId('file-check').check();
  await win.getByTestId('delete-selected').click();
  await win.getByTestId('confirm-ok').click();
  await expect(items).toHaveCount(n - 2);
  expect(fs.existsSync(path.join(root, 'Users', 'teacher', 'Desktop', '3학년 2반 명단.xlsx'))).toBeFalsy();
  await expect(win.getByTestId('issues-panel')).toContainText('확인하지 못한 파일');
  await expect(win.getByTestId('issues-panel').locator('.row')).toHaveCount(0); // 기본 접힘
  await win.getByTestId('issues-toggle').click();
  await expect(win.getByTestId('issues-panel').locator('.row').first()).toBeVisible();
});

test('폰트: 사용 주의 정리 → 되돌리기, 미리보기 폰트 로드', async () => {
  await win.getByTestId('nav-fonts').click();
  await expect(win.getByTestId('font-item')).toHaveCount(3, { timeout: 15000 });
  await expect.poll(() => win.evaluate(() => [...document.fonts].filter((f) => f.family.startsWith('sf-') && f.status === 'loaded').length), { timeout: 10000 }).toBeGreaterThan(0);
  await shot('03-fonts');
  await expect(win.getByTestId('fonts-clean-top')).toBeInViewport(); // 맨 위에도 실행 버튼
  await expect(win.getByTestId('fonts-clean')).toBeInViewport(); // 아래 막대는 화면 아래 고정
  await expect(win.getByTestId('font-basis').first()).toContainText('근거:');
  await expect(win.getByTestId('font-check')).toHaveCount(3);
  expect(await win.getByTestId('font-check').evaluateAll((els) => els.filter((e) => (e.querySelector('input') || e).checked).length)).toBe(2); // PC 전체 폰트는 기본 체크 해제
  await expect(win.getByTestId('fonts-select-all')).not.toBeChecked();
  await win.getByTestId('fonts-select-all').click();
  await expect(win.getByTestId('fonts-select-all')).toBeChecked();
  await win.getByTestId('fonts-clean').click();
  await win.getByTestId('confirm-ok').click(); // 열린 프로그램 없음 → 바로 정리 확인
  await expect(win.locator('.hero h1')).toContainText('정리할 폰트가 없어요');
  await expect(win.getByTestId('fonts-archive-note')).toContainText('쎈Clean 폰트 보관함');
  expect(fs.readdirSync(path.join(root, '_D', '쎈Clean 폰트 보관함')).length).toBe(1);
  expect((await mockLog()).some((l) => l.op === 'elevated' && (l.ops || []).includes('regDelete'))).toBeTruthy(); // PC 전체 폰트는 확인 창을 거침
  await win.getByTestId('fonts-undo').click();
  await expect(win.locator('.hero h1')).toContainText('사용 주의 폰트');
  await win.getByTestId('font-tab-school').click();
  await win.getByTestId('install-school').click();
  await expect(win.locator('text=모두 설치되어 있어요')).toBeVisible();
});

test('PC암호: 만들기 → D-day', async () => {
  await win.getByTestId('nav-password').click();
  await expect(win.getByTestId('pw-has')).toHaveText('⚠ 없음');
  await shot('04-password');
  await win.getByTestId('pw-open-form').click();
  await expect(win.getByTestId('pw-current')).toHaveCount(0);
  await win.getByTestId('pw-next').fill('school2026');
  await win.getByTestId('pw-confirm').fill('school2027');
  await win.getByTestId('pw-submit').click();
  await expect(win.getByTestId('pw-error')).toContainText('서로 달라요');
  await win.getByTestId('pw-next').fill('school2026');
  await win.getByTestId('pw-confirm').fill('school2026');
  await win.getByTestId('pw-submit').click();
  await expect(win.getByTestId('pw-dday')).toHaveText('D-90');
  await expect(win.getByTestId('nav-password').locator('.dot')).toHaveClass(/ok/);
});

test('업데이트: 크롬을 쎈Clean 안에서 업데이트 → 재부팅 안내, 한글 업데이트 프로그램', async () => {
  await win.getByTestId('nav-updates').click();
  const row = win.getByTestId('upd-row-chrome');
  await expect(row).toContainText('업데이트 있음', { timeout: 20000 });
  await expect(row).toContainText('새 버전 140.0.7339.128');
  await shot('05-updates');
  await win.getByTestId('upd-chrome').click();
  await expect(row).toContainText('PC를 다시 켜면 적용돼요', { timeout: 15000 });
  await expect(win.getByTestId('upd-chrome')).toHaveCount(0); // 다시 켜기 버튼 없음(반복 방지)
  await shot('05b-updates-restart');
  const log = await mockLog();
  expect(log.some((l) => l.op === 'chromeInstall')).toBeTruthy();
  expect(log.some((l) => l.op === 'close' && l.image === 'chrome.exe')).toBeFalsy(); // 크롬을 끄지 않음
  // 재부팅 뒤(대기 파일이 적용되면) 최신
  fs.rmSync(path.join(root, 'Program Files', 'Google', 'Chrome', 'Application', 'new_chrome.exe'), { force: true });
  await win.getByTestId('upd-recheck').click();
  await expect(row).toContainText('최신', { timeout: 15000 });
  await expect(win.getByTestId('upd-row-hangul')).toContainText('12.0.0.3650');
  await expect(win.getByTestId('upd-hangul')).toHaveText('업데이트 열기');
  await win.getByTestId('upd-hangul').click();
  await expect(win.locator('.toast').last()).toContainText('업데이트 창을 열었어요', { timeout: 10000 });
  await expect.poll(async () => (await mockLog()).some((l) => l.op === 'openPath' && /HncUpdater\.exe$/.test(l.path))).toBeTruthy();
});

test('C드라이브 정리: 찾기 → 오래된 순 → 드라이브 골라 옮기기 → 되돌리기 → 지우기 → 휴지통 비우기', async () => {
  // 옮길 드라이브를 하나 더(E) 만든다
  await app.evaluate(() => { const st = global.__sen.platform._state(); st.disks.E = { total: 500 * 1024 ** 3, free: 2 * 1024 ** 3, label: 'USB', removable: true }; });
  await win.getByTestId('nav-cdrive').click();
  await expect(win.getByTestId('cdrive-hero')).toContainText('꽉 찼어요');
  await expect(win.getByTestId('cdrive-why')).toBeVisible(); // 처음엔 펼쳐서 보여 줌
  await expect(win.getByTestId('disk-D')).toContainText('D드라이브');
  await expect(win.getByTestId('recycle-panel')).toBeVisible(); // 정리 방법 카드 3개가 목록보다 위
  await win.getByTestId('open-appwiz').click();
  await expect.poll(async () => (await mockLog()).some((l) => l.op === 'launch' && (l.args || [])[0] === 'appwiz.cpl')).toBeTruthy();
  await shot('12-cdrive-top');
  await win.getByTestId('cdrive-scan').click();
  const items = win.getByTestId('cd-item');
  await expect(items).toHaveCount(8, { timeout: 30000 });
  await expect(items.first()).toContainText('Windows10_22H2.iso'); // 오래된 순(500일 전)이 기본
  await win.getByTestId('cd-sort-size').click();
  await expect(items.first()).toContainText('Windows10_22H2.iso'); // 큰 순도 5.1GB가 처음
  await expect(items.nth(2)).toContainText('졸업식 2025.mov'); // 2.4GB
  await win.getByTestId('cd-sort-old').click();
  await expect(items.nth(2)).toContainText('한컴오피스2022_설치.exe'); // 300일 전
  await expect(win.getByTestId('cd-select-old')).toContainText('1년 넘은 것 선택 (1)');

  // 동영상만 골라 옮기기: 드라이브가 여럿이면 고르기 창
  await win.getByTestId('cd-tab-video').click();
  await expect(items).toHaveCount(4);
  await items.filter({ hasText: '운동회 전체 촬영.mp4' }).locator('input[type=checkbox]').check();
  await shot('12-cdrive-results');
  await expect(win.getByTestId('cd-move')).toHaveText('다른 드라이브로 옮기기');
  await win.getByTestId('cd-move').click();
  await expect(win.getByTestId('drive-picker')).toBeVisible();
  await expect(win.getByTestId('pick-btn-E')).toBeDisabled(); // 2GB뿐이라 공간 부족
  await expect(win.getByTestId('pick-D')).toContainText('추천');
  await shot('14-cdrive-picker');
  await win.getByTestId('pick-btn-D').click();
  await expect(win.getByTestId('cdrive-last')).toContainText('D드라이브로 1개', { timeout: 20000 });
  const moved = path.join(root, '_D', 'C드라이브에서 옮긴 파일', '내 동영상', '운동회 전체 촬영.mp4');
  expect(fs.existsSync(moved)).toBeTruthy();
  const link = path.join(root, 'Users', 'teacher', 'Desktop', 'D드라이브로 옮긴 파일.lnk');
  expect(fs.existsSync(link)).toBeTruthy();
  expect(fs.existsSync(path.join(root, 'Users', 'teacher', 'Videos', '운동회 전체 촬영.mp4.lnk'))).toBeFalsy();
  await shot('13-cdrive-moved');
  await win.getByTestId('cdrive-undo').click();
  await expect(win.getByTestId('cdrive-last')).toHaveCount(0);
  expect(fs.existsSync(path.join(root, 'Users', 'teacher', 'Videos', '운동회 전체 촬영.mp4'))).toBeTruthy();
  expect(fs.existsSync(link)).toBeFalsy();

  // 설치파일 지우기 → 휴지통 비우기
  await win.getByTestId('cdrive-scan').click();
  await win.getByTestId('cd-tab-installer').click();
  await expect(items).toHaveCount(4, { timeout: 30000 });
  await win.getByTestId('cd-select-all').check();
  await win.getByTestId('cd-delete').click();
  await win.getByTestId('confirm-ok').click();
  await expect(win.getByTestId('empty-recycle')).toBeEnabled({ timeout: 10000 });
  await win.getByTestId('empty-recycle').click();
  await win.getByTestId('confirm-ok').click();
  await expect(win.getByTestId('recycle-panel')).toContainText('비어 있어요');
  await expect(win.getByTestId('cdrive-hero')).not.toContainText('남은 공간 9.0GB');
  await app.evaluate(() => { delete global.__sen.platform._state().disks.E; });
});

test('바탕화면 정리: 미리보기 → 정리 → 되돌리기', async () => {
  const D = path.join(root, 'Users', 'teacher', 'Desktop');
  const before = fs.readdirSync(D).sort();
  await win.getByTestId('nav-desktop').click();
  await win.getByTestId('desktop-preview').click();
  await expect(win.getByTestId('desktop-tree')).toBeVisible({ timeout: 30000 });
  await shot('06-desktop-preview');
  // 미리보기에서 고치기: 폴더 펼치기 → 한 파일은 그대로 두기 → 폴더 이름 바꾸기
  const folder = win.getByTestId('desktop-folder').filter({ hasText: '학생·학급' }).first();
  await folder.locator('.linkish').click();
  const firstFile = win.getByTestId('desktop-file').first();
  const keptName = (await firstFile.locator('.fname').textContent()).trim();
  await firstFile.getByTestId('desktop-file-check').uncheck();
  await win.getByTestId('desktop-folder').filter({ hasText: '기타' }).first().getByTestId('desktop-rename').click();
  await win.getByTestId('name-input').fill('방과후');
  await win.getByTestId('name-ok').click();
  await expect(win.getByTestId('desktop-tree')).toContainText('방과후');
  await win.getByTestId('desktop-apply').click();
  await expect(win.getByTestId('desktop-undo')).toBeVisible();
  expect(fs.existsSync(path.join(D, keptName))).toBeTruthy(); // 그대로 두기로 한 파일
  expect(fs.readdirSync(path.join(D, '바탕화면 보관함'), { recursive: true }).some((p) => String(p).includes('방과후'))).toBeTruthy();
  await expect(win.locator('.hero h1')).toContainText('바탕화면을 정리했어요');
  expect(fs.existsSync(path.join(D, '바탕화면 보관함'))).toBeTruthy();
  expect(fs.existsSync(path.join(D, 'Chrome.lnk'))).toBeTruthy();
  await win.getByTestId('desktop-undo').click();
  await expect(win.getByTestId('desktop-preview')).toBeVisible();
  expect(fs.readdirSync(D).sort()).toEqual(before);
});

test('브라우저 청소: 광고 치료 → 기록 지우기', async () => {
  await win.getByTestId('nav-browser').click();
  await expect(win.getByTestId('ad-item').first()).toBeVisible({ timeout: 20000 });
  await shot('07-browser');
  await win.getByTestId('ad-fix').click();
  await win.getByTestId('confirm-ok').click();
  await expect(win.locator('.hero h1')).toContainText('찾았어요');
  const link = JSON.parse(fs.readFileSync(path.join(root, 'Users', 'teacher', 'Desktop', 'Chrome.lnk'), 'utf8'));
  expect(link.args).toBe('');
  await win.getByTestId('tab-history').click();
  await expect(win.getByTestId('h-clean')).toBeVisible();
  if (await win.getByTestId('close-browsers').count()) {
    await win.getByTestId('close-browsers').click();
    await win.getByTestId('confirm-ok').click();
  }
  await win.getByTestId('h-clean').click();
  await win.getByTestId('confirm-ok').click();
  await expect(win.locator('.toast').last()).toContainText('비웠어요');
});

test('IP 주소: 교사 - 내 IP 복사 → 받은 메시지 붙여넣기 → 바꾸기 → 원래대로', async () => {
  await win.getByTestId('nav-network').click();
  await expect(win.getByTestId('net-hero')).toContainText('10.20.3.42', { timeout: 15000 });
  await win.getByTestId('net-room').fill('3학년 2반');
  await win.getByTestId('net-copy').click();
  await expect.poll(() => app.evaluate(() => global.__sen.platform._state().clipboard)).toContain('[쎈Clean IP 정보] 3학년 2반');
  await shot('09-network-mine');
  // 정보부장이 보낸 메시지가 클립보드에 있다고 치고 [받은 내용 붙여넣기]
  await app.evaluate(() => { global.__sen.platform.clipboard.write('[쎈클린 IP 변경] 3학년 2반\nIP 10.20.3.77 / 서브넷 255.255.255.0 / 게이트웨이 10.20.3.1\nDNS 10.20.0.1, 10.20.0.2'); });
  await win.getByTestId('net-paste-btn').click();
  await expect(win.getByTestId('net-ip')).toHaveValue('10.20.3.77');
  await expect(win.getByTestId('net-gateway')).toHaveValue('10.20.3.1');
  // 잘못 고치면 막는다
  await win.getByTestId('net-gateway').fill('10.20.9.1');
  await win.getByTestId('net-apply').click();
  await expect(win.locator('.field-err').filter({ hasText: '앞자리가 달라요' })).toBeVisible();
  await win.getByTestId('net-gateway').fill('10.20.3.1');
  await win.getByTestId('net-apply').click();
  await win.getByTestId('confirm-ok').click();
  await expect(win.getByTestId('net-result')).toContainText('IP를 바꿨어요');
  await expect(win.getByTestId('net-hero')).toContainText('10.20.3.77');
  await shot('10-network-changed');
  await win.getByTestId('net-undo').click();
  await win.getByTestId('confirm-ok').click();
  await expect(win.getByTestId('net-hero')).toContainText('10.20.3.42');
});

test('IP 주소: 정보부장 - 받은 내용 저장 → 교실 목록 → IP 배정 메시지', async () => {
  await win.getByTestId('open-settings').click();
  await win.locator('select.sel').first().selectOption('admin');
  await win.getByTestId('nav-network').click();
  await win.getByTestId('tab-registry').click();
  // 교사가 보낸 메시지(앞 테스트에서 복사한 내용 형식)
  await app.evaluate(() => { global.__sen.platform.clipboard.write('[쎈Clean IP 정보] 3학년 2반\nPC이름 SM-3-2\nIP 10.20.3.42 / 서브넷 255.255.255.0 / 게이트웨이 10.20.3.1\nDNS 10.20.0.1, 10.20.0.2\nMAC 00-1A-2B-3C-4D-5E\n방식 고정 IP'); });
  await win.getByTestId('reg-paste-save').click();
  await app.evaluate(() => { global.__sen.platform.clipboard.write('[쎈클린 IP 정보] 3학년 1반\nPC이름 SM-3-1\nIP 10.20.3.41 / 서브넷 255.255.255.0 / 게이트웨이 10.20.3.1\nMAC AA-BB-CC-DD-EE-01'); });
  await win.getByTestId('reg-paste-save').click();
  await expect(win.getByTestId('reg-item')).toHaveCount(2);
  await win.getByTestId('def-dns1').fill('10.20.0.1');
  await win.getByTestId('def-save').click();
  const two = win.getByTestId('reg-item').filter({ hasText: '3학년 2반' });
  await two.getByTestId('reg-assign').click();
  await win.getByTestId('as-ip').fill('10.20.3.41');
  await win.getByTestId('as-make').click();
  await expect(win.locator('.modal h2').last()).toContainText('이미 쓰고 있는 IP예요');
  await win.getByTestId('confirm-cancel').click();
  await win.getByTestId('as-ip').fill('10.20.3.50');
  await win.getByTestId('as-make').click();
  await expect(win.getByTestId('as-message')).toContainText('IP 10.20.3.50 / 서브넷 255.255.255.0 / 게이트웨이 10.20.3.1');
  await expect.poll(() => app.evaluate(() => global.__sen.platform._state().clipboard)).toContain('[쎈Clean IP 변경] 3학년 2반');
  await win.keyboard.press('Escape');
  await expect(two).toContainText('변경 대기 → 10.20.3.50');
  await shot('11-network-registry');
});

test('설정 화면과 콘솔 오류 없음', async () => {
  await win.getByTestId('open-settings').click();
  await expect(win.locator('.page-title')).toHaveText('설정');
  await win.getByTestId('nav-dashboard').click();
  await expect(win.getByTestId('dash-rows').locator('.row:not(.skeleton)')).toHaveCount(9, { timeout: 20000 });
  await shot('08-dashboard-after');
  expect(errors).toEqual([]);
});
