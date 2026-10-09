'use strict';
// 파일 이름 고치기 규칙(순수 함수). 화면·서비스·테스트 공용. 계획 31
//  ① 깨진 한글(맥·아이폰의 자음·모음 조각, NFD) → NFC
//  ② 압축을 풀면 외계어가 되는 이름(인코딩 오인) → 한글
//  ③ 겹친 확장자·대문자 확장자
//  ④ 업로드 안 되는 이름(특수문자·이모지·공백·너무 긴 이름)
//  + 확인 필요: 낱자로 입력된 이름(ㄱ·ㅏ), 애매한 외계어
//  + 경고만: 문서로 위장한 실행 파일(이름은 고치지 않음)

// ── 인코딩 표 ──
let EUCKR = null; // 글자 ↔ cp949 바이트, KS X 1001 완성형 2350자 집합
// cp949(UHC) = EUC-KR(KS X 1001) + 확장 한글 8822자. 실행 환경마다 내장 해석기가 달라서 확장 부분은 규칙대로 직접 만든다.
function euckr() {
  if (EUCKR) return EUCKR;
  const dec = new TextDecoder('euc-kr');
  const enc = new Map(); // 글자 → [a, b]
  const rev = new Map(); // (a<<8|b) → 글자
  const ks2350 = new Set();
  const put = (ch, a, b) => { if (!enc.has(ch)) enc.set(ch, [a, b]); rev.set((a << 8) | b, ch); };
  for (let a = 0xA1; a <= 0xFE; a++) {
    for (let b = 0xA1; b <= 0xFE; b++) {
      const ch = dec.decode(Uint8Array.of(a, b));
      if (ch.length !== 1 || ch === '\uFFFD') continue;
      put(ch, a, b);
      if (a >= 0xB0 && a <= 0xC8 && /[가-힣]/.test(ch)) ks2350.add(ch);
    }
  }
  // 확장 한글: 완성형에 없는 한글을 가나다 순서대로 아래 자리에 차례로 배정(Windows 코드 페이지 949와 같음)
  const slots = [];
  const range = (lo, hi) => { const r = []; for (let x = lo; x <= hi; x++) r.push(x); return r; };
  for (let a = 0x81; a <= 0xC6; a++) {
    const trails = a <= 0xA0 ? [...range(0x41, 0x5A), ...range(0x61, 0x7A), ...range(0x81, 0xFE)] : [...range(0x41, 0x5A), ...range(0x61, 0x7A), ...range(0x81, 0xA0)];
    for (const b of trails) slots.push([a, b]);
  }
  let k = 0;
  for (let c = 0xAC00; c <= 0xD7A3 && k < slots.length; c++) {
    const ch = String.fromCharCode(c);
    if (ks2350.has(ch)) continue;
    const [a, b] = slots[k++];
    put(ch, a, b);
  }
  EUCKR = { enc, rev, ks2350 };
  return EUCKR;
}
// cp949 바이트 → 글자(엄격: 표에 없는 바이트가 있으면 null)
function decodeCp949(bytes) {
  const { rev } = euckr();
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const a = bytes[i];
    if (a < 0x80) { out += String.fromCharCode(a); continue; }
    const b = bytes[i + 1];
    const ch = b != null ? rev.get((a << 8) | b) : null;
    if (!ch) return null;
    out += ch; i++;
  }
  return out;
}
const CP437_HI = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
let CP437 = null, CP1252 = null;
function cp437() {
  if (!CP437) { CP437 = new Map(); for (let i = 0; i < 128; i++) CP437.set(CP437_HI[i], 0x80 + i); }
  return CP437;
}
function cp1252() {
  if (!CP1252) {
    CP1252 = new Map();
    const dec = new TextDecoder('windows-1252');
    for (let i = 0x80; i <= 0xFF; i++) CP1252.set(dec.decode(Uint8Array.of(i)), i);
  }
  return CP1252;
}
// 글자열 → 바이트(표에 없는 글자가 있으면 null)
function toBytes(s, kind) {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) { out.push(c); continue; }
    if (kind === 'cp949') { const b = euckr().enc.get(ch); if (!b) return null; out.push(...b); continue; }
    const m = kind === 'cp437' ? cp437() : cp1252();
    let b = m.get(ch);
    if (b == null && kind === 'cp1252' && c <= 0xFF) b = c; // latin1로 들어온 경우
    if (b == null) return null;
    out.push(b);
  }
  return Uint8Array.from(out);
}
function decodeStrict(bytes, enc) {
  try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch { return null; }
}

