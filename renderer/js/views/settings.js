import { h, btn, api, pageHead, select, toast, ago } from '../ui.js';

export default async function settingsView(ctx) {
  const s = await api('settings:get');
  const exclusions = await api('privacy:exclusions');
  const save = async (patch) => { await api('settings:set', patch); toast('저장했어요'); };
  const exBox = h('div', { class: 'items' });
  const drawEx = (list) => exBox.replaceChildren(...(list.length ? list.map((x) => h('div', { class: 'item tone-info' },
    h('div', { class: 'tx' }, h('strong', {}, x.name), h('span', {}, `${x.path} · ${ago(x.at)} 제외`)),
    btn('x', '다시 검사', async () => { await api('privacy:unexclude', x.key); drawEx(await api('privacy:exclusions')); }))) : [h('div', { class: 'muted' }, '없어요')]));
  drawEx(exclusions);
  ctx.main.append(
    pageHead('설정', '학교 규칙에 맞게 기준을 바꿀 수 있어요.', btn('home', '점검 현황으로', () => ctx.go('dashboard'))),
    h('section', { class: 'panel pad' },
      h('div', { class: 'form', style: { gridTemplateColumns: '220px 1fr' } },
        h('label', {}, '나는'), select([['user', '일반 사용자(교사)'], ['admin', '정보부장']], s.role, async (v) => { await api('settings:set', { role: v }); toast(v === 'admin' ? "정보부장으로 바꿨어요. [IP 주소]에 '교실 IP 관리'가 생겼어요" : '일반 사용자로 바꿨어요'); }),
        h('label', {}, 'PC암호 변경 주기'), select([[30, '30일'], [60, '60일'], [90, '90일 (3개월)'], [180, '180일']], s.passwordCycleDays, (v) => save({ passwordCycleDays: Number(v) })),
        h('label', {}, '화면보호기 대기 시간'), select([[5, '5분'], [10, '10분'], [15, '15분']], s.screensaverMinutes, (v) => save({ screensaverMinutes: Number(v) })))),
    h('section', { class: 'panel pad' }, h('div', { class: 'section-title' }, "개인정보 검사에서 '괜찮아요'로 뺀 파일"), exBox),
    h('section', { class: 'panel pad' }, h('div', { class: 'section-title' }, '쎈Clean 원칙'),
      h('div', { class: 'muted' }, '회원가입·광고·결제 없음 · 파일은 PC 밖으로 나가지 않음(업데이트 확인에만 인터넷 사용) · 암호를 저장하지 않음 · 지우기 전에 항상 확인')),
  );
}
