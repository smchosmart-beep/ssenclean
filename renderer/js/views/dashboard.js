import { h, btn, api, statusRow, hero, setHeaderActions, toast } from '../ui.js';

const ORDER = { danger: 0, warn: 1, ok: 2, info: 3, unknown: 4 };
const ICON = { password: 'lock', screensaver: 'monitor', browser: 'globe', updates: 'up', fonts: 'font', privacy: 'file', desktop: 'folder' };

export default async function dashboard(ctx) {
  const items = await api('dashboard:items');
  const cards = new Map();
  let alive = true;

  const heroBox = h('div', {});
  const rowsBox = h('section', { class: 'panel rows', 'data-testid': 'dash-rows' });
  ctx.main.append(heroBox, rowsBox);

  function renderHero() {
    const done = cards.size === items.length;
    const todo = [...cards.values()].filter((c) => c.level === 'danger' || c.level === 'warn').length;
    let el;
    if (!done && todo === 0) el = hero({ level: 'info', iconName: 'search', title: '내 PC를 점검하고 있어요', desc: '잠시만 기다려 주세요.' });
    else if (todo > 0) el = hero({ level: [...cards.values()].some((c) => c.level === 'danger') ? 'danger' : 'warn', title: '해결할 일이 {}있어요', titleEmph: `${todo}개 `, desc: done ? '마지막 점검: 방금 전' : '나머지 항목을 점검하고 있어요.' });
    else el = hero({ level: 'ok', iconName: 'checkCircle', title: '내 PC가 안전해요', desc: '마지막 점검: 방금 전' });
    el.setAttribute('data-testid', 'dash-hero');
    heroBox.replaceChildren(el);
  }

  function actionButton(c) {
    const a = c.action;
    if (!a) return null;
    return btn(a.icon || 'search', a.label, async () => {
      if (a.kind === 'navigate') return ctx.go(a.target, { autostart: !!a.autostart });
      const r = await api(a.target);
      if (r && r.ok === false) toast(r.code === 'managed' ? '학교에서 관리 중인 설정이라 바꿀 수 없어요' : '설정하지 못했어요');
      else toast('설정했어요');
      await check(c.id);
    }, { testid: `dash-action-${c.id}` });
  }

  function renderRows() {
    const list = items.map((id) => cards.get(id) || { id, loading: true });
    list.sort((a, b) => (a.loading ? 9 : ORDER[a.level]) - (b.loading ? 9 : ORDER[b.level]));
    rowsBox.replaceChildren(...list.map((c) => {
      if (c.loading) return h('div', { class: 'row skeleton tone-info' }, h('div', { class: 'ic' }), h('div', { class: 'tx' }, h('strong', {}), h('span', {})));
      let right = actionButton(c);
      if (c.dday != null && c.level === 'ok' && !right) right = h('span', { class: 'dday', 'data-testid': 'dday' }, `D-${c.dday}`);
      const row = statusRow({ level: c.level, iconName: ICON[c.id], title: c.title, desc: c.desc, right, testid: `dash-${c.id}` });
      if (c.dday != null && c.level === 'ok' && right && right.classList.contains('btn')) row.insertBefore(h('span', { class: 'dday' }, `D-${c.dday}`), row.lastChild);
      return row;
    }));
  }

  async function check(id) {
    const c = await api('dashboard:check', id);
    if (!alive || !c) return;
    cards.set(id, c);
    ctx.setDot(id, c.level);
    renderHero();
    renderRows();
  }

  function runAll() {
    cards.clear();
    renderHero();
    renderRows();
    return Promise.all(items.map((id) => check(id)));
  }

  setHeaderActions(
    btn('gear', '설정', () => ctx.go('settings'), { testid: 'open-settings' }),
    btn('refresh', '다시 점검', () => runAll(), { variant: 'primary', testid: 'recheck' }),
  );
  runAll();
  return () => { alive = false; };
}
