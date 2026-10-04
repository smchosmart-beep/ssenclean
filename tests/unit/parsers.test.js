'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../../core/platform/mock-fixtures');
const { extract } = require('../../core/privacy/parsers');
const { analyze } = require('../../core/privacy/detectors');

async function run(name, buf) {
  const r = await extract(name, buf);
  return { status: r.status, counts: analyze(r.segments).counts, segments: r.segments };
}

test('docx', async () => assert.deepStrictEqual((await run('a.docx', F.docx(['김 010-1234-5678']))).counts, { phone: 1 }));
test('pptx 위치는 슬라이드 번호', async () => {
  const r = await run('a.pptx', F.pptx([['제목'], ['900101-1234567']]));
  assert.deepStrictEqual(r.counts, { rrn: 1 });
  assert.ok(r.segments.some((s) => s.loc === '2번 슬라이드'));
});
test('hwpx', async () => assert.deepStrictEqual((await run('a.hwpx', F.hwpx(['계좌 국민 123456-01-234567']))).counts, { account: 1 }));
test('hwp 5.0 (압축, 제어문자 포함)', async () => {
  const r = await run('a.hwp', F.hwp(['주민 900101-1234567', '전화 010-2222-3333']));
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.counts, { rrn: 1, phone: 1 });
});
test('hwp 배포용·암호 문서는 locked', async () => {
  assert.strictEqual((await run('b.hwp', F.hwp(['x'], { distribution: true }))).status, 'locked');
  assert.strictEqual((await run('c.hwp', F.hwp(['x'], { encrypted: true }))).status, 'locked');
});
test('xlsx 위치는 시트·행', async () => {
  const r = await run('a.xlsx', F.xlsx({ 명단: [['이름', '주민'], ['a', '900101-1234567']] }));
  assert.deepStrictEqual(r.counts, { rrn: 1 });
  assert.ok(r.segments.some((s) => s.loc === '명단 2행'));
});
test('xls (biff8)', async () => assert.deepStrictEqual((await run('a.xls', F.xls({ S: [['a', '010-1111-2222']] }))).counts, { phone: 1 }));
test('pdf 텍스트', async () => assert.deepStrictEqual((await run('a.pdf', F.pdf(['Kim 010-7777-8888']))).counts, { phone: 1 }));
test('글자 없는 pdf는 scanned', async () => assert.strictEqual((await run('s.pdf', F.scannedPdf())).status, 'scanned'));
test('깨진 xlsx는 unreadable', async () => assert.strictEqual((await run('bad.xlsx', Buffer.from('nope'))).status, 'unreadable'));
test('csv (BOM)', async () => assert.deepStrictEqual((await run('a.csv', Buffer.from('﻿이름,연락처\n김,010-8888-9999'))).counts, { phone: 1 }));
test('txt (CP949)', async () => {
  const buf = Buffer.from(new TextEncoder().encode('x')); // placeholder
  const euckr = Buffer.from([0xb1, 0xe8, 0x20, 0x30, 0x31, 0x30, 0x2d, 0x31, 0x32, 0x33, 0x34, 0x2d, 0x35, 0x36, 0x37, 0x38]); // "김 010-1234-5678"
  assert.ok(buf);
  const r = await run('a.txt', euckr);
  assert.deepStrictEqual(r.counts, { phone: 1 });
  assert.ok(r.segments[0].text.startsWith('김'));
});

test('xls: 문자열이 많아 여러 조각(CONTINUE)으로 나뉜 경우와 숫자 셀', async () => {
  const rows = [['번호', '이름', '주민번호', '연락처']];
  for (let i = 1; i <= 1500; i++) rows.push([i, `학생${i}가나다라마바사`, i === 1400 ? '900101-1234567' : `메모${i}`, i === 1499 ? '010-2222-3333' : `비고${i}`]);
  const r = await run('big.xls', F.xls({ 큰명단: rows }));
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.counts, { rrn: 1, phone: 1 });
  assert.ok(r.segments.some((s) => s.loc === '큰명단 1401행' && s.text.startsWith('1400 | 학생1400가나다라마바사')));
  assert.strictEqual(r.segments.length, 1501);
});

