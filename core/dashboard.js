'use strict';
// 대시보드 카드. 각 항목을 따로 점검해서 끝나는 대로 화면에 채운다. spec 3장
// 화면 순서 = 사이드바 메뉴 순서(고정)
const ITEMS = ['privacy', 'fonts', 'password', 'screensaver', 'updates', 'cdrive', 'browser', 'desktop', 'filenames', 'network'];
const gb = (n) => `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)}GB`;

function fmtDate(t) { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일`; }

function createDashboard(s) {
  const card = (id, level, title, desc, action, extra = {}) => ({ id, level, title, desc, action, ...extra });

  const checks = {
    async password() {
      const st = await s.password.status({ refresh: true });
      const go = (label) => ({ kind: 'navigate', target: 'password', label, icon: 'lock' });
      if (st.hasPassword === false) return card('password', 'danger', 'PC암호가 없어요', '자리를 비우면 누구나 이 PC를 열 수 있어요.', go('암호 만들기'));
      if (st.dday != null) {
        const due = `변경 예정일 ${fmtDate(st.due)}`;
        if (st.dday < 0) return card('password', 'danger', `PC암호 변경일이 ${-st.dday}일 지났어요`, due, go('암호 바꾸기'));
        if (st.dday <= 14) return card('password', 'warn', `PC암호 변경까지 ${st.dday}일 남았어요`, due, go('암호 바꾸기'), { dday: st.dday });
        return card('password', 'ok', 'PC암호 - 다음 변경까지', due, null, { dday: st.dday });
      }
      if (st.hasPassword === true) return card('password', 'info', 'PC암호 - 마지막으로 바꾼 날을 알 수 없어요', '바꾼 날을 입력하면 다음 변경일을 알려 드려요.', go('날짜 입력'));
      return card('password', 'unknown', 'PC암호 - 확인할 수 없어요', '암호가 있는지 이 PC에서 확인하지 못했어요.', go('확인하기'));
    },
    async screensaver() {
      const st = s.screensaver.status();
      if (st.safe) return card('screensaver', 'ok', `화면보호기 - ${st.minutes}분 후 잠겨요`, '자리를 비우면 화면이 잠겨요.', null);
      const title = !st.active ? '화면보호기가 꺼져 있어요' : !st.secure ? '화면보호기를 풀 때 암호를 묻지 않아요' : `화면보호기가 ${st.minutes}분 뒤에야 켜져요`;
      return card('screensaver', 'danger', title, '자리를 비워도 화면이 그대로 보여요.', { kind: 'run', target: 'screensaver:secure', label: '안전하게 설정', icon: 'shield' });
    },
    async browser() {
      const q = s.browser.quickCount();
      if (q.count > 0) {
        const parts = [];
        if (q.shortcut) parts.push('브라우저 바로가기가 바뀌어 있어요');
        if (q.url) parts.push(`광고 아이콘 ${q.url}개가 있어요`);
        return card('browser', 'warn', `브라우저에 의심 항목 ${q.count}개`, parts.join(', ') || '광고 프로그램 흔적이 있어요.', { kind: 'navigate', target: 'browser', label: '청소하기', icon: 'broom' });
      }
      return card('browser', 'ok', '브라우저 - 문제없어요', '바로가기와 시작 프로그램에서 광고 흔적을 찾지 못했어요.', { kind: 'navigate', target: 'browser', label: '자세히', icon: 'search' });
    },
    async updates() {
      const list = await s.updates.check();
      // 쎈Clean 안에서 업데이트하는 중이면 '최신'으로 보이면 안 된다
      const busy = list.find((u) => u.state === 'updating');
      if (busy) {
        const p = busy.progress || {};
        const text = { downloading: '내려받는 중', installing: '설치하는 중', preparing: '설치를 준비하는 중', checking: '확인하는 중', available: '내려받을 준비 중' }[p.phase] || '진행 중';
        return card('updates', 'info', `${busy.name} 업데이트 중이에요`, `${text}${p.percent != null ? ` ${p.percent}%` : ''} · 끝나면 이 카드가 바뀌어요`, { kind: 'navigate', target: 'updates', label: '진행 보기', icon: 'search' });
      }
      const restart = list.find((u) => u.state === 'restart');
      if (restart && list.filter((u) => u.state === 'outdated').length === 0) {
        return card('updates', 'warn', '크롬을 다시 시작하면 업데이트가 적용돼요', `새 버전${restart.newVersion ? `(${restart.newVersion})` : ''}을 받아 두었어요. 열려 있던 탭은 그대로 돌아와요.`, { kind: 'navigate', target: 'updates', label: '크롬 다시 시작', icon: 'refresh', autostart: true });
      }
      const out = list.filter((u) => u.state === 'outdated' || u.state === 'restart');
      const go = { kind: 'navigate', target: 'updates', label: '업데이트', icon: 'up' };
      if (out.length === 1) {
        const u = out[0];
        return card('updates', 'warn', `${u.name} 업데이트가 있어요`, u.pending ? `설치할 업데이트 ${u.pending}개` : (u.version ? `현재 ${u.version}` : ''), go);
      }
      if (out.length > 1) return card('updates', 'warn', `업데이트할 프로그램 ${out.length}개`, out.map((u) => u.name).join(', '), go);
      if (list.length && list.every((u) => u.state === 'latest')) return card('updates', 'ok', '업데이트 - 모두 최신이에요', list.map((u) => u.name).join(', '), null);
      const latest = list.filter((u) => u.state === 'latest').map((u) => u.name);
      return card('updates', 'ok', '업데이트 - 확인된 프로그램은 최신이에요', latest.length ? `${latest.join(', ')} 최신 · 나머지는 업데이트 메뉴에서 확인하세요` : '업데이트 메뉴에서 확인하세요', { kind: 'navigate', target: 'updates', label: '자세히', icon: 'search' });
    },
    async fonts() {
      const r = s.fonts.list();
      if (r.summary.cautionRemovable > 0) return card('fonts', 'warn', `사용 주의 폰트 ${r.summary.cautionRemovable}개`, '학교에서 쓰면 저작권 문제가 될 수 있는 폰트예요.', { kind: 'navigate', target: 'fonts', label: '정리하기', icon: 'font' });
      return card('fonts', 'ok', '폰트 - 문제없어요', '사용 주의 폰트가 없어요.', { kind: 'navigate', target: 'fonts', label: '자세히', icon: 'search' });
    },
    async privacy() {
      const last = s.privacy.lastSummary();
      const scan = { kind: 'navigate', target: 'privacy', label: '지금 검사', icon: 'refresh', autostart: true };
      if (!last) return card('privacy', 'info', '개인정보 파일 - 아직 검사하지 않았어요', '바탕화면·문서·다운로드 폴더를 검사해 보세요.', scan);
      if (last.files > 0) return card('privacy', last.danger > 0 ? 'danger' : 'warn', `개인정보 파일 ${last.files}개가 남아 있어요`, `지난 검사 ${fmtDate(last.at)}`, { kind: 'navigate', target: 'privacy', label: '확인하기', icon: 'file' });
      return card('privacy', 'ok', '개인정보 파일 - 0개', `지난 검사 ${fmtDate(last.at)}`, scan);
    },
    async network() {
      // 점검 때마다 IP를 읽지 않는다. [IP 주소] 화면에서 불러온 값을 보여 준다.
      const l = s.network.last();
      const snap = l.snapshot;
      const go = { kind: 'navigate', target: 'network', label: '자세히', icon: 'link' };
      if (!snap) return card('network', 'info', 'IP 주소·PC 사양 - 아직 불러오지 않았어요', '[IP 주소]에서 [불러오기]를 누르면 IP와 CPU·RAM·SSD·모니터·프린터를 확인해요.', { ...go, label: '불러오기' });
      if (!snap.primary) return card('network', 'warn', '네트워크에 연결되어 있지 않았어요', `${fmtDate(snap.at)}에 불러온 내용이에요.`, go);
      const mode = snap.primary.dhcp ? '자동 IP' : '고정 IP';
      return card('network', 'info', `IP ${snap.primary.ip}`, `${mode}${l.room ? ` · ${l.room}` : ''} · ${fmtDate(snap.at)}에 불러옴`, go);
    },
    async cdrive() {
      const st = s.cdrive.status();
      const d = st.system;
      const go = { kind: 'navigate', target: 'cdrive', label: '정리하기', icon: 'disk' };
      if (!d) return card('cdrive', 'unknown', 'C드라이브 - 확인할 수 없어요', '남은 공간을 읽지 못했어요.', go);
      const left = `${gb(d.total)} 중 ${gb(d.free)} 남음 (${d.freePct}%)`;
      if (d.level === 'danger') return card('cdrive', 'danger', `C드라이브가 거의 꽉 찼어요 (${gb(d.free)} 남음)`, '꽉 차면 PC가 느려져요. 큰 동영상·설치파일을 정리하세요.', go);
      if (d.level === 'warn') return card('cdrive', 'warn', `C드라이브 남은 공간이 적어요 (${gb(d.free)} 남음)`, '더 차기 전에 큰 동영상·설치파일을 정리하세요.', go);
      return card('cdrive', 'ok', 'C드라이브 - 공간이 넉넉해요', left, { ...go, label: '자세히', icon: 'search' });
    },
    async filenames() {
      const q = s.filenames.quickCount();
      const go = { kind: 'navigate', target: 'filenames', label: '정리하기', icon: 'rename', autostart: true };
      if (q.warn) return card('filenames', 'danger', `문서로 위장한 실행 파일 ${q.warn}개가 있어요`, '이름은 문서 같지만 실행 파일이에요. 열지 말고 확인하세요.', { ...go, label: '확인하기', icon: 'warn' });
      if (q.fix) return card('filenames', 'warn', `파일명 정리 - 깨지거나 문제 있는 이름 ${q.fix}개`, '바탕화면·다운로드의 깨진 한글·특수문자·겹친 확장자를 한 번에 고쳐요.', go);
      return card('filenames', 'ok', '파일명 정리 - 깨진 이름이 없어요', '바탕화면·다운로드 파일 이름이 깔끔해요.', { ...go, label: '자세히', icon: 'search' });
    },
    async desktop() {
      const q = s.desktop.quickStatus();
      return card('desktop', 'info', `바탕화면 - 파일 ${q.total}개`, `정리할 파일 ${q.old}개 (최근 ${q.keepDays === 7 ? '1주' : q.keepDays === 14 ? '2주' : q.keepDays === 30 ? '1개월' : '3개월'} 안에 고친 파일은 그대로)`, { kind: 'navigate', target: 'desktop', label: '정리하기', icon: 'folder' });
    },
  };

  async function check(id) {
    if (!checks[id]) return null;
    try { return await checks[id](); } catch { return card(id, 'unknown', '확인할 수 없어요', '이 항목을 점검하지 못했어요.', null); }
  }

  return { ITEMS, check };
}

module.exports = { createDashboard, ITEMS };
