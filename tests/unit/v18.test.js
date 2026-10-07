'use strict';
// 1.8.0: 크롬 업데이트 중 점검 현황, 우리 교실 이름 저장, 파일로 보내기·한꺼번에 넣기, 기본 브라우저
const test = require('node:test');
const assert = require('node:assert');
const { freshEnv } = require('./helpers');
const { createUpdateService } = require('../../core/updates');
const { createDashboard } = require('../../core/dashboard');
const { createNetworkService } = require('../../core/network');
const { createBrowserService } = require('../../core/browser');

test('크롬을 내려받는 동안 점검 현황은 "업데이트 중"(최신이라고 하지 않음)', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const updates = createUpdateService(env);
  const dash = createDashboard({ updates });
  const r = await updates.run('chrome');
  assert.ok(r.ok && r.inline);
  const c = await dash.check('updates');
  assert.strictEqual(c.title, '크롬 업데이트 중이에요');
  assert.notStrictEqual(c.level, 'ok');
  // 끝나면 '다시 켜면 적용'
  await new Promise((res) => setTimeout(res, 800));
  const c2 = await dash.check('updates');
  assert.match(c2.title, /크롬을 다시 시작하면/);
  assert.strictEqual(c2.action.label, '크롬 다시 시작');
});

test('우리 교실 이름은 입력하면 바로 저장', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createNetworkService(env);
  svc.setRoom('  5학년 1반 ');
  assert.strictEqual(createNetworkService(env).last().room, '5학년 1반');
});

test('파일로 보내기 → 정보부장이 여러 파일을 한꺼번에 넣기', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createNetworkService(env);
  await svc.load();
  const f = await svc.messageFile('3학년 2반');
  assert.strictEqual(f.fileName, '쎈Clean IP정보_3학년 2반_SCHOOL-PC.txt');
  assert.ok(f.content.startsWith('﻿[쎈Clean IP 정보] 3학년 2반\r\n'));
  assert.ok(f.content.includes('RAM 16GB\r\n'));
  const text = f.content.replace(/^﻿/, '');
  const other = text.replace('3학년 2반', '3학년 1반').replace('00-1A-2B-3C-4D-5E', 'AA-BB-CC-DD-EE-01').replace('10.20.3.42', '10.20.3.41');
  const r = svc.registryImportMany([
    { name: 'a.txt', text },
    { name: 'b.txt', text: other },
    { name: '회의록.txt', text: '오늘 회의 내용' },
    { name: 'a 다시.txt', text },
  ]);
  assert.deepStrictEqual([r.created, r.updated, r.failed.length], [2, 1, 1]);
  assert.strictEqual(r.failed[0].code, 'not-ip-file');
  const pcs = svc.registryList().pcs;
  assert.strictEqual(pcs.length, 2);
  assert.ok(pcs.every((p) => p.ram === '16GB'));
});

test('기본 브라우저: 지금 브라우저 확인 → 크롬 설정 창 열기 → 바뀌면 크롬', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const b = createBrowserService(env);
  const st = b.defaultBrowser();
  assert.deepStrictEqual([st.id, st.name, st.isChrome, st.chromeInstalled], ['edge', '엣지', false, true]);
  const r = await b.makeChromeDefault();
  assert.deepStrictEqual([r.ok, r.opened, r.win11], [true, true, true]);
  assert.ok(env.platform._log().some((l) => l.op === 'openExternal' && l.url === 'ms-settings:defaultapps?registeredAppMachine=Google%20Chrome'));
  // 사용자가 설정 창에서 [기본값으로 설정]을 누르면(Windows 11 24H2는 UserChoiceLatest)
  env.platform.reg.write('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest', 'ProgId', env.platform.REG.SZ, 'ChromeHTML');
  assert.strictEqual(b.defaultBrowser().isChrome, true);
  assert.strictEqual((await b.makeChromeDefault()).already, true);
  // Windows 10은 기본 앱 화면
  env.platform.osBuild = 19045;
  env.platform.reg.write('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest', 'ProgId', env.platform.REG.SZ, 'MSEdgeHTM');
  assert.strictEqual((await b.makeChromeDefault()).win11, false);
  assert.ok(env.platform._log().some((l) => l.op === 'openExternal' && l.url === 'ms-settings:defaultapps'));
});

test('기본 앱 설정 열기: 크롬이 기본이어도 열 수 있음', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  env.platform.reg.write('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', 'ProgId', env.platform.REG.SZ, 'ChromeHTML');
  const b = createBrowserService(env);
  assert.strictEqual(b.defaultBrowser().isChrome, true);
  const r = await b.openDefaultApps();
  assert.ok(r.opened);
  assert.ok(env.platform._log().some((l) => l.op === 'openExternal' && l.url.startsWith('ms-settings:defaultapps')));
});
