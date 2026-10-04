'use strict';
// 개인정보 탐지 규칙. spec 4.4
// 주민번호는 체크섬을 쓰지 않는다(2020.10 이후 발급분은 뒷자리가 임의번호).

const TYPES = {
  rrn: { label: '주민번호', level: 3 },
  frn: { label: '외국인번호', level: 3 },
  passport: { label: '여권번호', level: 3 },
  license: { label: '운전면허번호', level: 3 },
  account: { label: '계좌번호', level: 2 },
  phone: { label: '전화번호', level: 2 },
  email: { label: '이메일', level: 1 },
};
// 위험도: 3 = 빨강, 2 = 주황, 1 = 노랑(주황 계열)
const PRIORITY = ['rrn', 'frn', 'license', 'passport', 'phone', 'account', 'email'];

const BANKS = '계좌|은행|예금주|입금|송금|이체|국민|신한|우리|하나|농협|기업|카카오뱅크|토스뱅크|케이뱅크|새마을|우체국|신협|수협|SC제일|씨티|부산|대구|경남|광주|전북|제주|산업';
const KW = {
  passport: /여권|passport/i,
  license: /면허/,
  account: new RegExp(BANKS),
};

function validBirth(yy, mm, dd, g) {
  const m = Number(mm), d = Number(dd), y2 = Number(yy);
  if (m < 1 || m > 12 || d < 1) return false;
  const century = (g === 1 || g === 2 || g === 5 || g === 6) ? 1900 : 2000;
  const y = century + y2;
  const dim = new Date(y, m, 0).getDate();
  return d <= dim;
}

function near(text, start, end, re, span = 30) {
  return re.test(text.slice(Math.max(0, start - span), Math.min(text.length, end + span)));
}

const RULES = [
  {
    type: 'rrn',
    re: /(?<![\d-])(\d{2})(\d{2})(\d{2})[-\s]?([1-8])(\d{6})(?![\d-])/g,
    check: (m) => validBirth(m[1], m[2], m[3], Number(m[4])),
    classify: (m) => (Number(m[4]) >= 5 ? 'frn' : 'rrn'),
  },
  {
    type: 'license',
    re: /(?<![\d-])(\d{2})-?(\d{2})-?(\d{6})-?(\d{2})(?![\d-])/g,
    check: (m, t, s, e) => near(t, s, e, KW.license),
  },
  {
    type: 'passport',
    re: /(?<![A-Za-z0-9])([MSRODG](?:\d{8}|\d{3}[A-Z]\d{4}))(?![A-Za-z0-9])/g,
    check: (m, t, s, e) => near(t, s, e, KW.passport),
  },
  {
    type: 'phone',
    re: /(?<![\d-])01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?![\d-])/g,
  },
  {
    type: 'account',
    re: /(?<![\d-])\d{2,6}(?:-\d{2,7}){1,3}(?![\d-])|(?<![\d-])\d{10,14}(?![\d-])/g,
    check: (m, t, s, e) => {
      const digits = m[0].replace(/-/g, '').length;
      return digits >= 10 && digits <= 16 && near(t, s, e, KW.account);
    },
  },
  {
    type: 'email',
    re: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g,
  },
];

// 텍스트에서 개인정보 위치 목록을 찾는다. 겹치면 우선순위가 높은 것만 남긴다.
function detect(text) {
  const found = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      const s = m.index, e = s + m[0].length;
      if (rule.check && !rule.check(m, text, s, e)) continue;
      const type = rule.classify ? rule.classify(m) : rule.type;
      found.push({ type, start: s, end: e, value: m[0] });
    }
  }
  found.sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type) || a.start - b.start);
  const kept = [];
  for (const f of found) {
    if (kept.some((k) => f.start < k.end && k.start < f.end)) continue;
    kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

function maskDigitsKeep(value, keepStart, keepEnd) {
  let digitIdx = 0;
  const total = value.replace(/[^0-9A-Za-z]/g, '').length;
  return value.replace(/[0-9A-Za-z]/g, (ch) => {
    const i = digitIdx++;
    return i < keepStart || i >= total - keepEnd ? ch : '*';
  });
}

function mask(type, value) {
  switch (type) {
    case 'rrn':
    case 'frn': {
      const d = value.replace(/[^0-9]/g, '');
      const sep = /-/.test(value) ? '-' : (/\s/.test(value) ? ' ' : '-');
      return d.slice(0, 6) + sep + d[6] + '******';
    }
    case 'phone': return maskDigitsKeep(value, 3, 4);
    case 'account': return maskDigitsKeep(value, 3, 2);
    case 'passport': return maskDigitsKeep(value, 1, 2);
    case 'license': return maskDigitsKeep(value, 4, 2);
    case 'email': {
      const [u, d] = value.split('@');
      return u.slice(0, 2) + '***@' + d;
    }
    default: return '***';
  }
}

// 찾은 위치 주변 문맥(앞뒤 20자)을 만들고, 그 안의 모든 개인정보를 가린다.
function snippet(text, hit, all, span = 20) {
  const s = Math.max(0, hit.start - span);
  const e = Math.min(text.length, hit.end + span);
  let out = '';
  let pos = s;
  for (const h of all) {
    if (h.end <= s || h.start >= e) continue;
    const hs = Math.max(h.start, s), he = Math.min(h.end, e);
    out += text.slice(pos, hs);
    out += (h.start >= s && h.end <= e) ? mask(h.type, h.value) : '***';
    pos = he;
  }
  out += text.slice(pos, e);
  return (s > 0 ? '…' : '') + out.replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '');
}

function levelOf(counts) {
  let lv = 0;
  for (const [t, n] of Object.entries(counts)) if (n > 0) lv = Math.max(lv, TYPES[t].level);
  return lv;
}

// segments: [{ loc, text }] → { counts, level, previews }
function maskAll(text, hits) {
  let out = '', pos = 0;
  for (const h of hits) { out += text.slice(pos, h.start) + mask(h.type, h.value); pos = h.end; }
  return (out + text.slice(pos)).replace(/\s+/g, ' ').trim();
}

// segments: [{ loc, text }] → { counts, level, previews }
// 짧은 줄(엑셀 행 등)은 줄 전체를 가려서 한 번만, 긴 문단은 찾은 곳마다 앞뒤 문맥을 보여 준다.
function analyze(segments, { maxPreviews = 30 } = {}) {
  const counts = {};
  const previews = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const hits = detect(seg.text);
    if (!hits.length) continue;
    for (const h of hits) counts[h.type] = (counts[h.type] || 0) + 1;
    if (previews.length >= maxPreviews) continue;
    if (seg.text.length <= 120) {
      const labels = [...new Set(hits.map((h) => TYPES[h.type].label))];
      previews.push({ type: hits[0].type, label: labels.join(' · '), loc: seg.loc || '', text: maskAll(seg.text, hits), masked: mask(hits[0].type, hits[0].value) });
    } else {
      for (const h of hits) {
        if (previews.length >= maxPreviews) break;
        previews.push({ type: h.type, label: TYPES[h.type].label, loc: seg.loc || '', text: snippet(seg.text, h, hits), masked: mask(h.type, h.value) });
      }
    }
  }
  return { counts, level: levelOf(counts), previews };
}

module.exports = { TYPES, detect, mask, snippet, analyze, levelOf };
