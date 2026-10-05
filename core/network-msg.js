'use strict';
// IP 주소 계산·검증과 메시지(교사 ↔ 정보부장) 만들기·읽기. 화면·서비스 공용.

const IP_RE = /\b(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\b/;
const IP_RE_G = new RegExp(IP_RE.source, 'g');
const MAC_RE = /\b([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})\b/;

const isIp = (s) => typeof s === 'string' && new RegExp(`^${IP_RE.source}$`).test(s.trim());
const toInt = (ip) => ip.split('.').reduce((a, b) => ((a << 8) | Number(b)) >>> 0, 0);
const toIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

function maskToPrefix(mask) {
  if (!isIp(mask)) return null;
  const n = toInt(mask);
  const inv = (~n) >>> 0;
  if ((inv & (inv + 1)) !== 0) return null; // 1이 앞쪽에 연속되지 않음
  let c = 0;
  for (let i = 31; i >= 0; i--) if ((n >>> i) & 1) c++;
  return c;
}
function prefixToMask(p) { return toIp(p === 0 ? 0 : ((0xFFFFFFFF << (32 - p)) >>> 0)); }
const normMac = (m) => (m ? String(m).toUpperCase().replace(/:/g, '-') : '');

function suggestGateway(ip, mask = '255.255.255.0', rule = '.1') {
  if (!isIp(ip) || maskToPrefix(mask) == null) return '';
  const net = (toInt(ip) & toInt(mask)) >>> 0;
  if (rule === '.254') return toIp((net | ((~toInt(mask)) >>> 0)) - 1);
  return toIp(net + 1);
}

// 입력값 검사 → 문제 목록(쉬운 말)
function validate({ dhcp, ip, mask, gateway, dns1, dns2 }) {
  if (dhcp) return [];
  const errs = [];
  if (!isIp(ip)) errs.push({ field: 'ip', msg: 'IP 주소를 숫자 4개(예: 10.20.3.42)로 입력해 주세요.' });
  const prefix = maskToPrefix(mask);
  if (prefix == null || prefix < 8 || prefix > 30) errs.push({ field: 'mask', msg: '서브넷 마스크가 올바르지 않아요(보통 255.255.255.0).' });
  if (gateway && !isIp(gateway)) errs.push({ field: 'gateway', msg: '게이트웨이를 숫자 4개로 입력해 주세요.' });
  for (const [k, v] of [['dns1', dns1], ['dns2', dns2]]) if (v && !isIp(v)) errs.push({ field: k, msg: 'DNS 서버 주소를 숫자 4개로 입력해 주세요.' });
  if (!errs.length) {
    const m = toInt(mask), n = toInt(ip);
    const host = n & ~m;
    if (host === 0 || ((host | m) >>> 0) === 0xFFFFFFFF) errs.push({ field: 'ip', msg: '이 IP는 쓸 수 없는 번호예요(맨 처음이나 맨 끝 번호).' });
    if (gateway && ((toInt(gateway) & m) >>> 0) !== ((n & m) >>> 0)) errs.push({ field: 'gateway', msg: 'IP와 게이트웨이의 앞자리가 달라요. 정보부장이 알려준 값을 다시 확인해 주세요.' });
    if (gateway && gateway === ip) errs.push({ field: 'gateway', msg: 'IP와 게이트웨이가 같아요.' });
  }
  return errs;
}

// ── 메시지 ──
function teacherMessage(info, room) {
  const lines = [
    `[쎈Clean IP 정보] ${room || '(교실 이름 없음)'}`,
    `PC이름 ${info.pcName || '-'}`,
    `IP ${info.ip || '-'} / 서브넷 ${info.mask || '-'} / 게이트웨이 ${info.gateway || '-'}`,
    `DNS ${(info.dns || []).filter(Boolean).join(', ') || '-'}`,
    `MAC ${info.mac || '-'}`,
    `방식 ${info.dhcp ? '자동(DHCP)' : '고정 IP'}`,
  ];
  return lines.join('\n');
}

function assignMessage({ room, ip, mask, gateway, dns1, dns2 }) {
  return [
    `[쎈Clean IP 변경] ${room || ''}`.trim(),
    `IP ${ip} / 서브넷 ${mask} / 게이트웨이 ${gateway || '-'}`,
    `DNS ${[dns1, dns2].filter(Boolean).join(', ') || '-'}`,
    '→ 쎈Clean [IP 주소] → [받은 내용 붙여넣기] 후 [바꾸기]를 누르세요.',
  ].join('\n');
}

// 사람이 쓴 메시지도 최대한 읽는다. → { kind, room, pcName, ip, mask, gateway, dns1, dns2, mac, dhcp }
function parseMessage(text) {
  const t = String(text || '').replace(/\r/g, '');
  const out = { kind: null, room: '', pcName: '', ip: '', mask: '', gateway: '', dns1: '', dns2: '', mac: '', dhcp: false };
  const head = t.match(/\[쎈(?:클린|Clean) IP (정보|변경)\]\s*([^\n]*)/) /* 1.3.0 이전 메시지도 읽음 */;
  if (head) { out.kind = head[1] === '정보' ? 'info' : 'assign'; out.room = head[2].trim(); }
  const after = (labelRe) => { const m = t.match(new RegExp(`(?:${labelRe})\\s*[:：=]?\\s*(${IP_RE.source})`, 'i')); return m ? m[0].match(IP_RE)[0] : ''; };
  out.ip = after('(?<![a-z])IP(?:\\s*주소)?|아이피(?:\\s*주소)?');
  out.mask = after('서브넷(?:\\s*마스크)?|subnet(?:\\s*mask)?|마스크|netmask');
  out.gateway = after('(?:기본\\s*)?게이트웨이|gateway|GW');
  const dnsLine = t.match(/(?:DNS|디엔에스)[^\n]*/i);
  if (dnsLine) { const ips = dnsLine[0].match(IP_RE_G) || []; out.dns1 = ips[0] || ''; out.dns2 = ips[1] || ''; }
  const mac = t.match(MAC_RE);
  if (mac) out.mac = normMac(mac[0]);
  const pc = t.match(/PC\s*이름\s*[:：]?\s*([^\s/]+)/i);
  if (pc && pc[1] !== '-') out.pcName = pc[1];
  if (/자동\s*\(?DHCP\)?|자동으로\s*IP/i.test(t)) out.dhcp = true;
  // 라벨 없이 숫자만 온 경우: 순서대로 IP, 서브넷, 게이트웨이, DNS
  if (!out.ip) {
    const all = t.match(IP_RE_G) || [];
    const masks = all.filter((x) => maskToPrefix(x) != null && x.startsWith('255.'));
    const rest = all.filter((x) => !masks.includes(x));
    out.ip = rest[0] || '';
    out.mask = out.mask || masks[0] || '';
    out.gateway = out.gateway || rest[1] || '';
    out.dns1 = out.dns1 || rest[2] || '';
    out.dns2 = out.dns2 || rest[3] || '';
  }
  return out;
}

module.exports = { isIp, maskToPrefix, prefixToMask, suggestGateway, validate, teacherMessage, assignMessage, parseMessage, normMac, toInt };
