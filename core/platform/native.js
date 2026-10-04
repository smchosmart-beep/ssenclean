'use strict';
// Windows 네이티브 API 바인딩 (koffi). Windows에서만 로드된다.
// 모든 함수는 실패 시 예외 대신 null/false를 돌려주고, 호출하는 쪽에서 "확인할 수 없어요"로 처리한다.

let lib = null;

function load() {
  if (lib) return lib;
  const koffi = require('koffi');
  const advapi = koffi.load('advapi32.dll');
  const kernel = koffi.load('kernel32.dll');
  const netapi = koffi.load('netapi32.dll');
  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  const shell32 = koffi.load('shell32.dll');

  const SHQUERYRBINFO = koffi.struct('SHQUERYRBINFO', { cbSize: 'uint32', i64Size: 'int64', i64NumItems: 'int64' });

  const USER_INFO_1 = koffi.struct('USER_INFO_1', {
    usri1_name: 'void *',
    usri1_password: 'void *',
    usri1_password_age: 'uint32',
    usri1_priv: 'uint32',
    usri1_home_dir: 'void *',
    usri1_comment: 'void *',
    usri1_flags: 'uint32',
    usri1_script_path: 'void *',
  });

  lib = {
    koffi,
    USER_INFO_1,
    SHQUERYRBINFO,
    // registry
    RegOpenKeyExW: advapi.func('long __stdcall RegOpenKeyExW(intptr hKey, str16 lpSubKey, uint32 ulOptions, uint32 samDesired, _Out_ intptr *phkResult)'),
    RegCreateKeyExW: advapi.func('long __stdcall RegCreateKeyExW(intptr hKey, str16 lpSubKey, uint32 Reserved, str16 lpClass, uint32 dwOptions, uint32 samDesired, void *lpSecurityAttributes, _Out_ intptr *phkResult, _Out_ uint32 *lpdwDisposition)'),
    RegCloseKey: advapi.func('long __stdcall RegCloseKey(intptr hKey)'),
    RegQueryValueExW: advapi.func('long __stdcall RegQueryValueExW(intptr hKey, str16 lpValueName, void *lpReserved, _Out_ uint32 *lpType, void *lpData, _Inout_ uint32 *lpcbData)'),
    RegEnumValueW: advapi.func('long __stdcall RegEnumValueW(intptr hKey, uint32 dwIndex, void *lpValueName, _Inout_ uint32 *lpcchValueName, void *lpReserved, _Out_ uint32 *lpType, void *lpData, _Inout_ uint32 *lpcbData)'),
    RegEnumKeyExW: advapi.func('long __stdcall RegEnumKeyExW(intptr hKey, uint32 dwIndex, void *lpName, _Inout_ uint32 *lpcchName, void *lpReserved, void *lpClass, void *lpcchClass, void *lpftLastWriteTime)'),
    RegSetValueExW: advapi.func('long __stdcall RegSetValueExW(intptr hKey, str16 lpValueName, uint32 Reserved, uint32 dwType, void *lpData, uint32 cbData)'),
    RegDeleteValueW: advapi.func('long __stdcall RegDeleteValueW(intptr hKey, str16 lpValueName)'),
    // account
    LogonUserW: advapi.func('int __stdcall LogonUserW(str16 lpszUsername, str16 lpszDomain, str16 lpszPassword, uint32 dwLogonType, uint32 dwLogonProvider, _Out_ intptr *phToken)'),
    CloseHandle: kernel.func('int __stdcall CloseHandle(intptr hObject)'),
    GetLastError: kernel.func('uint32 __stdcall GetLastError()'),
    GetFileAttributesW: kernel.func('uint32 __stdcall GetFileAttributesW(str16 lpFileName)'),
    NetUserGetInfo: netapi.func('uint32 __stdcall NetUserGetInfo(str16 servername, str16 username, uint32 level, _Out_ void **bufptr)'),
    NetApiBufferFree: netapi.func('uint32 __stdcall NetApiBufferFree(void *Buffer)'),
    NetUserChangePassword: netapi.func('uint32 __stdcall NetUserChangePassword(str16 domainname, str16 username, str16 oldpassword, str16 newpassword)'),
    // system params / fonts
    SystemParametersInfoW: user32.func('int __stdcall SystemParametersInfoW(uint32 uiAction, uint32 uiParam, void *pvParam, uint32 fWinIni)'),
    SendMessageTimeoutW: user32.func('intptr __stdcall SendMessageTimeoutW(intptr hWnd, uint32 Msg, uintptr wParam, intptr lParam, uint32 fuFlags, uint32 uTimeout, _Out_ uintptr *lpdwResult)'),
    AddFontResourceW: gdi32.func('int __stdcall AddFontResourceW(str16 lpFileName)'),
    RemoveFontResourceW: gdi32.func('int __stdcall RemoveFontResourceW(str16 lpFileName)'),
    // disks / recycle bin
    GetDriveTypeW: kernel.func('uint32 __stdcall GetDriveTypeW(str16 lpRootPathName)'),
    GetDiskFreeSpaceExW: kernel.func('int __stdcall GetDiskFreeSpaceExW(str16 lpDirectoryName, _Out_ uint64 *lpFreeBytesAvailable, _Out_ uint64 *lpTotalNumberOfBytes, _Out_ uint64 *lpTotalNumberOfFreeBytes)'),
    GetVolumeInformationW: kernel.func('int __stdcall GetVolumeInformationW(str16 lpRootPathName, void *lpVolumeNameBuffer, uint32 nVolumeNameSize, void *lpSerial, void *lpMaxLen, void *lpFlags, void *lpFsName, uint32 nFsNameSize)'),
    SHQueryRecycleBinW: shell32.func('int32 __stdcall SHQueryRecycleBinW(str16 pszRootPath, _Inout_ SHQUERYRBINFO *pSHQueryRBInfo)'),
    SHEmptyRecycleBinW: shell32.func('int32 __stdcall SHEmptyRecycleBinW(intptr hwnd, str16 pszRootPath, uint32 dwFlags)'),
  };
  return lib;
}

