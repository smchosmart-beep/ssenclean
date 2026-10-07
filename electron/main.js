'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const electron = require('electron');
const { app, BrowserWindow, ipcMain, protocol, net, utilityProcess, session, Menu, dialog } = electron;
const fs = require('fs');
const { createPlatform } = require('../core/platform');
const { createServices } = require('./services');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer', 'index.html');

protocol.registerSchemesAsPrivileged([{ scheme: 'senfont', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let platform = null;

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// 개인정보 검사는 별도 프로세스에서 돌려 화면이 멈추지 않게 한다.
function spawnScan(msg, onEvent) {
  const child = utilityProcess.fork(path.join(ROOT, 'core', 'privacy', 'scan-worker.js'), [], { serviceName: '쎈Clean 검사', stdio: 'ignore' });
  let finished = false;
  child.on('message', (ev) => {
    if (ev.type === 'done' || ev.type === 'error') { finished = true; setTimeout(() => child.kill(), 200); }
    onEvent(ev);
  });
  child.on('exit', () => { if (!finished) { finished = true; onEvent({ type: 'error', message: 'worker-exit' }); } });
  child.postMessage({ type: 'start', ...msg });
  return {
    stop() {
      child.postMessage({ type: 'stop' });
      setTimeout(() => { if (!finished) child.kill(); }, 4000);
    },
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#F2F0EB',
    title: '쎈Clean',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 파일을 창에 끌어다 놓아도 그 파일로 화면이 바뀌지 않게(쎈Clean 화면 주소만 허용)
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
  win.loadFile(RENDERER);
}

// 1.4.0에서 이름이 '쎈클린' → '쎈Clean'으로 바뀌어도 설정·되돌리기 기록은 예전 폴더(%APPDATA%\\쎈클린)를 그대로 쓴다.
try { app.setPath('userData', path.join(app.getPath('appData'), '쎈클린')); } catch { /* ignore */ }

app.whenReady().then(() => {
  platform = createPlatform({ electron });
  if (platform.kind === 'mock') app.setPath('userData', platform.paths.userData);
  const { services, channels } = createServices({ platform, spawnScan, emit });

  channels['privacy:pickFolder'] = async () => {
    const r = await dialog.showOpenDialog(win, { title: '검사할 폴더 고르기', properties: ['openDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  };
  channels['privacy:drives'] = () => {
    if (platform.kind === 'mock') return [platform.root];
    const out = [];
    for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const d = `${c}:\\`; try { fs.accessSync(d); out.push(d); } catch { /* none */ } }
    return out;
  };

  // 교실 IP 목록 CSV 내보내기·가져오기(파일 위치는 사용자가 고른다)
  channels['registry:exportCsv'] = async () => {
    const d = new Date();
    const name = `교실IP목록_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
    const r = await dialog.showSaveDialog(win, { title: '교실 IP 목록 저장', defaultPath: path.join(platform.paths.documents, name), filters: [{ name: 'CSV(엑셀)', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, services.network.exportCsv(), 'utf8');
    return { ok: true, path: r.filePath };
  };
  // 교사: IP·사양을 파일(.txt)로 저장해 정보부장에게 보내기
  channels['network:saveFile'] = async (room) => {
    const f = await services.network.messageFile(room);
    const r = await dialog.showSaveDialog(win, { title: '정보부장에게 보낼 파일 저장', defaultPath: path.join(platform.paths.desktop, f.fileName), filters: [{ name: '텍스트 파일', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, f.content, 'utf8');
    return { ok: true, path: r.filePath, name: path.basename(r.filePath) };
  };
  // 정보부장: 받은 파일 여러 개를 한꺼번에(파일 고르기 창)
  const readText = (file) => {
    const buf = fs.readFileSync(file);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\ufeff/, ''); } catch { return new TextDecoder('euc-kr').decode(buf); }
  };
  channels['registry:importFiles'] = async () => {
    const r = await dialog.showOpenDialog(win, { title: '선생님들이 보낸 IP 정보 파일 고르기(여러 개 가능)', properties: ['openFile', 'multiSelections'], filters: [{ name: '텍스트 파일', extensions: ['txt'] }] });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const files = r.filePaths.slice(0, 500).map((p) => { try { return fs.statSync(p).size > 256 * 1024 ? { name: path.basename(p), text: '' } : { name: path.basename(p), text: readText(p) }; } catch { return { name: path.basename(p), text: '' }; } });
    return services.network.registryImportMany(files);
  };
  channels['registry:importCsv'] = async () => {
    const r = await dialog.showOpenDialog(win, { title: '교실 IP 목록 가져오기', properties: ['openFile'], filters: [{ name: 'CSV(엑셀)', extensions: ['csv'] }] });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const buf = fs.readFileSync(r.filePaths[0]);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('euc-kr').decode(buf); }
    return services.network.importCsv(text);
  };

  Menu.setApplicationMenu(null);

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' senfont:; img-src 'self' data:; connect-src 'none'; object-src 'none'"] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  // 폰트 미리보기: 마지막 목록에 있는 폰트 파일만 내보낸다.
  protocol.handle('senfont', async (req) => {
    const id = new URL(req.url).hostname;
    const file = services.fonts.fileFor(id);
    if (!file) return new Response('', { status: 404 });
    const r = await net.fetch(pathToFileURL(file).toString());
    const body = await r.arrayBuffer();
    return new Response(body, { status: 200, headers: { 'Content-Type': 'font/ttf', 'Access-Control-Allow-Origin': '*' } });
  });

  for (const [ch, fn] of Object.entries(channels)) {
    ipcMain.handle(ch, async (event, arg) => {
      const url = event.senderFrame && event.senderFrame.url;
      if (!url || !url.startsWith('file://')) throw new Error('blocked');
      return fn(arg);
    });
  }

  createWindow();
  global.__sen = { platform, services }; // 자동 테스트에서만 사용
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