test('xlsx: 시트 이름·인라인 문자열·숫자', async () => {
  const r = await run('a.xlsx', F.xlsx({ 첫시트: [['a']], 둘째: [['이름', 12345], ['김', '010-1234-5678']] }));
  assert.ok(r.segments.some((s) => s.loc === '둘째 1행' && s.text === '이름 | 12345'));
  assert.deepStrictEqual(r.counts, { phone: 1 });
});

test('HTML로 저장된 xls (나이스 내려받기 형식)', async () => {
  const html = '<html><head><meta charset="utf-8"></head><body><table><tr><td>이름</td><td>연락처</td></tr><tr><td>김</td><td>010-1234-5678</td></tr></table></body></html>';
  const r = await run('neis.xls', Buffer.from(html));
  assert.deepStrictEqual(r.counts, { phone: 1 });
});

test('암호 걸린 xlsx(OLE 안 EncryptionInfo)는 locked', async () => {
  const CFB = require('cfb');
  const c = CFB.utils.cfb_new();
  CFB.utils.cfb_add(c, '/EncryptionInfo', Buffer.alloc(16));
  CFB.utils.cfb_add(c, '/EncryptedPackage', Buffer.alloc(16));
  const r = await run('secret.xlsx', Buffer.from(CFB.write(c, { type: 'buffer' })));
  assert.strictEqual(r.status, 'locked');
});

test('xls: 엑셀 방식(공유 문자열 SST가 CONTINUE로 나뉨, LABELSST·RK·NUMBER)', async () => {
  const rows = [['번호', '이름', '주민번호', '점수']];
  for (let i = 1; i <= 2000; i++) rows.push([i, `학생${i}가나다라마바사아자차카타파하`, i === 1777 ? '900101-1234567' : `메모${i}`, i + 0.5]);
  const buf = F.excelStyleXls('명단', rows);
  const CFB = require('cfb');
  const s = Buffer.from(CFB.find(CFB.read(buf, { type: 'buffer' }), 'Workbook').content);
  let cont = 0;
  for (let i = 0; i + 4 <= s.length;) { if (s.readUInt16LE(i) === 0x003C) cont++; i += 4 + s.readUInt16LE(i + 2); }
  assert.ok(cont >= 5, `CONTINUE 레코드 ${cont}개`);
  const r = await run('excel.xls', buf);
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.counts, { rrn: 1 });
  assert.strictEqual(r.segments.length, 2001);
  const row = r.segments.find((x) => x.loc === '명단 1778행');
  assert.strictEqual(row.text, '1777 | 학생1777가나다라마바사아자차카타파하 | 900101-1234567 | 1777.5');
  assert.strictEqual(r.segments[2000].text, '2000 | 학생2000가나다라마바사아자차카타파하 | 메모2000 | 2000.5');
});

// Electron utilityProcess(process.type === 'utility')에서도 PDF를 읽어야 한다. (1.2.0까지 전부 '읽을 수 없음'이던 버그)
test('PDF: 검사 프로세스(utility) 환경에서도 읽힘', async () => {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const code = `
    process.type = 'utility';
    Object.defineProperty(process.versions, 'electron', { value: '41.0.0' });
    const F = require(${JSON.stringify(path.join(__dirname, '../../core/platform/mock-fixtures'))});
    const { extract } = require(${JSON.stringify(path.join(__dirname, '../../core/privacy/parsers'))});
    extract('a.pdf', F.pdf(['Kim 010-7777-8888'])).then((r) => process.stdout.write(JSON.stringify({ status: r.status, type: process.type })));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }));
  assert.deepStrictEqual(out, { status: 'ok', type: 'utility' });
});