// ── Registry ──────────────────────────────────────────────
const HIVES = {
  HKCU: 0x80000001, HKEY_CURRENT_USER: 0x80000001,
  HKLM: 0x80000002, HKEY_LOCAL_MACHINE: 0x80000002,
};
const KEY_READ = 0x20019;
const KEY_WRITE = 0x20006;
const KEY_WOW64_64KEY = 0x0100;
const REG = { SZ: 1, EXPAND_SZ: 2, BINARY: 3, DWORD: 4, MULTI_SZ: 7, QWORD: 11 };

function splitKey(fullKey) {
  const i = fullKey.indexOf('\\');
  const hive = HIVES[fullKey.slice(0, i)];
  if (!hive) throw new Error('unknown hive: ' + fullKey);
  return { hive, sub: fullKey.slice(i + 1) };
}

function openKey(fullKey, write = false, create = false) {
  const L = load();
  const { hive, sub } = splitKey(fullKey);
  const out = [0];
  const sam = (write ? KEY_WRITE | KEY_READ : KEY_READ) | KEY_WOW64_64KEY;
  let rc;
  if (create) rc = L.RegCreateKeyExW(hive, sub, 0, null, 0, sam, null, out, [0]);
  else rc = L.RegOpenKeyExW(hive, sub, 0, sam, out);
  if (rc !== 0) return null;
  return out[0];
}

function decodeValue(type, buf, len) {
  const b = buf.subarray(0, len);
  switch (type) {
    case REG.SZ:
    case REG.EXPAND_SZ:
      return b.toString('utf16le').replace(/\0+$/, '');
    case REG.MULTI_SZ:
      return b.toString('utf16le').replace(/\0+$/, '').split('\0');
    case REG.DWORD:
      return len >= 4 ? b.readUInt32LE(0) : 0;
    case REG.QWORD:
      return len >= 8 ? Number(b.readBigUInt64LE(0)) : 0;
    default:
      return Buffer.from(b);
  }
}

function regRead(fullKey, name) {
  try {
    const L = load();
    const h = openKey(fullKey);
    if (h == null) return undefined;
    try {
      let size = 4096;
      for (let attempt = 0; attempt < 3; attempt++) {
        const buf = Buffer.alloc(size);
        const type = [0];
        const cb = [size];
        const rc = L.RegQueryValueExW(h, name, null, type, buf, cb);
        if (rc === 0) return { type: type[0], value: decodeValue(type[0], buf, cb[0]) };
        if (rc === 234) { size = cb[0] + 16; continue; } // ERROR_MORE_DATA
        return undefined;
      }
      return undefined;
    } finally { L.RegCloseKey(h); }
  } catch { return undefined; }
}

