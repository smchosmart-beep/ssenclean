import { h, btn, api, hero, pageHead, tip, toast, confirmDialog, modal, statusRow, radio, select, emptyState, fmtDate, icon, pendingCard } from '../ui.js';

const FIELDS = [['ip', 'IP 주소', '예: 10.20.3.42'], ['mask', '서브넷 마스크', '255.255.255.0'], ['gateway', '기본 게이트웨이', '예: 10.20.3.1'], ['dns1', '기본 DNS 서버', ''], ['dns2', '보조 DNS 서버', '(없으면 비워 두세요)']];
const input = (value, opts = {}) => { const el = h('input', { class: 'field', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', ...opts }); el.value = value || ''; return el; };

export default async function networkView(ctx) {
  const settings = await api('settings:get');
  let tab = settings.role === 'admin' && ctx.params.tab !== 'mine' ? (ctx.params.tab || 'mine') : 'mine';
  const tabsEl = h('div', { class: 'tabs' });
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(pageHead('IP 주소', settings.role === 'admin' ? '내 PC의 IP를 확인하고, 교실별 IP를 관리해요.' : '내 PC의 IP를 정보부장에게 알려 주고, 받은 IP로 바꿔요.', tabsEl), box);

  function renderTabs() {
    if (settings.role !== 'admin') { tabsEl.replaceChildren(); return; }
    tabsEl.replaceChildren(
      btn('monitor', '내 PC', () => { tab = 'mine'; renderTabs(); show(); }, { variant: tab === 'mine' ? 'on' : '', testid: 'tab-mine' }),
      btn('network', '교실 IP 관리', () => { tab = 'registry'; renderTabs(); show(); }, { variant: tab === 'registry' ? 'on' : '', testid: 'tab-registry' }));
  }

  // ───────────── 내 PC ─────────────
  let info = null;
  let form = null; // { dhcp, ip, mask, gateway, dns1, dns2 }
  let result = null;

  async function loadMine() {
    box.replaceChildren(pendingCard('IP 주소 확인 중…', '네트워크와 인터넷 연결을 확인하고 있어요'));
    info = await api('network:info');
    const conn = info.primary ? await api('network:check') : null;
    renderMine(conn);
  }

  function renderMine(conn) {
    const p = info.primary;
    if (!p) { box.replaceChildren(hero({ level: 'warn', iconName: 'network', title: '네트워크에 연결되어 있지 않아요', desc: '랜선이나 와이파이 연결을 확인해 주세요.' })); return; }
    const ok = conn && conn.internet;
    ctx.setDot('network', ok ? 'ok' : 'warn');
    const top = hero({
      level: ok ? 'ok' : 'warn', iconName: 'network',
      title: '내 IP는 {}예요', titleEmph: p.ip,
      desc: `${p.dhcp ? '자동 IP' : '고정 IP'} · ${conn == null ? '연결 확인 중' : ok ? '인터넷 연결됨' : '인터넷 연결이 안 돼요'} · ${p.alias}`,
      right: btn('refresh', '다시 확인', loadMine, { testid: 'net-recheck' }),
    });
    top.setAttribute('data-testid', 'net-hero');

    // 정보부장에게 알려주기
    const room = input(info.room, { inputmode: 'text', placeholder: '예: 3학년 2반', 'data-testid': 'net-room', style: { maxWidth: '240px' } });
    const kv = h('dl', { class: 'kv', style: { gridTemplateColumns: '130px 1fr' } },
      ...[['PC 이름', info.pcName], ['IP 주소', p.ip], ['서브넷 마스크', p.mask], ['기본 게이트웨이', p.gateway || '-'], ['DNS 서버', p.dns.join(', ') || '-'], ['MAC 주소', p.mac], ['방식', p.dhcp ? '자동(DHCP)' : '고정 IP']]
        .flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    const tell = h('section', { class: 'panel pad' },
      h('div', { class: 'section-title' }, '정보부장에게 알려주기'),
      h('div', { class: 'btn-row', style: { marginBottom: '16px' } }, h('label', { style: { width: '130px' } }, '우리 교실'), room),
      kv,
      h('div', { class: 'btn-row', style: { marginTop: '18px' } },
        btn('copy', '정보부장에게 보낼 내용 복사', async () => { await api('network:myMessage', room.value); toast('복사했어요. 메신저에 붙여넣어 정보부장에게 보내세요'); }, { variant: 'primary', testid: 'net-copy' })));

    // IP 바꾸기
    if (!form) form = { dhcp: p.dhcp, ip: p.ip, mask: p.mask, gateway: p.gateway, dns1: p.dns[0] || '', dns2: p.dns[1] || '' };
    const paste = h('textarea', { class: 'field', placeholder: '정보부장에게 받은 메시지를 여기에 붙여넣으세요', 'data-testid': 'net-paste' });
    const inputs = {};
    const errs = {};
    const grid = h('div', { class: 'form', style: { gridTemplateColumns: '150px 1fr', maxWidth: '560px' } });
    const drawGrid = () => {
      grid.replaceChildren();
      for (const [k, label, ph] of FIELDS) {
        inputs[k] = input(form[k], { placeholder: ph, disabled: form.dhcp, 'data-testid': `net-${k}` });
        inputs[k].addEventListener('input', () => { form[k] = inputs[k].value.trim(); });
        grid.append(h('label', {}, label), inputs[k]);
        errs[k] = h('div', { class: 'field-err' });
        grid.append(h('span'), errs[k]);
      }
    };
    drawGrid();
    const modeRow = h('div', { class: 'chk-line', style: { marginBottom: '12px' } },
      radio('ipmode', '정보부장이 알려준 IP로 (고정 IP)', !form.dhcp, () => { form.dhcp = false; drawGrid(); }),
      radio('ipmode', '자동으로 IP 받기 (DHCP)', form.dhcp, () => { form.dhcp = true; drawGrid(); }));
    const fill = async (text) => {
      const r = await api('network:parse', text);
      if (!r.found) { toast('메시지에서 IP 주소를 찾지 못했어요'); return; }
      form = { dhcp: r.dhcp, ip: r.ip, mask: r.mask, gateway: r.gateway, dns1: r.dns1, dns2: r.dns2 };
      renderMine(conn);
      toast('받은 내용으로 칸을 채웠어요. 확인하고 [바꾸기]를 누르세요');
    };
    paste.addEventListener('paste', () => setTimeout(() => fill(paste.value), 0));
    const change = h('section', { class: 'panel pad' },
      h('div', { class: 'section-title' }, 'IP 바꾸기'),
      paste,
      h('div', { class: 'btn-row', style: { margin: '10px 0 18px' } },
        btn('paste', '받은 내용 붙여넣기', async () => { const t = await api('app:paste'); paste.value = t; fill(t); }, { testid: 'net-paste-btn' }),
        h('span', { class: 'muted small' }, '붙여넣으면 아래 칸이 자동으로 채워져요.')),
      modeRow,
      grid,
      h('div', { class: 'btn-row', style: { marginTop: '18px' } },
        btn('check', '바꾸기', async () => {
          Object.values(errs).forEach((e) => { e.textContent = ''; });
          Object.values(inputs).forEach((i) => i.classList.remove('bad'));
          const cfg = { index: p.index, ...form };
          const errors = await api('network:validate', form);
          if (errors.length) { for (const e of errors) { errs[e.field].textContent = e.msg; inputs[e.field].classList.add('bad'); } return; }
          const ok = await confirmDialog({
            title: 'IP를 바꿀까요?',
            body: h('div', {},
              h('div', { class: 'msgbox' }, form.dhcp ? '자동으로 IP 받기(DHCP)' : `IP ${form.ip}\n서브넷 ${form.mask}\n게이트웨이 ${form.gateway || '-'}\nDNS ${[form.dns1, form.dns2].filter(Boolean).join(', ') || '-'}`),
              h('div', { class: 'muted small', style: { marginTop: '8px' } }, `지금 설정(IP ${p.ip})은 저장해 두었다가 [원래대로]로 되돌릴 수 있어요. 바꾸는 동안 인터넷이 잠깐 끊겨요. Windows 확인 창이 뜨면 [예]를 누르세요.`)),
            okLabel: '바꾸기', okIcon: 'check',
          });
          if (!ok) return;
          const r = await api('network:apply', cfg);
          if (!r.ok) {
            const msg = { canceled: 'Windows 확인 창에서 취소해서 바꾸지 않았어요. 다시 누르고 [예]를 누르세요.', denied: 'IP를 바꾸지 못했어요.', invalid: '입력한 값을 다시 확인해 주세요.', 'no-adapter': '네트워크 장치를 찾지 못했어요.' }[r.code] || 'IP를 바꾸지 못했어요.';
            await confirmDialog({ title: '바꾸지 못했어요', body: msg, okLabel: '알겠어요', cancelLabel: '닫기' });
            return;
          }
          info = r.info; form = null; result = r.check;
          renderMine(r.check);
        }, { variant: 'primary', testid: 'net-apply' }),
        info.canUndo ? btn('undo', '원래대로', async () => {
          const ok = await confirmDialog({ title: '바꾸기 전 설정으로 되돌릴까요?', okLabel: '되돌리기', okIcon: 'undo' });
          if (!ok) return;
          const r = await api('network:undo');
          if (r.ok) { info = r.info; form = null; result = r.check; toast('원래 설정으로 되돌렸어요'); renderMine(r.check); } else toast('되돌리지 못했어요');
        }, { testid: 'net-undo' }) : null));

    const resultBox = result ? h('section', { class: `panel pad tone-${result.internet ? 'ok' : 'warn'}`, 'data-testid': 'net-result' },
      h('div', { class: 'section-title' }, result.internet ? 'IP를 바꿨어요' : 'IP를 바꿨는데 인터넷이 안 돼요'),
      h('div', { class: 'chk-line' },
        result.gateway == null ? null : h('span', { class: result.gateway ? 'okmark' : 'badmark' }, `${result.gateway ? '✓' : '✗'} 학교 네트워크(게이트웨이)`),
        h('span', { class: result.internet ? 'okmark' : 'badmark' }, `${result.internet ? '✓' : '✗'} 인터넷`)),
      result.internet ? null : h('div', { style: { marginTop: '10px' } }, tip('정보부장이 알려준 값과 같은지 확인해 보세요. 모르겠으면 [원래대로]를 누르고 정보부장에게 문의하세요.', 'warn'))) : null;

    box.replaceChildren(top, resultBox, tell, change);
  }

  // ───────────── 정보부장: 교실 IP 관리 ─────────────
  let query = '';
  async function loadRegistry() {
    const data = await api('registry:list');
    renderRegistry(data);
  }

  function renderRegistry(data) {
    const recv = h('textarea', { class: 'field', placeholder: '교사에게 받은 [쎈클린 IP 정보] 메시지를 여기에 붙여넣으세요', 'data-testid': 'reg-paste' });
    const save = async (text) => {
      const r = await api('registry:import', text);
      if (!r.ok) { toast('메시지에서 IP나 MAC 주소를 찾지 못했어요'); return; }
      recv.value = '';
      await loadRegistry();
      if (r.duplicates.length) toast(`저장했어요. ⚠ 같은 IP를 ${r.duplicates.map((d) => d.room || d.pcName).join(', ')}도 쓰고 있어요`);
      else toast(`${r.record.room || r.record.pcName || 'PC'}을(를) ${r.created ? '저장' : '갱신'}했어요`);
    };
    const receive = h('section', { class: 'panel pad' },
      h('div', { class: 'section-title' }, '교사에게 받은 내용 저장'),
      recv,
      h('div', { class: 'btn-row', style: { marginTop: '10px' } },
        btn('paste', '붙여넣고 저장', async () => { const t = await api('app:paste'); await save(t); }, { variant: 'primary', testid: 'reg-paste-save' }),
        btn('check', '입력한 내용 저장', () => save(recv.value), { testid: 'reg-save' }),
        h('span', { class: 'muted small' }, '같은 PC(MAC 주소)가 다시 보내면 새로 만들지 않고 고쳐 저장해요.')));

    const d = data.defaults;
    const dIn = { mask: input(d.mask, { 'data-testid': 'def-mask' }), dns1: input(d.dns1, { 'data-testid': 'def-dns1' }), dns2: input(d.dns2, { 'data-testid': 'def-dns2' }) };
    let gwRule = d.gwRule;
    const defaults = h('section', { class: 'panel pad' },
      h('div', { class: 'section-title' }, '학교 기본값'),
      h('div', { class: 'muted small', style: { marginBottom: '12px' } }, '한 번 넣어 두면 IP 배정 메시지를 만들 때 IP만 입력하면 돼요.'),
      h('div', { class: 'form', style: { gridTemplateColumns: '150px 1fr', maxWidth: '560px' } },
        h('label', {}, '서브넷 마스크'), dIn.mask,
        h('label', {}, '기본 DNS 서버'), dIn.dns1,
        h('label', {}, '보조 DNS 서버'), dIn.dns2,
        h('label', {}, '게이트웨이'), select([['.1', '같은 대역의 .1 (예: 10.20.3.1)'], ['.254', '같은 대역의 .254'], ['manual', '매번 직접 입력']], gwRule, (v) => { gwRule = v; })),
      h('div', { class: 'btn-row', style: { marginTop: '14px' } }, btn('check', '기본값 저장', async () => {
        const r = await api('registry:defaults', { mask: dIn.mask.value.trim(), dns1: dIn.dns1.value.trim(), dns2: dIn.dns2.value.trim(), gwRule });
        toast(r.ok ? '학교 기본값을 저장했어요' : '숫자 형식을 확인해 주세요');
      }, { testid: 'def-save' })));

    const search = input(query, { inputmode: 'text', placeholder: '교실·IP·MAC 찾기', class: 'field search', 'data-testid': 'reg-search' });
    const listBox = h('div', { class: 'items', 'data-testid': 'reg-list' });
    const drawList = () => {
      const q = query.toLowerCase();
      const pcs = data.pcs.filter((pc) => !q || [pc.room, pc.pcName, pc.ip, pc.assignedIp, pc.mac, pc.note].some((v) => (v || '').toLowerCase().includes(q)));
      listBox.replaceChildren(...(pcs.length ? pcs.map(pcRow) : [emptyState(data.pcs.length ? '찾는 교실이 없어요' : '아직 저장한 교실이 없어요', data.pcs.length ? null : '교사에게 받은 메시지를 위에 붙여넣어 저장해 보세요.')]));
    };
    search.addEventListener('input', () => { query = search.value.trim(); drawList(); });

    function pcRow(pc) {
      const tags = [];
      if (pc.duplicate) tags.push(h('span', { class: 'tag tone-danger' }, 'IP 중복'));
      if (pc.assignedIp) tags.push(h('span', { class: 'tag tone-warn' }, `변경 대기 → ${pc.assignedIp}`));
      if (pc.dhcp) tags.push(h('span', { class: 'tag tone-info' }, '자동 IP'));
      const level = pc.duplicate ? 'danger' : pc.assignedIp ? 'warn' : 'ok';
      return h('div', { class: `item tone-${level}`, 'data-testid': 'reg-item' },
        h('div', { class: 'ic' }, icon('monitor')),
        h('div', { class: 'tx' },
          h('strong', {}, `${pc.room || '(교실 이름 없음)'}${pc.pcName ? ` · ${pc.pcName}` : ''}`),
          h('span', {}, `IP ${pc.ip || '-'} · MAC ${pc.mac || '-'} · ${pc.receivedAt ? `받은 날 ${fmtDate(pc.receivedAt)}` : ''}${pc.note ? ` · ${pc.note}` : ''}`),
          tags.length ? h('div', { class: 'counts' }, tags) : null),
        btn('network', 'IP 배정', () => assignModal(pc, data.defaults), { testid: 'reg-assign' }),
        btn('edit', '고치기', () => editModal(pc), { testid: 'reg-edit' }));
    }

    const list = h('section', { class: 'panel' },
      h('div', { class: 'btn-row', style: { padding: '14px 20px', borderBottom: '1px solid var(--hairline)' } },
        h('div', { class: 'section-title', style: { margin: 0, flex: '1' } }, `교실 IP 목록 ${data.pcs.length}대`),
        search,
        btn('download', '엑셀(CSV)로 저장', async () => { const r = await api('registry:exportCsv'); if (r.ok) toast('저장했어요'); }, { testid: 'reg-export' }),
        btn('up', 'CSV 가져오기', async () => {
          const r = await api('registry:importCsv');
          if (r.canceled) return;
          if (!r.ok) { toast('CSV 형식을 확인해 주세요(첫 줄에 교실, IP 같은 제목 필요)'); return; }
          toast(`새로 ${r.created}대, 고친 것 ${r.updated}대를 가져왔어요`);
          loadRegistry();
        }, { testid: 'reg-import' })),
      listBox);
    drawList();
    box.replaceChildren(receive, list, defaults);
  }

  function assignModal(pc, defaults) {
    return modal((close) => {
      const f = { ip: input(pc.assignedIp || pc.ip, { 'data-testid': 'as-ip' }), mask: input(pc.assignedMask || defaults.mask), gateway: input(pc.assignedGateway || ''), dns1: input(pc.assignedDns1 || defaults.dns1), dns2: input(pc.assignedDns2 || defaults.dns2) };
      f.gateway.placeholder = defaults.gwRule === 'manual' ? '직접 입력' : '비워 두면 학교 기본값 규칙대로';
      const err = h('div', { class: 'error', 'data-testid': 'as-error' });
      const out = h('div', {});
      const make = async (force = false) => {
        err.textContent = '';
        const r = await api('registry:assign', { id: pc.id, ip: f.ip.value.trim(), mask: f.mask.value.trim(), gateway: f.gateway.value.trim(), dns1: f.dns1.value.trim(), dns2: f.dns2.value.trim(), force });
        if (r.code === 'duplicate') {
          const go = await confirmDialog({ title: '이미 쓰고 있는 IP예요', body: `${r.duplicates.map((x) => `${x.room || ''} ${x.pcName || ''}`.trim()).join(', ')}에서 같은 IP를 쓰고 있어요. 그래도 배정할까요?`, okLabel: '그래도 배정', okIcon: 'check' });
          if (go) return make(true);
          return;
        }
        if (!r.ok) { err.textContent = (r.errors && r.errors[0] && r.errors[0].msg) || '값을 확인해 주세요.'; return; }
        out.replaceChildren(h('div', { class: 'msgbox', style: { marginTop: '14px' }, 'data-testid': 'as-message' }, r.message), h('div', { class: 'muted small', style: { marginTop: '6px' } }, '복사했어요. 메신저에 붙여넣어 선생님께 보내세요.'));
        toast('메시지를 복사했어요');
        loadRegistry();
      };
      return h('div', {},
        h('h2', {}, `${pc.room || pc.pcName || 'PC'} IP 배정`),
        h('div', { class: 'body' },
          h('div', { class: 'muted small', style: { marginBottom: '10px' } }, `지금 IP ${pc.ip || '-'} · MAC ${pc.mac || '-'}`),
          h('div', { class: 'form', style: { gridTemplateColumns: '120px 1fr' } },
            h('label', {}, '새 IP'), f.ip, h('label', {}, '서브넷'), f.mask, h('label', {}, '게이트웨이'), f.gateway, h('label', {}, 'DNS 1'), f.dns1, h('label', {}, 'DNS 2'), f.dns2),
          err, out),
        h('div', { class: 'actions' }, btn('x', '닫기', () => close(true)), btn('copy', '메시지 만들고 복사', () => make(false), { variant: 'primary', testid: 'as-make' })));
    });
  }

  function editModal(pc) {
    return modal((close) => {
      const f = { room: input(pc.room, { inputmode: 'text' }), pcName: input(pc.pcName, { inputmode: 'text' }), note: input(pc.note, { inputmode: 'text' }) };
      return h('div', {},
        h('h2', {}, '교실 정보 고치기'),
        h('div', { class: 'body' }, h('div', { class: 'form', style: { gridTemplateColumns: '100px 1fr' } }, h('label', {}, '교실'), f.room, h('label', {}, 'PC 이름'), f.pcName, h('label', {}, '메모'), f.note)),
        h('div', { class: 'actions' },
          btn('trash', '목록에서 빼기', async () => {
            const ok = await confirmDialog({ title: '목록에서 뺄까요?', body: `${pc.room || pc.pcName} (IP ${pc.ip})`, okLabel: '빼기', okIcon: 'trash', danger: true });
            if (!ok) return;
            await api('registry:delete', pc.id); close(true); loadRegistry();
          }),
          h('span', { style: { flex: '1' } }),
          btn('x', '취소', () => close(false)),
          btn('check', '저장', async () => { await api('registry:update', { id: pc.id, room: f.room.value, pcName: f.pcName.value, note: f.note.value }); close(true); loadRegistry(); }, { variant: 'primary' })));
    });
  }

  function show() { result = null; if (tab === 'registry') loadRegistry(); else loadMine(); }
  renderTabs();
  show();
}
