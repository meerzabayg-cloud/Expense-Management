// App shell: start-up, navigation, theme, offline/update handling.
import { openDB, requestPersistence } from './db.js';
import * as repo from './repo.js';
import { formatMoney, parseMoney } from './money.js';
import { h, clear, icon, toast, openSheet, closeAllSheets } from './ui.js';
import { currentMonth } from './dates.js';
import { applyTheme } from './theme.js';
import { renderDashboard } from './views/dashboard.js';
import { renderLists, renderListDetail } from './views/lists.js';
import { renderScan } from './views/scan.js';
import { renderExpenses } from './views/expenses.js';
import { renderReports } from './views/reports.js';
import { renderItems, renderItemDetail } from './views/items.js';
import { renderFunds } from './views/funds.js';
import { renderHistory } from './views/history.js';
import { renderPrices } from './views/prices.js';
import { renderSettings, renderBackup } from './views/settings.js';
import { renderHelp } from './views/help.js';
import { renderOnboarding } from './views/onboarding.js';

export const APP_VERSION = '1.0.0';

const ROUTES = {
  dashboard: { render: renderDashboard, title: 'Dashboard', tab: 'dashboard' },
  list: { render: renderLists, title: 'Grocery Lists', tab: 'list' },
  'list-detail': { render: renderListDetail, title: 'Grocery List', tab: 'list', back: '#/list' },
  scan: { render: renderScan, title: 'Scan Receipt', tab: 'scan' },
  expenses: { render: renderExpenses, title: 'Expenses', tab: 'expenses' },
  reports: { render: renderReports, title: 'Reports', tab: 'reports' },
  items: { render: renderItems, title: 'Grocery Catalogue', back: '#/dashboard' },
  'item-detail': { render: renderItemDetail, title: 'Item', back: '#/items' },
  funds: { render: renderFunds, title: 'Funds & Budgets', back: '#/dashboard' },
  history: { render: renderHistory, title: 'Purchase History', back: '#/dashboard' },
  prices: { render: renderPrices, title: 'Price Comparison', back: '#/dashboard' },
  settings: { render: renderSettings, title: 'Settings', back: '#/dashboard' },
  backup: { render: renderBackup, title: 'Backup & Restore', back: '#/dashboard' },
  help: { render: renderHelp, title: 'Help & Guide', back: '#/dashboard' },
};

const TABS = [
  ['dashboard', 'Dashboard', 'home'],
  ['list', 'Grocery', 'list'],
  ['scan', 'Scan', 'scan'],
  ['expenses', 'Expenses', 'wallet'],
  ['reports', 'Reports', 'chart'],
];

const MENU = [
  ['items', 'Grocery Catalogue', 'tag'],
  ['funds', 'Funds & Budgets', 'bank'],
  ['history', 'Purchase History', 'history'],
  ['prices', 'Price Comparison', 'trend'],
  ['backup', 'Backup & Restore', 'shield'],
  ['settings', 'Settings', 'settings'],
  ['help', 'Help & Guide', 'help'],
];

const ctx = {
  data: null,
  settings: null,
  ui: { month: currentMonth() }, // shared filters that persist while navigating
  version: APP_VERSION,
};

ctx.fm = (minor, opts) => formatMoney(minor, ctx.settings.currency, { digits: ctx.settings.digits, ...opts });
ctx.parse = (text, opts) => parseMoney(text, ctx.settings.digits, opts);
ctx.go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
ctx.refresh = async ({ rerender = true } = {}) => {
  await loadData();
  if (rerender) await route({ keepScroll: true });
};

async function loadData() {
  ctx.settings = await repo.getSettings();
  const d = await repo.loadAll();
  d.itemsById = new Map(d.items.map((i) => [i.id, i]));
  d.catsById = new Map(d.categories.map((c) => [c.id, c]));
  d.accountsById = new Map(d.accounts.map((a) => [a.id, a]));
  ctx.data = d;
}

function parseHash() {
  const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  let name = parts[0] || 'dashboard';
  if (name === 'list' && parts[1]) { name = 'list-detail'; params.id = decodeURIComponent(parts[1]); }
  if (name === 'items' && parts[1]) { name = 'item-detail'; params.id = decodeURIComponent(parts[1]); }
  return { name: ROUTES[name] ? name : 'dashboard', params };
}

let routing = Promise.resolve();
function route(opts) {
  routing = routing.then(() => doRoute(opts)).catch((e) => showFatal(e));
  return routing;
}

