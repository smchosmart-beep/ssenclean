'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detect, mask, analyze } = require('../../core/privacy/detectors');

const types = (s) => detect(s).map((h) => h.type);

test('주민번호: 유효 날짜와 성별 자리', () => {
  assert.deepStrictEqual(types('900101-1234567'), ['rrn']);
  assert.deepStrictEqual(types('9001011234567'), ['rrn']);
  assert.deepStrictEqual(types('050315-4123456'), ['rrn']);
  assert.deepStrictEqual(types('200229-3123456'), ['rrn'], '윤년 2월 29일');
  assert.deepStrictEqual(types('210229-3123456'), [], '평년 2월 29일은 무효');
  assert.deepStrictEqual(types('991399-1234567'), [], '13월 99일은 무효');
  assert.deepStrictEqual(types('900101-0234567'), [], '성별 자리 0');
  assert.deepStrictEqual(types('900101-9234567'), [], '성별 자리 9');
  assert.deepStrictEqual(types('19900101-1234567'), [], '더 긴 숫자열의 일부');
});

test('2020년 10월 이후 형식(뒷자리 임의번호)도 체크섬 없이 찾는다', () => {
  assert.deepStrictEqual(types('201201-4987654'), ['rrn']);
});

test('외국인등록번호는 성별 자리 5~8', () => {
  assert.deepStrictEqual(types('900101-5234567'), ['frn']);
  assert.deepStrictEqual(types('010101-8234567'), ['frn']);
});

test('전화·계좌·여권·면허·이메일', () => {
  assert.deepStrictEqual(types('연락처 010-1234-5678'), ['phone']);
  assert.deepStrictEqual(types('01012345678'), ['phone']);
  assert.deepStrictEqual(types('국민은행 123456-01-234567'), ['account']);
  assert.deepStrictEqual(types('번호 123456-01-234567'), [], '계좌 키워드 없음');
  assert.deepStrictEqual(types('여권번호 M12345678'), ['passport']);
  assert.deepStrictEqual(types('여권 M123A4567'), ['passport'], '신형 여권');
  assert.deepStrictEqual(types('M12345678'), [], '여권 키워드 없음');
  assert.deepStrictEqual(types('운전면허 11-22-123456-33'), ['license']);
  assert.deepStrictEqual(types('메일 kim.teacher@example.com'), ['email']);
});

test('오탐: 측정값·문서번호는 잡지 않는다', () => {
  assert.deepStrictEqual(types('측정값 1234567890123'), []);
  assert.deepStrictEqual(types('문서번호 2025-0101-123456'), []);
});

test('마스킹', () => {
  assert.strictEqual(mask('rrn', '900101-1234567'), '900101-1******');
  assert.strictEqual(mask('phone', '010-1234-5678'), '010-****-5678');
  assert.strictEqual(mask('account', '123-456-789012'), '123-***-****12');
  assert.strictEqual(mask('email', 'kim@example.com'), 'ki***@example.com');
});

test('미리보기 문맥 안의 다른 개인정보도 가린다', () => {
  const a = analyze([{ loc: '2행', text: '김철수 900101-1234567 010-9999-8888' }]);
  assert.deepStrictEqual(a.counts, { rrn: 1, phone: 1 });
  assert.strictEqual(a.level, 3);
  for (const p of a.previews) {
    assert.ok(!p.text.includes('1234567'), p.text);
    assert.ok(!p.text.includes('9999'), p.text);
  }
});
