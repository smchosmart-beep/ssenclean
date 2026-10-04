'use strict';
// Windows 네트워크: 조회는 PowerShell(읽기 전용, 일반 권한), 변경은 netsh.
// 권한이 없어 거부되면 Windows 확인 창([예])을 거쳐 같은 명령을 관리자 권한으로 다시 실행한다.
const net = require('net');
const { runPowerShell, run } = require('./exec');

async function adapters() {
  const res = await runPowerShell(`
$r=@()
Get-NetIPConfiguration -Detailed | Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address } | ForEach-Object {
  $c=$_; $a=$c.NetAdapter
  $ip=$c.IPv4Address | Select-Object -First 1
  $iface=Get-NetIPInterface -InterfaceIndex $c.InterfaceIndex -AddressFamily IPv4
  $gw=($c.IPv4DefaultGateway | Select-Object -First 1).NextHop
  $dns=@($c.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses })
  $r+=@{index=[int]$c.InterfaceIndex; alias=[string]$c.InterfaceAlias; desc=[string]$a.InterfaceDescription; mac=[string]$a.MacAddress;
        ip=[string]$ip.IPAddress; prefix=[int]$ip.PrefixLength; gateway=[string]$gw; dns=$dns; dhcp=([string]$iface.Dhcp -eq 'Enabled');
        virtual=[bool]$a.Virtual; hardware=[bool]$a.HardwareInterface; media=[string]$a.MediaType; wifi=([string]$a.PhysicalMediaType -match '802.11')}
}
ConvertTo-Json -InputObject @($r) -Depth 4 -Compress`, { timeoutMs: 30000 });
  return Array.isArray(res) ? res : [];
}

function netsh(args) { return run('netsh.exe', ['interface', 'ipv4', ...args], { timeoutMs: 30000 }); }

function classify(r) {
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.ok) return 'ok';
  if (/elevation|권한 상승|관리자 권한|access is denied|액세스가 거부/i.test(text)) return 'denied';
  return 'error';
}

// cfg: { index, dhcp, ip, mask, gateway, dns1, dns2 }
function stepsFor(cfg) {
  const name = `name=${cfg.index}`; // 이름(이더넷 2 등) 대신 인터페이스 번호를 써서 띄어쓰기·한글 문제를 피한다
  const steps = [];
  if (cfg.dhcp) {
    steps.push(['set', 'address', name, 'source=dhcp']);
    steps.push(['set', 'dnsservers', name, 'source=dhcp']);
  } else {
    steps.push(['set', 'address', name, 'source=static', `address=${cfg.ip}`, `mask=${cfg.mask}`, `gateway=${cfg.gateway || 'none'}`, ...(cfg.gateway ? ['gwmetric=1'] : [])]);
    if (cfg.dns1) {
      steps.push(['set', 'dnsservers', name, 'source=static', `address=${cfg.dns1}`, 'register=primary', 'validate=no']);
      if (cfg.dns2) steps.push(['add', 'dnsservers', name, `address=${cfg.dns2}`, 'index=2', 'validate=no']);
    } else {
      steps.push(['set', 'dnsservers', name, 'source=static', 'address=none']);
    }
  }
  return steps;
}

async function apply(cfg) {
  for (const s of stepsFor(cfg)) {
    const r = await netsh(s);
    const code = classify(r);
    // DHCP로 바꿀 때 '이미 DHCP' 같은 안내는 실패가 아니다
    if (code !== 'ok' && !(cfg.dhcp && /already|이미/i.test(r.stdout + r.stderr))) return code;
  }
  return 'ok';
}

async function pingOk(host) {
  if (!host) return null;
  const r = await run('ping.exe', ['-n', '2', '-w', '1500', host], { timeoutMs: 10000 });
  return /TTL=/i.test(r.stdout);
}

// 주소 찾기(DNS)와 실제 접속까지 확인한다. DNS 캐시만으로 '연결됨'이 나오지 않도록 TCP 접속을 한다.
function tcpOk(host, port = 443, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
async function internetOk() {
  const r = await Promise.all([tcpOk('www.naver.com'), tcpOk('www.google.com')]);
  return r.some(Boolean);
}

async function connectivity(gateway) {
  const [gw, internet] = await Promise.all([pingOk(gateway), internetOk()]);
  return { gateway: gw, internet };
}

// 관리자 권한으로 다시 실행. 반환: 'ok' | 'canceled' | 'error'
async function applyElevated(cfg, runElevated) {
  const ops = stepsFor(cfg).map((st) => ({ op: 'netsh', args: ['interface', 'ipv4', ...st], allowAlready: !!cfg.dhcp }));
  const r = await runElevated(ops);
  if (!r.ok) return r.canceled ? 'canceled' : 'error';
  return r.results.every((x) => x && x.ok) ? 'ok' : 'error';
}

module.exports = { adapters, apply, applyElevated, connectivity, stepsFor };
