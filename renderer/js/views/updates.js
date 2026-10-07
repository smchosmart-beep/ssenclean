import { h, btn, api, onEvent, hero, pageHead, tip, statusRow, toast, fmtDate, modal, pendingCard, confirmDialog } from '../ui.js';

const ICON = { chrome: 'globe', windows: 'monitor', hangul: 'file', office: 'file' };
const PHASE_TEXT = {
  checking: '업데이트를 확인하고 있어요',
  available: '업데이트를 내려받을 준비를 하고 있어요',
  downloading: '내려받는 중',
  preparing: '설치를 준비하고 있어요',
  installing: '설치하는 중',
  paused: '잠시 멈췄어요',
};

function howToHangul() {
  return modal((close) => h('div', {},
    h('h2', {}, '한글 업데이트 방법'),
    h('div', { class: 'body' },
      h('ol', { style: { paddingLeft: '20px', lineHeight: '2' } },
        h('li', {}, '한글을 열어요.'),
        h('li', {}, '위쪽 메뉴에서 [도움말]을 눌러요.'),
        h('li', {}, '[업데이트]를 누르고 안내에 따라 진행해요.')),
      h('div', { style: { marginTop: '10px' } }, tip('Windows 확인 창이 뜨면 [예]를 누르세요.', 'info'))),
    h('div', { class: 'actions' }, btn('check', '알겠어요', () => close(true), { variant: 'primary' }))));
}

