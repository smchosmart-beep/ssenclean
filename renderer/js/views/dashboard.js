import { h, btn, api, onEvent, statusRow, pendingRow, hero, setHeaderActions, toast } from '../ui.js';

const ICON = { privacy: 'file', fonts: 'font', password: 'lock', screensaver: 'monitor', updates: 'up', cdrive: 'disk', browser: 'globe', desktop: 'folder', network: 'network' };
const NAME = { privacy: '개인정보 파일', fonts: '폰트', password: 'PC암호', screensaver: '화면보호기', updates: '업데이트', cdrive: 'C드라이브', browser: '브라우저', desktop: '바탕화면', network: 'IP 주소' };
const PENDING_DESC = {
  privacy: '지난 검사 결과를 읽고 있어요',
  fonts: '설치된 폰트를 살펴보고 있어요',
  password: '로그인 방식과 암호 바꾼 날을 확인하고 있어요',
  screensaver: '화면보호기 설정을 확인하고 있어요',
  updates: '크롬·Windows·한글·오피스 버전을 확인하고 있어요',
  cdrive: 'C드라이브 남은 공간을 확인하고 있어요',
  browser: '바로가기와 시작 프로그램에서 광고 흔적을 찾고 있어요',
  desktop: '바탕화면 파일을 세고 있어요',
  network: '네트워크와 인터넷 연결을 확인하고 있어요',
};
const SLOW_MS = 20000;
const LIMIT_MS = 120000; // Windows 업데이트 확인은 90초까지 걸릴 수 있다

export default async function dashboard(ctx) {
  const items = await api('dashboard:items'); // 순서 = 사이드바 메뉴 순서(고정)
  const cards = new Map();
  const slow = new Set();
  const timers = [];
  let alive = true;
  let round = 0;

  const heroBox = h('div', {});
  const rowsBox = h('section', { class: 'panel rows', 'data-testid': 'dash-rows' });
  ctx.main.append(heroBox, rowsBox);

  const pendingIds = () => items.filter((id) => !cards.has(id));
  const running = () => pendingIds().length > 0;

  function pendingText() {
    const ids = pendingIds();
    const names = ids.slice(0, 3).map((id) => NAME[id]).join('·') + (ids.length > 3 ? ' 등' : '');
    return `${names}을 점검하고 있어요 (${ids.length}개 남음)`;
  }

  function renderHeader() {
    const busy = running();
    setHeaderActions(
      btn('gear', '설정', () => ctx.go('settings'), { testid: 'open-settings' }),
      btn('refresh', busy ? '점검 중…' : '다시 점검', () => runAll(), { variant: 'primary', disabled: busy, testid: 'recheck' }),
    );
  }

  function renderHero() {
    const done = !running();
    const vals = [...cards.values()];
    const todo = vals.filter((c) => c.level === 'danger' || c.level === 'warn').length;
    let el;
    if (!done && todo === 0) el = hero({ level: 'info', iconName: 'search', title: '내 PC를 점검하고 있어요', desc: pendingText() });
    else if (todo > 0) el = hero({ level: vals.some((c) => c.level === 'danger') ? 'danger' : 'warn', title: '해결할 일이 {}있어요', titleEmph: `${todo}개 `, desc: done ? '마지막 점검: 방금 전' : pendingText() });
    else el = hero({ level: 'ok', iconName: 'checkCircle', title: '내 PC가 안전해요', desc: '마지막 점검: 방금 전' });
    el.setAttribute('data-testid', 'dash-hero');
    heroBox.replaceChildren(el);
  }

  function actionButton(c) {
    const a = c.action;
    if (!a) return null;
    return btn(a.icon || 'search', a.label, async () => {
      if (a.kind === 'recheck') return check(c.id, round);
      if (a.kind === 'navigate') return ctx.go(a.target, { autostart: !!a.autostart });
      const r = await api(a.target);
      toast(r && r.ok === false ? '설정하지 못했어요' : '설정했어요');
      await check(c.id, round);
    }, { testid: `dash-action-${c.id}` });
  }

  function renderRows() {
    rowsBox.replaceChildren(...items.map((id) => {
      const c = cards.get(id);
      if (!c) {
        return pendingRow({
          title: `${NAME[id]} 확인 중…`,
          desc: slow.has(id) ? '조금 오래 걸리고 있어요. 다른 메뉴를 먼저 써도 돼요' : PENDING_DESC[id],
          testid: `dash-pending-${id}`,
        });
      }
      let right = actionButton(c);
      if (c.dday != null && c.level === 'ok' && !right) right = h('span', { class: 'dday', 'data-testid': 'dday' }, `D-${c.dday}`);
      const row = statusRow({ level: c.level, iconName: ICON[c.id], title: c.title, desc: c.desc, right, testid: `dash-${c.id}` });
      if (c.dday != null && c.level === 'ok' && right && right.classList.contains('btn')) row.insertBefore(h('span', { class: 'dday' }, `D-${c.dday}`), row.lastChild);
      return row;
    }));
  }

  function render() { if (!alive) return; renderHero(); renderRows(); renderHeader(); }

  async function check(id, r) {
    cards.delete(id);
    slow.delete(id);
    ctx.setDot(id, 'pending');
    render();
    const t1 = setTimeout(() => { if (alive && r === round && !cards.has(id)) { slow.add(id); renderRows(); } }, SLOW_MS);
    const t2 = setTimeout(() => {
      if (!alive || r !== round || cards.has(id)) return;
      cards.set(id, { id, level: 'unknown', title: `${NAME[id]} - 확인할 수 없어요`, desc: '시간이 너무 오래 걸려서 멈췄어요.', action: { kind: 'recheck', label: '다시 확인', icon: 'refresh' } });
      ctx.setDot(id, null);
      render();
    }, LIMIT_MS);
    timers.push(t1, t2);
    const c = await api('dashboard:check', id);
    clearTimeout(t1); clearTimeout(t2);
    if (r !== round || !c) return;
    ctx.setDot(id, c.level); // 다른 메뉴로 옮겨 가도 메뉴 점은 결과로 바꾼다
    if (!alive) return;
    cards.set(id, c);
    slow.delete(id);
    render();
  }

  function runAll() {
    round++;
    cards.clear();
    slow.clear();
    items.forEach((id) => ctx.setDot(id, 'pending'));
    render();
    return Promise.all(items.map((id) => check(id, round)));
  }

  runAll();
  // 크롬 업데이트가 진행 중이면 진행률을 카드에 반영하고, 끝나면 업데이트 카드만 다시 확인
  let lastPct = -1;
  const off = onEvent('updates:progress', (ev) => {
    if (!alive || ev.id !== 'chrome') return;
    if (ev.final) { check('updates', round); return; }
    const c = cards.get('updates');
    if (c && /업데이트 중이에요/.test(c.title) && ev.percent != null && ev.percent !== lastPct) {
      lastPct = ev.percent;
      const text = { downloading: '내려받는 중', installing: '설치하는 중' }[ev.phase] || '진행 중';
      cards.set('updates', { ...c, desc: `${text} ${ev.percent}% · 끝나면 이 카드가 바뀌어요` });
      render();
    }
  });
  return () => { alive = false; timers.forEach(clearTimeout); if (off) off(); };
}
