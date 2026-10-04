import { h, btn, api, hero, pageHead, tip, toast } from '../ui.js';

export default async function screensaverView(ctx) {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(pageHead('화면보호기', '자리를 비우면 화면이 잠기도록 설정해요.'), box);

  async function render(st) {
    st = st || await api('screensaver:status');
    const pw = await api('password:status');
    ctx.setDot('screensaver', st.level);
    const parts = [];
    if (st.safe) parts.push(hero({ level: 'ok', iconName: 'checkCircle', title: `${st.minutes}분 동안 사용하지 않으면 잠겨요`, desc: '화면보호기가 안전하게 설정되어 있어요.' }));
    else {
      const title = !st.active ? '화면보호기가 꺼져 있어요' : !st.secure ? '화면보호기를 풀 때 암호를 묻지 않아요' : `화면보호기가 ${st.minutes}분 뒤에야 켜져요`;
      parts.push(hero({ level: 'danger', iconName: 'monitor', title, desc: '자리를 비우면 화면이 그대로 보여요.' }));
    }
    if (pw.hasPassword === false) {
      parts.push(h('section', { class: 'panel pad tone-warn', style: { display: 'flex', alignItems: 'center', gap: '16px' } },
        h('div', { style: { flex: '1' } }, tip('PC암호가 없어서 화면보호기가 켜져도 누구나 풀 수 있어요.', 'warn')),
        btn('lock', '암호 만들기', () => ctx.go('password'), { testid: 'ss-to-password' })));
    }
    const actions = h('div', { class: 'btn-row' });
    if (!st.safe) actions.append(btn('shield', '안전하게 설정하기', async () => {
      const r = await api('screensaver:secure');
      if (r.ok) toast('설정했어요. 이제 자리를 비우면 화면이 잠겨요'); else toast('설정하지 못했어요');
      render(r.status);
    }, { variant: 'primary', testid: 'ss-secure' }));
    actions.append(btn('open', '화면보호기 설정 창 열기', () => api('screensaver:open'), { testid: 'ss-open' }));
    if (st.canUndo) actions.append(btn('undo', '원래대로', async () => { const r = await api('screensaver:undo'); toast('원래대로 되돌렸어요'); render(r.status); }, { testid: 'ss-undo' }));
    parts.push(h('section', { class: 'panel pad' },
      h('dl', { class: 'kv', style: { marginBottom: '16px' } },
        h('dt', {}, '화면보호기'), h('dd', {}, st.active ? '켜짐' : '꺼짐'),
        h('dt', {}, '대기 시간'), h('dd', {}, st.minutes ? `${st.minutes}분` : '-'),
        h('dt', {}, '풀 때 암호'), h('dd', {}, st.secure ? '물어봐요' : '묻지 않아요')),
      actions,
      h('div', { style: { marginTop: '16px' } }, tip('[안전하게 설정하기]는 빈 화면 화면보호기, 대기 시간, "다시 시작할 때 로그온 화면 표시"를 한 번에 켜요. 대기 시간은 [설정]에서 바꿀 수 있어요.'))));
    box.replaceChildren(...parts);
  }
  await render();
}
