'use strict';
// 엑셀 텍스트 추출기 (외부 라이브러리 없이). xlsx(OOXML), xls(BIFF8), HTML로 저장된 xls(나이스 내려받기 등)
const fflate = require('fflate');

const xmlText = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const isCfb = (b) => b.length > 8 && b.readUInt32LE(0) === 0xE011CFD0 && b.readUInt32LE(4) === 0xE11AB1A1;
const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4B;

function rowsToSegments(sheets) {
  const segs = [];
  for (const { name, rows } of sheets) {
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      const cells = rows.get(r).sort((a, b) => a[0] - b[0]).map((c) => String(c[1]).trim()).filter(Boolean);
      if (cells.length) segs.push({ loc: `${name} ${r + 1}행`, text: cells.join(' | ') });
    }
  }
  return segs;
}

function numText(n) {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
}

// ── XLSX ──────────────────────────────────────────────────
function colIndex(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { col: c - 1, row: Number(m[2]) - 1 };
}

function parseXlsx(buf) {
  let files;
  try {
    files = fflate.unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), {
      filter: (f) => /^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(f.name),
    });
  } catch { return { status: 'unreadable', segments: [] }; }
  const str = (n) => (files[n] ? fflate.strFromU8(files[n]) : '');
  const sheetFiles = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort(natural);
  if (!sheetFiles.length) return { status: 'unreadable', segments: [] };

  const sst = [];
  for (const si of str('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) || []) {
    const noPh = si.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    let t = '';
    for (const m of noPh.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)) t += xmlText(m[1]);
    sst.push(t);
  }

  // 시트 이름: workbook.xml의 r:id → rels의 Target
  const rels = {};
  for (const m of str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels[m[1]] = m[2].replace(/^\/?xl\//, '');
  for (const m of str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) rels[m[2]] = m[1].replace(/^\/?xl\//, '');
  const names = {};
  for (const m of str('xl/workbook.xml').matchAll(/<sheet [^>]*>/g)) {
    const tag = m[0];
    const name = (tag.match(/name="([^"]*)"/) || [])[1];
    const rid = (tag.match(/r:id="([^"]*)"/) || [])[1];
    if (name && rid && rels[rid]) names['xl/' + rels[rid]] = xmlText(name);
  }

  const sheets = [];
  sheetFiles.forEach((file, i) => {
    const xml = str(file);
    const rows = new Map();
    for (const m of xml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const inner = m[2] || '';
      const pos = colIndex((attrs.match(/r="([A-Z]+\d+)"/) || [])[1]);
      if (!pos) continue;
      const t = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let text = '';
      if (t === 'inlineStr') { for (const x of inner.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)) text += xmlText(x[1]); }
      else {
        const v = (inner.match(/<v>([^<]*)<\/v>/) || [])[1];
        if (v == null) continue;
        if (t === 's') text = sst[Number(v)] ?? '';
        else if (t === 'str' || t === 'e') text = xmlText(v);
        else if (t === 'b') continue;
        else text = numText(Number(v));
      }
      if (!rows.has(pos.row)) rows.set(pos.row, []);
      rows.get(pos.row).push([pos.col, text]);
    }
    sheets.push({ name: names[file] || `Sheet${i + 1}`, rows });
  });
  return { status: 'ok', segments: rowsToSegments(sheets) };
}

// ── XLS (BIFF8) ───────────────────────────────────────────
function rkValue(rk) {
  let v;
  if (rk & 2) v = rk >> 2;
  else { const b = Buffer.alloc(8); b.writeUInt32LE(rk & 0xFFFFFFFC, 4); v = b.readDoubleLE(0); }
  return rk & 1 ? v / 100 : v;
}

// SST는 CONTINUE 레코드로 나뉘어 있을 수 있어서, 조각을 넘나들며 읽는 리더를 쓴다.
function makeReader(chunks) {
  let ci = 0, pos = 0;
  const cur = () => chunks[ci];
  const ensure = () => { while (ci < chunks.length && pos >= cur().length) { ci++; pos = 0; } return ci < chunks.length; };
  return {
    u8() { if (!ensure()) throw new Error('eof'); return cur()[pos++]; },
    u16() { return this.u8() | (this.u8() << 8); },
    u32() { return (this.u16() | (this.u16() << 16)) >>> 0; },
    skip(n) { while (n > 0) { if (!ensure()) return; const k = Math.min(n, cur().length - pos); pos += k; n -= k; } },
    chars(cch, high) {
      let s = '';
      let wide = high;
      while (cch > 0) {
        if (ci >= chunks.length) break;
        if (pos >= cur().length) {
          // 글자가 다음 CONTINUE 조각으로 넘어가면 그 조각은 플래그 바이트(1=2바이트 문자)로 시작한다.
          ci++; pos = 0;
          if (ci >= chunks.length) break;
          wide = (cur()[pos++] & 1) === 1;
          continue;
        }
        const avail = cur().length - pos;
        const n = Math.min(cch, wide ? Math.floor(avail / 2) : avail);
        if (n <= 0) { pos = cur().length; continue; }
        const slice = cur().subarray(pos, pos + n * (wide ? 2 : 1));
        s += wide ? slice.toString('utf16le') : slice.toString('latin1');
        pos += n * (wide ? 2 : 1);
        cch -= n;
      }
      return s;
    },
  };
}

function readXlString(b, off, cchBytes = 2) {
  const cch = cchBytes === 2 ? b.readUInt16LE(off) : b[off];
  const flags = b[off + cchBytes];
  let p = off + cchBytes + 1;
  const rich = flags & 8, ext = flags & 4;
  if (rich) p += 2;
  if (ext) p += 4;
  const wide = flags & 1;
  const s = wide ? b.subarray(p, p + cch * 2).toString('utf16le') : b.subarray(p, p + cch).toString('latin1');
  return s;
}

function parseBiff(stream) {
  const recs = [];
  for (let i = 0; i + 4 <= stream.length;) {
    const type = stream.readUInt16LE(i), len = stream.readUInt16LE(i + 2);
    recs.push({ off: i, type, data: stream.subarray(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  if (!recs.length || recs[0].type !== 0x0809) return { status: 'unreadable', segments: [] };
  if (recs[0].data.length >= 2 && recs[0].data.readUInt16LE(0) !== 0x0600) return { status: 'unreadable', segments: [] }; // BIFF8만
  const sheetsByOffset = new Map();
  const sst = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 0x002F) return { status: 'locked', segments: [] }; // FILEPASS
    if (r.type === 0x0085) sheetsByOffset.set(r.data.readUInt32LE(0), readXlString(r.data, 6, 1));
    if (r.type === 0x00FC) {
      const chunks = [r.data.subarray(8)];
      for (let j = i + 1; j < recs.length && recs[j].type === 0x003C; j++) chunks.push(recs[j].data);
      const total = r.data.readUInt32LE(4);
      const rd = makeReader(chunks);
      try {
        for (let k = 0; k < total; k++) {
          const cch = rd.u16();
          const flags = rd.u8();
          const runs = flags & 8 ? rd.u16() : 0;
          const extLen = flags & 4 ? rd.u32() : 0;
          sst.push(rd.chars(cch, (flags & 1) === 1));
          rd.skip(runs * 4 + extLen);
        }
      } catch { /* 남은 문자열은 무시 */ }
    }
    if (r.type === 0x000A) break; // 전역 영역 끝(EOF)
  }
  const sheets = [];
  let cur = null;
  for (const r of recs) {
    if (r.type === 0x0809) {
      const name = sheetsByOffset.get(r.off);
      cur = name !== undefined ? { name, rows: new Map() } : null;
      if (cur) sheets.push(cur);
      continue;
    }
    if (!cur) continue;
    const d = r.data;
    const put = (row, col, text) => { if (!cur.rows.has(row)) cur.rows.set(row, []); cur.rows.get(row).push([col, text]); };
    try {
      if (r.type === 0x00FD) put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
      else if (r.type === 0x0204 || r.type === 0x00D6) put(d.readUInt16LE(0), d.readUInt16LE(2), readXlString(d, 6, 2));
      else if (r.type === 0x0203) put(d.readUInt16LE(0), d.readUInt16LE(2), numText(d.readDoubleLE(6)));
      else if (r.type === 0x027E) put(d.readUInt16LE(0), d.readUInt16LE(2), numText(rkValue(d.readInt32LE(6))));
      else if (r.type === 0x00BD) {
        const row = d.readUInt16LE(0), first = d.readUInt16LE(2);
        const n = (d.length - 6) / 6;
        for (let k = 0; k < n; k++) put(row, first + k, numText(rkValue(d.readInt32LE(4 + k * 6 + 2))));
      }
    } catch { /* 손상된 레코드는 건너뜀 */ }
  }
  return { status: 'ok', segments: rowsToSegments(sheets) };
}

function parseXlsCfb(buf) {
  const CFB = require('cfb');
  let c;
  try { c = CFB.read(buf, { type: 'buffer' }); } catch { return { status: 'unreadable', segments: [] }; }
  if (CFB.find(c, 'EncryptionInfo')) return { status: 'locked', segments: [] }; // 암호 걸린 xlsx
  const wb = CFB.find(c, 'Workbook') || CFB.find(c, 'Book');
  if (!wb || !wb.content) return { status: 'unreadable', segments: [] };
  return parseBiff(Buffer.from(wb.content));
}

// ── HTML로 저장된 xls ─────────────────────────────────────
function parseHtmlTable(buf) {
  let html = buf.toString('utf8');
  const cs = (html.match(/charset=["']?([\w-]+)/i) || [])[1];
  if (cs && /euc-kr|ks_c_5601|cp949/i.test(cs)) { try { html = new TextDecoder('euc-kr').decode(buf); } catch { /* keep */ } }
  const segs = [];
  let r = 0;
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    r++;
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((c) => xmlText(c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).trim()).filter(Boolean);
    if (cells.length) segs.push({ loc: `${r}행`, text: cells.join(' | ') });
  }
  return { status: 'ok', segments: segs };
}

function parseSpreadsheet(buf, ext) {
  if (isZip(buf)) return parseXlsx(buf);
  if (isCfb(buf)) return parseXlsCfb(buf);
  if (ext === '.xls') {
    const head = buf.subarray(0, 512).toString('latin1').toLowerCase();
    if (head.includes('<html') || head.includes('<table') || head.includes('<!doctype')) return parseHtmlTable(buf);
  }
  return { status: 'unreadable', segments: [] };
}

module.exports = { parseSpreadsheet, parseXlsx, parseBiff };
