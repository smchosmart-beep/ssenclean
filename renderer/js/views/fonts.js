import { h, btn, api, hero, pageHead, tip, toast, confirmDialog, checkbox, emptyState, icon, fmtDate } from '../ui.js';

const CLASS_TONE = { caution: 'warn', unknown: 'info', safe: 'ok' };
const CLASS_TAG = { caution: '사용 주의', unknown: '확인 필요', safe: '안심' };

export default async function fontsView(ctx) {
  let data = null;
  let tab = 'caution';
  const selected = new Set();
  const loaded = new Set();
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(pageHead('폰트 정리', '학교에서 쓰면 저작권 문제가 될 수 있는 폰트를 찾아 정리하고, 학교안심 글꼴을 설치해요.'), box);

  async function load() {
    box.replaceChildren(h('section', { class: 'panel pad' }, h('div', { class: 'muted' }, '설치된 폰트를 살펴보고 있어요…')));
    data = await api('fonts:list');
    selected.clear();
    data.items.filter((i) => i.defaultOn && i.removable).forEach((i) => selected.add(i.id));
    ctx.setDot('fonts', data.summary.cautionRemovable ? 'warn' : 'ok');
    render();
  }

  function sample(item) {
    const fam = `sf-${item.id}`;
    if (!loaded.has(item.id)) {
      loaded.add(item.id);
      try { const ff = new FontFace(fam, `url(senfont://${item.id}/)`); ff.load().then((f) => document.fonts.add(f)).catch(() => {}); } catch { /* ignore */ }
    }
    return h('div', { class: 'font-sample', style: { fontFamily: `"${fam}", var(--ui)` } }, '가나다 쎈Clean ABC 123');
  }

  function itemRow(item) {
    const canPick = item.removable && item.class !== 'safe';
    return h('div', { class: `item tone-${CLASS_TONE[item.class]}`, 'data-testid': 'font-item' },
      canPick ? checkbox(null, selected.has(item.id), (v) => { if (v) selected.add(item.id); else selected.delete(item.id); renderFooter(); }, { testid: 'font-check' }) : h('span', { style: { width: '20px', flex: 'none' } }),
      h('div', { class: 'ic' }, icon('font')),
      h('div', { class: 'tx' },
        h('strong', {}, item.name),
        h('span', {}, [item.manufacturer || '제작사 정보 없음', item.reason].join(' · ')),
        item.basis ? h('span', { 'data-testid': 'font-basis', style: { fontSize: '12px', opacity: '.7' } }, `근거: ${item.basis}`) : null,
        ),
      sample(item),
      h('span', { class: 'tag' }, CLASS_TAG[item.class]));
  }

  let footerEl = null;
  let heroSlot = null;
  const pickable = () => data.items.filter((i) => i.class === tab && i.removable && i.class !== 'safe');
  function renderFooter() {
    const n = selected.size;
    if (heroSlot) heroSlot.replaceChildren(n ? btn('broom', `${n}개 정리하기`, clean, { variant: 'primary', testid: 'fonts-clean-top' }) : null);
    if (!footerEl) return;
    const list = pickable();
    const allOn = list.length > 0 && list.every((i) => selected.has(i.id));
    const admin = [...selected].some((id) => { const it = data.items.find((x) => x.id === id); return it && it.needsAdmin; });
    footerEl.replaceChildren(
      checkbox(`전체 선택 (${list.length}개)`, allOn, (v) => { list.forEach((i) => (v ? selected.add(i.id) : selected.delete(i.id))); render(); }, { testid: 'fonts-select-all' }),
      h('span', { class: 'sum' }, n ? `선택 ${n}개` : ''),
      h('span', { class: 'muted small', style: { flex: '1' } }, admin ? '정리한 폰트는 보관함에 모아 두었다가 되돌릴 수 있어요. Windows 확인 창이 뜨면 [예]를 누르세요.' : '정리한 폰트는 보관함에 모아 두었다가 되돌릴 수 있어요.'),
      btn('broom', n ? `선택한 폰트 ${n}개 정리하기` : '선택한 폰트 정리하기', clean, { variant: 'primary', disabled: n === 0, testid: 'fonts-clean' }));
  }

  async function clean() {
    const ids = [...selected];
    const apps = await api('fonts:running');
    if (apps.length) {
      const go = await confirmDialog({ title: `${apps.join('·')}를 닫아 주세요`, body: '폰트를 쓰고 있는 프로그램이 열려 있으면 바로 정리되지 않을 수 있어요. 닫은 뒤 계속하세요.', okLabel: '계속하기', okIcon: 'play' });
      if (!go) return;
    }
    const ok = await confirmDialog({
      title: `폰트 ${ids.length}개를 정리할까요?`,
      body: h('div', {},
        h('div', {}, '이 폰트로 만든 문서는 다른 폰트로 보일 수 있어요.'),
        h('div', { style: { marginTop: '6px' } }, `정리한 폰트 파일은 '${data.archivePath}'에 모아 둬요. 문제가 생기면 [되돌리기]를 누르거나 보관함의 파일을 더블클릭해 다시 설치할 수 있어요.`)),
      okLabel: '정리하기', okIcon: 'broom',
    });
    if (!ok) return;
    const r = await api('fonts:clean', ids);
    if (r.canceled && !r.results.some((x) => x.ok)) { toast('Windows 확인 창에서 취소해서 정리하지 않았어요'); return; }
    const done = r.results.filter((x) => x.ok).length;
    const noBackup = r.results.filter((x) => x.reason === 'backup').length;
    if (noBackup) toast(`${noBackup}개는 보관함에 복사하지 못해서 정리하지 않았어요`);
    const pend = r.results.filter((x) => x.pending).length;
    await load();
    toast(pend ? `${done}개를 정리했어요. ${pend}개는 PC를 다시 켜면 마저 정리돼요` : `폰트 ${done}개를 정리했어요`, r.batchId ? { action: { label: '보관함 열기', icon: 'folder', run: () => api('fonts:openArchive') } } : {});
  }

  function schoolTab() {
    const s = data.school;
    const moreBtn = s.officialUrl ? btn('open', '더 많은 학교안심 글꼴 받기', () => api('app:openExternal', s.officialUrl), { testid: 'school-more' }) : null;
    const moreTip = h('div', { class: 'tip', style: { marginTop: '16px' } }, icon('bulb'),
      h('div', { style: { flex: '1' } }, `쎈Clean에는 자주 쓰는 학교안심 글꼴 ${s.families.length}종만 들어 있어요. 다른 글꼴은 KERIS 누리집에서 내려받아 설치하세요.${s.installedCount ? ` (이 PC에 설치된 학교안심 글꼴 파일 ${s.installedCount}개)` : ''}`),
      moreBtn);
    if (!s.families.length) return h('div', { class: 'panel pad' }, tip('학교안심 글꼴 파일이 설치파일에 들어 있지 않아요. 공식 배포처에서 내려받아 설치해 주세요.'), moreTip);
    const install = async (ids, label) => {
      const r = await api('fonts:installSchool', ids);
      await load();
      tab = 'school'; render();
      toast(r.every((x) => x.ok) ? `${label}을(를) 설치했어요` : '일부를 설치하지 못했어요');
    };
    const sampleOf = (id) => {
      const fam = `sf-${id}`;
      if (!loaded.has(id)) {
        loaded.add(id);
        try { const ff = new FontFace(fam, `url(senfont://${id}/)`); ff.load().then((f) => document.fonts.add(f)).catch(() => {}); } catch { /* ignore */ }
      }
      return fam;
    };
    const rows = s.families.map((f) => {
      const missing = f.weights.filter((w) => !w.installed);
      return h('div', { class: `item tone-${f.installed ? 'ok' : 'info'}`, 'data-testid': 'school-family' },
        h('div', { class: 'ic' }, icon(f.installed ? 'checkCircle' : 'download')),
        h('div', { class: 'tx' },
          h('strong', {}, f.name),
          h('span', {}, f.weights.map((w) => `${w.label || '보통'} ${w.installed ? '✓' : ''}`.trim()).join(' · '))),
        h('div', { class: 'font-sample', style: { fontFamily: `"${sampleOf(f.sampleId)}", var(--ui)` } }, '가나다 우리 반 ABC 123'),
        f.installed ? h('span', { class: 'tag' }, '설치됨')
          : btn('download', '설치', () => install(missing.map((w) => w.id), f.name), { testid: 'school-install-one' }));
    });
    return h('div', { class: 'pad', style: { padding: '20px 24px' } },
      h('div', { class: 'btn-row', style: { marginBottom: '14px' } },
        h('span', { style: { flex: '1' } }, `학교안심 글꼴 ${s.families.length}종 (파일 ${s.fileCount}개)`),
        s.allInstalled ? h('span', { class: 'muted' }, '학교안심 글꼴이 모두 설치되어 있어요.')
          : btn('download', '모두 설치', () => install(null, '학교안심 글꼴'), { variant: 'primary', testid: 'install-school' })),
      h('div', { class: 'items' }, rows),
      moreTip,
      h('div', { style: { marginTop: '10px' } }, tip('한글·파워포인트는 다시 켜야 글꼴 목록에 보여요.')));
  }

  function render() {
    footerEl = null;
    heroSlot = h('span', {});
    const s = data.summary;
    const head = hero({
      right: heroSlot,
      level: s.cautionRemovable ? 'warn' : 'ok',
      iconName: s.cautionRemovable ? 'warn' : 'checkCircle',
      title: s.cautionRemovable ? '사용 주의 폰트 {}를 찾았어요' : '정리할 폰트가 없어요',
      titleEmph: s.cautionRemovable ? `${s.cautionRemovable}개` : null,
      desc: `설치된 폰트 ${s.total}개 · 안심 ${s.safe} · 사용 주의 ${s.caution} · 확인 필요 ${s.unknown}`,
    });
    const tabs = h('div', { class: 'tabs' },
      [['caution', 'warn', `사용 주의 ${s.caution}`], ['unknown', 'info', `확인 필요 ${s.unknown}`], ['safe', 'checkCircle', `안심 ${s.safe}`], ['school', 'download', '학교안심 글꼴']]
        .map(([k, ic, l]) => btn(ic, l, () => { tab = k; selected.clear(); if (k === 'caution') data.items.filter((i) => i.defaultOn && i.removable).forEach((i) => selected.add(i.id)); render(); }, { variant: tab === k ? 'on' : '', testid: `font-tab-${k}` })));
    let body;
    if (tab === 'school') body = schoolTab();
    else {
      const list = data.items.filter((i) => i.class === tab);
      body = list.length ? h('div', { class: 'items', 'data-testid': 'font-list' }, list.map(itemRow)) : emptyState(tab === 'caution' ? '사용 주의 폰트가 없어요' : '해당하는 폰트가 없어요');
      if ((tab === 'caution' || tab === 'unknown') && list.some((i) => i.removable)) footerEl = h('div', { class: 'footer-bar sticky', 'data-testid': 'fonts-footer' });
      if (tab === 'unknown' && list.length) body = h('div', {}, h('div', { style: { padding: '14px 20px 0' } }, tip('정보가 부족해 판단할 수 없는 폰트예요. 학교 문서에는 학교안심 글꼴을 쓰세요. 다른 프로그램이 함께 설치했을 수 있으니 모르면 그대로 두세요.')), body);
    }
    const undoBox = data.undo.length ? h('section', { class: 'panel pad', style: { display: 'flex', alignItems: 'center', gap: '16px' } },
      h('div', { style: { flex: '1' } }, h('div', { class: 'section-title', style: { marginBottom: '0' } }, '최근 정리 기록'),
        h('div', { class: 'muted small' }, `${fmtDate(data.undo[data.undo.length - 1].at)} · ${data.undo[data.undo.length - 1].count}개 정리`)),
      btn('folder', '폰트 보관함 열기', () => api('fonts:openArchive'), { testid: 'fonts-archive' }),
      btn('undo', '되돌리기', async () => { const u = await api('fonts:undo', data.undo[data.undo.length - 1].id); await load(); toast(u.ok ? (u.missing ? `되돌렸어요. ${u.missing}개는 보관함에서 파일을 찾지 못했어요` : '되돌렸어요') : u.canceled ? 'Windows 확인 창에서 취소해서 되돌리지 않았어요' : u.code === 'missing' ? '보관함에서 파일을 찾지 못했어요' : '되돌리지 못했어요'); }, { testid: 'fonts-undo' })) : null;
    const archiveNote = data.archive ? h('div', { class: 'btn-row', 'data-testid': 'fonts-archive-note' }, tip(`정리한 폰트 ${data.archive.count}개가 '${data.archive.path}'에 모여 있어요. 파일을 더블클릭하고 [설치]를 누르면 다시 쓸 수 있어요.`, 'folder')) : null;
    box.replaceChildren(head,
      undoBox,
      h('section', { class: 'panel' }, h('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--hairline)' } }, tabs), body, footerEl),
      archiveNote);
    renderFooter();
  }

  await load();
}