function regValues(fullKey) {
  try {
    const L = load();
    const h = openKey(fullKey);
    if (h == null) return null;
    const out = {};
    try {
      for (let i = 0; i < 5000; i++) {
        const nameBuf = Buffer.alloc(32768 * 2);
        const cch = [32767];
        const type = [0];
        let dataBuf = Buffer.alloc(16384);
        const cb = [dataBuf.length];
        let rc = L.RegEnumValueW(h, i, nameBuf, cch, null, type, dataBuf, cb);
        if (rc === 234) {
          dataBuf = Buffer.alloc(cb[0] + 16);
          cch[0] = 32767; cb[0] = dataBuf.length;
          rc = L.RegEnumValueW(h, i, nameBuf, cch, null, type, dataBuf, cb);
        }
        if (rc === 259) break; // ERROR_NO_MORE_ITEMS
        if (rc !== 0) break;
        const name = nameBuf.subarray(0, cch[0] * 2).toString('utf16le');
        out[name] = { type: type[0], value: decodeValue(type[0], dataBuf, cb[0]) };
      }
    } finally { L.RegCloseKey(h); }
    return out;
  } catch { return null; }
}

function regSubkeys(fullKey) {
  try {
    const L = load();
    const h = openKey(fullKey);
    if (h == null) return null;
    const out = [];
    try {
      for (let i = 0; i < 20000; i++) {
        const nameBuf = Buffer.alloc(512 * 2);
        const cch = [511];
        const rc = L.RegEnumKeyExW(h, i, nameBuf, cch, null, null, null, null);
        if (rc !== 0) break;
        out.push(nameBuf.subarray(0, cch[0] * 2).toString('utf16le'));
      }
    } finally { L.RegCloseKey(h); }
    return out;
  } catch { return null; }
}

