// Electron 화면 테스트. 가짜 PC(mock)에서 실행한다.
module.exports = {
  testDir: './tests/e2e',
  timeout: 90000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off' },
};