const HANGUL = /[가-힣]/;
const LATIN_HI = /[\u0080-ÿ]/;
const BOX = /[─-◿⌐⌠⌡ⁿ·ƒ₧Α-ω∙-∞∩≡-≥≈]/;
const HANJA = /[一-鿿豈-﫿]/;
const nonAscii = (s) => [...s].filter((c) => c.codePointAt(0) >= 0x80);

// ② 외계어 이름 → 한글. { name, sure } 또는 null
function fixMojibake(stem) {
  const na = nonAscii(stem);
  if (!na.length) return null;
  const { ks2350 } = euckr();
  const cands = [];
  // 한글 cp949 바이트를 서양 글꼴(cp1252·latin1)이나 도스 글꼴(cp437)로 읽은 경우: ÇÑ±Û, ╟╤▒█
  if (na.every((c) => LATIN_HI.test(c) || BOX.test(c) || /[ŒœŠšŸŽžˆ˜–-…‰‹›€™]/.test(c))) {
    for (const k of ['cp1252', 'cp437']) {
      const b = toBytes(stem, k);
      if (!b) continue;
      const t = decodeCp949(b);
      if (t) cands.push(t);
      const u = decodeStrict(b, 'utf-8'); // UTF-8 이름을 도스 글꼴로 읽은 경우
      if (u) cands.push(u);
    }
  }
  // UTF-8 바이트를 한국어 Windows(cp949)로 읽은 경우: 援먯궗 → 교사
  if (na.some((c) => HANJA.test(c) || (HANGUL.test(c) && !ks2350.has(c)))) {
    const b = toBytes(stem, 'cp949');
    if (b) { const u = decodeStrict(b, 'utf-8'); if (u) cands.push(u); }
  }
  for (const t of cands) {
    if (t === stem || t.includes('�')) continue;
    const tn = nonAscii(t);
    if (!tn.length) continue;
    const hangul = tn.filter((c) => HANGUL.test(c));
    if (hangul.length < Math.ceil(tn.length * 0.6)) continue;
    const sure = hangul.length >= 2 && hangul.every((c) => ks2350.has(c)) && tn.every((c) => HANGUL.test(c) || /[　-〿！-～·]/.test(c));
    return { name: t.normalize('NFC'), sure };
  }
  return null;
}

// 낱자(호환 자모) 조합: 두벌식 자판과 같은 규칙
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const VOWEL_MIX = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
const JONG_MIX = { 'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ' };
const isCho = (c) => CHO.includes(c);
const isJung = (c) => JUNG.includes(c);
function composeCompat(s) {
  const out = [];
  let i = 0;
  const chars = [...s];
  while (i < chars.length) {
    const c = chars[i];
    if (isCho(c) && isJung(chars[i + 1])) {
      let v = chars[i + 1]; let j = i + 2;
      if (chars[j] && VOWEL_MIX[v + chars[j]]) { v = VOWEL_MIX[v + chars[j]]; j++; }
      let t = '';
      // 받침: 다음 글자가 모음이 아니면 받침으로
      if (chars[j] && JONG.indexOf(chars[j]) > 0 && !isJung(chars[j + 1])) {
        t = chars[j]; j++;
        if (chars[j] && JONG_MIX[t + chars[j]] && !isJung(chars[j + 1])) { t = JONG_MIX[t + chars[j]]; j++; }
      }
      out.push(String.fromCharCode(0xAC00 + (CHO.indexOf(c) * 21 + JUNG.indexOf(v)) * 28 + JONG.indexOf(t)));
      i = j;
    } else { out.push(c); i++; }
  }
  return out.join('');
}

// ③ 확장자
const DOC_EXT = 'hwp|hwpx|hwt|cell|show|pdf|docx?|xlsx?|pptx?|txt|csv|zip|jpe?g|png|gif|bmp|mp4|mov|avi|mp3|wav|hwpml|odt|ods|odp';
const EXEC_EXT = /\.(exe|scr|com|bat|cmd|pif|vbs|vbe|js|jse|wsf|hta|msi|ps1)$/i;
function isDisguised(name) {
  if (/‮/.test(name)) return true; // 글자 방향을 뒤집어 확장자를 속이는 문자
  return new RegExp(`\\.(${DOC_EXT})[\\s._]*\\.(exe|scr|com|bat|cmd|pif|vbs|vbe|js|jse|wsf|hta|msi|ps1)$`, 'i').test(name)
    || (EXEC_EXT.test(name) && /\s{5,}\.\w+$/.test(name));
}
function fixExtension(name) {
  const m = name.match(new RegExp(`^(.*?)((?:\\.(?:${DOC_EXT}))+)$`, 'i'));
  if (!m) return null;
  const exts = m[2].split('.').filter(Boolean);
  const last = exts[exts.length - 1];
  // 같은 확장자가 겹친 것만 하나로(가정통신문.hwp.hwp). 서로 다른 것(보고서.pdf.hwp)은 그대로.
  let keep = exts.length > 1 && exts.every((e) => e.toLowerCase() === last.toLowerCase()) ? [last] : exts;
  keep = [...keep.slice(0, -1), keep[keep.length - 1].toLowerCase()];
  const fixed = `${m[1]}.${keep.join('.')}`;
  return fixed !== name ? fixed : null;
}

