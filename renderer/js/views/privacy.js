import { h, btn, api, onEvent, statusRow, hero, pageHead, tip, toast, confirmDialog, checkbox, ago, fmtDate, emptyState, icon } from '../ui.js';

const LEVEL = { 3: 'danger', 2: 'warn', 1: 'warn' };
const TYPE_LABEL = { rrn: '주민번호', frn: '외국인번호', passport: '여권번호', license: '운전면허번호', account: '계좌번호', phone: '전화번호', email: '이메일' };
const TYPE_ORDER = ['rrn', 'frn', 'passport', 'license', 'account', 'phone', 'email'];
const ISSUE_SHORT = { locked: '암호 걸린 파일', unreadable: '열 수 없는 파일', scanned: '스캔 문서', 'skipped-large': '너무 큰 파일', 'skipped-cloud': '클라우드에만 있는 파일' };
const ISSUE_TEXT = {
  locked: '암호가 걸렸거나 배포용이라 열 수 없어요',
  unreadable: '파일이 손상됐거나 읽을 수 없어요',
  scanned: '글자가 없는 스캔 문서라 읽을 수 없어요',
  'skipped-large': '너무 커서 건너뛰었어요 (100MB 초과)',
  'skipped-cloud': '클라우드에만 있는 파일이라 건너뛰었어요',
};

