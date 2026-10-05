import { h, btn, api, onEvent, hero, pageHead, tip, toast, confirmDialog, modal, checkbox, radio, select, fmtBytes, icon, fmtDate } from '../ui.js';

const ARCHIVE = '바탕화면 보관함';
const GROUPS = [
  ['year-topic', '학년도별 › 하는 일별 (추천)', '2026학년도 › 수업 · 학생·학급 · 행사 · 공문·업무 · 연수 · 사진·영상 · 기타'],
  ['topic', '하는 일별만', '수업 · 학생·학급 · 행사 · 공문·업무 · 연수 · 사진·영상 · 기타'],
  ['type', '종류별', '한글 · 엑셀 · 파워포인트 · PDF · 사진 · 영상 …'],
];
const KEEP = [[7, '1주'], [14, '2주'], [30, '1개월'], [90, '3개월']];
const EXTRA_LABEL = { installers: '이미 설치한 설치파일', extracted: '이미 압축을 푼 압축파일', duplicates: '똑같은 파일 (복사본)', broken: '고장 난 바로가기' };
const TOPIC_ORDER = ['수업', '학생·학급', '행사', '공문·업무', '연수', '사진·영상', '기타'];
const byFolder = (a, b) => {
  if (/학년도$/.test(a.label) && /학년도$/.test(b.label)) return b.label.localeCompare(a.label, 'ko', { numeric: true }); // 최근 학년도 먼저
  const ia = TOPIC_ORDER.indexOf(a.label), ib = TOPIC_ORDER.indexOf(b.label);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return a.label.localeCompare(b.label, 'ko', { numeric: true });
};
const keepLabel = (d) => (KEEP.find(([v]) => v === Number(d)) || KEEP[1])[1];

