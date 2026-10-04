'use strict';
// 테스트·가짜 환경용 샘플 문서 생성기. 모든 개인정보는 형식만 맞춘 가짜 값이다.
const fflate = require('fflate');
const CFB = require('cfb');

const enc = (s) => fflate.strToU8(s);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function zip(files) {
  const obj = {};
  for (const [k, v] of Object.entries(files)) obj[k] = typeof v === 'string' ? enc(v) : v;
  return Buffer.from(fflate.zipSync(obj));
}

function docx(paragraphs) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

function pptx(slides) {
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  };
  slides.forEach((lines, i) => {
    const sp = lines.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join('');
    files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>${sp}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return zip(files);
}

// 엑셀처럼 공유 문자열(sharedStrings)을 쓰는 최소 xlsx
function xlsx(sheets) {
  const sst = [];
  const idx = new Map();
  const colName = (c) => { let s = ''; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  };
  const names = Object.keys(sheets);
  names.forEach((name, si) => {
    const rowsXml = sheets[name].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (!idx.has(v)) { idx.set(v, sst.length); sst.push(v); }
      return `<c r="${ref}" t="s"><v>${idx.get(v)}</v></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${si + 1}.xml`] = `<?xml version="1.0"?><worksheet xmlns="m"><sheetData>${rowsXml}</sheetData></worksheet>`;
  });
  files['xl/workbook.xml'] = `<?xml version="1.0"?><workbook xmlns="m" xmlns:r="r"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0"?><Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="ws" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
  files['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst count="${sst.length}">${sst.map((t) => `<si><t>${esc(t)}</t></si>`).join('')}</sst>`;
  return zip(files);
}

function xls(sheets) {
  const [name] = Object.keys(sheets);
  return excelStyleXls(name, sheets[name]);
}

function hwpx(paragraphs) {
  const ps = paragraphs.map((t) => `<hp:p><hp:run><hp:t>${esc(t)}</hp:t></hp:run></hp:p>`).join('');
  return zip({
    mimetype: 'application/hwp+zip',
    'Contents/section0.xml': `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="hs" xmlns:hp="hp">${ps}</hs:sec>`,
  });
}

function hwpRecord(tag, level, data) {
  const size = data.length;
  if (size < 0xFFF) {
    const h = Buffer.alloc(4);
    h.writeUInt32LE((tag & 0x3FF) | ((level & 0x3FF) << 10) | (size << 20) >>> 0);
    return Buffer.concat([h, data]);
  }
  const h = Buffer.alloc(8);
  h.writeUInt32LE(((tag & 0x3FF) | ((level & 0x3FF) << 10) | (0xFFF << 20)) >>> 0, 0);
  h.writeUInt32LE(size, 4);
  return Buffer.concat([h, data]);
}

function hwp(paragraphs, { encrypted = false, distribution = false } = {}) {
  const header = Buffer.alloc(256);
  header.write('HWP Document File', 0, 'ascii');
  header.writeUInt32LE(0x05000300, 32);
  let props = 1; // compressed
  if (encrypted) props |= 2;
  if (distribution) props |= 4;
  header.writeUInt32LE(props, 36);
  const recs = [];
  for (const p of paragraphs) {
    recs.push(hwpRecord(66, 0, Buffer.alloc(22)));
    // 앞에 표 컨트롤(확장 제어문자 11, 8 WCHAR)을 넣어 제어문자 건너뛰기를 검증한다.
    const ctrl = Buffer.alloc(16); ctrl.writeUInt16LE(11, 0); ctrl.writeUInt16LE(11, 14);
    recs.push(hwpRecord(67, 1, Buffer.concat([ctrl, Buffer.from(p, 'utf16le'), Buffer.from([13, 0])])));
  }
  const section = Buffer.from(fflate.deflateSync(Buffer.concat(recs)));
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, '/FileHeader', header);
  CFB.utils.cfb_add(cfb, '/DocInfo', Buffer.from(fflate.deflateSync(Buffer.alloc(0))));
  if (!distribution) CFB.utils.cfb_add(cfb, '/BodyText/Section0', section);
  else CFB.utils.cfb_add(cfb, '/ViewText/Section0', Buffer.from('encrypted'));
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
}