function encodeValue(type, value) {
  switch (type) {
    case REG.SZ:
    case REG.EXPAND_SZ:
      return Buffer.from(String(value) + '\0', 'utf16le');
    case REG.MULTI_SZ:
      return Buffer.from([].concat(value).join('\0') + '\0\0', 'utf16le');
    case REG.DWORD: { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }
    case REG.QWORD: { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
    default:
      return Buffer.from(value);
  }
}

function regWrite(fullKey, name, type, value) {
  try {
    const L = load();
    const h = openKey(fullKey, true, true);
    if (h == null) return false;
    try {
      const data = encodeValue(type, value);
      return L.RegSetValueExW(h, name, 0, type, data, data.length) === 0;
    } finally { L.RegCloseKey(h); }
  } catch { return false; }
}

function regDelete(fullKey, name) {
  try {
    const L = load();
    const h = openKey(fullKey, true);
    if (h == null) return false;
    try {
      const rc = L.RegDeleteValueW(h, name);
      return rc === 0 || rc === 2;
    } finally { L.RegCloseKey(h); }
  } catch { return false; }
}

// ── Account ───────────────────────────────────────────────
// 반환: true(암호 있음) / false(암호 없음) / null(판단 불가)
function hasPassword(user) {
  try {
    const L = load();
    const tok = [0];
    const ok = L.LogonUserW(user, '.', '', 2 /* INTERACTIVE */, 0 /* DEFAULT */, tok);
    const err = ok ? 0 : L.GetLastError();
    if (ok) { L.CloseHandle(tok[0]); return false; }
    if (err === 1327) return false; // ERROR_ACCOUNT_RESTRICTION: 빈 암호 제한
    if (err === 1326) return true;  // ERROR_LOGON_FAILURE: 암호가 맞지 않음 = 암호 있음
    return null;
  } catch { return null; }
}

// 반환: 암호가 설정된 뒤 지난 초(seconds) 또는 null
function passwordAgeSeconds(user) {
  try {
    const L = load();
    const out = [null];
    const rc = L.NetUserGetInfo(null, user, 1, out);
    if (rc !== 0 || !out[0]) return null;
    try {
      const info = L.koffi.decode(out[0], L.USER_INFO_1);
      return info.usri1_password_age;
    } finally { L.NetApiBufferFree(out[0]); }
  } catch { return null; }
}

// 반환 코드: 'ok' | 'wrong-password' | 'policy' | 'denied' | 'error'
function changePassword(user, oldPw, newPw) {
  try {
    const L = load();
    const rc = L.NetUserChangePassword(null, user, oldPw, newPw);
    if (rc === 0) return 'ok';
    if (rc === 86) return 'wrong-password';
    if (rc === 2245) return 'policy';
    if (rc === 5) return 'denied';
    return 'error:' + rc;
  } catch { return 'error'; }
}

// ── System params ─────────────────────────────────────────
const SPI = { SETSCREENSAVEACTIVE: 0x0011, SETSCREENSAVETIMEOUT: 0x000F, SETSCREENSAVESECURE: 0x0077 };
function applyScreenSaver({ active, timeoutSec, secure }) {
  try {
    const L = load();
    const f = 0x01 | 0x02; // SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
    L.SystemParametersInfoW(SPI.SETSCREENSAVETIMEOUT, timeoutSec, null, f);
    L.SystemParametersInfoW(SPI.SETSCREENSAVESECURE, secure ? 1 : 0, null, f);
    L.SystemParametersInfoW(SPI.SETSCREENSAVEACTIVE, active ? 1 : 0, null, f);
    return true;
  } catch { return false; }
}

function addFont(path) { try { return load().AddFontResourceW(path) > 0; } catch { return false; } }
function removeFont(path) { try { return load().RemoveFontResourceW(path) > 0; } catch { return false; } }
function broadcastFontChange() {
  try { load().SendMessageTimeoutW(0xffff, 0x001D, 0, 0, 0x0002, 1000, [0]); return true; } catch { return false; }
}

const FILE_ATTR = { HIDDEN: 0x2, SYSTEM: 0x4, OFFLINE: 0x1000, RECALL_ON_OPEN: 0x40000, RECALL_ON_DATA_ACCESS: 0x400000, INVALID: 0xFFFFFFFF };
function fileAttributes(path) {
  try {
    const a = load().GetFileAttributesW(path);
    return a === FILE_ATTR.INVALID ? null : a;
  } catch { return null; }
}

// ── Disks / Recycle bin ──────────────────────────────────
// 드라이브 종류: 2 이동식(USB), 3 고정(하드디스크·SSD). 네트워크·CD는 빼고 돌려준다.
function disks() {
  const out = [];
  let L;
  try { L = load(); } catch { return out; }
  for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${c}:\\`;
    try {
      const type = L.GetDriveTypeW(root);
      if (type !== 2 && type !== 3) continue;
      const avail = [0], total = [0], free = [0];
      if (!L.GetDiskFreeSpaceExW(root, avail, total, free)) continue;
      let label = '';
      try {
        const buf = Buffer.alloc(261 * 2);
        if (L.GetVolumeInformationW(root, buf, 261, null, null, null, null, 0)) label = buf.toString('utf16le').split('\0')[0];
      } catch { /* no label */ }
      out.push({ letter: c, root, total: Number(total[0]), free: Number(avail[0]), removable: type === 2, label });
    } catch { /* skip */ }
  }
  return out;
}

function recycleBinQuery(root) {
  try {
    const L = load();
    const info = { cbSize: L.koffi.sizeof(L.SHQUERYRBINFO), i64Size: 0, i64NumItems: 0 };
    const hr = L.SHQueryRecycleBinW(root, info);
    if (hr !== 0) return null;
    return { size: Number(info.i64Size), count: Number(info.i64NumItems) };
  } catch { return null; }
}

function recycleBinEmpty(root) {
  try {
    const hr = load().SHEmptyRecycleBinW(0, root, 0x1 | 0x2 | 0x4); // 확인창·진행창·소리 없음
    return hr === 0 || hr === -2147418113 /* 비어 있을 때 E_UNEXPECTED */;
  } catch { return false; }
}

module.exports = {
  disks, recycleBinQuery, recycleBinEmpty,
  REG, FILE_ATTR,
  regRead, regValues, regSubkeys, regWrite, regDelete,
  hasPassword, passwordAgeSeconds, changePassword,
  applyScreenSaver, addFont, removeFont, broadcastFontChange, fileAttributes,
};
