// Small DOM toolkit. All text is inserted with textContent (never as HTML),
// so names and notes typed by users or read from receipts cannot inject code.

// Optional parts of a screen are written as `cond ? el : null`. Native append/
// replaceChildren would print "null", so empty values are skipped everywhere.
if (typeof Element !== 'undefined' && !Element.prototype.__sfemPatched) {
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const orig = Element.prototype[m];
    Element.prototype[m] = function (...nodes) { return orig.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false)); };
  }
  Element.prototype.__sfemPatched = true;
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'required' || k === 'readOnly') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** Inline SVG icon from a small built-in set (paths are static strings, not user data). */
const ICONS = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  menu: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5 9-10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  store: 'M4 9l1-5h14l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6',
  shield: 'M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  merge: 'M6 3v6a6 6 0 0 0 6 6h6M15 12l3 3-3 3M6 21v-6',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
};

export function icon(name, { size = 22, cls = '' } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.info);
  svg.appendChild(p);
  return svg;
}

/* ---------------- Toasts ---------------- */

export function toast(message, { tone = 'info', timeout = 3200 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: `toast toast-${tone}`, role: tone === 'error' ? 'alert' : 'status' }, message);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, timeout);
}

/* ---------------- Bottom sheet / modal ---------------- */

let sheetStack = [];

export function openSheet(title, content, { onClose, wide = false } = {}) {
  const host = document.getElementById('sheets');
  const prevFocus = document.activeElement;
  const close = () => {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 220);
    sheetStack = sheetStack.filter((s) => s !== api);
    document.removeEventListener('keydown', onKey);
    onClose?.();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === api) close(); };
  const body = h('div', { class: 'sheet-body' }, content);
  const sheet = h('div', { class: `sheet ${wide ? 'sheet-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
    body);
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, sheet);
  host.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  document.addEventListener('keydown', onKey);
  const api = { close, body, sheet };
  sheetStack.push(api);
  setTimeout(() => { const f = sheet.querySelector('input:not([type=hidden]),select,textarea,button.btn'); if (f && !f.dataset.nofocus && window.innerWidth > 700) f.focus(); }, 60);
  return api;
}

export function closeAllSheets() { for (const s of [...sheetStack]) s.close(); }

export function confirmDialog({ title = 'Are you sure?', message, confirmText = 'Confirm', danger = false, extra }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); s.close(); } };
    const s = openSheet(title, h('div', {},
      h('p', { class: 'muted' }, message),
      extra || null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => finish(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => finish(true) }, confirmText))),
    { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

/* ---------------- Form helpers ---------------- */

let fieldSeq = 0;

export function field(label, control, { hint, error, id } = {}) {
  const fid = id || control.id || `f${++fieldSeq}`;
  control.id = fid;
  const err = h('div', { class: 'field-error', id: `${fid}-err`, role: 'alert' }, error || '');
  if (hint) control.setAttribute('aria-describedby', `${fid}-hint`);
  return h('div', { class: 'field' },
    h('label', { for: fid }, label),
    control,
    hint ? h('div', { class: 'hint', id: `${fid}-hint` }, hint) : null,
    err);
}

export function setFieldError(control, msg) {
  const err = document.getElementById(`${control.id}-err`);
  if (err) err.textContent = msg || '';
  control.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map(([v, label, extra = {}]) => h('option', { value: v, selected: v === value, ...extra }, label)));
}

export function moneyInput(attrs = {}) {
  return h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', ...attrs });
}

export function datalist(id, values) {
  return h('datalist', { id }, values.map((v) => h('option', { value: v })));
}

/** Prevents double submission: disables the button while the async action runs. */
export async function busy(btn, fn) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'Saving…';
  try { return await fn(); }
  finally { delete btn.dataset.busy; btn.disabled = false; btn.textContent = old; }
}

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, { size: 34 })), h('h3', {}, title), h('p', { class: 'muted' }, text), action || null);
}

export function pill(text, tone = 'neutral') { return h('span', { class: `pill pill-${tone}` }, text); }

export function segmented(options, value, onChange, { label } = {}) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label || '' });
  for (const [v, text] of options) {
    wrap.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'active' : '', onclick: () => onChange(v) }, text));
  }
  return wrap;
}

export function downloadFile(name, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

/** On phones, prefer the system share sheet ("Save to Files", Drive, WhatsApp...) when available. */
export async function shareOrDownload(name, content, type) {
  const blob = new Blob([content], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  downloadFile(name, blob);
  return 'downloaded';
}