// ASCII 텍스트만 담는 최소 PDF
function pdf(lines) {
  const content = ['BT', '/F1 12 Tf', '72 760 Td', '14 TL']
    .concat(lines.map((l) => `(${String(l).replace(/[()\\]/g, (m) => '\\' + m)}) Tj T*`)).concat(['ET']).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// 텍스트가 없는(스캔본) PDF
function scannedPdf() { return pdf([]); }

module.exports = { docx, pptx, xlsx, xls, hwpx, hwp, pdf, scannedPdf, zip };

// 엑셀이 실제로 쓰는 방식(SST + LABELSST + CONTINUE)의 BIFF8 xls를 만든다(테스트용).
function excelStyleXls(sheetName, rows) {
  const rec = (type, data) => { const h = Buffer.alloc(4); h.writeUInt16LE(type, 0); h.writeUInt16LE(data.length, 2); return Buffer.concat([h, data]); };
  const strings = [];
  const index = new Map();
  for (const row of rows) for (const v of row) if (typeof v === 'string' && !index.has(v)) { index.set(v, strings.length); strings.push(v); }
  // SST: 8224바이트마다 CONTINUE로 나누고, 문자 중간에서 나뉘면 새 조각 앞에 플래그 바이트(1)를 넣는다.
  const LIMIT = 8224;
  const parts = [];
  let curBuf = [Buffer.alloc(8)];
  curBuf[0].writeUInt32LE(strings.length, 0); curBuf[0].writeUInt32LE(strings.length, 4);
  let curLen = 8;
  const flush = () => { parts.push(Buffer.concat(curBuf)); curBuf = []; curLen = 0; };
  for (const s of strings) {
    const head = Buffer.alloc(3); head.writeUInt16LE(s.length, 0); head[2] = 1; // UTF-16
    if (curLen + 3 + 2 > LIMIT) flush();
    curBuf.push(head); curLen += 3;
    let chars = Buffer.from(s, 'utf16le');
    while (chars.length) {
      const room = Math.floor((LIMIT - curLen) / 2) * 2;
      if (room <= 0) { flush(); curBuf.push(Buffer.from([1])); curLen = 1; continue; }
      const take = chars.subarray(0, room);
      curBuf.push(take); curLen += take.length;
      chars = chars.subarray(take.length);
      if (chars.length) { flush(); curBuf.push(Buffer.from([1])); curLen = 1; }
    }
  }
  if (curLen) flush();
  const sst = parts.map((p, i) => rec(i === 0 ? 0x00FC : 0x003C, p));
  const bof = (t) => { const d = Buffer.alloc(16); d.writeUInt16LE(0x0600, 0); d.writeUInt16LE(t, 2); return rec(0x0809, d); };
  const eof = rec(0x000A, Buffer.alloc(0));
  const nameBuf = Buffer.from(sheetName, 'utf16le');
  const bsData = Buffer.concat([Buffer.alloc(6), Buffer.from([sheetName.length, 1]), nameBuf]);
  const globalsNoBs = [bof(0x0005)];
  const globalsLen = globalsNoBs.reduce((a, b) => a + b.length, 0) + 4 + bsData.length + sst.reduce((a, b) => a + b.length, 0) + eof.length;
  bsData.writeUInt32LE(globalsLen, 0);
  const cells = [];
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (typeof v === 'string') { const d = Buffer.alloc(10); d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeUInt32LE(index.get(v), 6); cells.push(rec(0x00FD, d)); }
    else if (Number.isInteger(v) && Math.abs(v) < 2 ** 29) { const d = Buffer.alloc(10); d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeInt32LE((v << 2) | 2, 6); cells.push(rec(0x027E, d)); }
    else { const d = Buffer.alloc(14); d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeDoubleLE(v, 6); cells.push(rec(0x0203, d)); }
  }));
  const stream = Buffer.concat([...globalsNoBs, rec(0x0085, bsData), ...sst, eof, bof(0x0010), ...cells, eof]);
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, '/Workbook', stream);
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
}
module.exports.excelStyleXls = excelStyleXls;
