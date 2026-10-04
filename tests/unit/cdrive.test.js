'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createCdriveService, levelOf, MOVE_ROOT } = require('../../core/cdrive');
const { freshEnv } = require('./helpers');

const GB = 1024 ** 3, MB = 1024 ** 2;

test('남은 공간 단계', () => {
  assert.strictEqual(levelOf({ total: 238 * GB, free: 9 * GB }), 'danger');
  assert.strictEqual(levelOf({ total: 238 * GB, free: 30 * GB }), 'warn');
  assert.strictEqual(levelOf({ total: 238 * GB, free: 60 * GB }), 'ok');
  assert.strictEqual(levelOf({ total: 120 * GB, free: 15 * GB }), 'warn'); // 12%지만 20GB 미만
});

test('C드라이브 상태와 큰 파일 찾기', async () => {
  const env = freshEnv();
  try {
    const s = createCdriveService(env);
    const st = s.status();
    assert.strictEqual(st.system.letter, 'C');
    assert.strictEqual(st.system.level, 'danger');
    assert.deepStrictEqual(st.others.map((d) => d.letter), ['D']);

    const { results, summary } = await s.scan();
    const names = results.map((r) => r.name);
    for (const n of ['운동회 전체 촬영.mp4', '2학기 공개수업.mp4', '과학 실험 영상.mkv', '졸업식 2025.mov', 'Windows10_22H2.iso', '한컴오피스2022_설치.exe', 'ZoomInstallerFull.msi', '그림판도구.exe']) assert.ok(names.includes(n), n);
    for (const n of ['동요 반주.mp4', 'cache_video.mp4', 'big_setup.exe', '운동회 영상.mp4', 'HncSetup_2024.exe']) assert.ok(!names.includes(n), n);
    assert.strictEqual(results[0].name, 'Windows10_22H2.iso'); // 큰 순서
    assert.strictEqual(results.find((r) => r.name === '졸업식 2025.mov').place, 'C드라이브 › 자료');
    assert.strictEqual(results.find((r) => r.name === '과학 실험 영상.mkv').place, '문서 › 수업자료');
    assert.strictEqual(results.find((r) => r.name === 'ZoomInstallerFull.msi').kind, 'installer');
    assert.strictEqual(summary.count, results.length);
    assert.ok(env.events.some(([ch, p]) => ch === 'cdrive:event' && p.type === 'done'));
  } finally { env.cleanup(); }
});

test('D드라이브로 옮기기 → 바로가기 → 되돌리기', async () => {
  const env = freshEnv();
  try {
    const s = createCdriveService(env);
    const { results } = await s.scan();
    const pick = results.filter((r) => ['운동회 전체 촬영.mp4', '졸업식 2025.mov'].includes(r.name));
    const before = s.status();
    const r = await s.move({ paths: pick.map((p) => p.path), target: 'D', shortcut: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.moved, 2);
    const d = env.platform.paths.dDrive;
    const dest1 = path.join(d, MOVE_ROOT, '내 동영상', '운동회 전체 촬영.mp4');
    const dest2 = path.join(d, MOVE_ROOT, 'C드라이브', '자료', '졸업식 2025.mov');
    assert.ok(fs.existsSync(dest1) && fs.existsSync(dest2));
    assert.ok(!fs.existsSync(pick[0].path));
    assert.ok(fs.existsSync(pick[0].path + '.lnk'));
    const after = s.status();
    assert.ok(Math.abs((after.system.free - before.system.free) - r.bytes) < 64 * 1024); // 바로가기·기록 파일 몇 KB 차이
    assert.ok(after.last && after.last.moved === 2);
    assert.ok(!s.results().some((x) => pick.some((p) => p.path === x.path)));

    const u = await s.undo(r.logId);
    assert.deepStrictEqual([u.ok, u.restored], [true, 2]);
    assert.ok(fs.existsSync(pick[0].path) && !fs.existsSync(pick[0].path + '.lnk') && !fs.existsSync(dest1));
    assert.strictEqual(s.status().last, null);
  } finally { env.cleanup(); }
});

test('다른 드라이브(복사)로 옮기기: 열려 있는 파일은 그대로 둔다', async () => {
  const env = freshEnv();
  const origRename = fs.promises.rename;
  const origUnlink = fs.promises.unlink;
  try {
    const small = path.join(env.platform.paths.home, 'Videos', '짧은 영상.mp4');
    const fd = fs.openSync(small, 'w'); fs.ftruncateSync(fd, 51 * MB); fs.closeSync(fd);
    const locked = path.join(env.platform.paths.home, 'Videos', '재생 중.mp4');
    const fd2 = fs.openSync(locked, 'w'); fs.ftruncateSync(fd2, 52 * MB); fs.closeSync(fd2);
    const s = createCdriveService(env);
    await s.scan();
    fs.promises.rename = async () => { throw Object.assign(new Error('x'), { code: 'EXDEV' }); };
    fs.promises.unlink = async (p) => { if (p === locked) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return origUnlink(p); };
    const r = await s.move({ paths: [small, locked], target: 'D', shortcut: false });
    assert.strictEqual(r.moved, 1);
    assert.deepStrictEqual(r.failed, [{ name: '재생 중.mp4', reason: 'locked' }]);
    const dest = path.join(env.platform.paths.dDrive, MOVE_ROOT, '내 동영상', '짧은 영상.mp4');
    assert.strictEqual(fs.statSync(dest).size, 51 * MB);
    assert.ok(!fs.existsSync(small));
    assert.ok(fs.existsSync(locked));
    assert.ok(!fs.existsSync(path.join(env.platform.paths.dDrive, MOVE_ROOT, '내 동영상', '재생 중.mp4')));
    assert.ok(env.events.some(([ch, p]) => ch === 'cdrive:event' && p.type === 'move' && p.percent === 100));
  } finally { fs.promises.rename = origRename; fs.promises.unlink = origUnlink; env.cleanup(); }
});

test('지우기는 휴지통으로, 휴지통 비우기로 공간 확보', async () => {
  const env = freshEnv();
  try {
    const s = createCdriveService(env);
    const { results } = await s.scan();
    const iso = results.find((r) => r.name === 'Windows10_22H2.iso');
    const free0 = s.status().system.free;
    const out = await s.remove({ paths: [iso.path, '/etc/passwd'] });
    assert.deepStrictEqual(out.map((x) => x.ok), [true]); // 목록에 없는 경로는 무시
    const st = s.status();
    assert.strictEqual(st.system.free, free0); // 휴지통에 있으면 공간은 그대로
    assert.ok(st.recycle.size >= iso.size);
    assert.strictEqual(s.emptyRecycle().ok, true);
    const st2 = s.status();
    assert.strictEqual(st2.recycle.size, 0);
    assert.ok(st2.system.free >= free0 + iso.size);
  } finally { env.cleanup(); }
});

test('옮기기: 공간 부족·잘못된 요청', async () => {
  const env = freshEnv();
  try {
    const s = createCdriveService(env);
    const { results } = await s.scan();
    assert.strictEqual((await s.move({ paths: ['/nope'], target: 'D' })).code, 'bad-request');
    assert.strictEqual((await s.move({ paths: [results[0].path], target: 'C' })).code, 'bad-request');
    const st = env.platform._state(); st.disks.D.free = 1 * GB;
    assert.strictEqual((await s.move({ paths: [results[0].path], target: 'D' })).code, 'no-space');
  } finally { env.cleanup(); }
});
