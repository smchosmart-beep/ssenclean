'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshEnv } = require('./helpers');
const F = require('../../core/filename-fix');
const { createFilenameService, photoDate } = require('../../core/filenames');

// 한글 → cp949 바이트 → 서양 글꼴로 읽은 외계어(압축 풀기에서 생기는 모양)
const cp949 = (s) => F.toBytes(s, 'cp949');
const as1252 = (s) => new TextDecoder('windows-1252').decode(cp949(s));

test('이름 고치기 규칙: 깨진 한글·외계어·확장자·특수문자, 건드리면 안 되는 이름', () => {
  const fix = (n) => F.fixName(n).name;
  assert.strictEqual(fix('용석핑.hwp'.normalize('NFD')), '용석핑.hwp');
  assert.strictEqual(fix(as1252('한글문서') + '.hwp'), '한글문서.hwp');
  assert.strictEqual(fix(F.decodeCp949(new TextEncoder().encode('교사')) + '.hwp'), '교사.hwp'); // 援먯궗
  assert.strictEqual(fix('가정통신문.hwp.hwp'), '가정통신문.hwp');
  assert.strictEqual(fix('IMG_1234.JPG'), 'IMG_1234.jpg');
  assert.strictEqual(fix('★운동회 사진🎉.jpg'), '운동회 사진.jpg');
  assert.strictEqual(fix('  수업  자료 .hwp'), '수업 자료.hwp');
  const jamo = F.fixName('ㅇㅛㅇㅅㅓㄱㅍㅣㅇ.hwp');
  assert.deepStrictEqual([jamo.name, jamo.sure], ['용석핑.hwp', false], '낱자는 확인 필요');
  assert.strictEqual(F.fixName('안내문.pdf.exe').warn, 'disguised');
  for (const n of ['ㅋㅋ.txt', '2026학년도 1학기 (최종).hwp', '보고서_v2.hwp', '회의록 - 복사본.hwp', '똠방각하.hwp', '一般 문서.hwp', 'Résumé.pdf', 'Café menu.docx', '보고서.pdf.hwp', 'setup.exe', '과학(2)_실험.hwp']) {
    assert.strictEqual(fix(n), n, n);
  }
  assert.strictEqual(F.composeCompat('ㄷㅏㄺㄱㅗㄱㅣ'), '닭고기');
  assert.strictEqual(F.uniqueName('a.hwp', new Set(['a.hwp', 'a (2).hwp'])), 'a (3).hwp');
});

test('파일명 정리: 찾기 → 한 번에 정리 → 되돌리기, 같은 이름·위장 파일·확인 필요', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const P = env.platform.paths;
  const dl = path.join(P.downloads, '받은 자료');
  fs.mkdirSync(dl, { recursive: true });
  const mk = (dir, n, body = 'x') => { fs.writeFileSync(path.join(dir, n), body); return path.join(dir, n); };
  mk(dl, '용석핑.hwp'.normalize('NFD'));
  mk(dl, as1252('가정통신문') + '.hwp');
  mk(dl, '보고서.hwp.hwp');
  mk(dl, '보고서.hwp'); // 이미 있음 → (2)
  mk(dl, '안내문.pdf.exe');
  mk(dl, 'ㅇㅛㅇㅅㅓㄱ.hwp');
  const sub = path.join(P.desktop, '사진'.normalize('NFD'));
  fs.mkdirSync(sub, { recursive: true });
  mk(sub, '운동회🎉.jpg');
  const svc = createFilenameService(env);
  assert.deepStrictEqual(svc.quickCount(), { fix: 5, warn: 1 });
  const r = await svc.scan();
  const by = Object.fromEntries(r.items.map((i) => [i.newName, i]));
  assert.ok(by['용석핑.hwp'] && by['가정통신문.hwp'] && by['보고서 (2).hwp'] && by['사진'] && by['운동회.jpg']);
  assert.strictEqual(by['용석.hwp'].sure, false);
  assert.deepStrictEqual(r.warnings.map((w) => w.name), ['안내문.pdf.exe']);
  assert.ok(!r.items.some((i) => i.name === '안내문.pdf.exe'), '위장 파일은 이름을 바꾸지 않음');
  const sureIds = r.items.filter((i) => i.sure).map((i) => i.id);
  const a = await svc.apply(sureIds);
  assert.strictEqual(a.renamed, sureIds.length);
  assert.ok(fs.existsSync(path.join(dl, '용석핑.hwp')));
  assert.ok(fs.existsSync(path.join(dl, '보고서 (2).hwp')) && fs.existsSync(path.join(dl, '보고서.hwp')));
  assert.ok(fs.existsSync(path.join(P.desktop, '사진', '운동회.jpg')), '폴더 안쪽부터 바꿔 경로가 꼬이지 않음');
  assert.ok(fs.existsSync(path.join(dl, 'ㅇㅛㅇㅅㅓㄱ.hwp')), '확인 필요는 고르지 않으면 그대로');
  assert.strictEqual(svc.lastUndo().count, sureIds.length);
  const u = await svc.undo(a.batchId);
  assert.strictEqual(u.restored, sureIds.length);
  assert.ok(fs.existsSync(path.join(dl, '용석핑.hwp'.normalize('NFD'))));
  assert.ok(fs.existsSync(path.join(sub, '운동회🎉.jpg')));
  assert.strictEqual(svc.lastUndo(), null);
});

