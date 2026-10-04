import { h, btn, api, onEvent, pageHead, tip, toast, confirmDialog, modal, checkbox, fmtBytes, fmtDate, ago, icon, emptyState } from '../ui.js';

const KIND = { video: { label: '동영상', icon: 'video' }, installer: { label: '설치파일', icon: 'package' } };
const FAIL_TEXT = { locked: '열려 있어서 못 옮겼어요', 'no-space': '옮길 드라이브에 공간이 부족해요', stopped: '멈춰서 옮기지 않았어요', error: '옮기지 못했어요' };
const YEAR = 365 * 86400000;

// 화면을 떠났다 와도 유지할 것
let filter = 'all';

export default async function cdriveView(ctx) {
  let st = null;
  let results = [];
  let scanned = false;
  let scanning = false;
  let prog = { dirs: 0, files: 0, found: 0, current: '' };
  let sort = 'old';
  let desktopLink = true;
  let whyOpen = false;
  let moving = null; // { index, total, name, percent }
  let lastMove = null;
  const selected = new Set();

  const statusBox = h('div');
  const cardsBox = h('div', { class: 'cd-cards' });
  const listBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  ctx.main.append(
    pageHead('C드라이브 정리', 'C드라이브가 꽉 차면 PC가 느려져요. 큰 파일을 지우거나 다른 드라이브로 옮겨서 공간을 만드세요.'),
    statusBox, cardsBox, listBox);

  const off = onEvent('cdrive:event', (ev) => {
    if (ev.type === 'progress') { prog = ev; if (scanning) renderCards(); }
    if (ev.type === 'move') { moving = ev; renderList(); }
    if (ev.type === 'done' && scanning) finishScan();
  });

  const sumOf = (list) => list.reduce((n, r) => n + r.size, 0);
  const driveName = (d) => (d.label ? `${d.letter}드라이브 (${d.label})` : `${d.letter}드라이브`);

  // ───────── ① 상태 카드 ─────────
  const diskLine = (d, main) => {
    const used = d.total - d.free;
    const pct = d.total ? Math.round((used / d.total) * 100) : 0;
    return h('div', { class: `disk tone-${main ? d.level : 'ok'} ${main ? '' : 'small-disk'}`, 'data-testid': main ? 'disk-c' : `disk-${d.letter}` },
      h('div', { class: 'disk-line' },
        h('strong', {}, driveName(d)),
        d.removable ? h('span', { class: 'tag' }, 'USB') : null,
        h('span', { class: 'muted small' }, `${fmtBytes(d.total)} 중 ${fmtBytes(used)} 사용`),
        h('span', { class: 'free' }, `${fmtBytes(d.free)} 남음`)),
      h('div', { class: 'disk-bar' }, h('i', { style: { width: `${Math.max(2, pct)}%` } })));
  };

  function renderStatus() {
    const d = st.system;
    if (!d) { statusBox.replaceChildren(h('section', { class: 'panel pad' }, h('div', { class: 'section-title' }, 'C드라이브 공간을 읽지 못했어요'))); return; }
    ctx.setDot('cdrive', d.level);
    const title = { danger: ['C드라이브가 거의 ', '꽉 찼어요'], warn: ['C드라이브 남은 공간이 ', '적어요'], ok: ['C드라이브 공간이 ', '넉넉해요'] }[d.level] || ['C드라이브 ', ''];
    const why = h('div', { class: 'tip why', 'data-testid': 'cdrive-why' }, icon('bulb'), h('div', {},
      h('strong', {}, '왜 C드라이브를 비워야 하나요?'),
      h('ul', {},
        h('li', {}, 'Windows는 C드라이브의 빈 공간을 작업하는 책상처럼 써요. 책상이 가득 차면 일이 느려지듯 PC도 느려져요.'),
        h('li', {}, '빈 공간이 10%보다 적으면 프로그램이 멈추거나 Windows 업데이트가 설치되지 않을 수 있어요.'),
        h('li', {}, '수업 영상처럼 계속 쓸 파일은 다른 드라이브로 옮기고, 다 쓴 설치파일은 지우세요.'))));
    statusBox.replaceChildren(h('section', { class: `panel pad tone-${d.level}`, 'data-testid': 'cdrive-hero' },
      h('div', { class: 'cd-head' },
        h('div', { class: 'badge' }, icon('disk')),
        h('div', { style: { flex: '1' } },
          h('h1', {}, title[0], h('b', {}, title[1])),
          h('p', {}, `남은 공간 ${fmtBytes(d.free)} (${d.freePct}%) · 15% 넘게 비워 두면 좋아요`)),
        btn(whyOpen ? 'x' : 'bulb', whyOpen ? '설명 닫기' : '왜 비워야 하나요?', () => { whyOpen = !whyOpen; renderStatus(); }, { testid: 'cdrive-why-toggle' })),
      whyOpen ? why : null,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' } },
        diskLine(d, true),
        st.others.map((o) => diskLine(o, false)),
        st.others.length ? null : h('div', { class: 'muted small' }, '옮길 수 있는 다른 드라이브(D·E 등)가 없어요. 지우기만 할 수 있어요.'))));
  }

  // ───────── ② 정리 방법 카드 3개 ─────────
  function card(testid, iconName, title, big, desc, actions) {
    return h('section', { class: 'panel cd-card', 'data-testid': testid },
      h('div', { class: 'cd-card-top' }, h('div', { class: 'kind-ic' }, icon(iconName)), h('div', { class: 'section-title', style: { margin: 0 } }, title)),
      big ? h('div', { class: 'big' }, big) : null,
      h('div', { class: 'muted small', style: { flex: '1' } }, desc),
      h('div', { class: 'btn-row' }, actions));
  }

  function renderCards() {
    const r = st.recycle;
    const hasTrash = r && r.size > 0;
    let bigFiles;
    if (scanning) {
      bigFiles = card('card-files', 'search', '큰 파일 정리', h('span', { class: 'cd-scan' }, h('span', { class: 'spinner' }), '찾는 중…'),
        `폴더 ${prog.dirs.toLocaleString()}개 확인 · 찾은 파일 ${prog.found}개`,
        [btn('stop', '멈추기', () => api('cdrive:stop'), { testid: 'cdrive-stop' })]);
    } else if (scanned) {
      bigFiles = card('card-files', 'video', '큰 파일 정리', results.length ? fmtBytes(sumOf(results)) : '없어요',
        results.length ? `동영상·설치파일 ${results.length}개` : '50MB 넘는 동영상이나 설치파일이 없어요',
        [btn('refresh', '다시 찾기', startScan, { testid: 'cdrive-rescan' })]);
    } else {
      bigFiles = card('card-files', 'video', '큰 파일 정리', '찾아보기',
        'C드라이브에서 50MB 넘는 동영상과 5MB 넘는 설치파일(exe·msi·iso)을 찾아요. Windows·프로그램 폴더는 건드리지 않아요.',
        [btn('search', '큰 파일 찾기', startScan, { variant: 'primary', testid: 'cdrive-scan' })]);
    }
    const trash = card('recycle-panel', 'trash', '휴지통 비우기', r ? (hasTrash ? fmtBytes(r.size) : '비어 있어요') : '확인 불가',
      hasTrash ? `${r.count}개 · 휴지통에 있어도 C드라이브 공간을 그대로 차지해요` : '휴지통에 있는 파일도 C드라이브 공간을 차지해요',
      [btn('broom', '휴지통 비우기', emptyRecycle, { variant: hasTrash ? 'primary' : '', disabled: !hasTrash, testid: 'empty-recycle' }),
        btn('open', '열기', () => api('cdrive:openRecycle'), { title: '휴지통 열기' })]);
    const prog2 = card('card-programs', 'trash', '안 쓰는 프로그램 지우기', null,
      h('span', {}, '프로그램도 C드라이브를 차지해요. 지울 때 Windows 확인 창이 뜨면 [예]를 누르세요.', h('br'), '나이스·에듀파인용 보안 프로그램(키보드 보안, 인증서 등)은 지우지 마세요.'),
      [btn('trash', '프로그램 제거 창 열기', () => api('uninstall:open'), { testid: 'open-appwiz' })]);
    cardsBox.replaceChildren(bigFiles, trash, prog2);
  }

  async function emptyRecycle() {
    const ok = await confirmDialog({ title: '휴지통을 비울까요?', body: `휴지통에 있는 ${st.recycle.count}개 파일(${fmtBytes(st.recycle.size)})을 완전히 지워요.`, warn: '비우면 다시 꺼낼 수 없어요', okLabel: '비우기', okIcon: 'broom', danger: true });
    if (!ok) return;
    const r = await api('cdrive:emptyRecycle');
    toast(r.ok ? '휴지통을 비웠어요' : '휴지통을 비우지 못했어요');
    await refresh();
  }

  // ───────── ③ 큰 파일 목록 ─────────
  const visible = () => {
    const list = filter === 'all' ? results.slice() : results.filter((r) => r.kind === filter);
    if (sort === 'old') list.sort((a, b) => a.mtimeMs - b.mtimeMs || b.size - a.size);
    else list.sort((a, b) => b.size - a.size || a.mtimeMs - b.mtimeMs);
    return list;
  };

  async function startScan() {
    scanning = true; scanned = false; selected.clear(); lastMove = null;
    prog = { dirs: 0, files: 0, found: 0, current: '' };
    renderCards(); renderList();
    api('cdrive:scan');
  }
  async function finishScan() {
    scanning = false; scanned = true;
    results = await api('cdrive:results');
    renderCards(); renderList();
  }

  function lastMovePanel() {
    const m = lastMove || (st.last && !st.last.undone ? { logId: st.last.id, target: st.last.target, moved: st.last.moved, bytes: st.last.bytes, at: st.last.at } : null);
    if (!m || !m.moved) return null;
    return h('section', { class: 'panel pad', style: { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }, 'data-testid': 'cdrive-last' },
      h('div', { style: { flex: '1', minWidth: '260px' } },
        h('div', { class: 'section-title', style: { marginBottom: '2px' } }, `${m.target}드라이브로 ${m.moved}개(${fmtBytes(m.bytes)})를 옮겼어요`),
        h('div', { class: 'muted small' }, `바탕화면의 '${m.target}드라이브로 옮긴 파일'에서 찾을 수 있어요.${m.at ? ` · ${fmtDate(m.at)}` : ''}`)),
      btn('folder', '옮긴 폴더 열기', () => api('cdrive:openFolder', m.target), { testid: 'cdrive-open-moved' }),
      btn('undo', '되돌리기', async () => {
        const r = await api('cdrive:undo', m.logId);
        if (!r.ok) { toast(r.code === 'no-space' ? 'C드라이브 공간이 부족해서 되돌릴 수 없어요' : '되돌릴 수 없어요'); return; }
        toast(r.skipped ? `${r.restored}개를 되돌렸어요. ${r.skipped}개는 못 되돌렸어요` : `${r.restored}개를 C드라이브로 되돌렸어요`);
        lastMove = null;
        if (scanned) { results = []; scanned = false; }
        await refresh();
      }, { testid: 'cdrive-undo' }));
  }

  function shortPlace(place) {
    const parts = place.split(' › ');
    return parts.length > 2 ? `${parts.slice(0, 2).join(' › ')} › …` : place;
  }

  function fileItem(r) {
    const on = selected.has(r.path);
    return h('div', { class: `item ${on ? 'sel' : ''}`, 'data-testid': 'cd-item' },
      checkbox(null, on, (v) => { if (v) selected.add(r.path); else selected.delete(r.path); renderList(); }),
      h('div', { class: 'kind-ic', title: KIND[r.kind].label }, icon(KIND[r.kind].icon)),
      h('div', { class: 'tx' },
        h('strong', {}, r.name, r.dup ? h('span', { class: 'count-chip tone-warn', style: { marginLeft: '8px' }, 'data-testid': 'cd-dup' }, `같은 파일 ${r.dup}개`) : null),
        h('span', { title: r.path }, `${KIND[r.kind].label} · ${shortPlace(r.place)}`)),
      h('div', { class: 'when', 'data-testid': 'cd-date' }, h('span', {}, fmtDate(r.mtimeMs)), h('small', {}, ago(r.mtimeMs))),
      h('span', { class: 'size' }, fmtBytes(r.size)),
      btn('search', '위치', () => api('cdrive:reveal', r.path), { title: '파일이 있는 폴더 열기' }));
  }

  function moveLabel() {
    if (st.others.length === 1) return `${st.others[0].letter}드라이브로 옮기기`;
    return '다른 드라이브로 옮기기';
  }

  function footer(vis) {
    const sel = results.filter((r) => selected.has(r.path));
    const allOn = vis.length > 0 && vis.every((r) => selected.has(r.path));
    const old = vis.filter((r) => Date.now() - r.mtimeMs > YEAR);
    if (moving) {
      return h('div', { class: 'footer-bar sticky', 'data-testid': 'cdrive-moving', style: { flexDirection: 'column', alignItems: 'stretch' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
          h('div', { class: 'sum', style: { flex: '1' } }, `${moving.total}개 중 ${moving.index}번째 옮기는 중 · ${moving.name}`),
          h('strong', {}, `${moving.percent}%`),
          btn('stop', '멈추기', () => api('cdrive:stop'))),
        h('div', { class: 'progress' }, h('i', { style: { width: `${moving.percent}%` } })),
        h('div', { class: 'muted small' }, '큰 동영상은 몇 분 걸릴 수 있어요. 끝날 때까지 PC를 끄지 마세요.'));
    }
    return h('div', { class: 'footer-bar sticky' },
      checkbox(`전체 선택 (${vis.length}개)`, allOn, (v) => { vis.forEach((r) => (v ? selected.add(r.path) : selected.delete(r.path))); renderList(); }, { testid: 'cd-select-all' }),
      old.length ? btn('calendar', `1년 넘은 것 선택 (${old.length})`, () => { selected.clear(); old.forEach((r) => selected.add(r.path)); renderList(); }, { testid: 'cd-select-old' }) : null,
      h('span', { class: 'sum', style: { flex: '1' } }, sel.length ? `선택 ${sel.length}개 · ${fmtBytes(sumOf(sel))}` : ''),
      st.others.length ? checkbox("바탕화면에 '옮긴 파일' 바로가기 만들기", desktopLink, (v) => { desktopLink = v; api('cdrive:prefs', { desktopLink: v }); }, { testid: 'cd-desktop-link' }) : null,
      st.others.length ? btn('move', moveLabel(), moveSelected, { variant: 'primary', disabled: !sel.length, testid: 'cd-move' }) : null,
      btn('trash', '지우기', removeSelected, { variant: st.others.length ? '' : 'primary', disabled: !sel.length, testid: 'cd-delete' }));
  }

  // 옮길 드라이브 고르기: 하나면 확인 창, 여러 개면 고르기 창
  async function pickDrive(sel) {
    const need = sumOf(sel);
    if (st.others.length === 1) {
      const d = st.others[0];
      if (d.free < need) { toast(`${d.letter}드라이브에 공간이 부족해요 (${fmtBytes(need)} 필요)`); return null; }
      const ok = await confirmDialog({
        title: `${sel.length}개(${fmtBytes(need)})를 ${d.letter}드라이브로 옮길까요?`,
        body: h('div', {},
          h('div', {}, `${d.letter}:\\C드라이브에서 옮긴 파일 폴더에 원래 폴더 이름대로 옮겨요.`),
          desktopLink ? h('div', { style: { marginTop: '6px' } }, `바탕화면의 '${d.letter}드라이브로 옮긴 파일'에서 찾을 수 있어요.`) : null,
          d.removable ? h('div', { class: 'warnline', style: { marginTop: '6px' } }, 'USB를 빼면 옮긴 파일을 열 수 없어요.') : null,
          h('div', { style: { marginTop: '6px' } }, '동영상을 재생하고 있다면 먼저 닫아 주세요.')),
        okLabel: '옮기기', okIcon: 'move',
      });
      return ok ? d.letter : null;
    }
    const pref = st.prefs.target && st.others.some((o) => o.letter === st.prefs.target) ? st.prefs.target : st.recommended;
    const list = st.others.slice().sort((a, b) => (a.letter === pref ? -1 : b.letter === pref ? 1 : b.free - a.free));
    return modal((close) => h('div', { 'data-testid': 'drive-picker' },
      h('h2', {}, '어느 드라이브로 옮길까요?'),
      h('div', { class: 'body' },
        h('div', { class: 'muted', style: { marginBottom: '12px' } }, `선택한 파일 ${sel.length}개 · ${fmtBytes(need)}`),
        h('div', { class: 'drive-list' }, list.map((d) => {
          const enough = d.free >= need + 200 * 1024 * 1024;
          const used = d.total - d.free;
          return h('div', { class: `drive-row ${enough ? '' : 'disabled'}`, 'data-testid': `pick-${d.letter}` },
            h('div', { style: { flex: '1', minWidth: 0 } },
              h('div', { class: 'disk-line' },
                h('strong', {}, driveName(d)),
                d.letter === st.recommended ? h('span', { class: 'tag tone-ok' }, '추천') : null,
                d.removable ? h('span', { class: 'tag' }, 'USB') : null,
                h('span', { class: 'free' }, enough ? `${fmtBytes(d.free)} 남음` : '공간 부족')),
              h('div', { class: 'disk-bar tone-ok', style: { marginTop: '6px' } }, h('i', { style: { width: `${Math.max(2, Math.round((used / d.total) * 100))}%` } })),
              d.removable ? h('div', { class: 'muted small', style: { marginTop: '4px', color: 'var(--warn)' } }, 'USB를 빼면 옮긴 파일을 열 수 없어요') : null),
            btn('move', '여기로 옮기기', () => close(d.letter), { variant: d.letter === pref ? 'primary' : '', disabled: !enough, testid: `pick-btn-${d.letter}` }));
        })),
        h('div', { class: 'muted small', style: { marginTop: '12px' } }, '동영상을 재생하고 있다면 먼저 닫아 주세요.')),
      h('div', { class: 'actions' }, btn('x', '취소', () => close(null)))));
  }

  async function moveSelected() {
    const sel = results.filter((r) => selected.has(r.path));
    if (!sel.length) return;
    const target = await pickDrive(sel);
    if (!target) return;
    moving = { index: 1, total: sel.length, name: sel[0].name, percent: 0 };
    renderList();
    const r = await api('cdrive:move', { paths: sel.map((x) => x.path), target, desktopLink });
    moving = null;
    if (!r.ok) { toast(r.code === 'no-space' ? `${target}드라이브에 공간이 부족해요` : '옮기지 못했어요'); renderList(); return; }
    sel.forEach((x) => selected.delete(x.path));
    results = await api('cdrive:results');
    lastMove = r;
    await refresh();
    if (r.failed.length) {
      await confirmDialog({
        title: `${r.failed.length}개는 옮기지 못했어요`,
        body: h('div', {}, r.failed.slice(0, 6).map((f) => h('div', {}, `${f.name} — ${FAIL_TEXT[f.reason] || FAIL_TEXT.error}`)),
          r.failed.some((f) => f.reason === 'locked') ? h('div', { style: { marginTop: '8px' } }, '동영상 플레이어나 파워포인트를 닫고 다시 해 보세요.') : null),
        okLabel: '알겠어요', cancelLabel: '닫기',
      });
    } else toast(`${r.moved}개를 옮겼어요. C드라이브에 ${fmtBytes(r.bytes)}가 비었어요${r.link ? `. 바탕화면의 '${r.link}'에서 찾을 수 있어요` : ''}`);
  }

  async function removeSelected() {
    const sel = results.filter((r) => selected.has(r.path));
    if (!sel.length) return;
    const vids = sel.filter((r) => r.kind === 'video').length;
    const ok = await confirmDialog({
      title: `${sel.length}개(${fmtBytes(sumOf(sel))})를 지울까요?`,
      body: h('div', {},
        h('div', {}, '휴지통으로 보내요. 휴지통을 비워야 C드라이브 공간이 생겨요.'),
        vids && st.others.length ? h('div', { style: { marginTop: '6px' } }, `동영상 ${vids}개는 지우지 않고 다른 드라이브로 옮길 수도 있어요.`) : null),
      okLabel: '지우기', okIcon: 'trash',
    });
    if (!ok) return;
    const res = await api('cdrive:remove', { paths: sel.map((x) => x.path) });
    const done = res.filter((x) => x.ok);
    done.forEach((x) => selected.delete(x.path));
    results = await api('cdrive:results');
    await refresh();
    const fail = res.length - done.length;
    if (fail) toast(`${fail}개는 열려 있어서 지우지 못했어요`);
    else toast(`${done.length}개를 휴지통으로 보냈어요. 휴지통을 비우면 공간이 생겨요`, { action: { label: '휴지통 비우기', icon: 'broom', run: emptyRecycle } });
  }

  function renderList() {
    const out = [lastMovePanel()];
    if (scanned && results.length) {
      const vids = results.filter((r) => r.kind === 'video');
      const inst = results.filter((r) => r.kind === 'installer');
      if (filter === 'video' && !vids.length) filter = 'all';
      if (filter === 'installer' && !inst.length) filter = 'all';
      const setSort = (k) => { sort = k; api('cdrive:prefs', { sort: k }); renderList(); };
      const tabs = h('div', { class: 'tabs', style: { alignItems: 'center' } },
        btn('disk', `전체 ${results.length}개 · ${fmtBytes(sumOf(results))}`, () => { filter = 'all'; renderList(); }, { variant: filter === 'all' ? 'on' : '', testid: 'cd-tab-all' }),
        vids.length ? btn('video', `동영상 ${vids.length}개 · ${fmtBytes(sumOf(vids))}`, () => { filter = 'video'; renderList(); }, { variant: filter === 'video' ? 'on' : '', testid: 'cd-tab-video' }) : null,
        inst.length ? btn('package', `설치파일 ${inst.length}개 · ${fmtBytes(sumOf(inst))}`, () => { filter = 'installer'; renderList(); }, { variant: filter === 'installer' ? 'on' : '', testid: 'cd-tab-installer' }) : null,
        h('span', { style: { flex: '1' } }),
        btn('calendar', '오래된 순', () => setSort('old'), { variant: sort === 'old' ? 'on' : '', testid: 'cd-sort-old' }),
        btn('disk', '큰 순', () => setSort('size'), { variant: sort === 'size' ? 'on' : '', testid: 'cd-sort-size' }));
      const moveWord = st.others.length === 1 ? `${st.others[0].letter}드라이브로` : '다른 드라이브로';
      const hint = filter === 'installer' ? tip('설치파일은 설치가 끝났으면 지워도 돼요. 다시 필요하면 홈페이지에서 받을 수 있어요. 같은 파일이 여러 개면 하나만 남기세요.')
        : filter === 'video' ? tip(st.others.length ? `수업 영상처럼 계속 쓸 동영상은 지우지 말고 ${moveWord} 옮기세요.` : '계속 쓸 동영상은 USB나 클라우드에 옮겨 두고 지우세요.')
          : tip(st.others.length ? `동영상은 ${moveWord} 옮기고, 설치파일은 지우는 것을 추천해요.` : '다른 드라이브가 없어서 지우기만 할 수 있어요. 계속 쓸 동영상은 USB에 옮겨 두세요.');
      const vis = visible();
      out.push(h('section', { class: 'panel', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: '12px' } }, tabs, hint),
        h('div', { class: 'items cd-list', 'data-testid': 'cd-list' }, vis.map(fileItem)),
        footer(vis)));
    } else if (scanned) {
      out.push(h('section', { class: 'panel pad' }, emptyState('정리할 큰 파일이 없어요', '50MB 넘는 동영상이나 설치파일을 찾지 못했어요.')));
    }
    listBox.replaceChildren(...out);
  }

  async function refresh() {
    st = await api('cdrive:status');
    renderStatus(); renderCards(); renderList();
  }

  st = await api('cdrive:status');
  results = await api('cdrive:results');
  sort = st.prefs.sort;
  desktopLink = st.prefs.desktopLink;
  whyOpen = !st.prefs.whySeen; // 처음 한 번은 펼쳐서 보여 준다
  if (!st.prefs.whySeen) api('cdrive:prefs', { whySeen: true });
  scanning = !!st.scanning;
  scanned = results.length > 0;
  renderStatus(); renderCards(); renderList();
  if (ctx.params.autostart && !scanning) await startScan();
  return () => off();
}
