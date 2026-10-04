'use strict';
// 문서에서 텍스트를 뽑는다. 결과: { status: 'ok'|'locked'|'unreadable'|'scanned', segments: [{loc,text}] }
// 'locked' = 암호·배포용 문서, 'unreadable' = 손상·지원 불가, 'scanned' = 글자 없는 PDF
const fflate = require('fflate');
const path = require('path');

const MAX_CHARS = 5_000_000;

const xmlText = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

function unzip(buf, filter) {
  try {
    return fflate.unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { filter: (f) => filter(f.name) });
  } catch { return null; }
}
const dec = (u8) => fflate.strFromU8(u8);
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// 문단 단위로 태그 사이 텍스트를 모은다.
function paragraphs(xml, paraRe, textRe) {
  const out = [];
  const paras = xml.match(paraRe) || [];
  for (const p of paras) {
    let t = '';
    let m;
    textRe.lastIndex = 0;
    while ((m = textRe.exec(p))) t += xmlText(m[1]);
    if (t.trim()) out.push(t);
  }
  return out;
}

function isEncryptedOoxml(buf) {
  // 암호 걸린 OOXML은 ZIP이 아니라 OLE(CFB) 컨테이너다.
  return buf.length > 8 && buf.readUInt32LE(0) === 0xE011CFD0 && buf.readUInt32LE(4) === 0xE11AB1A1;
}

