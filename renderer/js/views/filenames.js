import { h, btn, api, hero, pageHead, tip, toast, confirmDialog, checkbox, icon, emptyState, pendingCard, statusRow, select } from '../ui.js';

// [파일명 정리] 깨진 한글·외계어·특수문자·겹친 확장자를 한 번에. 계획 31
const TAG_TONE = { '깨진 한글': 'warn', '외계어 이름': 'warn', '풀어진 글자': 'info', '확장자': 'info', '특수문자·공백': 'info', '너무 긴 이름': 'info' };

export default async function filenamesView(ctx) {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(pageHead('파일명 정리', '깨진 한글·외계어·특수문자·겹친 확장자를 찾아 한 번에 깔끔하게 고쳐요. 파일 내용은 그대로예요.'), box);

  let roots = null;        // null = 바탕화면·다운로드·문서
  let rules = null;        // 선택 규칙(고른 폴더일 때만)
  let rulesOpen = false;
  let result = null;       // 찾기 결과
  let done = null;         // 정리 결과
  const selected = new Set();
  let footerEl = null;

  const scopeText = () => (roots ? (roots.length === 1 ? roots[0] : `${roots[0]} 외 ${roots.length - 1}개`) : '바탕화면 · 다운로드 · 문서 (안쪽 폴더까지)');

  async function run() {
    done = null;
    box.replaceChildren(scopePanel(), pendingCard('파일 이름 살펴보는 중…', '깨진 한글·외계어·특수문자·겹친 확장자를 찾고 있어요'));
    result = await api('filenames:scan', { roots: roots || undefined, rules: roots ? rules : undefined });
    selected.clear();
    for (const i of result.items) if (i.sure) selected.add(i.id);
    render();
  }

  // 찾을 곳: 기본 폴더 / 폴더 고르기 / 끌어다 놓기(놓으면 바로 찾기)
  function scopePanel() {
    const drop = h('div', { class: 'dropzone', 'data-testid': 'fn-drop' },
      h('div', { class: 'ic tone-ok' }, icon('folder')),
      h('div', { style: { flex: '1' } },
        h('strong', { style: { display: 'block' } }, `찾을 곳: ${scopeText()}`),
        h('span', { class: 'muted small' }, '다른 폴더나 파일을 여기에 끌어다 놓으면 바로 찾아요.')),
      btn('folder', '폴더 고르기', async () => { const p = await api('filenames:pickFolder'); if (p && p.length) { roots = p; run(); } }, { testid: 'fn-pick' }),
      roots ? btn('undo', '처음 범위로', () => { roots = null; rules = null; rulesOpen = false; run(); }, { testid: 'fn-reset-scope' }) : null);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const paths = window.sen.pathsOf ? window.sen.pathsOf(e.dataTransfer.files) : [];
      if (!paths.length) { toast('끌어다 놓은 위치를 알 수 없어요. [폴더 고르기]를 써 주세요'); return; }
      roots = paths; run();
    });
    return h('section', { class: 'panel pad' }, drop);
  }

  // 선택 규칙(D·E·F): 고른 폴더·파일에만, 하위 폴더 없이
  function rulesPanel() {
    const r = rules || { date: '', prefix: '', suffix: '', find: '', replace: '', number: false, order: 'name', roster: '' };
    const field = (key, ph, w = '160px') => { const el = h('input', { class: 'field', type: 'text', placeholder: ph, 'data-testid': `fn-rule-${key}`, style: { maxWidth: w } }); el.value = r[key] || ''; el.addEventListener('change', () => { r[key] = el.value; }); return el; };
    const roster = h('textarea', { class: 'field', placeholder: '명단을 붙여넣으세요(엑셀에서 이름 칸을 복사). 위에서부터 차례로 01_이름, 02_이름…', 'data-testid': 'fn-rule-roster', style: { minHeight: '90px' } });
    roster.value = r.roster || '';
    roster.addEventListener('change', () => { r.roster = roster.value; });
    const body = h('div', { class: 'form', style: { gridTemplateColumns: '170px 1fr', marginTop: '14px' } },
      h('label', {}, '앞에 날짜 붙이기'), select([['', '안 붙임'], ['modified', '고친 날 (2026-10-09_)'], ['photo', '사진 찍은 날 (사진만, 없으면 고친 날)']], r.date || '', (v) => { r.date = v; }),
      h('label', {}, '앞·뒤에 글자 붙이기'), h('div', { class: 'btn-row', style: { gap: '8px' } }, field('prefix', '앞 (예: 2026_)'), field('suffix', '뒤 (예: _3반)')),
      h('label', {}, '찾아 바꾸기'), h('div', { class: 'btn-row', style: { gap: '8px' } }, field('find', '찾을 글자 (예: 최최종)'), h('span', {}, '→'), field('replace', '바꿀 글자 (비우면 지움)')),
      h('label', {}, '번호 매기기'), h('div', { class: 'btn-row', style: { gap: '12px' } }, checkbox('이름 뒤에 _01, _02…', !!r.number, (v) => { r.number = v; }, { testid: 'fn-rule-number' }), select([['name', '이름 순서로'], ['photo', '사진 찍은 순서로']], r.order || 'name', (v) => { r.order = v; })),
      h('label', {}, '명단으로 이름 바꾸기'), h('div', {}, roster, h('div', { class: 'muted small', style: { marginTop: '4px' } }, '파일을 이름 순서로 놓고 명단을 위에서부터 맞춰요. 명단은 저장하지 않아요.')));
    return h('section', { class: 'panel pad', 'data-testid': 'fn-rules' },
      h('div', { class: 'btn-row' },
        h('div', { style: { flex: '1' } }, h('div', { class: 'section-title', style: { margin: 0 } }, '이름 규칙 더하기 (선택)'), h('span', { class: 'muted small' }, roots ? '고른 폴더 바로 안의 파일에만 적용돼요. 켜 두면 [한 번에 정리]에 함께 들어가요.' : '폴더를 고르거나 끌어다 놓으면 쓸 수 있어요.')),
        roots ? btn(rulesOpen ? 'up' : 'down', rulesOpen ? '접기' : '펼치기', () => { rulesOpen = !rulesOpen; render(); }, { testid: 'fn-rules-toggle' }) : null),
      roots && rulesOpen ? h('div', {}, body, h('div', { class: 'btn-row', style: { marginTop: '14px' } },
        btn('check', '미리보기에 적용', () => { rules = r; run(); }, { variant: 'primary', testid: 'fn-rules-apply' }),
        rules ? btn('x', '규칙 끄기', () => { rules = null; run(); }, { testid: 'fn-rules-off' }) : null)) : null);
  }

  function itemRow(i) {
    return h('div', { class: `item tone-${i.sure ? 'warn' : 'info'}`, 'data-testid': 'fn-item' },
      checkbox(null, selected.has(i.id), (v) => { if (v) selected.add(i.id); else selected.delete(i.id); renderFooter(); }, { testid: 'fn-check' }),
      h('div', { class: 'ic' }, icon(i.isDir ? 'folder' : 'file')),
      h('div', { class: 'tx' },
        h('strong', { 'data-testid': 'fn-new' }, i.newName),
        h('span', { style: { textDecoration: 'line-through', opacity: '.75' }, 'data-testid': 'fn-old' }, i.name),
        h('span', { class: 'muted small' }, i.dir)),
      h('div', { class: 'counts', style: { flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '260px' } }, i.reasons.map((r) => h('span', { class: `tag tone-${TAG_TONE[r] || 'info'}` }, r))));
  }

  function renderFooter() {
    if (!footerEl) return;
    const n = selected.size;
    footerEl.replaceChildren(
      checkbox('전체 선택', result && n === result.items.length && n > 0, (v) => { selected.clear(); if (v) result.items.forEach((i) => selected.add(i.id)); render(); }, { testid: 'fn-select-all' }),
      h('span', { class: 'muted', style: { flex: '1' } }, `${n}개 선택`),
      btn('rename', '한 번에 정리', cleanUp, { variant: 'primary', disabled: !n, testid: 'fn-clean' }));
  }

  async function cleanUp() {
    if (!selected.size) return;
    const r = await api('filenames:apply', [...selected]);
    done = r;
    const bad = r.failed.length ? ` ${r.failed.length}개는 ${r.failed.some((f) => f.reason === 'locked') ? '열려 있어서' : ''} 고치지 못했어요` : '';
    toast(`${r.renamed}개 이름을 정리했어요.${bad}`);
    result = null;
    renderDone();
  }

  function renderDone() {
    const r = done;
    box.replaceChildren(
      scopePanel(),
      hero({ level: 'ok', iconName: 'checkCircle', title: '파일 이름 {}를 정리했어요', titleEmph: `${r.renamed}개`, desc: r.failed.length ? `${r.failed.length}개는 열려 있거나 이미 바뀌어서 그대로 뒀어요. 파일을 닫고 다시 찾아보세요.` : '파일 내용은 그대로예요. 잘못 바뀌었으면 [되돌리기]를 누르세요.',
        right: h('div', { class: 'btn-row' },
          r.batchId ? btn('undo', '되돌리기', async () => { const u = await api('filenames:undo', r.batchId); toast(u.ok ? `${u.restored}개를 원래 이름으로 되돌렸어요` : '되돌리지 못했어요'); run(); }, { testid: 'fn-undo' }) : null,
          btn('refresh', '다시 찾기', run, { testid: 'fn-rescan' })) }));
  }

  function render() {
    if (done) { renderDone(); return; }
    footerEl = null;
    const r = result;
    const n = r.items.length;
    ctx.setDot('filenames', r.warnings.length ? 'danger' : n ? 'warn' : 'ok');
    const parts = [
      scopePanel(),
      hero({
        level: r.warnings.length ? 'danger' : n ? 'warn' : 'ok', iconName: n || r.warnings.length ? 'rename' : 'checkCircle',
        title: n ? '깔끔하게 고칠 이름 {}를 찾았어요' : '정리할 이름이 없어요', titleEmph: n ? `${n}개` : null,
        desc: n ? `자동으로 고칠 이름 ${r.sure}개${r.check ? ` · 확인 필요 ${r.check}개(체크하면 함께 고쳐요)` : ''} · 파일 ${r.scanned}개를 살펴봤어요` : `파일·폴더 ${r.scanned}개를 살펴봤어요.${r.truncated ? ' 너무 많아서 일부만 봤어요. 폴더를 골라 다시 찾아 보세요.' : ''}`,
        right: h('div', { class: 'btn-row' },
          n ? btn('rename', '한 번에 정리', cleanUp, { variant: 'primary', testid: 'fn-clean-top' }) : null,
          btn('refresh', '다시 찾기', run, { testid: 'fn-rescan' })),
      }),
    ];
    if (r.warnings.length) {
      parts.push(h('section', { class: 'panel rows', 'data-testid': 'fn-warnings' }, r.warnings.map((w) => statusRow({
        level: 'danger', iconName: 'warn', title: `문서로 위장한 실행 파일: ${w.name}`, desc: `${w.dir} · 이름은 문서처럼 보이지만 실행 파일이에요. 열지 말고, 모르는 파일이면 지우세요.`, tag: '열지 마세요',
        right: btn('folder', '폴더 열기', () => api('filenames:reveal', w.path), { testid: 'fn-warn-open' }), testid: 'fn-warning',
      }))));
    }
    if (r.rosterMismatch) parts.push(h('section', { class: 'panel pad tone-warn' }, tip(`파일은 ${r.rosterMismatch.files}개, 명단은 ${r.rosterMismatch.names}명이에요. 위에서부터 맞는 만큼만 바꿔요.`, 'warn')));
    parts.push(rulesPanel());
    if (n) {
      const sure = r.items.filter((i) => i.sure), check = r.items.filter((i) => !i.sure);
      footerEl = h('div', { class: 'footer-bar sticky', 'data-testid': 'fn-footer' });
      parts.push(h('section', { class: 'panel' },
        sure.length ? h('div', { class: 'section-title', style: { padding: '16px 20px 0' } }, `자동으로 고칠 이름 ${sure.length}개`) : null,
        h('div', { class: 'items', 'data-testid': 'fn-list' }, sure.map(itemRow)),
        check.length ? h('div', { class: 'section-title', style: { padding: '16px 20px 0' } }, `확인 필요 ${check.length}개`) : null,
        check.length ? h('div', { style: { padding: '0 20px 8px' } }, tip('원래 뜻과 다르게 바뀔 수 있어서 처음엔 체크하지 않았어요. 바뀔 이름이 맞으면 체크하세요.')) : null,
        check.length ? h('div', { class: 'items', 'data-testid': 'fn-check-list' }, check.map(itemRow)) : null,
        footerEl));
      renderFooter();
    } else if (!r.warnings.length) {
      parts.push(h('section', { class: 'panel' }, emptyState('파일 이름이 깔끔해요', '맥·아이폰에서 받은 파일이나 압축을 푼 파일 이름이 깨지면 여기서 고칠 수 있어요.')));
    }
    box.replaceChildren(...parts);
  }

  // 처음: 바로 찾기(점검 현황에서 왔거나 기본 범위)
  await run();
}