export default async function updatesView(ctx) {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(pageHead('업데이트', '크롬, Windows, 한글, MS오피스가 최신인지 확인하고 바로 업데이트해요.'), box);
  let list = [];
  let chromeLive = null; // 진행 중 표시
  let alive = true;

  const off = onEvent('updates:progress', (ev) => {
    if (ev.id !== 'chrome') return;
    if (ev.final) {
      chromeLive = null;
      if (ev.phase === 'done') toast('새 버전을 받아 두었어요. [크롬 다시 시작]을 누르면 적용돼요');
      else if (ev.phase === 'latest') toast('크롬이 이미 최신이에요');
      else if (ev.phase === 'opened') toast("크롬 정보 화면을 열었어요. 업데이트가 끝나면 [다시 시작]을 눌러 주세요");
      else if (ev.phase === 'guide') toast('크롬 오른쪽 위 ⋮ → 설정 → Chrome 정보에서 업데이트하세요');
      else toast('크롬 업데이트를 마치지 못했어요. 잠시 뒤 다시 해 주세요');
      run();
      return;
    }
    chromeLive = ev;
    render();
  });

  function chromeRow(u) {
    let level = 'info', tag = '확인할 수 없어요', desc = u.version ? `현재 ${u.version}` : '', right = null;
    const live = chromeLive || (u.state === 'updating' ? u.progress : null);
    if (live) {
      level = 'warn'; tag = '업데이트 중';
      desc = `${PHASE_TEXT[live.phase] || '업데이트하고 있어요'}${live.percent != null ? ` ${live.percent}%` : ''} · 구글 서버에서 받느라 오래 걸릴 수 있어요. 다른 일을 해도 돼요, 끝나면 알려 드려요`;
      right = btn('refresh', '진행 중', null, { disabled: true, testid: 'upd-chrome' });
    } else if (u.state === 'restart') {
      level = 'warn'; tag = '다시 시작하면 적용돼요';
      desc = `새 버전${u.newVersion ? `(${u.newVersion})` : ''}을 받아 두었어요. 크롬을 다시 시작하면 적용돼요. 열려 있던 탭은 그대로 돌아와요.${u.restartTried ? ' 다시 시작해도 바뀌지 않으면 PC를 다시 켜도 적용돼요.' : ''}`;
      right = btn('refresh', '크롬 다시 시작', restartChrome, { variant: 'primary', testid: 'upd-chrome-restart' });
    } else if (u.state === 'outdated') {
      level = 'warn'; tag = '업데이트 있음';
      desc = [u.version ? `현재 ${u.version}` : null, u.latest ? `새 버전 ${u.latest}` : null].filter(Boolean).join(' · ');
      right = btn('up', '업데이트', async () => {
        const r = await api('updates:run', 'chrome');
        if (r.inline) { chromeLive = { phase: 'checking' }; render(); } else if (r.restart) run(); else if (r.guide) toast(r.guide);
      }, { testid: 'upd-chrome' });
    } else if (u.state === 'latest') {
      level = 'ok'; tag = '최신';
    } else {
      desc = [desc, '업데이트 창을 열어 직접 확인하세요'].filter(Boolean).join(' · ');
      right = btn('open', '업데이트 열기', async () => {
        const r = await api('updates:run', 'chrome');
        if (r.inline) { chromeLive = { phase: 'checking' }; render(); } else if (r.guide) toast(r.guide);
      }, { testid: 'upd-chrome' });
    }
    return statusRow({ level, iconName: ICON.chrome, title: u.name, desc, tag, right, testid: 'upd-row-chrome' });
  }

  // 크롬의 [다시 시작]과 같게(크롬이 스스로 다시 시작, 열린 탭 복원)
  let recheckTimers = [];
  async function restartChrome() {
    const ok = await confirmDialog({ title: '크롬을 다시 시작할까요?', body: '크롬 창이 잠깐 닫혔다가 다시 열려요. 열려 있던 탭은 그대로 돌아와요. 작성 중인 글이 있으면 먼저 저장하세요.', okLabel: '다시 시작', okIcon: 'refresh' });
    if (!ok) return;
    const r = await api('updates:run', 'chrome-restart');
    if (!r.ok) { toast('크롬을 찾지 못했어요'); return; }
    if (r.restarted) toast('크롬을 다시 시작했어요. 잠시 뒤 새 버전인지 확인할게요');
    else if (r.launched) toast('크롬을 켰어요. 잠시 뒤 새 버전인지 확인할게요');
    else if (r.guide) toast(r.guide);
    recheckTimers.forEach(clearTimeout);
    recheckTimers = [5000, 20000].map((ms) => setTimeout(() => { if (alive) run(); }, ms));
  }

  function row(u) {
    if (u.id === 'chrome') return chromeRow(u);
    let level, tag, desc, right = null;
    if (u.state === 'outdated') { level = 'warn'; tag = '업데이트 있음'; }
    else if (u.state === 'latest') { level = 'ok'; tag = '최신'; }
    else { level = 'info'; tag = '확인할 수 없어요'; }
    if (u.id === 'windows') {
      desc = [u.lastInstalled ? `마지막 업데이트 ${fmtDate(u.lastInstalled)}` : null, u.pending ? `설치할 업데이트 ${u.pending}개` : null].filter(Boolean).join(' · ') || '업데이트 기록을 확인할 수 없어요';
      right = btn('open', '업데이트 열기', async () => { const r = await api('updates:run', 'windows'); if (r.guide) toast(r.guide); }, { testid: 'upd-windows' });
    } else if (u.id === 'hangul') {
      desc = [u.version ? `현재 ${u.version}` : null, u.product].filter(Boolean).join(' · ');
      right = u.hasUpdater
        ? btn('open', '업데이트 열기', async () => { const r = await api('updates:run', 'hangul'); if (r.howto) howToHangul(); else if (r.guide) toast(r.guide); }, { testid: 'upd-hangul' })
        : btn('info', '업데이트 방법', () => howToHangul(), { testid: 'upd-hangul' });
    } else {
      desc = u.version ? `현재 ${u.version}` : '';
      if (u.canUpdate) right = btn('open', '업데이트 열기', async () => { const r = await api('updates:run', u.id); if (r.guide) toast(r.guide); }, { testid: `upd-${u.id}` });
    }
    if (u.state !== 'outdated' && u.state !== 'latest' && right && u.id !== 'windows') desc = [desc, '업데이트 창을 열어 직접 확인하세요'].filter(Boolean).join(' · ');
    return statusRow({ level, iconName: ICON[u.id], title: u.name, desc, tag, right, testid: `upd-row-${u.id}` });
  }

  function render() {
    const out = list.filter((u) => u.state === 'outdated' || u.state === 'restart');
    ctx.setDot('updates', out.length || chromeLive ? 'warn' : list.length && list.every((u) => u.state === 'latest') ? 'ok' : null);
    box.replaceChildren(
      hero({ level: out.length ? 'warn' : 'ok', iconName: out.length ? 'up' : 'checkCircle', title: out.length ? '업데이트할 프로그램이 {}있어요' : '확인된 프로그램은 최신이에요', titleEmph: out.length ? `${out.length}개 ` : null, desc: '파일은 외부로 보내지 않고, 업데이트 확인에만 인터넷을 써요.', right: btn('refresh', '다시 확인', run, { testid: 'upd-recheck' }) }),
      h('section', { class: 'panel rows' }, list.length ? list.map(row) : h('div', { class: 'empty' }, '확인할 프로그램이 설치되어 있지 않아요')),
      tip('[업데이트 열기]를 누르면 각 프로그램의 업데이트 창이 열려요. 거기서 안내에 따라 진행하세요. 쎈Clean은 설치파일을 직접 내려받지 않아요. Windows 확인 창이 뜨면 [예]를 누르세요.'));
  }

  async function run() {
    if (!list.length) box.replaceChildren(pendingCard('업데이트 확인 중…', '크롬·Windows·한글·오피스 버전을 확인하고 있어요 (Windows는 1분 정도 걸릴 수 있어요)'));
    list = await api('updates:check');
    if (!alive) return;
    render();
  }

  await run();
  // 점검 현황의 [크롬 다시 시작]으로 들어왔으면 바로 확인 창
  if (ctx.params.autostart && list.some((u) => u.id === 'chrome' && u.state === 'restart')) restartChrome();
  return () => { alive = false; off(); recheckTimers.forEach(clearTimeout); };
}
