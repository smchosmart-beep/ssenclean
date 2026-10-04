// 가짜 PC에서 쎈클린을 실제로 띄워 주요 흐름을 확인한다.
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

test('대시보드: 문제 순서대로 카드가 채워진다', async () => {
  await expect(win.getByTestId('dash-hero')).toContainText('해결할 일이', { timeout: 20000 });
  const rows = win.getByTestId('dash-rows').locator('.row:not(.skeleton)');
  await expect(rows).toHaveCount(7, { timeout: 20000 });
  await expect(rows.nth(0)).toHaveClass(/tone-danger/);
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
  await expect(win.locator('text=확인하지 못한 파일')).toBeVisible();
});

test('폰트: 사용 주의 정리 → 되돌리기, 미리보기 폰트 로드', async () => {
  await win.getByTestId('nav-fonts').click();
  await expect(win.getByTestId('font-item')).toHaveCount(3, { timeout: 15000 });
  await expect.poll(() => win.evaluate(() => [...document.fonts].filter((f) => f.family.startsWith('sf-') && f.status === 'loaded').length), { timeout: 10000 }).toBeGreaterThan(0);
  await shot('03-fonts');
  await win.getByTestId('fonts-clean').click();
  await win.getByTestId('confirm-ok').click(); // 열린 프로그램 없음 → 바로 정리 확인
  await expect(win.locator('.hero h1')).toContainText('정리할 폰트가 없어요');
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

test('업데이트: 크롬 구버전 표시와 공식 업데이트 실행', async () => {
  await win.getByTestId('nav-updates').click();
  await expect(win.getByTestId('upd-row-chrome')).toContainText('업데이트 있음', { timeout: 20000 });
  await shot('05-updates');
  await win.getByTestId('upd-chrome').click();
  await expect.poll(async () => (await mockLog()).some((l) => l.op === 'launch' && (l.args || [])[0] === 'chrome://settings/help')).toBeTruthy();
});

test('프로그램 제거: 제어판 창 열기', async () => {
  await win.getByTestId('nav-uninstall').click();
  await win.getByTestId('open-appwiz').click();
  await expect.poll(async () => (await mockLog()).some((l) => l.op === 'launch' && (l.args || [])[0] === 'appwiz.cpl')).toBeTruthy();
});

test('바탕화면 정리: 미리보기 → 정리 → 되돌리기', async () => {
  const D = path.join(root, 'Users', 'teacher', 'Desktop');
  const before = fs.readdirSync(D).sort();
  await win.getByTestId('nav-desktop').click();
  await win.getByTestId('desktop-preview').click();
  await expect(win.getByTestId('desktop-tree')).toBeVisible({ timeout: 30000 });
  await shot('06-desktop-preview');
  await win.getByTestId('desktop-apply').click();
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
  await win.getByTestId('close-browsers').click();
  await win.getByTestId('confirm-ok').click();
  await win.getByTestId('h-clean').click();
  await win.getByTestId('confirm-ok').click();
  await expect(win.locator('.toast').last()).toContainText('비웠어요');
});

test('설정 화면과 콘솔 오류 없음', async () => {
  await win.getByTestId('open-settings').click();
  await expect(win.locator('.page-title')).toHaveText('설정');
  await win.getByTestId('nav-dashboard').click();
  await expect(win.getByTestId('dash-rows').locator('.row:not(.skeleton)')).toHaveCount(7, { timeout: 20000 });
  await shot('08-dashboard-after');
  expect(errors).toEqual([]);
});
