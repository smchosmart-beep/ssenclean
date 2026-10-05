'use strict';
// PC 사양(Windows에서 읽은 값)을 대장에 적기 좋은 짧은 글로 바꾼다.
// → { pcModel, cpu, ram, ssd, monitor, printer } (모두 문자열, 여러 개는 ' / '로 이음)

// 메모리 제조사 JEDEC 코드
const RAM_MAKERS = { '80CE': '삼성', CE00: '삼성', '00CE': '삼성', '80AD': 'SK하이닉스', AD00: 'SK하이닉스', '00AD': 'SK하이닉스', '802C': '마이크론', '2C00': '마이크론', '002C': '마이크론', '859B': '크루셜', '9B05': '크루셜', '0198': '킹스톤', '9801': '킹스톤', '04CD': 'G.Skill', CD04: 'G.Skill', '029E': '커세어', '9E02': '커세어', '8551': 'Qimonda', '0443': 'Ramaxel', '4304': 'Ramaxel' };
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

function ramText(raw) {
  const mods = (raw.ram || []).filter((m) => m && m.size > 0);
  const total = mods.reduce((a, m) => a + m.size, 0) || raw.ramTotal || 0;
  if (!total) return '';
  const head = gbBinary(total);
  if (!mods.length) return head;
  const groups = new Map();
  for (const m of mods) {
    const code = String(m.maker || '').toUpperCase().replace(/^0X/, '');
    const maker = RAM_MAKERS[code] || (ok(m.maker) && !/^[0-9A-F]{4}$/.test(code) ? clean(m.maker) : '');
    const key = [gbBinary(m.size), maker, ok(m.part) ? clean(m.part) : '', m.speed || m.speed2 || 0].join('|');
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const parts = [...groups].map(([k, n]) => {
    const [size, maker, part, speed] = k.split('|');
    return [`${size}×${n}`, [maker, part].filter(Boolean).join(' '), Number(speed) ? `${speed}MHz` : ''].filter(Boolean).join(' ');
  });
  return `${head} (${parts.join(', ')})`;
}

function diskType(d) {
  const media = String(d.media || '');
  if (/ssd|^4$/i.test(media) || /nvme|^17$/i.test(String(d.bus || '')) || /ssd|nvme/i.test(d.model || '')) return 'SSD';
  if (/hdd|^3$/i.test(media)) return 'HDD';
  return '';
}

function ssdText(raw) {
  const list = (raw.disks || []).filter((d) => d && d.size > 0 && !/usb|^7$/i.test(String(d.bus || '')) && !/usb/i.test(d.model || ''));
  return list.map((d) => {
    const t = diskType(d);
    return `${clean(d.model) || '이름 없음'} (${[t, gbDecimal(d.size)].filter(Boolean).join(' ')})`;
  }).join(' / ');
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
    cpu: cpuText(raw), ram: ramText(raw), ssd: ssdText(raw), monitor: monitorText(raw), printer: printerText(raw),
  };
}

// 화면·메시지·대장에서 같은 순서와 이름을 쓴다.
const HW_FIELDS = [['pcModel', 'PC 모델'], ['cpu', 'CPU'], ['ram', 'RAM'], ['ssd', 'SSD'], ['monitor', '모니터'], ['printer', '프린터']];

module.exports = { summarize, HW_FIELDS, gbDecimal };
