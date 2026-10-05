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
  assert.ok(msg.includes('[쎈Clean IP 정보] 3학년 2반'));
  assert.strictEqual(env.platform._state().clipboard, msg);
  assert.strictEqual((await svc.info()).room, '3학년 2반');

  // 정보부장 메시지 붙여넣기 → 칸 채움 (게이트웨이 없으면 추천값)
  // 1.3.0 이전 '[쎈클린 …]' 메시지도 읽어야 한다
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

  // 권한이 없다고 거부되면 Windows 확인 창을 거쳐 다시 시도
  env.platform._state().network.denied = true;
  env.platform._state().elevate = 'no';
  assert.strictEqual((await svc.apply({ index: 12, dhcp: true })).code, 'canceled');
  env.platform._state().elevate = 'yes';
  const r3 = await svc.apply({ index: 12, dhcp: true });
  assert.ok(r3.ok);
  assert.ok(env.platform._log().some((l) => l.op === 'elevated' && l.what === 'netApply'));
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

test('불러오기는 버튼을 누를 때만, PC 사양을 메시지·대장·CSV에 함께', async (t) => {
  const { summarize, gbDecimal } = require('../../core/hardware');
  const env = freshEnv();
  t.after(env.cleanup);
  const svc = createNetworkService(env);
  // 화면에 들어오기만 하면 아무것도 읽지 않는다
  const l0 = svc.last();
  assert.strictEqual(l0.snapshot, null);
  assert.ok(!env.platform._log().some((x) => x.op === 'hardware'));

  const l = await svc.load();
  const hw = l.snapshot.hardware;
  assert.strictEqual(l.snapshot.primary.ip, '10.20.3.42');
  assert.strictEqual(hw.pcModel, 'SAMSUNG DM500TDA');
  assert.strictEqual(hw.cpu, 'Intel Core i5-12400 @ 2.50GHz');
  assert.strictEqual(hw.ram, '16GB (8GB×2 삼성 M378A1K43EB2-CWE 3200MHz)');
  assert.strictEqual(hw.ssd, 'SAMSUNG MZVL2512HCJQ-00B07 (SSD 512GB)', 'USB 메모리는 빼기');
  assert.strictEqual(hw.monitor, '삼성 S24R35x / LG FHD');
  assert.strictEqual(hw.printer, 'Samsung M2020 Series (기본) / Canon iR-ADV C3525 UFR II', 'PDF 저장 같은 가상 프린터는 빼기');
  assert.strictEqual(svc.last().snapshot.at, l.snapshot.at, '다시 들어와도 저장한 값 그대로');

  const msg = await svc.myMessage('3학년 2반');
  assert.ok(msg.includes('── PC 사양 ──\nPC 모델 SAMSUNG DM500TDA\nCPU Intel Core i5-12400'));
  assert.strictEqual(env.platform._log().filter((x) => x.op === 'hardware').length, 1, '복사할 때 다시 읽지 않음');

  // 정보부장이 붙여넣으면 대장에 사양까지 기록
  const r = svc.registryImport(msg);
  assert.ok(r.ok && r.created);
  const pc = svc.registryList().pcs[0];
  assert.strictEqual(pc.ip, '10.20.3.42');
  assert.strictEqual(pc.cpu, hw.cpu);
  assert.strictEqual(pc.printer, hw.printer);
  // 메신저가 구분선을 없애도 줄 이름으로 읽는다
  const p = M.parseMessage(msg.replace('── PC 사양 ──\n', ''));
  assert.strictEqual(p.hw.monitor, hw.monitor);
  assert.strictEqual(p.ip, '10.20.3.42');
  // 예전(사양 없는) 메시지로 다시 받아도 사양은 지우지 않음
  svc.registryImport(msg.split('── PC 사양 ──')[0]);
  assert.strictEqual(svc.registryList().pcs[0].ram, hw.ram);

  const csv = svc.exportCsv();
  assert.ok(parseCsv(csv)[0].join(',').includes('PC모델,CPU,RAM,SSD,모니터,프린터'));
  const env2 = freshEnv();
  t.after(env2.cleanup);
  const svc2 = createNetworkService(env2);
  svc2.importCsv(csv);
  assert.strictEqual(svc2.registryList().pcs[0].ssd, hw.ssd);

  // IP를 바꾸면 저장한 IP도 새 값으로, 사양은 그대로
  await svc.apply({ index: 12, ip: '10.20.3.77', mask: '255.255.255.0', gateway: '10.20.3.1', dns1: '10.20.0.1' });
  assert.strictEqual(svc.last().snapshot.primary.ip, '10.20.3.77');
  assert.strictEqual(svc.last().snapshot.hardware.cpu, hw.cpu);

  // 사양을 못 읽어도 IP는 보여 줌
  assert.strictEqual(summarize(null), null);
  assert.strictEqual(gbDecimal(1000204886016), '1TB');
  assert.strictEqual(summarize({ monitors: [{ maker: 'BOE', name: '', code: '0A9D' }] }).monitor, 'BOE (제품코드 0A9D)');
});