function parseDocx(buf) {
  if (isEncryptedOoxml(buf)) return { status: 'locked', segments: [] };
  const files = unzip(buf, (n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
  if (!files || !files['word/document.xml']) return { status: 'unreadable', segments: [] };
  const segs = [];
  for (const name of Object.keys(files).sort(natural)) {
    const loc = name === 'word/document.xml' ? '' : '머리말·꼬리말';
    for (const t of paragraphs(dec(files[name]), /<w:p[ >][\s\S]*?<\/w:p>/g, /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)) segs.push({ loc, text: t });
  }
  return { status: 'ok', segments: segs };
}

function parsePptx(buf) {
  if (isEncryptedOoxml(buf)) return { status: 'locked', segments: [] };
  const files = unzip(buf, (n) => /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(n));
  if (!files) return { status: 'unreadable', segments: [] };
  const segs = [];
  for (const name of Object.keys(files).sort(natural)) {
    const num = (name.match(/(\d+)\.xml$/) || [])[1];
    const loc = name.includes('notes') ? `${num}번 슬라이드 메모` : `${num}번 슬라이드`;
    for (const t of paragraphs(dec(files[name]), /<a:p>[\s\S]*?<\/a:p>/g, /<a:t>([^<]*)<\/a:t>/g)) segs.push({ loc, text: t });
  }
  return { status: 'ok', segments: segs };
}

function parseHwpx(buf) {
  const files = unzip(buf, (n) => /^Contents\/section\d+\.xml$/.test(n));
  if (!files) return { status: 'unreadable', segments: [] };
  const names = Object.keys(files).sort(natural);
  if (!names.length) return { status: 'unreadable', segments: [] };
  const segs = [];
  for (const name of names) {
    for (const t of paragraphs(dec(files[name]), /<hp:p[ >][\s\S]*?<\/hp:p>/g, /<hp:t(?: [^>]*)?>([^<]*)<\/hp:t>/g)) segs.push({ loc: '', text: t });
  }
  return { status: 'ok', segments: segs };
}

// ── HWP 5.0 ──
const HWPTAG_PARA_TEXT = 67;
const CTRL_INLINE_OR_EXT = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

function hwpParaText(data) {
  let s = '';
  for (let i = 0; i + 1 < data.length;) {
    const c = data.readUInt16LE(i);
    if (c < 32) {
      if (CTRL_INLINE_OR_EXT.has(c)) { i += 16; continue; } // 8 WCHAR
      if (c === 10 || c === 13) s += '\n';
      i += 2;
      continue;
    }
    s += String.fromCharCode(c);
    i += 2;
  }
  return s;
}

function hwpRecords(buf) {
  const texts = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const h = buf.readUInt32LE(i);
    const tag = h & 0x3FF;
    let size = (h >>> 20) & 0xFFF;
    i += 4;
    if (size === 0xFFF) { if (i + 4 > buf.length) break; size = buf.readUInt32LE(i); i += 4; }
    if (i + size > buf.length) break;
    if (tag === HWPTAG_PARA_TEXT) texts.push(hwpParaText(buf.subarray(i, i + size)));
    i += size;
  }
  return texts;
}

function parseHwp(buf) {
  const CFB = require('cfb');
  let cfb;
  try { cfb = CFB.read(buf, { type: 'buffer' }); } catch { return { status: 'unreadable', segments: [] }; }
  const header = CFB.find(cfb, 'FileHeader');
  if (!header || !header.content) return { status: 'unreadable', segments: [] };
  const hb = Buffer.from(header.content);
  if (!hb.toString('ascii', 0, 17).startsWith('HWP Document File')) return { status: 'unreadable', segments: [] };
  const props = hb.readUInt32LE(36);
  const compressed = !!(props & 1);
  if (props & 2) return { status: 'locked', segments: [] }; // 암호
  if (props & 4) return { status: 'locked', segments: [] }; // 배포용
  const sections = cfb.FullPaths
    .map((p, idx) => ({ p, e: cfb.FileIndex[idx] }))
    .filter(({ p }) => /\/BodyText\/Section\d+$/i.test(p))
    .sort((a, b) => natural(a.p, b.p));
  if (!sections.length) return { status: 'unreadable', segments: [] };
  const segs = [];
  for (const { e } of sections) {
    let data = Buffer.from(e.content || []);
    if (compressed) {
      try { data = Buffer.from(fflate.inflateSync(new Uint8Array(data))); } catch { return { status: 'unreadable', segments: [] }; }
    }
    for (const t of hwpRecords(data)) if (t.trim()) segs.push({ loc: '', text: t });
  }
  return { status: 'ok', segments: segs };
}

// ── 스프레드시트: 외부 라이브러리 없이 직접 읽는다(sheets.js) ──
const { parseSpreadsheet } = require('./sheets');

// ── PDF ──
// PDF.js는 process.type이 'browser'가 아니면(Electron utilityProcess는 'utility') 브라우저로 착각해
// Worker를 찾다가 모든 PDF 열기에 실패한다. 불러오는 동안만 Node로 보이게 하고,
// 작업자 모듈도 미리 불러 같은 스레드에서 돌게 한다(globalThis.pdfjsWorker).
let pdfjsPromise = null;
function pdfjs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const hasType = Object.prototype.hasOwnProperty.call(process, 'type');
    const saved = process.type;
    const masked = saved && saved !== 'browser';
    if (masked) { try { Object.defineProperty(process, 'type', { value: undefined, configurable: true, writable: true, enumerable: true }); } catch { /* ignore */ } }
    try {
      const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      return lib;
    } finally {
      if (masked) {
        try {
          if (hasType) Object.defineProperty(process, 'type', { value: saved, configurable: true, writable: true, enumerable: true });
          else delete process.type;
        } catch { /* ignore */ }
      }
    }
  })();
  return pdfjsPromise;
}
async function parsePdf(buf) {
  const lib = await pdfjs();
  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, stopAtErrors: false }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') return { status: 'locked', segments: [] };
    return { status: 'unreadable', segments: [] };
  }
  const segs = [];
  let total = 0;
  try {
    for (let p = 1; p <= doc.numPages && total < MAX_CHARS; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let text = '';
      for (const it of tc.items) { if ('str' in it) text += it.str + (it.hasEOL ? '\n' : ' '); }
      total += text.length;
      if (text.trim()) segs.push({ loc: `${p}쪽`, text });
      page.cleanup();
    }
  } finally { try { await doc.destroy(); } catch { /* ignore */ } }
  if (!segs.length) return { status: 'scanned', segments: [] };
  return { status: 'ok', segments: segs };
}

// ── 텍스트 ──
function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString('utf8');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not utf8 */ }
  try { return new TextDecoder('euc-kr').decode(buf); } catch { return buf.toString('latin1'); }
}
function parseText(buf) {
  const text = decodeText(buf.subarray(0, MAX_CHARS));
  const segs = text.split(/\r?\n/).map((line, i) => ({ loc: `${i + 1}줄`, text: line })).filter((s) => s.text.trim());
  return { status: 'ok', segments: segs };
}

const PARSERS = {
  '.docx': parseDocx,
  '.pptx': parsePptx,
  '.hwpx': parseHwpx,
  '.hwp': parseHwp,
  '.xlsx': (buf) => parseSpreadsheet(buf, '.xlsx'),
  '.xls': (buf) => parseSpreadsheet(buf, '.xls'),
  '.pdf': parsePdf,
  '.txt': parseText,
  '.csv': parseText,
};
const SUPPORTED = Object.keys(PARSERS);

async function extract(file, buf) {
  const ext = path.extname(file).toLowerCase();
  const fn = PARSERS[ext];
  if (!fn) return { status: 'unreadable', segments: [] };
  try {
    return await fn(buf);
  } catch {
    return { status: 'unreadable', segments: [] };
  }
}

module.exports = { extract, SUPPORTED, hwpRecords, decodeText };