export default async function privacyView(ctx) {
  const roots = await api('privacy:roots');
  const extraRoots = [];
  let wholePc = false;
  let state = await api('privacy:results');
  let progress = { checked: 0, total: 0, current: '' };
  let sort = 'danger';
  const selected = new Set();
  let focus = null;
  let secure = false;
  let showIssues = false;

  if (state && state.results) state.results.filter((r) => r.status === 'found').forEach((r) => selected.add(r.path));
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(box);

  const off = onEvent('privacy:event', (ev) => {
    if (state && state.id && ev.id !== state.id) return;
    if (ev.type === 'total') progress.total = ev.total;
    if (ev.type === 'progress') progress = { checked: ev.checked, total: ev.total, current: ev.current };
    if (ev.type === 'result') {
      state.results.push(ev.result);
      if (ev.result.status === 'found') selected.add(ev.result.path);
    }
    if (ev.type === 'done' || ev.type === 'error') { state.running = false; state.summary = ev.summary || null; }
    scheduleRender();
  });
  let pending = false;
  function scheduleRender() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); }

  async function start() {
    const list = wholePc ? await api('privacy:drives') : [...roots.filter((r) => r.checked).map((r) => r.path), ...extraRoots];
    if (!list.length) { toast('찾을 곳을 하나 이상 골라 주세요'); return; }
    selected.clear(); focus = null;
    progress = { checked: 0, total: 0, current: '' };
    const r = await api('privacy:start', { roots: list });
    state = { id: r.id, running: true, results: [], summary: null };
    render();
  }

  function found() { return state.results.filter((r) => r.status === 'found'); }
  function issues() { return state.results.filter((r) => r.status !== 'found'); }

  function sorted(list) {
    const l = [...list];
    if (sort === 'old') l.sort((a, b) => a.mtimeMs - b.mtimeMs);
    else if (sort === 'folder') l.sort((a, b) => a.where.localeCompare(b.where, 'ko') || a.name.localeCompare(b.name, 'ko'));
    else l.sort((a, b) => b.level - a.level || total(b) - total(a));
    return l;
  }
  const total = (r) => Object.values(r.counts || {}).reduce((a, b) => a + b, 0);

  function countChips(r) {
    return h('div', { class: 'counts' }, TYPE_ORDER.filter((t) => r.counts[t]).map((t) =>
      h('span', { class: `count-chip tone-${['rrn', 'frn', 'passport', 'license'].includes(t) ? 'danger' : 'warn'}` }, `${TYPE_LABEL[t]} ${r.counts[t]}`)));
  }

  function fileItem(r) {
    const cb = checkbox(null, selected.has(r.path), (v) => { if (v) selected.add(r.path); else selected.delete(r.path); renderFooter(); }, { testid: 'file-check' });
    const el = h('div', { class: `item tone-${LEVEL[r.level]} ${focus === r.path ? 'sel' : ''}`, 'data-testid': 'file-item', onclick: (e) => { if (e.target.closest('label, button')) return; focus = r.path; render(); } },
      cb,
      h('div', { class: 'ic' }, icon('file')),
      h('div', { class: 'tx' },
        h('strong', {}, r.name),
        h('span', {}, `${r.where} · 마지막 수정 ${ago(r.mtimeMs)}`),
        countChips(r)),
      btn('check', '괜찮아요', async () => {
        await api('privacy:exclude', r.path);
        state.results = state.results.filter((x) => x.path !== r.path);
        selected.delete(r.path);
        if (focus === r.path) focus = null;
        toast('다음 검사부터 이 파일은 빼고 찾을게요');
        render();
      }, { testid: 'file-ok', title: '이 파일은 괜찮아요' }));
    return el;
  }

  function previewPanel() {
    const r = state.results.find((x) => x.path === focus) || sorted(found())[0];
    if (!r) return h('section', { class: 'panel preview' }, h('div', { class: 'muted' }, '파일을 누르면 찾은 내용을 보여 드려요.'));
    return h('section', { class: `panel preview tone-${LEVEL[r.level]}`, 'data-testid': 'preview' },
      h('div', { class: 'section-title' }, r.name),
      h('div', { class: 'muted small' }, `${r.where} · ${fmtDate(r.mtimeMs)} 수정`),
      h('div', { style: { marginTop: '12px' } }, tip('가린 상태로만 보여 드려요. 파일을 열지 않아도 확인할 수 있어요.', 'eye')),
      (r.previews || []).map((p) => h('div', { class: 'hit' }, h('span', { class: 'loc' }, [p.label, p.loc].filter(Boolean).join(' · ')), p.text)),
      h('div', { class: 'btn-row', style: { marginTop: '16px' } }, btn('open', '파일 위치 열기', () => api('privacy:reveal', r.path))));
  }

  let footerEl = null;
  function renderFooter() {
    if (!footerEl) return;
    const n = [...selected].filter((p) => found().some((r) => r.path === p)).length;
    footerEl.replaceChildren(
      checkbox(`전체 선택 (${found().length}개)`, n > 0 && n === found().length, (v) => { found().forEach((r) => (v ? selected.add(r.path) : selected.delete(r.path))); render(); }, { testid: 'select-all' }),
      h('span', { style: { flex: '1' } }),
      checkbox('복구하기 어렵게 지우기', secure, (v) => { secure = v; }, { testid: 'secure' }),
      btn('trash', `선택한 ${n}개 지우기`, remove, { variant: 'primary', disabled: n === 0, testid: 'delete-selected' }));
  }

  async function remove() {
    const paths = [...selected].filter((p) => found().some((r) => r.path === p));
    if (!paths.length) return;
    const ok = await confirmDialog({
      title: `${paths.length}개 파일을 지울까요?`,
      body: secure ? '파일 내용을 덮어쓴 뒤 지워요. SSD에서는 완벽한 복구 차단을 보장할 수 없어요.' : '휴지통으로 보내요. 휴지통에서 다시 꺼낼 수 있어요.',
      warn: secure ? '되돌릴 수 없어요' : null,
      okLabel: '지우기', okIcon: 'trash', danger: secure,
    });
    if (!ok) return;
    const res = await api('privacy:delete', { paths, secure });
    const done = res.filter((x) => x.ok).map((x) => x.path);
    const locked = res.filter((x) => !x.ok);
    state.results = state.results.filter((r) => !done.includes(r.path));
    done.forEach((p) => selected.delete(p));
    render();
    if (locked.length) await confirmDialog({ title: `${locked.length}개는 지우지 못했어요`, body: '파일이 열려 있거나 지울 권한이 없어요. 한글·엑셀을 닫고 다시 눌러 주세요.', okLabel: '알겠어요', cancelLabel: '닫기' });
    if (done.length) toast(secure ? `${done.length}개를 복구하기 어렵게 지웠어요` : `${done.length}개를 휴지통으로 보냈어요`, secure ? {} : { action: { label: '휴지통 열기', icon: 'trash', run: () => api('privacy:openTrash') } });
  }

  function setupView() {
    const rootsBox = h('div', { class: 'choice-group' },
      roots.map((r) => checkbox(r.label, r.checked, (v) => { r.checked = v; }, { testid: `root-${r.label}` })),
      extraRoots.map((p, i) => h('div', { class: 'btn-row' }, checkbox(p, true, (v) => { if (!v) { extraRoots.splice(i, 1); render(); } }))));
    return [
      pageHead('개인정보 파일', '내 PC에 흩어진 주민번호·전화번호·계좌번호가 들어 있는 파일을 찾아서 한 번에 지워요.'),
      h('section', { class: 'panel pad' },
        h('div', { class: 'section-title' }, '어디를 찾을까요?'),
        rootsBox,
        h('div', { class: 'btn-row', style: { marginTop: '10px' } },
          btn('plus', '폴더 추가', async () => { const p = await api('privacy:pickFolder'); if (p && !extraRoots.includes(p)) { extraRoots.push(p); render(); } }),
          checkbox('내 PC 전체 (오래 걸려요)', wholePc, (v) => { wholePc = v; }, { testid: 'whole-pc' })),
        h('div', { style: { marginTop: '18px' } }, tip('한글(hwp·hwpx), 엑셀, 파워포인트, 워드, PDF, csv·txt 파일을 찾아요. 파일은 PC 밖으로 나가지 않아요.')),
        h('div', { class: 'btn-row', style: { marginTop: '18px' } }, btn('search', '개인정보 찾기', start, { variant: 'primary', testid: 'privacy-start' }))),
    ];
  }

  function runningView() {
    const pct = progress.total ? Math.round((progress.checked / progress.total) * 100) : 0;
    const bar = h('div', { class: `progress ${progress.total ? '' : 'indeterminate'}` }, h('i', { style: { width: progress.total ? `${pct}%` : undefined } }));
    return h('section', { class: 'panel pad', 'data-testid': 'scan-progress' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' } },
        h('div', { style: { flex: '1' } },
          h('div', { class: 'page-title' }, progress.total ? `${progress.total.toLocaleString()}개 중 ${progress.checked.toLocaleString()}개 확인 중` : '파일 목록을 만들고 있어요'),
          h('div', { class: 'page-desc' }, `찾은 파일 ${found().length}개`)),
        btn('stop', '멈추기', () => api('privacy:stop'), { testid: 'privacy-stop' })),
      bar,
      h('div', { class: 'muted small', style: { marginTop: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, progress.current ? progress.current.split(/[\\/]/).pop() : ''));
  }

  function resultsView() {
    const f = found();
    const iss = issues();
    const out = [];
    if (!state.running) {
      const lv = f.some((r) => r.level === 3) ? 'danger' : f.length ? 'warn' : 'ok';
      out.push(hero({
        level: lv,
        iconName: f.length ? 'warn' : 'checkCircle',
        title: f.length ? '개인정보가 들어 있는 파일 {}를 찾았어요' : '개인정보가 들어 있는 파일이 없어요',
        titleEmph: f.length ? `${f.length}개` : null,
        desc: state.summary ? `${state.summary.checked.toLocaleString()}개 파일 확인${state.summary.stopped ? ' (중간에 멈춤)' : ''}${state.summary.excluded ? ` · 괜찮다고 한 파일 ${state.summary.excluded}개 제외` : ''}` : '',
        right: btn('refresh', '다시 찾기', () => { state = { results: [], running: false }; render(); }, { testid: 'privacy-again' }),
      }));
    }
    if (f.length) {
      const tabs = h('div', { class: 'tabs' }, [['danger', '위험한 순'], ['old', '오래된 순'], ['folder', '폴더별']].map(([k, l]) => btn(k === 'danger' ? 'warn' : k === 'old' ? 'calendar' : 'folder', l, () => { sort = k; render(); }, { variant: sort === k ? 'on' : '' })));
      footerEl = h('div', { class: 'btn-row', style: { padding: '14px 20px', borderTop: '1px solid var(--hairline)' } });
      out.push(h('div', { class: 'split' },
        h('section', { class: 'panel', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
          h('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--hairline)' } }, tabs),
          h('div', { class: 'items list', 'data-testid': 'file-list' }, sorted(f).map(fileItem)),
          footerEl),
        previewPanel()));
      renderFooter();
    }
    if (iss.length && !state.running) {
      const byReason = {};
      for (const r of iss) byReason[r.status] = (byReason[r.status] || 0) + 1;
      const summary = Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${ISSUE_SHORT[k] || '확인할 수 없는 파일'} ${n}개`).join(' · ');
      out.push(h('section', { class: 'panel', 'data-testid': 'issues-panel' },
        h('div', { style: { padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' } },
          h('div', { style: { flex: '1', minWidth: '240px' } },
            h('div', { class: 'section-title', style: { marginBottom: '2px' } }, `확인하지 못한 파일 ${iss.length}개`),
            h('div', { class: 'muted small' }, summary)),
          btn(showIssues ? 'x' : 'eye', showIssues ? '접기' : '자세히 보기', () => { showIssues = !showIssues; render(); }, { testid: 'issues-toggle' })),
        showIssues ? h('div', { class: 'rows', style: { borderTop: '1px solid var(--hairline)' } }, iss.slice(0, 200).map((r) => statusRow({ level: 'info', iconName: 'file', title: r.name, desc: `${r.where} · ${ISSUE_TEXT[r.status] || '확인할 수 없어요'}`, tag: '확인 불가' })),
          iss.length > 200 ? h('div', { class: 'muted small', style: { padding: '12px 24px' } }, `… 외 ${iss.length - 200}개`) : null) : null));
    }
    return out;
  }

  function render() {
    footerEl = null;
    const children = [];
    if (state && state.running) children.push(runningView(), ...resultsView());
    else if (state && state.summary) children.push(...resultsView());
    else children.push(...setupView());
    box.replaceChildren(...children.flat().filter(Boolean));
  }

  if (ctx.params.autostart && !(state && state.running)) await start();
  else render();
  return () => off();
}
