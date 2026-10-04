'use strict';
// 실행 환경에 맞는 플랫폼 어댑터를 고른다.
function createPlatform({ electron, forceMock } = {}) {
  const useMock = forceMock || process.env.SENCLEAN_MOCK === '1' || process.platform !== 'win32';
  if (useMock) return require('./mock').createMockPlatform({});
  return require('./win32').createWin32Platform({ electron });
}
module.exports = { createPlatform };
