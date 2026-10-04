'use strict';
// 대시보드 카드. 각 항목을 따로 점검해서 끝나는 대로 화면에 채운다. spec 3장
const ITEMS = ['password', 'screensaver', 'browser', 'updates', 'fonts', 'privacy', 'desktop'];

function fmtDate(t) { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일`; }

function createDashboard(s) {
  const card = (id, level, title, desc, action, extra = {}) => ({ id, level, title, desc, action, ...extra });

  const checks = {
    async password() {
      const st = await s.password.status({ refresh: true });
      const go = (label) => ({ kind: 'navigate', target: 'password', label, icon: 'lock' });
      if (st.accountType === 'domain') return card('password', 'info', 'PC암호 - 학교에서 관리하는 계정이에요', '암호는 정보 담당 선생님께 문의하세요.', null);
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
      if (st.managed) return card('screensaver', 'info', '화면보호기 - 학교에서 관리 중이에요', '설정은 정보 담당 선생님께 문의하세요.', { kind: 'navigate', target: 'screensaver', label: '자세히', icon: 'search' });
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
      const out = list.filter((u) => u.state === 'outdated');
      const go = { kind: 'navigate', target: 'updates', label: '업데이트', icon: 'up' };
      if (out.length === 1) {
        const u = out[0];
        return card('updates', 'warn', `${u.name} 업데이트가 있어요`, u.version ? `현재 ${u.version}` : (u.pending ? `설치할 업데이트 ${u.pending}개` : ''), go);
      }
      if (out.length > 1) return card('updates', 'warn', `업데이트할 프로그램 ${out.length}개`, out.map((u) => u.name).join(', '), go);
      if (list.length && list.every((u) => u.state === 'latest')) return card('updates', 'ok', '업데이트 - 모두 최신이에요', list.map((u) => u.name).join(', '), null);
      return card('updates', 'info', '업데이트 - 일부는 확인할 수 없어요', list.filter((u) => u.state === 'unknown').map((u) => u.name).join(', ') + ' 은(는) 직접 확인해 주세요.', { kind: 'navigate', target: 'updates', label: '자세히', icon: 'search' });
    },
    async fonts() {
      const r = s.fonts.list();
      if (r.summary.cautionRemovable > 0) return card('fonts', 'warn', `사용 주의 폰트 ${r.summary.cautionRemovable}개`, '학교에서 쓰려면 라이선스 확인이 필요한 폰트예요.', { kind: 'navigate', target: 'fonts', label: '정리하기', icon: 'font' });
      return card('fonts', 'ok', '폰트 - 문제없어요', r.summary.caution ? `시스템 폰트 중 ${r.summary.caution}개는 정보 담당 선생님 확인이 필요해요.` : '사용 주의 폰트가 없어요.', { kind: 'navigate', target: 'fonts', label: '자세히', icon: 'search' });
    },
    async privacy() {
      const last = s.privacy.lastSummary();
      const scan = { kind: 'navigate', target: 'privacy', label: '지금 검사', icon: 'refresh', autostart: true };
      if (!last) return card('privacy', 'info', '개인정보 파일 - 아직 검사하지 않았어요', '바탕화면·문서·다운로드 폴더를 검사해 보세요.', scan);
      if (last.files > 0) return card('privacy', last.danger > 0 ? 'danger' : 'warn', `개인정보 파일 ${last.files}개가 남아 있어요`, `지난 검사 ${fmtDate(last.at)}`, { kind: 'navigate', target: 'privacy', label: '확인하기', icon: 'file' });
      return card('privacy', 'ok', '개인정보 파일 - 0개', `지난 검사 ${fmtDate(last.at)}`, scan);
    },
    async desktop() {
      const q = s.desktop.quickStatus();
      return card('desktop', 'info', `바탕화면 - 파일 ${q.total}개`, `${q.months}개월 넘게 안 건드린 파일 ${q.old}개`, { kind: 'navigate', target: 'desktop', label: '정리하기', icon: 'folder' });
    },
  };

  async function check(id) {
    if (!checks[id]) return null;
    try { return await checks[id](); } catch { return card(id, 'unknown', '확인할 수 없어요', '이 항목을 점검하지 못했어요.', null); }
  }

  return { ITEMS, check };
}

module.exports = { createDashboard, ITEMS };
