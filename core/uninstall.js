'use strict';
// 프로그램 제거 메뉴: 제어판 '프로그램 제거 또는 변경' 창을 연다. spec 9장
function createUninstallService({ platform }) {
  return { open: () => platform.launch('control.exe', ['appwiz.cpl']) };
}
module.exports = { createUninstallService };
