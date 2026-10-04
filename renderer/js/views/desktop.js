import { h, btn, api, onEvent, hero, pageHead, tip, toast, confirmDialog, checkbox, radio, select, fmtBytes, icon, fmtDate } from '../ui.js';

const GROUPS = [
  ['type', '종류별로 (한글 / 엑셀 / PDF / 사진 …)'],
  ['semester', '학기별로 (2025학년도 1학기 / 2학기 …)'],
  ['semester-type', '학기별로 묶고, 그 안에서 종류별로'],
  ['none', "묶지 않고 '바탕화면 보관함' 한 폴더로"],
];
const EXTRA_LABEL = { installers: '이미 설치한 설치파일', extracted: '이미 압축을 푼 압축파일', duplicates: '똑같은 파일 (복사본)', broken: '고장 난 바로가기' };

export default async function desktopView(ctx) {
  const settings = await api('settings:get');
  const opt = JSON.parse(JSON.stringify(settings.desktop));
  let plan = null;
  let done = null;
  const del = new Set();
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(pageHead('바탕화면 정리', '지우지 않고 보관함으로 옮기기만 해요. 언제든 되돌릴 수 있어요.'), box);
  let phase = '';
  const off = onEvent('desktop:progress', (p) => { phase = p.phase; if (!plan && !done) renderLoading(); });

  function renderLoading() {
    box.replaceChildren(h('section', { class: 'panel pad' }, h('div', { class: 'page-title' }, phase === 'privacy' ? '개인정보가 들어 있는 파일을 찾고 있어요' : '바탕화면 파일을 살펴보고 있어요'), h('div', { class: 'progress indeterminate', style: { marginTop: '14px' } }, h('i'))));
  }

  async function optionsView() {
    const st = await api('desktop:status');
    const hist = await api('desktop:history');
    const last = hist.find((x) => !x.undone);
    const q1 = h('div', { class: 'choice-group' },
      radio('scope', '전부', opt.scope === 'all', () => { opt.scope = 'all'; }),
      radio('scope', '오래된 파일만', opt.scope === 'old', () => { opt.scope = 'old'; },
        h('span', { class: 'btn-row', style: { marginLeft: '6px' } }, '-', select([[1, '1개월'], [3, '3개월'], [6, '6개월'], [12, '1년']], opt.olderThanMonths, (v) => { opt.olderThanMonths = Number(v); }), h('span', {}, '넘게 안 건드린 것'))));
    const q2 = h('div', { class: 'choice-group' }, GROUPS.map(([k, l]) => radio('group', l, opt.groupBy === k, () => { opt.groupBy = k; })));
    const q3 = h('div', { class: 'choice-group' },
      checkbox('이미 설치한 설치파일', opt.finds.installers, (v) => { opt.finds.installers = v; }),
      checkbox('똑같은 파일 (복사본)', opt.finds.duplicates, (v) => { opt.finds.duplicates = v; }),
      checkbox('고장 난 바로가기', opt.finds.brokenShortcuts, (v) => { opt.finds.brokenShortcuts = v; }),
      checkbox('개인정보가 들어 있는 파일', opt.finds.privacy, (v) => { opt.finds.privacy = v; }));
    const step = (n, title, body) => h('div', { style: { marginBottom: '20px' } }, h('div', { class: 'section-title' }, `${n} ${title}`), body);
    box.replaceChildren(
      hero({ level: 'info', iconName: 'folder', title: `바탕화면에 파일이 ${st.total}개 있어요`, desc: `${st.months}개월 넘게 안 건드린 파일 ${st.old}개` }),
      last ? h('section', { class: 'panel pad', style: { display: 'flex', alignItems: 'center', gap: '16px' } },
        h('div', { style: { flex: '1' } }, h('div', { class: 'section-title', style: { marginBottom: 0 } }, '지난 정리'), h('div', { class: 'muted small' }, `${fmtDate(last.at)} · ${last.moved}개 옮김`)),
        btn('folder', '보관함 열기', () => api('desktop:openArchive')),
        btn('undo', '되돌리기', async () => { const r = await api('desktop:undo', last.id); toast(`${r.restored}개를 원래대로 되돌렸어요`); optionsView(); }, { testid: 'desktop-undo-last' })) : null,
      h('section', { class: 'panel pad' },
        step('①', '어떤 파일을 정리할까요?', q1),
        step('②', '어떻게 묶을까요?', q2),
        step('③', '같이 찾아볼까요?', q3),
        tip('바로가기 아이콘(크롬·한글·나이스 등)은 그대로 둬요. 같이 찾은 파일은 직접 고른 것만 휴지통으로 보내요.'),
        h('div', { class: 'btn-row', style: { marginTop: '18px' } }, btn('eye', '미리보기', makePlan, { variant: 'primary', testid: 'desktop-preview' }))));
  }

  async function makePlan() {
    phase = 'files';
    renderLoading();
    plan = await api('desktop:plan', opt);
    del.clear();
    previewView();
  }

  function treeView() {
    const n = (label, count, pv, child) => h('div', { class: `node ${child ? 'child' : ''}` }, icon('folder'), h('span', {}, `${label} (${count})`), pv ? h('span', { class: 'warnmark' }, `⚠ 개인정보 ${pv}`) : null);
    return h('div', { class: 'tree', 'data-testid': 'desktop-tree' },
      h('div', { class: 'node' }, icon('folder'), h('strong', {}, '바탕화면 보관함')),
      h('div', { style: { paddingLeft: '28px' } }, plan.tree.map((t) => [
        plan.options.groupBy === 'none' ? null : n(t.label, t.count, t.privacy, false),
        t.children.map((c) => n(c.label, c.count, c.privacy, true)),
      ])));
  }

  function previewView() {
    const extras = Object.entries(plan.extras).filter(([, list]) => list.length);
    const extraBox = extras.length ? h('section', { class: 'panel pad' },
      h('div', { class: 'section-title' }, '같이 찾은 것 — 지워도 돼요'),
      h('div', { class: 'muted small', style: { marginBottom: '10px' } }, '고른 것만 휴지통으로 보내요. 고르지 않으면 그대로 보관함으로 옮겨요.'),
      extras.map(([k, list]) => h('div', { style: { marginBottom: '12px' } },
        h('div', { style: { fontWeight: 700 } }, `${EXTRA_LABEL[k]} ${list.length}개`),
        list.map((x) => checkbox(`${x.name} · ${fmtBytes(x.size)} · ${x.reason}`, del.has(x.path), (v) => { if (v) del.add(x.path); else del.delete(x.path); }, { testid: `extra-${k}` }))))) : null;
    const pvBox = plan.privacy.length ? h('section', { class: 'panel pad tone-warn', style: { display: 'flex', alignItems: 'center', gap: '16px' } },
      h('div', { style: { flex: '1' } }, h('div', { class: 'section-title', style: { marginBottom: '2px' } }, `개인정보가 들어 있는 파일 ${plan.privacy.length}개`), h('div', { class: 'muted small' }, plan.privacy.map((p) => p.name).slice(0, 4).join(', ') + (plan.privacy.length > 4 ? ' …' : ''))),
      btn('file', '개인정보 파일 메뉴에서 보기', () => ctx.go('privacy', { autostart: true }))) : null;
    box.replaceChildren(
      hero({ level: 'info', iconName: 'eye', title: plan.moveCount ? `${plan.total}개 중 {}를 보관함으로 옮겨요` : '옮길 파일이 없어요', titleEmph: plan.moveCount ? `${plan.moveCount}개` : null, desc: `${plan.keepCount}개(바로가기·최근 파일 등)는 그대로 둬요.` }),
      plan.moveCount ? h('section', { class: 'panel pad' }, h('div', { class: 'section-title' }, '정리하면 이렇게 돼요'), treeView()) : null,
      pvBox,
      extraBox,
      h('section', { class: 'panel pad' }, h('div', { class: 'btn-row' },
        btn('folder', '정리하기', apply, { variant: 'primary', disabled: !plan.moveCount && !del.size && !extras.length, testid: 'desktop-apply' }),
        btn('x', '조건 바꾸기', () => { plan = null; optionsView(); }, { testid: 'desktop-back' }))));
  }

  async function apply() {
    if (del.size) {
      const ok = await confirmDialog({ title: `${del.size}개를 휴지통으로 보낼까요?`, body: '나머지 파일은 보관함으로 옮겨요. 휴지통에서 다시 꺼낼 수 있어요.', okLabel: '정리하기', okIcon: 'folder' });
      if (!ok) return;
    }
    const r = await api('desktop:apply', { planId: plan.id, deletePaths: [...del] });
    if (!r.ok) { toast('바탕화면이 바뀌어서 다시 미리보기를 할게요'); return makePlan(); }
    done = r; plan = null;
    doneView();
  }

  function doneView() {
    box.replaceChildren(
      hero({ level: 'ok', iconName: 'checkCircle', title: '바탕화면을 정리했어요', desc: `${done.moved}개를 보관함으로 옮겼어요${done.trashed ? ` · ${done.trashed}개는 휴지통으로 보냈어요` : ''}${done.failed ? ` · ${done.failed}개는 열려 있어서 못 옮겼어요` : ''}` }),
      h('section', { class: 'panel pad' }, h('div', { class: 'btn-row' },
        btn('folder', '보관함 열기', () => api('desktop:openArchive'), { testid: 'desktop-open-archive' }),
        btn('undo', '되돌리기', async () => {
          const r = await api('desktop:undo', done.logId);
          toast(r.skipped ? `${r.restored}개를 되돌렸어요. ${r.skipped}개는 이미 옮겨졌거나 지워져서 못 되돌렸어요` : `${r.restored}개를 원래대로 되돌렸어요`);
          done = null; optionsView();
        }, { testid: 'desktop-undo' }),
        btn('home', '점검 현황으로', () => ctx.go('dashboard'))),
        done.trashed ? h('div', { style: { marginTop: '14px' } }, tip('휴지통으로 보낸 파일은 휴지통에서 다시 꺼낼 수 있어요.')) : null));
  }

  await optionsView();
  return () => off();
}