test('파일명 정리: 고른 폴더에 이름 규칙(날짜·글자·번호·명단), 시스템 폴더는 받지 않음', async (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  const dir = path.join(env.platform.paths.documents, '과제');
  const inner = path.join(dir, '안쪽');
  fs.mkdirSync(inner, { recursive: true });
  for (const n of ['b.hwp', 'a.hwp', 'c 최최종.hwp']) fs.writeFileSync(path.join(dir, n), 'x');
  fs.writeFileSync(path.join(inner, 'z.hwp'), 'x');
  const old = new Date(2025, 2, 4);
  fs.utimesSync(path.join(dir, 'a.hwp'), old, old);
  const svc = createFilenameService(env);
  let r = await svc.scan({ roots: [dir], rules: { find: '최최종', replace: '', prefix: '2026_', number: true } });
  const names = r.items.map((i) => i.newName).sort();
  assert.deepStrictEqual(names, ['2026_a_01.hwp', '2026_b_02.hwp', '2026_c_03.hwp']);
  assert.ok(!r.items.some((i) => i.name === 'z.hwp'), '규칙은 안쪽 폴더에는 적용 안 함');
  r = await svc.scan({ roots: [dir], rules: { date: 'modified' } });
  assert.ok(r.items.some((i) => i.newName === '2025-03-04_a.hwp'));
  r = await svc.scan({ roots: [dir], rules: { roster: '김하늘\n이바다' } });
  assert.deepStrictEqual(r.items.map((i) => i.newName).sort(), ['01_김하늘.hwp', '02_이바다.hwp']);
  assert.deepStrictEqual(r.rosterMismatch, { files: 3, names: 2 });
  await svc.apply(r.items.map((i) => i.id));
  assert.ok(fs.existsSync(path.join(dir, '01_김하늘.hwp')) && fs.existsSync(path.join(dir, 'c 최최종.hwp')));
  // 기본 범위(바탕화면 등)에는 규칙을 적용하지 않음
  r = await svc.scan({ rules: { prefix: 'X_' } });
  assert.ok(!r.items.some((i) => i.newName.startsWith('X_')));
  // 시스템 폴더·드라이브 맨 위는 받지 않고 기본 범위로
  r = await svc.scan({ roots: ['C:\\Windows', 'C:\\', '/'] });
  assert.strictEqual(r.custom, false);
});

test('사진 찍은 날 읽기(사진 정보)', (t) => {
  const env = freshEnv();
  t.after(env.cleanup);
  // 최소 JPEG + Exif(IFD0 → ExifIFD → DateTimeOriginal)
  const dt = Buffer.from('2024:05:17 10:20:30\0', 'latin1');
  const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4 + dt.length);
  tiff.write('II', 0, 'latin1'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x8769, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18); tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26); tiff.writeUInt16LE(0x9003, 28); tiff.writeUInt16LE(2, 30); tiff.writeUInt32LE(20, 32); tiff.writeUInt32LE(44, 36); tiff.writeUInt32LE(0, 40);
  dt.copy(tiff, 44);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, (app1.length + 2) >> 8, (app1.length + 2) & 255]);
  const f = path.join(env.platform.paths.desktop, 'p.jpg');
  fs.writeFileSync(f, Buffer.concat([head, app1, Buffer.from([0xFF, 0xD9])]));
  const d = photoDate(f);
  assert.ok(d && d.getFullYear() === 2024 && d.getMonth() === 4 && d.getDate() === 17);
});
