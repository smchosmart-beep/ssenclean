import { h, btn, api, hero, pageHead, tip, statusRow, toast, fmtDate } from '../ui.js';

const ICON = { chrome: 'globe', windows: 'monitor', hangul: 'file', office: 'file' };

export default async function updatesView(ctx) {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(pageHead('업데이트', '크롬, Windows, 한글, MS오피스가 최신인지 확인하고 바로 업데이트해요.'), box);

  async function run() {
    box.replaceChildren(h('section', { class: 'panel pad' }, h('div', { class: 'muted' }, '업데이트를 확인하고 있어요… (Windows는 1분 정도 걸릴 수 있어요)'), h('div', { class: 'progress indeterminate', style: { marginTop: '12px' } }, h('i'))));
    const list = await api('updates:check');
    const out = list.filter((u) => u.state === 'outdated');
    ctx.setDot('updates', out.length ? 'warn' : list.every((u) => u.state === 'latest') ? 'ok' : null);
    const offline = list.some((u) => u.offline);
    const rows = list.map((u) => {
      let level, desc, label, tag;
      if (u.state === 'outdated') { level = 'warn'; label = '업데이트'; tag = '업데이트 있음'; }
      else if (u.state === 'latest') { level = 'ok'; tag = '최신'; }
      else { level = 'info'; label = u.canUpdate ? '업데이트 확인' : null; tag = '확인할 수 없어요'; }
      if (u.id === 'windows') desc = [u.lastInstalled ? `마지막 업데이트 ${fmtDate(u.lastInstalled)}` : null, u.pending ? `설치할 업데이트 ${u.pending}개` : null, u.managed ? '학교에서 관리하는 업데이트예요' : null].filter(Boolean).join(' · ') || '업데이트 기록을 확인할 수 없어요';
      else desc = [u.version ? `현재 ${u.version}` : null, u.latest && u.state === 'outdated' ? `최신 ${u.latest}` : null, u.product].filter(Boolean).join(' · ');
      const right = label || u.id === 'windows' || u.id === 'office' ? btn(u.state === 'outdated' ? 'up' : 'search', label || '업데이트 확인', async () => {
        const r = await api('updates:run', u.id);
        if (r.guide) toast(r.guide);
      }, { testid: `upd-${u.id}` }) : null;
      return statusRow({ level, iconName: ICON[u.id], title: u.name, desc, tag, right, testid: `upd-row-${u.id}` });
    });
    box.replaceChildren(
      hero({ level: out.length ? 'warn' : 'ok', iconName: out.length ? 'up' : 'checkCircle', title: out.length ? '업데이트할 프로그램이 {}있어요' : '확인된 프로그램은 최신이에요', titleEmph: out.length ? `${out.length}개 ` : null, desc: '파일은 외부로 보내지 않고, 업데이트 확인에만 인터넷을 써요.', right: btn('refresh', '다시 확인', run, { testid: 'upd-recheck' }) }),
      offline ? tip('인터넷 연결을 확인해 주세요. 최신 버전을 확인하지 못했어요.', 'warn') : null,
      h('section', { class: 'panel rows' }, rows.length ? rows : h('div', { class: 'empty' }, '확인할 프로그램이 설치되어 있지 않아요')),
      tip('쎈클린은 설치파일을 직접 내려받지 않고, 각 프로그램의 공식 업데이트 기능을 열어 드려요. 관리자 암호를 물으면 정보 담당 선생님께 요청하세요.'));
  }
  await run();
}
