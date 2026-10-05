'use strict';
// PC 사양(Windows에서 읽은 값)을 대장에 적기 좋은 짧은 글로 바꾼다.
// → { pcModel, cpu, ram, ssd, monitor, printer } (모두 문자열, 여러 개는 ' / '로 이음)

// 모니터 제조사 PNP 코드
const MON_MAKERS = { SAM: '삼성', SEC: '삼성', SDC: '삼성디스플레이', GSM: 'LG', LGD: 'LG디스플레이', DEL: 'Dell', HWP: 'HP', HPN: 'HP', LEN: 'Lenovo', ACR: 'Acer', AUS: 'ASUS', BNQ: 'BenQ', PHL: 'Philips', AOC: 'AOC', VSC: 'ViewSonic', BOE: 'BOE', AUO: 'AUO', CMN: 'Innolux', IVM: 'iiyama', ENC: 'EIZO', SHP: 'Sharp', HKC: 'HKC', MSI: 'MSI', GBT: 'Gigabyte', APP: 'Apple', NEC: 'NEC', SNY: 'Sony', TSB: 'Toshiba', CRS: '크로스오버', HSD: '한성', JWK: '주연테크', DMS: '디엠에스' };
// 실제 기계가 아닌 프린터(PDF 저장·팩스·원노트 등)
const VIRTUAL_PRINTER = /\bpdf|xps|onenote|fax|팩스|send to|document writer|ezpdf|hancom|한컴|cutepdf|bullzip|snagit|microsoft print/i;
const BAD = /^(to be filled by o\.?e\.?m\.?|system product name|system manufacturer|default string|none|unknown|o\.?e\.?m\.?|undefined|\s*)$/i;

const clean = (s) => String(s || '').replace(/\(R\)|\(TM\)|®|™/gi, '').replace(/\s+/g, ' ').trim();
const ok = (s) => !!s && !BAD.test(String(s).trim());
const uniq = (a) => [...new Set(a.filter(Boolean))];

function gbDecimal(n) { // 저장장치는 제품 표기처럼 1000 단위
  if (!n) return '';
  const g = n / 1e9;
  if (g >= 1000) return `${+(g / 1000).toFixed(1)}TB`;
  const steps = [32, 64, 120, 128, 240, 250, 256, 480, 500, 512, 960, 1000];
  const near = steps.filter((s) => Math.abs(g - s) / s < 0.08).sort((a, b) => Math.abs(g - a) - Math.abs(g - b))[0];
  return `${near || Math.round(g)}GB`;
}
const gbBinary = (n) => (n ? `${Math.round(n / 1024 ** 3)}GB` : '');

function cpuText(raw) {
  return uniq((raw.cpu || []).map((c) => clean(c).replace(/\s*CPU\s*@/i, ' @').replace(/\s+\d+-Core Processor$/i, ''))).join(' / ');
}

// RAM은 합계 용량만(예: 32GB). Windows가 알려 주는 전체 메모리는 조금 모자라게 나오므로 반올림.
function ramText(raw) {
  const mods = (raw.ram || []).filter((m) => m && m.size > 0);
  const total = mods.reduce((a, m) => a + m.size, 0) || raw.ramTotal || 0;
  return total ? gbBinary(total) : '';
}

function diskType(d) {
  const media = String(d.media || '');
  if (/ssd|^4$/i.test(media) || /nvme|^17$/i.test(String(d.bus || '')) || /ssd|nvme/i.test(d.model || '')) return 'SSD';
  if (/hdd|^3$/i.test(media)) return 'HDD';
  return '';
}

// 저장장치는 SSD와 HDD를 나눠 용량만. 여러 개면 ' + '로 잇고, 종류를 모르면 SSD 칸에 '(종류 모름)'.
function diskTexts(raw) {
  const list = (raw.disks || []).filter((d) => d && d.size > 0 && !/usb|^7$/i.test(String(d.bus || '')) && !/usb/i.test(d.model || ''));
  const ssd = [], hdd = [];
  for (const d of list) {
    const t = diskType(d);
    if (t === 'HDD') hdd.push(gbDecimal(d.size));
    else ssd.push(t ? gbDecimal(d.size) : `${gbDecimal(d.size)}(종류 모름)`);
  }
  return { ssd: ssd.join(' + '), hdd: hdd.join(' + ') };
}

