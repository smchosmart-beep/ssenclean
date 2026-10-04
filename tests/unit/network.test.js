'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../core/network-msg');
const { createNetworkService, parseCsv } = require('../../core/network');
const { freshEnv } = require('./helpers');

test('IP 계산·검증', () => {
  assert.strictEqual(M.maskToPrefix('255.255.255.0'), 24);
  assert.strictEqual(M.maskToPrefix('255.255.254.0'), 23);
  assert.strictEqual(M.maskToPrefix('255.0.255.0'), null);
  assert.strictEqual(M.suggestGateway('10.20.3.42'), '10.20.3.1');
  assert.strictEqual(M.suggestGateway('10.20.3.42', '255.255.255.0', '.254'), '10.20.3.254');
  assert.deepStrictEqual(M.validate({ ip: '10.20.3.42', mask: '255.255.255.0', gateway: '10.20.3.1' }), []);
  assert.strictEqual(M.validate({ ip: '10.20.3.42', mask: '255.255.255.0', gateway: '10.20.4.1' })[0].field, 'gateway');
  assert.strictEqual(M.validate({ ip: '10.20.3.0', mask: '255.255.255.0', gateway: '10.20.3.1' })[0].field, 'ip');
  assert.strictEqual(M.validate({ ip: '10.20.3.256', mask: '255.255.255.0' })[0].field, 'ip');
  assert.deepStrictEqual(M.validate({ dhcp: true }), []);
});

test('메시지: 교사 → 정보부장 → 교사, 그리고 사람이 쓴 메시지', () => {
  const info = { pcName: 'SM-3-2', ip: '10.20.3.42', mask: '255.255.255.0', gateway: '10.20.3.1', dns: ['10.20.0.1', '10.20.0.2'], mac: '00:1a:2b:3c:4d:5e' };
  const p = M.parseMessage(M.teacherMessage(info, '3학년 2반'));
  assert.strictEqual(p.kind, 'info');
  assert.strictEqual(p.room, '3학년 2반');
  assert.strictEqual(p.mac, '00:1A:2B:3C:4D:5E'.replace(/:/g, '-'));
  assert.strictEqual(p.pcName, 'SM-3-2');
  const a = M.parseMessage(M.assignMessage({ room: '3학년 2반', ip: '10.20.3.50', mask: '255.255.255.0', gateway: '10.20.3.1', dns1: '168.126.63.1' }));
  assert.strictEqual(a.kind, 'assign');
  assert.strictEqual(a.ip, '10.20.3.50');
  assert.strictEqual(a.dns2, '');
  const h = M.parseMessage('3-2반 아이피 10.1.5.23 서브넷마스크: 255.255.255.0 기본 게이트웨이 10.1.5.1 dns 168.126.63.1 / 168.126.63.2');
  assert.deepStrictEqual([h.ip, h.mask, h.gateway, h.dns1, h.dns2], ['10.1.5.23', '255.255.255.0', '10.1.5.1', '168.126.63.1', '168.126.63.2']);
  const bare = M.parseMessage('10.1.5.23\n255.255.255.0\n10.1.5.1\n168.126.63.1');
  assert.deepStrictEqual([bare.ip, bare.mask, bare.gateway, bare.dns1], ['10.1.5.23', '255.255.255.0', '10.1.5.1', '168.126.63.1']);
});

test('교사: 내 IP 보기·메시지 복사·IP 바꾸기·연결 확인·원래대로', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createNetworkService(env);
  const i = await svc.info();
  assert.strictEqual(i.primary.alias, '이더넷', '가상 어댑터가 아니라 실제 랜 카드');
  assert.strictEqual(i.primary.mask, '255.255.255.0');
  const msg = await svc.myMessage('3학년 2반');
  assert.ok(msg.includes('[쎈클린 IP 정보] 3학년 2반'));
  assert.strictEqual(env.platform._state().clipboard, msg);
  assert.strictEqual((await svc.info()).room, '3학년 2반');

  // 정보부장 메시지 붙여넣기 → 칸 채움 (게이트웨이 없으면 추천값)
  const p = svc.parse('[쎈클린 IP 변경] 3학년 2반\nIP 10.20.3.77 / 서브넷 255.255.255.0\nDNS 10.20.0.1');
  assert.strictEqual(p.gateway, '10.20.3.1');
  assert.deepStrictEqual(p.errors, []);

  // 잘못된 값은 바꾸지 않는다
  const bad = await svc.apply({ index: 12, ip: '10.20.3.77', mask: '255.255.255.0', gateway: '10.20.9.1' });
  assert.strictEqual(bad.code, 'invalid');
  assert.strictEqual((await svc.info()).primary.ip, '10.20.3.42');

  const r = await svc.apply({ index: 12, ip: '10.20.3.77', mask: '255.255.255.0', gateway: '10.20.3.1', dns1: '10.20.0.1', dns2: '' });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.check, { gateway: true, internet: true });
  assert.strictEqual(r.info.primary.ip, '10.20.3.77');
  assert.ok(r.info.canUndo);

  // 연결이 안 되는 게이트웨이 → 결과에 표시
  const r2 = await svc.apply({ index: 12, ip: '10.20.3.78', mask: '255.255.255.0', gateway: '10.20.3.2' });
  assert.strictEqual(r2.check.internet, false);
  const u = await svc.undo();
  assert.ok(u.ok);
  assert.strictEqual(u.info.primary.ip, '10.20.3.77', '바로 전 설정으로 되돌림');

  // 권한이 없는 PC
  env.platform._state().network.denied = true;
  assert.strictEqual((await svc.apply({ index: 12, dhcp: true })).code, 'denied');
});