async function doRoute({ keepScroll = false } = {}) {
  const main = document.getElementById('main');
  if (!ctx.settings.onboarded) {
    renderChrome(null);
    clear(main).appendChild(renderOnboarding(ctx, async (target = '#/dashboard') => { await ctx.refresh({ rerender: false }); if (location.hash === target) route(); else location.hash = target; }));
    return;
  }
  const { name, params } = parseHash();
  const r = ROUTES[name];
  const scrollY = window.scrollY;
  ctx.setTitle = (t) => { document.getElementById('title').textContent = t; document.title = `${t} · Family Expense`; };
  renderChrome(r);
  ctx.setTitle(r.title);
  let view;
  try {
    view = await r.render(ctx, params);
  } catch (e) {
    console.error(e);
    view = h('div', { class: 'card' }, h('h3', {}, 'Something went wrong'), h('p', { class: 'muted' }, e.message || String(e)), h('button', { class: 'btn btn-primary', onclick: () => ctx.go('#/dashboard') }, 'Go to dashboard'));
  }
  clear(main).appendChild(view);
  window.scrollTo(0, keepScroll ? scrollY : 0);
  if (!keepScroll) main.focus({ preventScroll: true });
}

function renderChrome(r) {
  const header = document.getElementById('header');
  const nav = document.getElementById('tabs');
  document.body.classList.toggle('onboarding', !r);
  clear(header);
  if (!r) { clear(nav); return; }
  header.append(
    r.back ? h('a', { class: 'icon-btn', href: r.back, 'aria-label': 'Back' }, icon('back')) : h('span', { class: 'brand-dot', 'aria-hidden': 'true' }),
    h('h1', { id: 'title' }, r.title),
    h('span', { id: 'offline-pill', class: `pill pill-warn ${navigator.onLine ? 'hidden' : ''}` }, 'Offline'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More options', onclick: openMenu }, icon('menu')));
  clear(nav);
  for (const [id, label, ic] of TABS) {
    const active = r.tab === id;
    nav.appendChild(h('a', { href: `#/${id}`, class: `tab ${active ? 'active' : ''} ${id === 'scan' ? 'tab-scan' : ''}`, 'aria-current': active ? 'page' : null },
      h('span', { class: 'tab-icon' }, icon(ic, { size: id === 'scan' ? 26 : 22 })), h('span', { class: 'tab-label' }, label)));
  }
}

function openMenu() {
  const s = openSheet('More', h('nav', { class: 'menu-list' },
    MENU.map(([id, label, ic]) => h('a', { href: `#/${id}`, class: 'menu-item', onclick: () => setTimeout(() => s.close(), 0) }, icon(ic), h('span', {}, label), icon('back', { cls: 'chev' }))),
    h('p', { class: 'muted small center' }, `Smart Family Expense & Grocery Manager · v${APP_VERSION}`),
    h('p', { class: 'muted small center' }, 'Your data is stored only on this device.')));
}

function showFatal(e) {
  console.error(e);
  const main = document.getElementById('main');
  clear(main).appendChild(h('div', { class: 'card' },
    h('h3', {}, 'The app could not start'),
    h('p', {}, e?.message || String(e)),
    h('p', { class: 'muted' }, 'If you are using a private/incognito window, offline storage may be disabled. Try a normal browser window, or reload.'),
    h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Reload')));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const promptUpdate = (worker) => {
      const bar = h('div', { class: 'update-bar', role: 'status' },
        h('span', {}, 'A new version of the app is ready.'),
        h('button', { class: 'btn btn-small btn-primary', onclick: () => { worker.postMessage({ type: 'SKIP_WAITING' }); } }, 'Update now'));
      document.body.appendChild(bar);
    };
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('Service worker registration failed', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

async function start() {
  try {
    await openDB();
    await repo.ensureSeeded();
    await loadData();
  } catch (e) { showFatal(e); return; }
  applyTheme(ctx.settings.theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(ctx.settings.theme));
  window.addEventListener('hashchange', () => { closeAllSheets(); route(); });
  const onlineChange = () => { document.getElementById('offline-pill')?.classList.toggle('hidden', navigator.onLine); };
  window.addEventListener('online', onlineChange);
  window.addEventListener('offline', onlineChange);
  await route();
  registerServiceWorker();
  if (ctx.settings.onboarded) requestPersistence();
}

window.addEventListener('error', (e) => { if (e?.message && !/ResizeObserver/.test(e.message)) toast(`Unexpected error: ${e.message}`, { tone: 'error' }); });
window.addEventListener('unhandledrejection', (e) => { const m = e?.reason?.message || String(e.reason || ''); if (m) toast(m, { tone: 'error' }); });

start();
