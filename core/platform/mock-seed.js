'use strict';
// 가짜 교사 PC를 만든다. 바탕화면·문서·폰트·레지스트리·브라우저 프로필 등.
const fs = require('fs');
const path = require('path');
const F = require('./mock-fixtures');

const DAY = 86400000;
const REG = { SZ: 1, EXPAND_SZ: 2, BINARY: 3, DWORD: 4 };

function write(file, data, ageDays) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  if (ageDays != null) {
    const t = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(file, t, t);
  }
}

// 큰 파일은 내용 없이 크기만 잡는다(희소 파일). 실제 디스크는 거의 쓰지 않는다.
function big(file, bytes, ageDays) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, bytes);
  fs.closeSync(fd);
  if (ageDays != null) { const t = new Date(Date.now() - ageDays * DAY); fs.utimesSync(file, t, t); }
}
const GB = 1024 ** 3, MB = 1024 ** 2;

function seedMock(root, P) {
  fs.mkdirSync(root, { recursive: true });
  const N = (n, rrn, phone) => [n, rrn, phone];

  // ── 바탕화면 ──
  const D = P.desktop;
  write(path.join(D, '3학년 2반 명단.xlsx'), F.xlsx({ '명단': [['번호', '이름', '주민등록번호', '보호자 연락처'], N(1, '900101-1234567', '010-1234-5678'), N(2, '050315-4123456', '010-9876-5432'), N(3, '091231-3012345', '010-5555-0000')] }), 400);
  write(path.join(D, '학부모 상담 기록.hwp'), F.hwp(['2학기 상담 기록', '학부모 연락처 010-2222-3333 으로 회신 요청', '환불 계좌: 국민은행 123456-01-234567 예금주 홍길동']), 200);
  write(path.join(D, '가정통신문 초안.hwpx'), F.hwpx(['가을 현장체험학습 안내', '문의: 교무실']), 20);
  write(path.join(D, '현장체험 동의서 회신.docx'), F.docx(['동의서 회신 명단', '김민지 보호자 010-3333-4444', '이메일 parent.kim@example.com']), 120);
  write(path.join(D, '방과후 수강료 정리.xls'), F.xls({ Sheet1: [['이름', '계좌'], ['이영희', '신한 110-234-567890']] }), 500);
  write(path.join(D, '학급 운영 계획.pptx'), F.pptx([['2026 학급 운영 계획'], ['우리 반 규칙']]), 230);
  write(path.join(D, '연수 이수증.pdf'), F.pdf(['Certificate of completion', 'Teacher training 2025']), 300);
  write(path.join(D, '교직원 비상연락망.pdf'), F.pdf(['Emergency contact list', 'Kim 010-7777-8888', 'Lee 010-1111-2222']), 60);
  write(path.join(D, '스캔_동의서.pdf'), F.scannedPdf(), 90);
  write(path.join(D, '현장학습 사진.jpg'), Buffer.from('fakejpg-01'), 150);
  write(path.join(D, '현장학습 사진 - 복사본.jpg'), Buffer.from('fakejpg-01'), 140);
  write(path.join(D, '운동회 영상.mp4'), Buffer.alloc(2048, 7), 380);
  write(path.join(D, 'HncSetup_2024.exe'), Buffer.from('MZ-installer'), 250);
  write(path.join(D, 'ZoomInstaller.exe'), Buffer.from('MZ-zoom'), 180);
  write(path.join(D, '수업자료 모음.zip'), F.zip({ 'a.txt': 'hello' }), 210);
  fs.mkdirSync(path.join(D, '수업자료 모음'), { recursive: true });
  write(path.join(D, '메모.txt'), Buffer.from('회의 메모\n다음 주 월요일 학년 협의회\n'), 2);
  write(path.join(D, '오늘 할 일.txt'), Buffer.from('공문 확인'), 0);
  // 바로가기 (가짜 .lnk = JSON)
  const chromeExe = path.join(P.programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
  const edgeExe = path.join(P.programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  write(chromeExe, 'exe');
  write(edgeExe, 'exe');
  write(path.join(D, 'Chrome.lnk'), JSON.stringify({ target: chromeExe, args: 'http://start.best-deal-search.example/?src=adw' }));
  write(path.join(D, 'Microsoft Edge.lnk'), JSON.stringify({ target: edgeExe, args: '' }));
  write(path.join(D, '나이스.lnk'), JSON.stringify({ target: chromeExe, args: '--app=https://sen.neis.go.kr' }));
  write(path.join(D, '옛날 프로그램.lnk'), JSON.stringify({ target: path.join(P.programFiles, 'OldTool', 'old.exe'), args: '' }));
  write(path.join(D, '최저가 쇼핑.url'), '[InternetShortcut]\r\nURL=https://shop.best-deal-search.example/?src=adw&subid=22\r\n');
  write(path.join(D, '오늘의 특가.url'), '[InternetShortcut]\r\nURL=http://www.delta-search.com/deal\r\n');
  write(path.join(D, '학교 홈페이지.url'), '[InternetShortcut]\r\nURL=https://sangmyung.es.kr/\r\n');
  write(path.join(D, 'desktop.ini'), '[.ShellClassInfo]');

  // ── 문서·다운로드 ──
  write(path.join(P.documents, '2025 업무', '학생 기초조사서.hwp'), F.hwp(['학생 기초조사서', '학생 주민번호 150707-3123456', '보호자 휴대전화 010-4444-5555']), 380);
  write(path.join(P.documents, '2025 업무', '여권 사본 정리.docx'), F.docx(['해외연수 참가자', '여권번호 M12345678']), 300);
  write(path.join(P.documents, '2025 업무', '배포용 문서.hwp'), F.hwp(['배포용'], { distribution: true }), 100);
  write(path.join(P.documents, '수업', '국어 학습지.hwpx'), F.hwpx(['5학년 국어 학습지', '문장 성분 알아보기']), 30);
  write(path.join(P.documents, '수업', '번호 연습.txt'), Buffer.from('측정값 1234567890123\n문서번호 2025-0101-123456\n'), 40);
  write(path.join(P.downloads, '연락처 명단(1).csv'), Buffer.from('﻿이름,연락처\n김철수,010-8888-9999\n'), 70);
  write(path.join(P.downloads, '깨진 파일.xlsx'), Buffer.from('this is not a zip'), 10);

  // ── 폰트 ──
  const fontDir = path.join(__dirname, 'mock-fonts');
  const userFonts = {};
  for (const f of (fs.existsSync(fontDir) ? fs.readdirSync(fontDir) : [])) {
    const dest = path.join(P.userFonts, f);
    write(dest, fs.readFileSync(path.join(fontDir, f)));
    userFonts[path.basename(f, '.ttf') + ' (TrueType)'] = { type: REG.SZ, value: dest };
  }
  const sysFonts = {};
  const assetFonts = path.join(__dirname, '..', '..', 'assets', 'fonts');
  for (const f of ['Cafe24PROSlim-Air.otf']) {
    const src = path.join(assetFonts, f);
    if (fs.existsSync(src)) {
      write(path.join(P.windowsFonts, f), fs.readFileSync(src));
      sysFonts['Cafe24 PRO Slim Air (TrueType)'] = { type: REG.SZ, value: f };
    }
  }
  if (fs.existsSync(path.join(fontDir, 'SandollTestGothic.ttf'))) {
    write(path.join(P.windowsFonts, 'SandollSystem.ttf'), fs.readFileSync(path.join(fontDir, 'SandollTestGothic.ttf')));
    sysFonts['Sandoll System (TrueType)'] = { type: REG.SZ, value: 'SandollSystem.ttf' };
  }

  // ── 한컴오피스 ──
  const hncUpdater = path.join(P.programFilesX86, 'Hnc', 'Office 2022', 'HncUtils', 'Service', 'HncUpdater.exe');
  const hwpExe = path.join(P.programFilesX86, 'Hnc', 'Office 2022', 'HOffice120', 'Bin', 'Hwp.exe');
  write(hncUpdater, 'MZ'); write(hwpExe, 'MZ');

  // ── 광고 프로그램 흔적 ──
  const shopAlarm = path.join(P.localAppData, 'ShopAlarm', 'shopalarm.exe');
  const shopUpd = path.join(P.localAppData, 'ShopAlarm', 'update.exe');
  write(shopAlarm, 'MZ'); write(shopUpd, 'MZ');
  const kakao = path.join(P.localAppData, 'Kakao', 'KakaoTalk', 'KakaoTalk.exe');
  write(kakao, 'MZ');
  write(path.join(P.startup, '쇼핑 알리미.lnk'), JSON.stringify({ target: shopAlarm, args: '/tray' }));
  write(path.join(P.startMenu, 'Google Chrome.lnk'), JSON.stringify({ target: chromeExe, args: '' }));

  // ── 브라우저 프로필 ──
  const prof = path.join(P.browserData.chrome, 'Default');
  write(path.join(P.browserData.chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: '사용자 1' } } } }));
  write(path.join(prof, 'Preferences'), JSON.stringify({
    session: { restore_on_startup: 4, startup_urls: ['http://start.best-deal-search.example/home'] },
    default_search_provider_data: { template_url_data: { url: 'http://search.best-deal-search.example/q={searchTerms}', short_name: 'Deal Search' } },
    extensions: { settings: {
      abcdefghijklmnopabcdefghijklmnop: { from_webstore: false, location: 4, manifest: { name: 'Shopping Helper', version: '1.0' }, state: 1 },
      bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: { from_webstore: true, location: 1, manifest: { name: 'Google 번역', version: '2.0' }, state: 1 },
    } },
  }));
  write(path.join(prof, 'History'), Buffer.alloc(300000, 1));
  write(path.join(prof, 'Cache', 'Cache_Data', 'data_1'), Buffer.alloc(1500000, 2));
  write(path.join(prof, 'Code Cache', 'js', 'a'), Buffer.alloc(400000, 3));
  write(path.join(prof, 'Network', 'Cookies'), Buffer.alloc(80000, 4));
  write(path.join(prof, 'Login Data'), Buffer.alloc(1000, 5));
  const eprof = path.join(P.browserData.edge, 'Default');
  write(path.join(P.browserData.edge, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: '프로필 1' } } } }));
  write(path.join(eprof, 'Preferences'), JSON.stringify({ session: { restore_on_startup: 1 }, extensions: { settings: {} } }));
  write(path.join(eprof, 'History'), Buffer.alloc(120000, 1));
  write(path.join(eprof, 'Cache', 'Cache_Data', 'data_1'), Buffer.alloc(600000, 2));

  // ── C드라이브의 큰 파일 ──
  big(path.join(P.home, 'Videos', '운동회 전체 촬영.mp4'), Math.round(3.2 * GB), 330);
  big(path.join(P.home, 'Videos', '2학기 공개수업.mp4'), Math.round(1.8 * GB), 40);
  big(path.join(P.documents, '수업자료', '과학 실험 영상.mkv'), 420 * MB, 200);
  big(path.join(P.documents, '수업자료', '동요 반주.mp4'), 30 * MB, 100); // 기준(50MB)보다 작음
  big(path.join(P.downloads, 'Windows10_22H2.iso'), Math.round(5.1 * GB), 500);
  big(path.join(P.downloads, '한컴오피스2022_설치.exe'), 950 * MB, 300);
  big(path.join(P.downloads, 'ZoomInstallerFull.msi'), 85 * MB, 150);
  big(path.join(P.downloads, '그림판도구.exe'), 40 * MB, 150); // 설치파일 이름이 아니지만 다운로드 폴더에 있음
  big(path.join(root, '자료', '졸업식 2025.mov'), Math.round(2.4 * GB), 260);
  big(path.join(P.localAppData, 'Temp', 'cache_video.mp4'), 600 * MB, 10); // AppData는 건드리지 않음
  big(path.join(P.programFiles, 'Vendor', 'big_setup.exe'), 300 * MB, 10); // Program Files도 건드리지 않음
  fs.mkdirSync(path.join(root, '_D'), { recursive: true });

  const HKCU = 'HKCU\\Software';
  const state = {
    disks: { C: { total: 238 * GB, free: 9 * GB }, D: { total: 931 * GB, free: 612 * GB } },
    account: { type: 'local', password: '', passwordSetAt: null, minLength: 4 },
    processes: ['explorer.exe', 'chrome.exe'],
    lockedFiles: [],
    cloudOnly: [],
    offline: false,
    chromeLatest: '141.0.7390.65',
    chromeUpdate: { available: true, version: '140.0.7339.128' },
    network: {
      reachable: ['10.20.3.1', '10.20.3.254'],
      adapters: [
        { index: 12, alias: '이더넷', desc: 'Realtek PCIe GbE Family Controller', mac: '00-1A-2B-3C-4D-5E', ip: '10.20.3.42', prefix: 24, gateway: '10.20.3.1', dns: ['10.20.0.1', '10.20.0.2'], dhcp: false, virtual: false, hardware: true, media: '802.3', wifi: false },
        { index: 25, alias: 'vEthernet (Default Switch)', desc: 'Hyper-V Virtual Ethernet Adapter', mac: '00-15-5D-01-02-03', ip: '172.28.0.1', prefix: 20, gateway: '', dns: [], dhcp: false, virtual: true, hardware: false, media: '802.3', wifi: false },
      ],
    },
    windowsUpdate: { lastInstalled: new Date(Date.now() - 12 * DAY).toISOString(), pending: 0 },
    fileVersions: { [chromeExe]: '128.0.6613.120', [path.join(P.programFilesX86, 'Hnc', 'Office 2022', 'HOffice120', 'Bin', 'Hwp.exe')]: '12.0.0.3650' },
    signatures: {
      [shopAlarm]: { signed: false, company: '', created: new Date(Date.now() - 9 * DAY).toISOString() },
      [shopUpd]: { signed: false, company: '', created: new Date(Date.now() - 9 * DAY).toISOString() },
      [kakao]: { signed: true, company: 'Kakao Corp.', created: new Date(Date.now() - 500 * DAY).toISOString() },
    },
    tasks: [
      { name: 'ShopAlarmUpdate', path: '\\', user: 'teacher', state: 'Ready', author: '', actions: [{ exec: shopUpd, args: '/silent' }] },
      { name: 'GoogleUpdateTaskUserS-1-5-21', path: '\\', user: 'teacher', state: 'Ready', author: 'Google LLC', actions: [{ exec: path.join(P.localAppData, 'Google', 'Update', 'GoogleUpdate.exe'), args: '/c' }] },
    ],
    registry: {
      'HKCU\\Control Panel\\Desktop': {
        ScreenSaveActive: { type: REG.SZ, value: '0' },
        ScreenSaveTimeOut: { type: REG.SZ, value: '900' },
        ScreenSaverIsSecure: { type: REG.SZ, value: '0' },
      },
      [`${HKCU}\\Microsoft\\Windows\\CurrentVersion\\Run`]: {
        ShopAlarm: { type: REG.SZ, value: `"${shopAlarm}" /startup` },
        KakaoTalk: { type: REG.SZ, value: `"${kakao}" -bystartup` },
      },
      [`${HKCU}\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run`]: {},
      [`${HKCU}\\Microsoft\\Windows NT\\CurrentVersion\\Fonts`]: userFonts,
      'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts': sysFonts,
      [`${HKCU}\\Google\\Chrome\\BLBeacon`]: { version: { type: REG.SZ, value: '128.0.6613.120' } },
      'HKLM\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration': { VersionToReport: { type: REG.SZ, value: '16.0.17928.20156' } },
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{HNC-OFFICE-2022}': {
        DisplayName: { type: REG.SZ, value: '한컴오피스 2022' }, DisplayVersion: { type: REG.SZ, value: '12.0.0.3345' }, Publisher: { type: REG.SZ, value: 'Hancom' },
      },
      [`${HKCU}\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ShopAlarm`]: {
        DisplayName: { type: REG.SZ, value: 'ShopAlarm 쇼핑 알리미' }, Publisher: { type: REG.SZ, value: '' },
        UninstallString: { type: REG.SZ, value: `"${path.join(P.localAppData, 'ShopAlarm', 'uninstall.exe')}"` },
      },
      [`${HKCU}\\Microsoft\\Windows\\CurrentVersion\\Internet Settings`]: {
        ProxyEnable: { type: REG.DWORD, value: 1 }, ProxyServer: { type: REG.SZ, value: '127.0.0.1:8899' },
      },
    },
    log: [],
  };
  fs.writeFileSync(path.join(root, 'mock-state.json'), JSON.stringify(state, null, 1));
}

module.exports = { seedMock };
