'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { compile, classify } = require('../../core/fonts/classify');
const { decodeName } = require('../../core/fonts/fontinfo');
const cdb = compile(require(path.join(__dirname, '../../data/font-db.json')));

test('폰트 분류 기준(1.5)', () => {
  const ms = classify({ family: 'SimSun-ExtG', manufacturer: 'Microsoft Corporation', copyright: '© Monotype' }, cdb);
  assert.deepStrictEqual([ms.class, ms.bundled], ['safe', true]);
  const ms2 = classify({ family: 'Some Font', copyright: 'Copyright Monotype', vendorId: 'MS  ' }, cdb);
  assert.strictEqual(ms2.class, 'safe', '제작사 ID MS면 Monotype 저작권이어도 안심');
  const hc = classify({ family: '함초롬바탕', manufacturer: 'Hancom Inc.' }, cdb);
  assert.deepStrictEqual([hc.class, hc.bundled], ['safe', true]);
  const bs = classify({ family: 'Zapf Test', copyright: 'Copyright Bitstream Inc.' }, cdb);
  assert.strictEqual(bs.class, 'caution');
  assert.match(bs.basis, /저작권/);
  const empty = classify({ family: '이상한글꼴' }, cdb);
  assert.deepStrictEqual([empty.class, empty.reason], ['unknown', '제작사·라이선스 정보가 비어 있어요']);
  const other = classify({ family: '이상한글꼴2', manufacturer: '동네디자인' }, cdb);
  assert.deepStrictEqual([other.class, other.reason], ['unknown', '목록에 없는 제작사예요']);
  assert.match(other.basis, /동네디자인/);
});

test('옛 한글 이름표(완성형·맥) 읽기', () => {
  const euc = Buffer.from([0xB1, 0xBC, 0xB8, 0xB2]); // '굴림'
  assert.strictEqual(decodeName(1, 3, euc), '굴림');
  const wide = Buffer.from([0x00, 0xB1, 0x00, 0xBC, 0x00, 0xB8, 0x00, 0xB2]);
  assert.strictEqual(decodeName(3, 5, wide), '굴림');
  assert.strictEqual(decodeName(3, 1, Buffer.from([0xAD, 0x74, 0xB9, 0xBC])), '굴림');
});
