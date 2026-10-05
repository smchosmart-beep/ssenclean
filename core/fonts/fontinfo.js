'use strict';
// 폰트 파일의 name/OS2 테이블만 읽는다(파일 전체를 읽지 않음). TTF·OTF·TTC 지원.
const fs = require('fs');

const NAME_IDS = { 0: 'copyright', 1: 'family', 2: 'subfamily', 4: 'fullName', 8: 'manufacturer', 9: 'designer', 11: 'vendorUrl', 13: 'license', 14: 'licenseUrl', 16: 'typoFamily' };

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return b.subarray(0, n);
}

function tableDir(fd, offset) {
  const h = readAt(fd, offset, 12);
  if (h.length < 12) return null;
  const tag = h.readUInt32BE(0);
  if (tag !== 0x00010000 && tag !== 0x4F54544F /* OTTO */ && tag !== 0x74727565 /* true */) return null;
  const num = h.readUInt16BE(4);
  const dir = readAt(fd, offset + 12, num * 16);
  const tables = {};
  for (let i = 0; i < num; i++) {
    const t = dir.toString('latin1', i * 16, i * 16 + 4);
    tables[t] = { offset: dir.readUInt32BE(i * 16 + 8), length: dir.readUInt32BE(i * 16 + 12) };
  }
  return tables;
}

const eucKr = (() => { try { return new TextDecoder('euc-kr'); } catch { return null; } })();
function utf16be(buf) {
  const sw = Buffer.from(buf);
  if (sw.length % 2) return null;
  sw.swap16();
  return sw.toString('utf16le');
}
// 이름표 글자 풀기. 옛날 한글 폰트는 완성형(Windows 인코딩 5, 맥 인코딩 3)으로만 적혀 있는 경우가 있다.
function decodeName(platformId, encodingId, buf) {
  if (platformId === 0) return utf16be(buf);
  if (platformId === 3) {
    if (encodingId === 5 && eucKr) {
      // 16비트 칸에 1바이트 글자는 0x00XX로 들어 있다 → 앞의 0을 빼고 완성형으로 읽는다
      const bytes = [];
      for (let i = 0; i + 1 < buf.length; i += 2) { if (buf[i]) bytes.push(buf[i]); bytes.push(buf[i + 1]); }
      return eucKr.decode(Buffer.from(bytes));
    }
    if (encodingId === 0 || encodingId === 1 || encodingId === 10) return utf16be(buf);
    return null;
  }
  if (platformId === 1 && encodingId === 0) return buf.toString('latin1');
  if (platformId === 1 && encodingId === 3 && eucKr) return eucKr.decode(buf);
  return null;
}

function readNames(fd, t) {
  const b = readAt(fd, t.offset, Math.min(t.length, 256 * 1024));
  if (b.length < 6) return {};
  const count = b.readUInt16BE(2);
  const strOff = b.readUInt16BE(4);
  const out = {};
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > b.length) break;
    const pid = b.readUInt16BE(r), eid = b.readUInt16BE(r + 2), lang = b.readUInt16BE(r + 4), nid = b.readUInt16BE(r + 6);
    const len = b.readUInt16BE(r + 8), off = b.readUInt16BE(r + 10);
    const key = NAME_IDS[nid];
    if (!key) continue;
    const s = strOff + off;
    if (s + len > b.length) continue;
    const text = decodeName(pid, eid, b.subarray(s, s + len));
    if (!text) continue;
    const lk = pid === 3 ? (lang === 0x0412 ? 'ko' : lang === 0x0409 ? 'en' : 'x' + lang.toString(16)) : (pid === 1 ? (lang === 23 ? 'ko' : 'mac') : 'u');
    out[key] = out[key] || {};
    if (!out[key][lk]) out[key][lk] = text.replace(/\0/g, '').trim();
  }
  return out;
}

function readVendor(fd, t) {
  if (!t || t.length < 62) return '';
  return readAt(fd, t.offset + 58, 4).toString('latin1');
}

function infoAt(fd, offset) {
  const tables = tableDir(fd, offset);
  if (!tables || !tables.name) return null;
  const names = readNames(fd, tables.name);
  const pick = (k) => {
    const v = names[k];
    if (!v) return '';
    return v.ko || v.en || Object.values(v)[0] || '';
  };
  const all = (k) => (names[k] ? [...new Set(Object.values(names[k]))] : []);
  return {
    family: pick('typoFamily') || pick('family'),
    familyKo: (names.typoFamily && names.typoFamily.ko) || (names.family && names.family.ko) || '',
    familyEn: (names.typoFamily && names.typoFamily.en) || (names.family && names.family.en) || '',
    families: [...new Set([...all('family'), ...all('typoFamily'), ...all('fullName')])],
    fullName: pick('fullName'),
    copyright: all('copyright').join(' / '),
    manufacturer: all('manufacturer').join(' / '),
    designer: all('designer').join(' / '),
    license: all('license').join(' / '),
    licenseUrl: all('licenseUrl').join(' / '),
    vendorUrl: all('vendorUrl').join(' / '),
    vendorId: readVendor(fd, tables['OS/2']).trim(),
  };
}

function readFontInfo(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = readAt(fd, 0, 12);
    if (head.length < 12) return null;
    if (head.toString('latin1', 0, 4) === 'ttcf') {
      const n = head.readUInt32BE(8);
      const offs = readAt(fd, 12, Math.min(n, 64) * 4);
      const faces = [];
      for (let i = 0; i < offs.length / 4; i++) {
        const f = infoAt(fd, offs.readUInt32BE(i * 4));
        if (f) faces.push(f);
      }
      if (!faces.length) return null;
      const first = faces[0];
      return { ...first, families: [...new Set(faces.flatMap((f) => f.families))], faces: faces.length };
    }
    return infoAt(fd, 0);
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

module.exports = { readFontInfo, decodeName };
