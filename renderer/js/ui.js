// 공통 화면 부품. 파일명 등 외부 문자열은 항상 textContent로 넣는다.
import { ICONS } from './icons.js';

// 조건부로 만든 부품(null)이 화면에 'null' 글자로 찍히지 않게 한다.
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function replaceChildren(...nodes) {
  return nativeReplace.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false));
};

export const api = (ch, arg) => window.sen.invoke(ch, arg);
export const onEvent = (ch, fn) => window.sen.on(ch, fn);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || ICONS.info; // 정적 아이콘 문자열만 사용
  return svg;
}

// 버튼: 항상 아이콘 + 글자. variant: '' | 'primary' | 'danger' | 'on'
export function btn(iconName, label, onClick, { variant = '', wide = false, block = false, disabled = false, title, testid } = {}) {
  const b = h('button', { type: 'button', class: ['btn', variant, wide && 'wide', block && 'block'].filter(Boolean).join(' '), disabled, title, 'data-testid': testid });
  b.append(icon(iconName), h('span', {}, label));
  if (onClick) {
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true;
      try { await onClick(b); } finally { if (b.isConnected) b.disabled = disabled; }
    });
  }
  return b;
}

export const TONE_ICON = { danger: 'warn', warn: 'warn', ok: 'checkCircle', info: 'info', unknown: 'info' };
export const TONE_TAG = { danger: '바로 해결', warn: '해결 권장', ok: '안전', info: '정보', unknown: '확인 불가' };

export function statusRow({ level, iconName, title, desc, tag, right, testid }) {
  return h('div', { class: `row tone-${level}`, 'data-testid': testid },
    h('div', { class: 'ic' }, icon(iconName || TONE_ICON[level])),
    h('div', { class: 'tx' }, h('strong', {}, title), desc ? h('span', {}, desc) : null),
    tag === false ? null : h('span', { class: 'tag' }, tag || TONE_TAG[level]),
    right || null,
  );
}

// 이름이 있는 '점검 중' 줄/카드
export function pendingRow({ title, desc, testid }) {
  return h('div', { class: 'row pending tone-info', 'data-testid': testid },
    h('div', { class: 'ic' }, h('span', { class: 'spinner', 'aria-hidden': 'true' })),
    h('div', { class: 'tx' }, h('strong', {}, title), desc ? h('span', {}, desc) : null),
    h('span', { class: 'tag pending' }, '점검 중'));
}
export function pendingCard(title, desc) {
  return h('section', { class: 'panel rows' }, pendingRow({ title, desc }));
}

export function hero({ level, title, titleEmph, desc, iconName, right }) {
  const t = h('h1', {});
  if (titleEmph) {
    const [a, b] = title.split('{}');
    t.append(a, h('b', {}, titleEmph), b || '');
  } else t.textContent = title;
  return h('section', { class: `panel hero tone-${level}` },
    h('div', { class: 'badge' }, icon(iconName || TONE_ICON[level])),
    h('div', {}, t, desc ? h('p', {}, desc) : null),
    h('span', { class: 'sp' }),
    right || null,
  );
}

export function pageHead(title, desc, right) {
  return h('section', { class: 'panel pad', style: { display: 'flex', alignItems: 'center', gap: '16px' } },
    h('div', { style: { flex: '1' } }, h('div', { class: 'page-title' }, title), desc ? h('div', { class: 'page-desc' }, desc) : null),
    right || null);
}

export function tip(text, iconName = 'bulb') {
  return h('div', { class: 'tip' }, icon(iconName), h('div', {}, text));
}

export function toast(text, { action } = {}) {
  const root = document.getElementById('toasts');
  root.replaceChildren(); // 한 번에 하나만 보여 준다
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, text));
  if (action) el.append(btn(action.icon || 'undo', action.label, async () => { await action.run(); el.remove(); }));
  root.append(el);
  setTimeout(() => el.remove(), action ? 6000 : 2500);
}

// 확인 창: Promise<boolean>
export function confirmDialog({ title, body, warn, okLabel = '확인', okIcon = 'check', danger = false, cancelLabel = '취소' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    const ok = btn(okIcon, okLabel, () => close(true), { variant: danger ? 'danger' : 'primary', testid: 'confirm-ok' });
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(false); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, title),
        h('div', { class: 'body' }, body ? (body instanceof Node ? body : h('div', {}, body)) : null, warn ? h('div', { class: 'warnline' }, warn) : null),
        h('div', { class: 'actions' }, btn('x', cancelLabel, () => close(false), { testid: 'confirm-cancel' }), ok)));
    root.append(back);
    document.addEventListener('keydown', onKey);
    ok.focus();
  });
}

// 내용이 있는 모달(폼 등). render(close) → Node
export function modal(render) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, render(close)));
    root.append(back);
    document.addEventListener('keydown', onKey);
    const f = back.querySelector('input, button.primary');
    if (f) f.focus();
  });
}

export function checkbox(label, checked, onChange, { testid } = {}) {
  const input = h('input', { type: 'checkbox', 'data-testid': testid });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange && onChange(input.checked));
  return h('label', { class: 'check' }, input, label != null ? h('span', {}, label) : null);
}

export function radio(name, label, checked, onChange, extra) {
  const input = h('input', { type: 'radio', name });
  input.checked = !!checked;
  input.addEventListener('change', () => input.checked && onChange());
  return h('label', { class: 'check' }, input, h('span', {}, label), extra || null);
}

export function select(options, value, onChange) {
  const s = h('select', { class: 'sel' }, options.map(([v, l]) => { const o = h('option', { value: String(v) }, l); if (String(v) === String(value)) o.selected = true; return o; }));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)}MB`;
  return `${(n / 1024 ** 3).toFixed(1)}GB`;
}

export function fmtDate(t) { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; }

export function ago(t) {
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return '오늘';
  if (days < 30) return `${days}일 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

export function emptyState(big, small) {
  return h('div', { class: 'empty' }, h('span', { class: 'big' }, big), small ? h('span', {}, small) : null);
}

export function setHeaderActions(...nodes) {
  const el = document.getElementById('header-actions');
  el.replaceChildren(...nodes.filter(Boolean));
}
