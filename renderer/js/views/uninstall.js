import { h, btn, api, pageHead, tip } from '../ui.js';

export default async function uninstallView(ctx) {
  ctx.main.append(
    pageHead('프로그램 제거', '설치된 프로그램을 지우거나 바꾸려면 아래 버튼을 누르세요.'),
    h('section', { class: 'panel pad' },
      h('div', { class: 'btn-row' }, btn('trash', '프로그램 제거 창 열기', () => api('uninstall:open'), { variant: 'primary', testid: 'open-appwiz' })),
      h('div', { style: { marginTop: '16px' } }, tip('지울 때 관리자 암호를 물어보면 정보 담당 선생님께 요청하세요.')),
      h('div', { style: { marginTop: '10px' } }, tip('나이스·에듀파인용 보안 프로그램(키보드 보안, 인증서 등)은 지우지 마세요. 다시 접속할 때 또 설치돼요.', 'warn'))),
  );
}