// ④ 업로드 안 되는 글자
const BAD_CHARS = /[#%&{}^~`$@+=;!]/g; // 웹 업로드·주소에서 문제 되는 글자(Windows가 원래 막는 \/:*?"<>|는 이름에 있을 수 없음)
const PICTO = /[\p{Extended_Pictographic}☀-➿⬀-⯿←-⇿■-◿✀-➿㈀-㋿①-⓿※⁂★☆♡-♧️‍]/gu;
const INVISIBLE = /[\u0000-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g;
function cleanStem(stem) {
  let s = stem.replace(INVISIBLE, '').replace(/[ 　 - ]/g, ' ');
  s = s.replace(PICTO, ' ').replace(BAD_CHARS, '_');
  s = s.replace(/_{2,}/g, '_').replace(/ {2,}/g, ' ').replace(/\s*_\s*/g, '_');
  s = s.replace(/^[\s_.]+|[\s_.]+$/g, '');
  return s;
}

function splitExt(name, isDir) {
  if (isDir) return { stem: name, ext: '' };
  const m = name.match(/^(.+?)((?:\.[A-Za-z0-9]{1,6})+)$/);
  if (!m) return { stem: name, ext: '' };
  // 확장자는 마지막 것만(겹친 확장자는 ③에서 처리)
  const i = name.lastIndexOf('.');
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

// 한 이름에 자동 규칙을 차례로. → { name, reasons:[{kind,label}], sure, warn }
function fixName(name, { isDir = false, maxLen = 0 } = {}) {
  const reasons = [];
  let sure = true;
  if (!isDir && isDisguised(name)) return { name, reasons: [{ kind: 'disguised', label: '위장 실행 파일' }], sure: false, warn: 'disguised' };
  let n = name;
  // ① 조각 한글
  if (/[ᄀ-ᇿꥠ-꥿ힰ-퟿]/.test(n)) {
    const t = n.normalize('NFC');
    if (t !== n) { n = t; reasons.push({ kind: 'nfd', label: '깨진 한글' }); }
  }
  // ② 외계어(확장자는 그대로 두고 앞부분만)
  {
    const { stem, ext } = splitExt(n, isDir);
    let r = null;
    try { r = fixMojibake(stem); } catch { r = null; } // 해석기가 없는 환경에서도 찾기는 계속
    if (r) { n = r.name + ext; reasons.push({ kind: 'mojibake', label: '외계어 이름' }); if (!r.sure) sure = false; }
  }
  // 낱자로 입력된 이름(확인 필요). 모음이 없으면(ㅋㅋ) 그대로
  if (/[ㄱ-ㆎ]/.test(n) && /[ㅏ-ㅣ]/.test(n)) {
    const t = composeCompat(n);
    if (t !== n) { n = t; reasons.push({ kind: 'jamo', label: '풀어진 글자' }); sure = false; }
  }
  // ③ 확장자
  if (!isDir) {
    const t = fixExtension(n);
    if (t) { n = t; reasons.push({ kind: 'ext', label: '확장자' }); }
  }
  // ④ 특수문자·공백
  {
    const { stem, ext } = splitExt(n, isDir);
    let s = cleanStem(stem);
    if (!s) s = '이름 없음';
    let label = s !== stem ? '특수문자·공백' : '';
    if (maxLen > 0 && s.length + ext.length > maxLen) {
      s = [...s].slice(0, Math.max(20, maxLen - ext.length)).join('').replace(/[\s_.]+$/, '');
      label = '너무 긴 이름';
    }
    if (label) { n = s + ext; reasons.push({ kind: label === '너무 긴 이름' ? 'long' : 'chars', label }); }
  }
  return { name: n, reasons, sure: reasons.length ? sure : true };
}

// 같은 이름이 있으면 '이름 (2).확장자'
function uniqueName(name, taken, isDir) {
  if (!taken.has(name.toLowerCase())) return name;
  const { stem, ext } = splitExt(name, isDir);
  for (let i = 2; i < 1000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
  return name;
}

module.exports = { decodeCp949, fixName, fixMojibake, composeCompat, fixExtension, isDisguised, cleanStem, splitExt, uniqueName, toBytes };
