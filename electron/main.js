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
  const child = utilityProcess.fork(path.join(ROOT, 'core', 'privacy', 'scan-worker.js'), [], { serviceName: '쎈클린 검사', stdio: 'ignore' });
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
    title: '쎈클린',
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
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.loadFile(RENDERER);
}

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
