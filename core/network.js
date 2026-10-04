'use strict';
// IP 주소 메뉴. 교사: 내 IP 알려주기·받은 IP로 바꾸기 / 정보부장: 교실별 IP 목록·배정 메시지.
const crypto = require('crypto');
const M = require('./network-msg');

const REGISTRY = 'ip-registry.json';
const DEFAULTS = { mask: '255.255.255.0', dns1: '', dns2: '', gwRule: '.1' };

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const t = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const CSV_COLS = [
  ['room', '교실'], ['pcName', 'PC이름'], ['ip', 'IP'], ['mask', '서브넷'], ['gateway', '게이트웨이'], ['dns1', 'DNS1'], ['dns2', 'DNS2'],
  ['mac', 'MAC'], ['dhcp', '방식'], ['receivedAt', '받은 날'], ['assignedIp', '배정 IP'], ['assignedAt', '배정한 날'], ['note', '메모'],
];
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');

function createNetworkService({ platform, store }) {
  // ── 내 PC ──
  function pickPrimary(list) {
    const score = (a) => (a.gateway ? 8 : 0) + (a.hardware ? 4 : 0) + (!a.virtual ? 2 : 0) + (!a.wifi ? 1 : 0);
    return [...list].sort((a, b) => score(b) - score(a))[0] || null;
  }

  function view(a) {
    if (!a) return null;
    return { index: a.index, alias: a.alias, desc: a.desc, mac: M.normMac(a.mac), ip: a.ip, mask: M.prefixToMask(a.prefix), gateway: a.gateway || '', dns: (a.dns || []).filter(Boolean), dhcp: !!a.dhcp, wifi: !!a.wifi, virtual: !!a.virtual };
  }

  async function info() {
    const raw = await platform.network.adapters();
    const list = raw.map(view);
    const physical = list.filter((a) => !a.virtual);
    const primary = view(pickPrimary(raw));
    const s = store.settings.get();
    return { pcName: platform.user.computer, room: s.room || '', role: s.role || 'user', adapters: physical.length ? physical : list, primary, canUndo: !!store.read('network-undo.json', null) };
  }

  async function myMessage(room) {
    if (typeof room === 'string') store.settings.set({ room: room.trim() });
    const i = await info();
    const msg = M.teacherMessage({ ...(i.primary || {}), pcName: i.pcName }, i.room);
    platform.clipboard.write(msg);
    return msg;
  }

  function registryData() {
    const r = store.read(REGISTRY, null) || {};
    return { defaults: { ...DEFAULTS, ...(r.defaults || {}) }, pcs: r.pcs || [] };
  }

  // 받은 메시지를 읽어 칸을 채운다(빈 칸은 학교 기본값·추천값으로).
  function parse(text) {
    const p = M.parseMessage(text);
    const d = registryData().defaults;
    if (p.ip && !p.mask) p.mask = d.mask || '255.255.255.0';
    if (p.ip && !p.gateway) p.gateway = M.suggestGateway(p.ip, p.mask, d.gwRule);
    if (p.ip && !p.dns1 && d.dns1) { p.dns1 = d.dns1; p.dns2 = p.dns2 || d.dns2; }
    return { ...p, found: !!(p.ip || p.dhcp), errors: M.validate(p) };
  }

  async function apply(cfg) {
    const errors = M.validate(cfg);
    if (errors.length) return { ok: false, code: 'invalid', errors };
    const before = (await platform.network.adapters()).find((a) => a.index === cfg.index);
    if (!before) return { ok: false, code: 'no-adapter' };
    const prev = view(before);
    store.write('network-undo.json', { at: Date.now(), index: prev.index, alias: prev.alias, dhcp: prev.dhcp, ip: prev.ip, mask: prev.mask, gateway: prev.gateway, dns1: prev.dns[0] || '', dns2: prev.dns[1] || '' });
    const code = await platform.network.apply(cfg);
    if (code !== 'ok') return { ok: false, code };
    const check = await verify(cfg.dhcp ? null : cfg.gateway);
    return { ok: true, check, info: await info() };
  }

  async function verify(gateway) {
    // 바꾼 직후에는 연결이 잠깐 끊길 수 있어 몇 번 다시 확인한다.
    let last = null;
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((r) => setTimeout(r, platform.kind === 'mock' ? 10 : 2500));
      const now = await info();
      last = await platform.network.connectivity(gateway || (now.primary && now.primary.gateway));
      if (last.internet) break;
    }
    return last;
  }

  async function undo() {
    const u = store.read('network-undo.json', null);
    if (!u) return { ok: false };
    const code = await platform.network.apply({ index: u.index, dhcp: u.dhcp, ip: u.ip, mask: u.mask, gateway: u.gateway, dns1: u.dns1, dns2: u.dns2 });
    if (code !== 'ok') return { ok: false, code };
    store.write('network-undo.json', null);
    return { ok: true, check: await verify(u.dhcp ? null : u.gateway), info: await info() };
  }

  async function check() {
    const i = await info();
    return platform.network.connectivity(i.primary && i.primary.gateway);
  }

  // ── 정보부장: 교실별 IP 목록 ──
  function saveRegistry(r) { store.write(REGISTRY, r); }
  const ipOf = (pc) => (pc.assignedIp || pc.ip);

  function duplicatesOf(r, ip, exceptId) {
    if (!ip) return [];
    return r.pcs.filter((x) => x.id !== exceptId && (x.ip === ip || x.assignedIp === ip)).map((x) => ({ id: x.id, room: x.room, pcName: x.pcName }));
  }

  function registryList() {
    const r = registryData();
    const pcs = r.pcs.map((pc) => ({ ...pc, duplicate: duplicatesOf(r, ipOf(pc), pc.id).length > 0 }));
    pcs.sort((a, b) => (a.room || '').localeCompare(b.room || '', 'ko', { numeric: true }) || (a.pcName || '').localeCompare(b.pcName || ''));
    return { defaults: r.defaults, pcs };
  }

  function upsert(r, p, source = 'message') {
    const mac = M.normMac(p.mac);
    let pc = (mac && r.pcs.find((x) => x.mac === mac)) || r.pcs.find((x) => !x.mac && x.room === p.room && x.pcName === p.pcName && (p.room || p.pcName));
    const created = !pc;
    if (!pc) { pc = { id: crypto.randomBytes(6).toString('hex') }; r.pcs.push(pc); }
    Object.assign(pc, {
      room: p.room || pc.room || '', pcName: p.pcName || pc.pcName || '', ip: p.ip || pc.ip || '', mask: p.mask || pc.mask || '',
      gateway: p.gateway || pc.gateway || '', dns1: p.dns1 || pc.dns1 || '', dns2: p.dns2 || pc.dns2 || '', mac: mac || pc.mac || '',
      dhcp: !!p.dhcp, receivedAt: Date.now(), source,
    });
    // 교사가 배정받은 IP로 바꾼 뒤 다시 보내오면 배정 완료로 정리
    if (pc.assignedIp && pc.assignedIp === pc.ip) { pc.assignedIp = ''; pc.assignedAt = null; pc.appliedAt = Date.now(); }
    return { pc, created };
  }

  function registryImport(text) {
    const p = M.parseMessage(text);
    if (!p.ip && !p.mac) return { ok: false, code: 'empty' };
    const r = registryData();
    const { pc, created } = upsert(r, p);
    saveRegistry(r);
    return { ok: true, created, record: pc, duplicates: duplicatesOf(r, pc.ip, pc.id) };
  }

  function registryUpdate(id, patch) {
    const r = registryData();
    const pc = r.pcs.find((x) => x.id === id);
    if (!pc) return { ok: false };
    for (const k of ['room', 'pcName', 'note']) if (typeof patch[k] === 'string') pc[k] = patch[k].trim();
    saveRegistry(r);
    return { ok: true, record: pc };
  }

  function registryDelete(id) {
    const r = registryData();
    r.pcs = r.pcs.filter((x) => x.id !== id);
    saveRegistry(r);
    return { ok: true };
  }

  function setDefaults(d) {
    const r = registryData();
    const next = { ...r.defaults };
    if (d.mask !== undefined) { if (d.mask && M.maskToPrefix(d.mask) == null) return { ok: false, field: 'mask' }; next.mask = d.mask || DEFAULTS.mask; }
    for (const k of ['dns1', 'dns2']) if (d[k] !== undefined) { if (d[k] && !M.isIp(d[k])) return { ok: false, field: k }; next[k] = d[k]; }
    if (['.1', '.254', 'manual'].includes(d.gwRule)) next.gwRule = d.gwRule;
    r.defaults = next;
    saveRegistry(r);
    return { ok: true, defaults: next };
  }

  // 새 IP 배정 → 메시지(클립보드에 복사)
  function assign(id, cfg) {
    const r = registryData();
    const pc = r.pcs.find((x) => x.id === id);
    if (!pc) return { ok: false, code: 'unknown' };
    const d = r.defaults;
    const full = {
      ip: (cfg.ip || '').trim(), mask: cfg.mask || d.mask,
      gateway: cfg.gateway || (d.gwRule !== 'manual' ? M.suggestGateway(cfg.ip, cfg.mask || d.mask, d.gwRule) : ''),
      dns1: cfg.dns1 !== undefined ? cfg.dns1 : d.dns1, dns2: cfg.dns2 !== undefined ? cfg.dns2 : d.dns2,
    };
    const errors = M.validate(full);
    if (errors.length) return { ok: false, code: 'invalid', errors };
    const dup = duplicatesOf(r, full.ip, pc.id);
    if (dup.length && !cfg.force) return { ok: false, code: 'duplicate', duplicates: dup };
    Object.assign(pc, { assignedIp: full.ip, assignedMask: full.mask, assignedGateway: full.gateway, assignedDns1: full.dns1, assignedDns2: full.dns2, assignedAt: Date.now() });
    saveRegistry(r);
    const message = M.assignMessage({ room: pc.room, ...full });
    platform.clipboard.write(message);
    return { ok: true, message, record: pc };
  }

  function exportCsv() {
    const { pcs } = registryList();
    const lines = [CSV_COLS.map((c) => c[1]).join(',')];
    for (const pc of pcs) {
      lines.push(CSV_COLS.map(([k]) => {
        if (k === 'dhcp') return csvCell(pc.dhcp ? '자동' : '고정');
        if (k === 'receivedAt' || k === 'assignedAt') return csvCell(day(pc[k]));
        return csvCell(pc[k]);
      }).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { ok: false, code: 'empty' };
    const header = rows[0].map((h) => h.trim());
    const col = (label) => header.findIndex((h) => h === label || h.toLowerCase() === label.toLowerCase());
    const idx = Object.fromEntries(CSV_COLS.map(([k, l]) => [k, col(l)]));
    if (idx.ip < 0 && idx.mac < 0) return { ok: false, code: 'columns' };
    const r = registryData();
    let created = 0, updated = 0;
    for (const row of rows.slice(1)) {
      const g = (k) => (idx[k] >= 0 ? (row[idx[k]] || '').trim() : '');
      const p = { room: g('room'), pcName: g('pcName'), ip: g('ip'), mask: g('mask'), gateway: g('gateway'), dns1: g('dns1'), dns2: g('dns2'), mac: g('mac'), dhcp: g('dhcp') === '자동' };
      if (!p.ip && !p.mac) continue;
      const res = upsert(r, p, 'csv');
      if (g('note')) res.pc.note = g('note');
      if (g('assignedIp') && M.isIp(g('assignedIp')) && g('assignedIp') !== res.pc.ip) res.pc.assignedIp = g('assignedIp');
      if (res.created) created++; else updated++;
    }
    saveRegistry(r);
    return { ok: true, created, updated };
  }

  return {
    info, myMessage, parse, apply, undo, check,
    registryList, registryImport, registryUpdate, registryDelete, setDefaults, assign, exportCsv, importCsv,
  };
}

module.exports = { createNetworkService, parseCsv };