export default async function desktopView(ctx) {
  const settings = await api('settings:get');
  const opt = JSON.parse(JSON.stringify(settings.desktop));
  if (!GROUPS.some(([k]) => k === opt.groupBy)) opt.groupBy = 'year-topic';
  if (opt.scope !== 'all') opt.scope = 'recent';
  if (!KEEP.some(([v]) => v === Number(opt.keepDays))) opt.keepDays = 14;
  let plan = null;
  let done = null;
  const del = new Set();
  let overrides = {}; // moveId -> { keep:true } | { folder:'a/b' }
  let renames = {}; // 원래 폴더 경로 -> 새 이름
  const open = new Set(); // 펼친 폴더 경로
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
      radio('scope', '', opt.scope === 'recent', () => { opt.scope = 'recent'; },
        h('span', { class: 'btn-row', style: { gap: '6px' } }, '최근', select(KEEP, opt.keepDays, (v) => { opt.keepDays = Number(v); }), h('span', {}, '안에 고친 파일은 바탕화면에 그대로 두고 나머지 정리 (추천)'))),
      radio('scope', '전부 정리', opt.scope === 'all', () => { opt.scope = 'all'; }));
    const q2 = h('div', { class: 'choice-group', 'data-testid': 'desktop-groups' }, GROUPS.map(([k, l, ex]) => radio('group', l, opt.groupBy === k, () => { opt.groupBy = k; }, h('span', { class: 'muted small', style: { marginLeft: '8px' } }, ex))),
      h('div', { class: 'muted small', style: { marginTop: '6px' } }, '이름이 비슷한 파일(가정통신문_1, _2(수정), _최종 …)이 3개 넘으면 한 폴더로 모아요. 미리보기에서 폴더를 바꾸거나 이름을 고칠 수 있어요.'));
    const q3 = h('div', { class: 'choice-group' },
      checkbox('이미 설치한 설치파일', opt.finds.installers, (v) => { opt.finds.installers = v; }),
      checkbox('똑같은 파일 (복사본)', opt.finds.duplicates, (v) => { opt.finds.duplicates = v; }),
      checkbox('고장 난 바로가기', opt.finds.brokenShortcuts, (v) => { opt.finds.brokenShortcuts = v; }),
      checkbox('개인정보가 들어 있는 파일', opt.finds.privacy, (v) => { opt.finds.privacy = v; }));
    const step = (n, title, body) => h('div', { style: { marginBottom: '20px' } }, h('div', { class: 'section-title' }, `${n} ${title}`), body);
    box.replaceChildren(
      hero({ level: 'info', iconName: 'folder', title: `바탕화면에 파일이 ${st.total}개 있어요`, desc: `최근 ${keepLabel(st.keepDays)} 안에 고치지 않은 파일 ${st.old}개` }),
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
    del.clear(); overrides = {}; renames = {}; open.clear();
    previewView();
  }

  // ── 미리보기: 고친 내용(overrides·renames)을 반영한 나무 ──
  const foldersOf = (m) => (overrides[m.id] && typeof overrides[m.id].folder === 'string' ? overrides[m.id].folder.split('/').filter(Boolean) : m.folders);
  const shown = (p) => { // 원래 경로 → 화면 이름(이름 바꾸기 반영)
    const segs = p.split('/');
    return segs.map((s, i) => renames[segs.slice(0, i + 1).join('/')] || s);
  };
  function buildTree() {
    const root = { children: new Map(), files: [] };
    for (const m of plan.moves) {
      const keep = !!(overrides[m.id] && overrides[m.id].keep); // 그대로 두는 파일도 자리에 보여 주되 개수에서는 뺀다
      let node = root; const acc = [];
      for (const seg of foldersOf(m)) {
        acc.push(seg);
        if (!node.children.has(seg)) node.children.set(seg, { path: acc.join('/'), label: seg, count: 0, privacy: 0, children: new Map(), files: [] });
        node = node.children.get(seg);
        if (!keep) { node.count++; if (m.privacy) node.privacy++; }
      }
      node.files.push(m);
    }
    return root;
  }
  function allFolders() {
    const set = new Set();
    for (const m of plan.moves) { const f = foldersOf(m); for (let i = 1; i <= f.length; i++) set.add(f.slice(0, i).join('/')); }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  }

  async function askName(title, value) {
    return modal((close) => {
      const input = h('input', { class: 'field', type: 'text', 'data-testid': 'name-input' });
      input.value = value || '';
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value.trim() || null); });
      setTimeout(() => input.select(), 0);
      return h('div', {}, h('h2', {}, title), h('div', { class: 'body' }, input),
        h('div', { class: 'actions' }, btn('x', '취소', () => close(null)), btn('check', '확인', () => close(input.value.trim() || null), { variant: 'primary', testid: 'name-ok' })));
    });
  }

  function fileRow(m, depth) {
    const keep = !!(overrides[m.id] && overrides[m.id].keep);
    const cur = foldersOf(m).join('/');
    const opts = [['', `${ARCHIVE} (바로 아래)`], ...allFolders().map((p) => [p, shown(p).join(' › ')]), ['__new', '새 폴더 만들기…']];
    return h('div', { class: `node file ${keep ? 'kept' : ''}`, style: { paddingLeft: `${depth * 24 + 30}px` }, 'data-testid': 'desktop-file' },
      checkbox(null, !keep, (v) => { overrides[m.id] = v ? (overrides[m.id] && overrides[m.id].folder != null ? { folder: overrides[m.id].folder } : undefined) : { keep: true }; if (!overrides[m.id]) delete overrides[m.id]; previewView(); }, { testid: 'desktop-file-check' }),
      icon('file'), h('span', { class: 'fname' }, m.name), keep ? h('span', { class: 'muted small' }, '바탕화면에 그대로') : null, m.privacy ? h('span', { class: 'warnmark' }, '⚠ 개인정보') : null,
      h('span', { style: { flex: '1' } }),
      select(opts, cur, async (v) => {
        if (v === '__new') {
          const name = await askName('새 폴더 이름', '');
          if (!name) { previewView(); return; }
          const parent = foldersOf(m).slice(0, -1);
          v = [...parent, name.replace(/[\\/:*?"<>|]/g, ' ').trim()].join('/');
        }
        overrides[m.id] = { folder: v };
        open.add(v);
        previewView();
      }));
  }

  function nodeView(n, depth) {
    const isOpen = open.has(n.path);
    const label = shown(n.path).pop();
    return [
      h('div', { class: 'node', style: { paddingLeft: `${depth * 24}px` }, 'data-testid': 'desktop-folder' },
        h('button', { type: 'button', class: 'linkish', onclick: () => { if (isOpen) open.delete(n.path); else open.add(n.path); previewView(); } },
          icon(isOpen ? 'folder' : 'folder'), h('span', {}, `${isOpen ? '▾' : '▸'} ${label} (${n.count})`)),
        n.privacy ? h('span', { class: 'warnmark' }, `⚠ 개인정보 ${n.privacy}`) : null,
        btn('edit', '이름 바꾸기', async () => { const name = await askName('폴더 이름 바꾸기', label); if (name) { renames[n.path] = name; previewView(); } }, { testid: 'desktop-rename' })),
      [...n.children.values()].sort(byFolder).map((c) => nodeView(c, depth + 1)),
      isOpen ? n.files.map((m) => fileRow(m, depth)) : null,
    ];
  }

  function previewView() {
    const tree = buildTree();
    const keptN = Object.values(overrides).filter((o) => o && o.keep).length;
    const moveN = plan.moveCount - keptN;
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
      hero({ level: 'info', iconName: 'eye', title: moveN ? `${plan.total}개 중 {}를 보관함으로 옮겨요` : '옮길 파일이 없어요', titleEmph: moveN ? `${moveN}개` : null, desc: `${plan.total - moveN}개(바로가기·최근 파일·그대로 두기로 한 파일)는 바탕화면에 그대로 둬요.` }),
      moveN ? h('section', { class: 'panel pad' },
        h('div', { class: 'section-title' }, '정리하면 이렇게 돼요'),
        h('div', { class: 'muted small', style: { marginBottom: '10px' } }, '폴더를 누르면 파일이 보여요. 체크를 풀면 그 파일은 바탕화면에 그대로 두고, 오른쪽에서 다른 폴더로 바꿀 수 있어요.'),
        h('div', { class: 'tree', 'data-testid': 'desktop-tree' },
          h('div', { class: 'node' }, icon('folder'), h('strong', {}, ARCHIVE)),
          [...tree.children.values()].sort(byFolder).map((n) => nodeView(n, 1)),
          tree.files.map((m) => fileRow(m, 0)))) : null,
      pvBox,
      extraBox,
      h('section', { class: 'panel pad' }, h('div', { class: 'btn-row' },
        btn('folder', '정리하기', apply, { variant: 'primary', disabled: !moveN && !del.size && !extras.length, testid: 'desktop-apply' }),
        btn('x', '조건 바꾸기', () => { plan = null; optionsView(); }, { testid: 'desktop-back' }))));
  }

  async function apply() {
    if (del.size) {
      const ok = await confirmDialog({ title: `${del.size}개를 휴지통으로 보낼까요?`, body: '나머지 파일은 보관함으로 옮겨요. 휴지통에서 다시 꺼낼 수 있어요.', okLabel: '정리하기', okIcon: 'folder' });
      if (!ok) return;
    }
    const r = await api('desktop:apply', { planId: plan.id, deletePaths: [...del], overrides, renames });
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
