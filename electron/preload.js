'use strict';
// 화면에 노출하는 API. 정해진 채널만 호출·구독할 수 있다.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = [
  'app:info', 'app:openExternal', 'settings:get', 'settings:set',
  'dashboard:items', 'dashboard:check',
  'privacy:roots', 'privacy:start', 'privacy:stop', 'privacy:results', 'privacy:delete', 'privacy:exclude', 'privacy:exclusions', 'privacy:unexclude', 'privacy:reveal', 'privacy:openTrash', 'privacy:last', 'privacy:pickFolder', 'privacy:drives',
  'fonts:list', 'fonts:running', 'fonts:clean', 'fonts:undo', 'fonts:installSchool',
  'password:status', 'password:change', 'password:setDate', 'password:openSettings', 'password:openMicrosoft',
  'screensaver:status', 'screensaver:secure', 'screensaver:undo', 'screensaver:open',
  'updates:check', 'updates:run',
  'uninstall:open',
  'desktop:status', 'desktop:plan', 'desktop:apply', 'desktop:undo', 'desktop:history', 'desktop:openArchive',
  'browser:scan', 'browser:fix', 'browser:undo', 'browser:reset', 'browser:running', 'browser:close', 'browser:sizes', 'browser:clean',
  'app:copy', 'app:paste',
  'network:info', 'network:myMessage', 'network:parse', 'network:apply', 'network:validate', 'network:undo', 'network:check',
  'registry:list', 'registry:import', 'registry:update', 'registry:delete', 'registry:defaults', 'registry:assign', 'registry:exportCsv', 'registry:importCsv',
];
const EVENTS = ['privacy:event', 'desktop:progress', 'updates:progress'];

contextBridge.exposeInMainWorld('sen', {
  invoke(channel, arg) {
    if (!INVOKE.includes(channel)) return Promise.reject(new Error('blocked channel'));
    return ipcRenderer.invoke(channel, arg);
  },
  on(channel, fn) {
    if (!EVENTS.includes(channel)) return () => {};
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
