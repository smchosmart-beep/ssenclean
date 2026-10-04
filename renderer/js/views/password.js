import { h, btn, api, hero, pageHead, tip, toast, modal, fmtDate } from '../ui.js';

const ACCOUNT = { local: '이 PC 전용 계정', microsoft: 'Microsoft 계정 (이메일로 로그인)', unknown: '확인할 수 없어요' };
const ERR = {
  'wrong-password': '지금 쓰는 암호가 맞지 않아요.',
  policy: '학교 규칙에 맞지 않는 암호예요. 더 길거나 예전에 쓰지 않은 암호로 해 주세요.',
  mismatch: '새 암호 두 칸이 서로 달라요.',
  empty: '새 암호를 입력해 주세요.',
  denied: '이 PC에서는 여기서 암호를 바꿀 수 없어요. 아래 [Windows 로그인 옵션 열기]를 이용해 주세요.',
  'not-local': '이 계정은 여기서 암호를 바꿀 수 없어요.',
  error: '암호를 바꾸지 못했어요. [Windows 로그인 옵션 열기]를 이용해 주세요.',
};

export default async function passwordView(ctx) {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(pageHead('PC암호', '이 PC에 로그인할 때 쓰는 암호를 확인하고 바꿔요. 쎈클린은 암호를 저장하지 않아요.'), box);

  async function openForm(st) {
    const hasPw = st.hasPassword !== false;
    const fields = {};
    const field = (name, label) => {
      const input = h('input', { class: 'field', type: 'password', autocomplete: 'off', 'data-testid': `pw-${name}` });
      fields[name] = input;
      return [h('label', {}, label), input];
    };
    const errEl = h('div', { class: 'error', 'data-testid': 'pw-error' });
    return modal((close) => {
      const submit = async () => {
        errEl.textContent = '';
        const r = await api('password:change', { current: hasPw ? fields.current.value : '', next: fields.next.value, confirm: fields.confirm.value });
        Object.values(fields).forEach((f) => { f.value = ''; });
        if (r.ok) { close(true); toast('암호를 바꿨어요. 다음 로그인부터 새 암호를 쓰세요'); return; }
        if (r.code === 'cooldown') errEl.textContent = `잠시 뒤(${r.wait}초) 다시 해 주세요.`;
        else errEl.textContent = (ERR[r.code] || ERR.error) + (r.warnLock ? ' 여러 번 틀리면 계정이 잠길 수 있어요.' : '');
        (hasPw ? fields.current : fields.next).focus();
      };
      const form = h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('h2', {}, hasPw ? '암호 바꾸기' : '암호 만들기'),
        h('div', { class: 'body' },
          h('div', { class: 'form', style: { marginTop: '8px' } },
            hasPw ? field('current', '현재 암호') : null,
            field('next', '새 암호'),
            field('confirm', '새 암호 확인')),
          h('div', { style: { marginTop: '10px' } }, errEl)),
        h('div', { class: 'actions' },
          btn('x', '취소', () => close(false), { testid: 'pw-cancel' }),
          btn('key', hasPw ? '바꾸기' : '만들기', submit, { variant: 'primary', testid: 'pw-submit' })));
      return form;
    });
  }

  async function render() {
    const st = await api('password:status');
    ctx.setDot('password', st.level === 'info' ? null : st.level);
    const parts = [];

    let level = st.level === 'unknown' ? 'info' : st.level;
    if (st.hasPassword === false) parts.push(hero({ level: 'danger', iconName: 'lock', title: '이 PC는 암호 없이 열려요', desc: '자리를 비우면 누구나 이 PC를 열 수 있어요.' }));
    else if (st.dday != null) {
      const title = st.dday < 0 ? `변경일이 ${-st.dday}일 지났어요` : st.dday <= 14 ? `변경까지 ${st.dday}일 남았어요` : '다음 변경까지';
      parts.push(hero({ level, iconName: 'calendar', title, desc: `마지막 변경 ${fmtDate(st.lastChanged)} · 변경 예정일 ${fmtDate(st.due)} (${st.cycle}일마다)`, right: h('span', { class: 'dday', style: { fontSize: '40px' }, 'data-testid': 'pw-dday' }, st.dday < 0 ? `D+${-st.dday}` : `D-${st.dday}`) }));
    } else if (st.hasPassword === true) parts.push(hero({ level: 'info', iconName: 'calendar', title: '마지막으로 바꾼 날을 알 수 없어요', desc: '바꾼 날을 입력하면 다음 변경일을 알려 드려요.' }));
    else parts.push(hero({ level: 'info', iconName: 'info', title: '암호가 있는지 확인할 수 없어요', desc: '아래 버튼으로 Windows 로그인 옵션을 열어 확인해 주세요.' }));

    const kv = h('dl', { class: 'kv' },
      h('dt', {}, '계정 종류'), h('dd', { 'data-testid': 'pw-account' }, ACCOUNT[st.accountType] || ACCOUNT.unknown),
      h('dt', {}, '암호'), h('dd', { 'data-testid': 'pw-has' }, st.hasPassword === true ? '있음' : st.hasPassword === false ? '⚠ 없음' : '확인할 수 없어요'));

    const actions = h('div', { class: 'btn-row', style: { marginTop: '18px' } });
    if (st.accountType === 'microsoft') {
      actions.append(btn('open', 'Microsoft 계정 암호 바꾸러 가기', () => api('password:openMicrosoft'), { variant: 'primary', testid: 'pw-ms' }));
    } else if (st.canChangeHere) {
      actions.append(btn('key', st.hasPassword === false ? '암호 만들기' : '암호 바꾸기', async () => { if (await openForm(st)) render(); }, { variant: 'primary', testid: 'pw-open-form' }));
    }
    actions.append(btn('gear', 'Windows 로그인 옵션 열기', () => api('password:openSettings'), { testid: 'pw-open-settings' }));

    parts.push(h('section', { class: 'panel pad' },
      h('div', { class: 'section-title' }, '이 PC의 로그인 방식'),
      kv,
      h('div', { style: { marginTop: '16px' } }, tip('암호 하나만 쓰시면 충분해요. PIN, 얼굴, 지문은 설정하지 않아도 돼요.')),
      st.accountType === 'microsoft' ? h('div', { style: { marginTop: '10px' } }, tip('Microsoft 계정 암호는 인터넷에서 바꿔요. 바꾼 뒤에는 PC 로그인에도 새 암호를 써요.', 'info')) : null,
      actions));

    if (st.hasPassword !== false && st.source !== 'system') {
      const input = h('input', { class: 'field', type: 'date', style: { width: '200px' }, 'data-testid': 'pw-date' });
      if (st.lastChanged) input.value = new Date(st.lastChanged - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      parts.push(h('section', { class: 'panel pad' },
        h('div', { class: 'section-title' }, '마지막으로 암호를 바꾼 날'),
        h('div', { class: 'muted small', style: { marginBottom: '12px' } }, '이 계정은 바꾼 날을 PC에서 알 수 없어서 직접 입력해 주셔야 해요.'),
        h('div', { class: 'btn-row' }, input, btn('check', '저장', async () => { if (!input.value) return; await api('password:setDate', input.value); toast('저장했어요'); render(); }, { testid: 'pw-date-save' }))));
    }
    box.replaceChildren(...parts);
  }

  await render();
}