function monitorText(raw) {
  const list = (raw.monitors || []).map((m) => {
    const code = String(m.maker || '').toUpperCase();
    const maker = MON_MAKERS[code] || code;
    const name = clean(m.name);
    if (name) {
      const has = [maker, code, maker === '삼성' ? 'samsung' : '', maker === 'LG' ? 'lg' : ''].some((x) => x && name.toLowerCase().includes(String(x).toLowerCase()));
      return has ? name : `${maker} ${name}`.trim();
    }
    return `${maker || '모니터'}${m.code ? ` (제품코드 ${m.code})` : ' (노트북 화면)'}`;
  });
  return list.join(' / ');
}

function printerText(raw) {
  const list = (raw.printers || []).filter((p) => p && !VIRTUAL_PRINTER.test(`${p.name} ${p.driver} ${p.port}`));
  list.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const model = clean(p.driver) || clean(p.name);
    if (seen.has(model.toLowerCase())) continue;
    seen.add(model.toLowerCase());
    out.push(`${model}${p.isDefault ? ' (기본)' : ''}`);
  }
  return out.join(' / ');
}

function summarize(raw) {
  if (!raw) return null;
  let maker = ok(raw.maker) ? clean(raw.maker) : '';
  for (let i = 0; i < 3; i++) maker = maker.replace(/[\s,.]*(co\.?,?\s*ltd\.?|corporation|corp\.?|inc\.?|electronics|computer|technology)\.?$/i, '').trim();
  const model = ok(raw.model) ? clean(raw.model) : '';
  return {
    pcModel: [maker, model].filter(Boolean).join(' '),
    cpu: cpuText(raw), ram: ramText(raw), ...diskTexts(raw), monitor: monitorText(raw), printer: printerText(raw),
  };
}

// 1.6.0 형식(제조사·모델명까지 적은 값)을 용량만 남긴 새 형식으로 바꾼다.
//  RAM '32GB (16GB×2 …)' → '32GB'
//  SSD 'KLEVV … (SSD 1TB) / WDC … (SSD 500GB) / SAMSUNG HD502HJ (HDD 500GB)' → SSD '1TB + 500GB', HDD '500GB'
function normalizeHw(hw) {
  if (!hw) return hw;
  const out = { ...hw };
  if (out.ram) { const m = String(out.ram).match(/^\s*(\d+(?:\.\d+)?\s*[GT]B)/i); if (m) out.ram = m[1].replace(/\s+/g, ''); }
  if (out.ssd && /\((?:SSD|HDD)?\s*[\d.]+\s*[GT]B\)/i.test(out.ssd)) {
    const ssd = [], hdd = [];
    for (const part of String(out.ssd).split(' / ')) {
      const m = part.match(/\((SSD|HDD)?\s*([\d.]+\s*[GT]B)\)\s*$/i);
      if (!m) continue;
      const size = m[2].replace(/\s+/g, '');
      if (/hdd/i.test(m[1] || '')) hdd.push(size); else ssd.push(m[1] ? size : `${size}(종류 모름)`);
    }
    out.ssd = ssd.join(' + ');
    if (!out.hdd) out.hdd = hdd.join(' + ');
  }
  return out;
}

// 화면·메시지·대장에서 같은 순서와 이름을 쓴다.
const HW_FIELDS = [['pcModel', 'PC 모델'], ['cpu', 'CPU'], ['ram', 'RAM'], ['ssd', 'SSD'], ['hdd', 'HDD'], ['monitor', '모니터'], ['printer', '프린터']];

module.exports = { summarize, normalizeHw, HW_FIELDS, gbDecimal };