test('정보부장: 교실별 IP 저장·갱신·중복 경고·배정 메시지·CSV', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createNetworkService(env);
  const m1 = M.teacherMessage({ pcName: 'SM-3-2', ip: '10.20.3.42', mask: '255.255.255.0', gateway: '10.20.3.1', dns: ['10.20.0.1'], mac: '00-1A-2B-3C-4D-5E' }, '3학년 2반');
  const m2 = M.teacherMessage({ pcName: 'SM-3-1', ip: '10.20.3.41', mask: '255.255.255.0', gateway: '10.20.3.1', dns: ['10.20.0.1'], mac: 'AA-BB-CC-DD-EE-01' }, '3학년 1반');
  assert.ok(svc.registryImport(m1).created);
  assert.ok(svc.registryImport(m2).created);
  // 같은 PC(MAC)가 다시 보내면 새로 만들지 않고 갱신
  const again = svc.registryImport(m1.replace('3학년 2반', '3학년 2반(이동)'));
  assert.strictEqual(again.created, false);
  assert.strictEqual(svc.registryList().pcs.length, 2);
  assert.strictEqual(svc.registryImport('안녕하세요').code, 'empty');

  // 학교 기본값
  assert.ok(svc.setDefaults({ dns1: '10.20.0.1', dns2: '10.20.0.2', gwRule: '.1' }).ok);
  assert.strictEqual(svc.setDefaults({ dns1: '10.20.0' }).ok, false);

  const pcs = svc.registryList().pcs;
  const two = pcs.find((x) => x.mac === '00-1A-2B-3C-4D-5E');
  // 이미 3학년 1반이 쓰는 IP → 경고
  const dup = svc.assign(two.id, { ip: '10.20.3.41' });
  assert.strictEqual(dup.code, 'duplicate');
  assert.strictEqual(dup.duplicates[0].room, '3학년 1반');
  // IP만 넣으면 기본값으로 메시지 완성 + 클립보드
  const ok = svc.assign(two.id, { ip: '10.20.3.50' });
  assert.ok(ok.ok);
  assert.ok(ok.message.includes('IP 10.20.3.50 / 서브넷 255.255.255.0 / 게이트웨이 10.20.3.1'));
  assert.ok(ok.message.includes('DNS 10.20.0.1, 10.20.0.2'));
  assert.strictEqual(env.platform._state().clipboard, ok.message);
  // 교사가 바꾼 뒤 다시 보내오면 배정 완료로 정리
  svc.registryImport(m1.replace('10.20.3.42', '10.20.3.50'));
  const done = svc.registryList().pcs.find((x) => x.id === two.id);
  assert.strictEqual(done.ip, '10.20.3.50');
  assert.ok(!done.assignedIp && done.appliedAt);

  svc.registryUpdate(two.id, { note: '전자칠판 옆, "교사용"' });
  const csv = svc.exportCsv();
  assert.ok(csv.startsWith('﻿교실,PC이름,IP'));
  const rows = parseCsv(csv);
  assert.strictEqual(rows.length, 3);
  assert.ok(rows.some((r) => r.includes('전자칠판 옆, "교사용"')), '쉼표·따옴표가 들어간 메모도 그대로');

  // 다른 PC에서 가져오기
  const env2 = freshEnv();
  t.after(env2.cleanup);
  const svc2 = createNetworkService(env2);
  const imp = svc2.importCsv(csv);
  assert.deepStrictEqual([imp.created, imp.updated], [2, 0]);
  assert.strictEqual(svc2.registryList().pcs.length, 2);
  svc2.registryDelete(svc2.registryList().pcs[0].id);
  assert.strictEqual(svc2.registryList().pcs.length, 1);
});
