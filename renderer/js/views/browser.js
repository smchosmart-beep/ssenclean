import { h, btn, api, hero, pageHead, tip, toast, confirmDialog, checkbox, icon, fmtBytes, emptyState } from '../ui.js';

const KIND_ICON = { shortcut: 'link', 'fake-shortcut': 'link', url: 'globe', startup: 'play', task: 'calendar', program: 'trash', proxy: 'globe', extension: 'plus', homepage: 'home', search: 'search' };

export default async function browserView(ctx) {
  let tab = ctx.params.tab || 'ads';
  let scan = null;
  const selected = new Set();
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  const tabsEl = h('div', { class: 'tabs' });
  ctx.main.append(pageHead('브라우저 청소', '광고창·광고 팝업·쇼핑 아이콘의 원인을 찾아 없애고, 방문 기록을 지워요.', tabsEl), box);

  function renderTabs() {
    tabsEl.replaceChildren(
      btn('broom', '광고 없애기', () => { tab = 'ads'; renderTabs(); show(); }, { variant: tab === 'ads' ? 'on' : '', testid: 'tab-ads' }),
      btn('trash', '기록 지우기', () => { tab = 'history'; renderTabs(); show(); }, { variant: tab === 'history' ? 'on' : '', testid: 'tab-history' }));
  }

  function runningBox(running, after) {
    if (!running || !running.length) return null;
    return h('section', { class: 'panel pad tone-warn', style: { display: 'flex', alignItems: 'center', gap: '16px' } },
      h('div', { style: { flex: '1' } }, tip(`${running.map((r) => r.label).join('·')}가 열려 있어요. 닫은 뒤 청소하면 더 확실해요.`, 'warn')),
      btn('x', '모두 닫기', async () => {
        const ok = await confirmDialog({ title: '브라우저를 모두 닫을까요?', body: '작성 중인 글이 있으면 먼저 저장해 주세요.', okLabel: '모두 닫기', okIcon: 'x' });
        if (!ok) return;
        const left = await api('browser:close');
        toast(left.length ? '일부 창이 닫히지 않았어요. 직접 닫아 주세요' : '브라우저를 닫았어요');
        after();
      }, { testid: 'close-browsers' }));
  }

  // ── 광고 없애기 ──
  async function runScan() {
    box.replaceChildren(h('section', { class: 'panel pad' }, h('div', { class: 'page-title' }, '광고 프로그램을 찾고 있어요'), h('div', { class: 'progress indeterminate', style: { marginTop: '14px' } }, h('i'))));
    scan = await api('browser:scan');
    selected.clear();
    scan.items.filter((i) => i.fixable && i.checked).forEach((i) => selected.add(i.id));
    ctx.setDot('browser', scan.items.some((i) => i.fixable) ? 'warn' : 'ok');
    renderAds();
  }

  function itemRow(it) {
    const tone = it.verdict === 'adware' ? 'danger' : 'warn';
    return h('div', { class: `item tone-${tone}`, 'data-testid': 'ad-item' },
      it.fixable ? checkbox(null, selected.has(it.id), (v) => { if (v) selected.add(it.id); else selected.delete(it.id); renderFooter(); }, { testid: 'ad-check' }) : h('span', { style: { width: '20px', flex: 'none' } }),
      h('div', { class: 'ic' }, icon(KIND_ICON[it.kind] || 'warn')),
      h('div', { class: 'tx' }, h('strong', {}, it.title), h('span', {}, it.detail), h('span', { style: { color: 'var(--ink)' } }, `왜? ${it.reason}`)),
      h('span', { class: 'tag' }, it.verdict === 'adware' ? '광고 프로그램' : '의심돼요'),
      it.guide ? btn('refresh', `${it.guide === 'edge' ? '엣지' : '크롬'} 설정 초기화`, () => { api('browser:reset', it.guide); toast('설정 화면이 열리면 [설정 초기화]를 눌러 주세요'); }, { title: '브라우저 설정 초기화 화면 열기' }) : null);
  }

  let footerEl = null;
  function renderFooter() {
    if (!footerEl) return;
    footerEl.replaceChildren(
      h('span', { class: 'muted small', style: { flex: '1' } }, '치료한 내용은 [되돌리기]로 원래대로 돌릴 수 있어요.'),
      btn('broom', selected.size ? `한 번에 치료하기 (${selected.size})` : '한 번에 치료하기', fix, { variant: 'primary', disabled: !selected.size, testid: 'ad-fix' }));
  }

  async function fix() {
    const ids = [...selected];
    const ok = await confirmDialog({ title: `${ids.length}개를 치료할까요?`, body: '바로가기는 원래대로 고치고, 광고 아이콘은 휴지통으로 보내고, 자동 실행은 꺼요.', okLabel: '치료하기', okIcon: 'broom' });
    if (!ok) return;
    const r = await api('browser:fix', ids);
    const launched = r.results.filter((x) => x.launched).length;
    toast(`${r.fixed}개를 치료했어요${launched ? '. 열린 제거 창에서 마저 지워 주세요' : ''}`, r.undoId ? { action: { label: '되돌리기', run: async () => { await api('browser:undo'); toast('되돌렸어요'); runScan(); } } } : {});
    await runScan();
  }

  function renderAds() {
    footerEl = null;
    const fixable = scan.items.filter((i) => i.fixable);
    const info = scan.items.filter((i) => !i.fixable);
    const adware = scan.items.filter((i) => i.verdict === 'adware').length;
    const parts = [
      hero({
        level: fixable.length ? (adware ? 'danger' : 'warn') : 'ok',
        iconName: fixable.length ? 'warn' : 'checkCircle',
        title: scan.items.length ? '광고 흔적을 {}찾았어요' : '광고 흔적을 찾지 못했어요',
        titleEmph: scan.items.length ? `${scan.items.length}개 ` : null,
        desc: scan.items.length ? '항목마다 왜 의심되는지 적어 두었어요.' : '바로가기·시작 프로그램·예약 작업·브라우저 설정을 확인했어요.',
        right: btn('refresh', '다시 찾기', runScan, { testid: 'ad-rescan' }),
      }),
      runningBox(scan.running, runScan),
    ];
    if (fixable.length) {
      footerEl = h('div', { class: 'btn-row', style: { padding: '14px 20px', borderTop: '1px solid var(--hairline)' } });
      parts.push(h('section', { class: 'panel' }, h('div', { class: 'items', 'data-testid': 'ad-list' }, fixable.map(itemRow)), footerEl));
    }
    if (info.length) {
      parts.push(h('section', { class: 'panel' },
        h('div', { class: 'section-title', style: { padding: '16px 20px 0' } }, '브라우저 안에서 직접 확인할 것'),
        h('div', { style: { padding: '8px 20px 0' } }, tip('확장 프로그램과 시작 페이지는 브라우저가 보호하고 있어서 쎈클린이 바꾸지 않아요. [설정 초기화]를 누르면 한 번에 원래대로 돌아가요.')),
        h('div', { class: 'items' }, info.map(itemRow))));
    }
    if (scan.admin.length) {
      parts.push(h('section', { class: 'panel pad' },
        h('div', { class: 'section-title' }, `관리자 권한이 필요한 항목 ${scan.admin.length}개`),
        scan.admin.map((a) => h('div', { class: 'muted' }, `${a.title} - ${a.reason}`)),
        h('div', { style: { marginTop: '10px' } }, tip('정보 담당 선생님께 요청하세요.', 'info'))));
    }
    if (scan.canUndo) parts.push(h('div', { class: 'btn-row' }, btn('undo', '지난 치료 되돌리기', async () => { const r = await api('browser:undo'); toast(r.manual ? `되돌렸어요. 휴지통으로 보낸 아이콘 ${r.manual}개는 휴지통에서 꺼내 주세요` : '되돌렸어요'); runScan(); }, { testid: 'ad-undo' })));
    box.replaceChildren(...parts.filter(Boolean));
    renderFooter();
  }

  // ── 기록 지우기 ──
  async function renderHistory() {
    const sizes = await api('browser:sizes');
    const running = await api('browser:running');
    if (!sizes.length) { box.replaceChildren(h('section', { class: 'panel' }, emptyState('크롬·엣지 기록을 찾지 못했어요'))); return; }
    const pick = { browsers: new Set(sizes.map((s) => s.browser)), history: true, cache: true, cookies: false };
    const sum = (k) => sizes.filter((s) => pick.browsers.has(s.browser)).reduce((a, s) => a + s.sizes[k], 0);
    const kindsBox = h('div', { class: 'choice-group' });
    const drawKinds = () => kindsBox.replaceChildren(
      checkbox(`방문 기록 (${fmtBytes(sum('history'))})`, pick.history, (v) => { pick.history = v; }, { testid: 'h-history' }),
      checkbox(`임시 파일(캐시) (${fmtBytes(sum('cache'))})`, pick.cache, (v) => { pick.cache = v; }, { testid: 'h-cache' }),
      checkbox(`쿠키 (${fmtBytes(sum('cookies'))}) - 지우면 사이트 로그인이 풀려요`, pick.cookies, (v) => { pick.cookies = v; }, { testid: 'h-cookies' }));
    drawKinds();
    box.replaceChildren(...[
      runningBox(running, renderHistory),
      h('section', { class: 'panel pad' },
        h('div', { class: 'section-title' }, '어떤 브라우저를 청소할까요?'),
        h('div', { class: 'btn-row' }, sizes.map((s) => checkbox(s.label, true, (v) => { if (v) pick.browsers.add(s.browser); else pick.browsers.delete(s.browser); drawKinds(); }, { testid: `h-${s.browser}` }))),
        h('div', { class: 'section-title', style: { marginTop: '18px' } }, '무엇을 지울까요?'),
        kindsBox,
        h('div', { style: { marginTop: '14px' } }, tip('저장된 비밀번호, 자동 완성, 즐겨찾기는 지우지 않아요.')),
        h('div', { class: 'btn-row', style: { marginTop: '18px' } }, btn('trash', '지우기', async () => {
          if (!pick.browsers.size || !(pick.history || pick.cache || pick.cookies)) { toast('지울 것을 골라 주세요'); return; }
          const ok = await confirmDialog({ title: '브라우저 기록을 지울까요?', body: pick.cookies ? '쿠키를 지우면 나이스·메일 등 사이트에 다시 로그인해야 해요.' : '방문 기록과 임시 파일을 지워요.', warn: '되돌릴 수 없어요', okLabel: '지우기', okIcon: 'trash' });
          if (!ok) return;
          const r = await api('browser:clean', { browsers: [...pick.browsers], history: pick.history, cache: pick.cache, cookies: pick.cookies });
          if (!r.ok && r.code === 'running') { toast(`${r.running.map((x) => x.label).join('·')}를 먼저 닫아 주세요`); renderHistory(); return; }
          const label = { chrome: '크롬', edge: '엣지' };
          toast(Object.entries(r.freed).map(([b, n]) => `${label[b]} ${fmtBytes(n)}`).join(', ') + '를 비웠어요');
          renderHistory();
        }, { variant: 'primary', testid: 'h-clean' })))].filter(Boolean));
  }

  function show() { if (tab === 'ads') { if (scan) renderAds(); else runScan(); } else renderHistory(); }
  renderTabs();
  show();
}
