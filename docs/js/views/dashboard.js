import { h, icon, segmented, toast, pill } from '../ui.js';
import * as repo from '../repo.js';
import * as calc from '../calc.js';
import { barChart, donut, progress, PALETTE } from '../charts.js';
import { monthLabel, addMonths, currentMonth, dateLabel, todayISO, daysBetween } from '../dates.js';
import { formatPct, pctChange } from '../money.js';
import { openTransactionForm, catLabel, catIcon } from './forms.js';

export function monthPicker(ctx, onChange) {
  const m = ctx.ui.month;
  const set = (v) => { ctx.ui.month = v; onChange(); };
  return h('div', { class: 'month-picker' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous month', onclick: () => set(addMonths(m, -1)) }, icon('back')),
    h('label', { class: 'month-label' }, monthLabel(m),
      h('input', { type: 'month', value: m, class: 'month-input', 'aria-label': 'Choose month', onchange: (e) => e.target.value && set(e.target.value) })),
    h('button', { class: 'icon-btn flip', type: 'button', 'aria-label': 'Next month', disabled: m >= currentMonth(), onclick: () => set(addMonths(m, 1)) }, icon('back')));
}

export function txnRow(ctx, t, { onClick } = {}) {
  const acc = ctx.data.accountsById.get(t.accountId);
  const to = ctx.data.accountsById.get(t.toAccountId);
  const sign = t.type === 'expense' ? -1 : t.type === 'transfer' ? 0 : t.type === 'adjustment' ? Math.sign(t.amountMinor) : 1;
  const title = t.type === 'transfer' ? `${acc?.name || '?'} → ${to?.name || '?'}` : t.merchant || (t.type === 'adjustment' ? 'Balance adjustment' : catLabel(ctx, t.categoryId));
  const sub = [t.type === 'transfer' ? 'Transfer' : t.type === 'adjustment' ? acc?.name : catLabel(ctx, t.categoryId), dateLabel(t.date, { withYear: false })];
  if (t.type === 'refund') sub.unshift('Refund');
  return h('button', { type: 'button', class: 'row', onclick: onClick || (() => openTransactionForm(ctx, { txn: t })) },
    h('span', { class: 'row-icon' }, t.type === 'transfer' ? '⇄' : t.type === 'adjustment' ? '±' : catIcon(ctx, t.categoryId)),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-sub' }, sub.filter(Boolean).join(' · '), t.receiptId ? ' · 🧾' : '')),
    h('span', { class: `row-amount ${sign < 0 ? '' : sign > 0 ? 'good' : 'muted'}` }, ctx.fm(Math.abs(t.amountMinor), { sign: false }).replace(/^/, sign > 0 ? '+' : sign < 0 ? '−' : '')));
}

function kpi(label, value, { sub, tone, onClick, big = false } = {}) {
  return h(onClick ? 'button' : 'div', { class: `kpi ${big ? 'kpi-big' : ''} ${tone ? 'tone-' + tone : ''}`, type: onClick ? 'button' : null, onclick: onClick },
    h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value' }, value), sub ? h('span', { class: 'kpi-sub' }, sub) : null);
}

export async function renderDashboard(ctx) {
  const { data, settings } = ctx;
  const month = ctx.ui.month;
  const prev = addMonths(month, -1);
  const summary = calc.summariseMonth(data.transactions, month, data.categories);
  const prevSummary = calc.summariseMonth(data.transactions, prev, data.categories);
  const bmap = calc.budgetsForMonth(data.budgets, month);
  const total = calc.totalBudget(bmap);
  const balances = calc.accountBalances(data.accounts, data.transactions);
  const funds = calc.fundsSummary(data.accounts, balances);
  const [from, to] = [`${month}-01`, `${month}-31`];
  const movers = calc.priceMovers(data.purchases);
  const root = h('div', { class: 'view' });
  const rerender = () => ctx.refresh();

  root.append(monthPicker(ctx, rerender));

  // Safety banners
  const hasData = data.transactions.length + data.purchases.length > 0;
  const lastBackup = settings.lastBackupAt ? new Date(settings.lastBackupAt) : null;
  const backupAge = lastBackup ? daysBetween(todayISO(lastBackup), todayISO()) : null;
  if (hasData && (backupAge === null || backupAge >= settings.backupReminderDays)) {
    root.append(h('a', { class: 'banner banner-warn', href: '#/backup' }, icon('shield'),
      h('span', {}, backupAge === null ? 'You have not made a backup yet. Your data lives only on this phone — tap to save a backup.' : `Last backup was ${backupAge} days ago. Tap to make a fresh backup.`)));
  }
  if (navigator.storage?.persisted) {
    navigator.storage.persisted().then((p) => {
      if (!p && hasData && !document.querySelector('.banner-persist')) {
        root.insertBefore(h('a', { class: 'banner banner-info banner-persist', href: '#/help?topic=storage' }, icon('info'), h('span', {}, 'This browser may clear app data if the phone runs low on space. Install the app to your home screen and keep regular backups.')), root.children[1] || null);
      }
    }).catch(() => {});
  }

  // Due recurring payments — confirmed by the user, never automatic
  const due = repo.dueRecurring(data.recurring);
  if (due.length) {
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Due recurring payments'),
      due.slice(0, 5).map((r) => h('div', { class: 'row static' },
        h('span', { class: 'row-icon' }, catIcon(ctx, r.categoryId)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.merchant || catLabel(ctx, r.categoryId)), h('span', { class: 'row-sub' }, `${ctx.fm(r.amountMinor)} · due ${dateLabel(r.nextDate)}`)),
        h('span', { class: 'row-actions' },
          h('button', { class: 'btn btn-small btn-ghost', onclick: async () => { await repo.skipRecurring(r.id); toast('Skipped'); ctx.refresh(); } }, 'Skip'),
          h('button', { class: 'btn btn-small btn-primary', onclick: async (e) => { e.target.disabled = true; await repo.recordRecurring(r.id, { currency: settings.currency }); toast('Recorded', { tone: 'good' }); ctx.refresh(); } }, 'Record'))))));
  }

  // KPIs
  const mom = pctChange(prevSummary.spending, summary.spending);
  const remaining = total !== null ? total - summary.spending : null;
  const gBudget = bmap.get(calc.GROCERY_CATEGORY_ID)?.amountMinor ?? null;
  root.append(h('section', { class: 'kpi-hero' },
    h('div', { class: 'hero-top' },
      h('span', { class: 'kpi-label' }, `Spent in ${monthLabel(month)}`),
      h('span', { class: 'hero-value' }, ctx.fm(summary.spending)),
      h('span', { class: 'hero-sub' }, mom === null ? 'No spending recorded last month to compare' : `${formatPct(mom)} vs ${monthLabel(prev, { short: true })} (${ctx.fm(prevSummary.spending)})`)),
    total !== null ? h('div', { class: 'hero-budget' },
      progress((summary.spending / total) * 100),
      h('div', { class: 'hero-budget-row' }, h('span', {}, `Budget ${ctx.fm(total)}`), h('b', {}, remaining >= 0 ? `${ctx.fm(remaining)} left` : `${ctx.fm(-remaining)} over`))) :
      h('a', { class: 'hero-link', href: '#/funds?tab=budgets' }, 'Set a monthly budget →')));

  root.append(h('section', { class: 'kpi-grid' },
    kpi('Groceries', ctx.fm(summary.grocery), { sub: gBudget ? `${ctx.fm(gBudget - summary.grocery)} ${gBudget - summary.grocery >= 0 ? 'left' : 'over'} of ${ctx.fm(gBudget)}` : 'No grocery budget set', tone: gBudget ? (summary.grocery > gBudget ? 'bad' : 'good') : null, onClick: () => ctx.go('#/expenses?filter=grocery') }),
    kpi('Other spending', ctx.fm(summary.nonGrocery), { sub: `${summary.count} transactions`, onClick: () => ctx.go('#/expenses') }),
    kpi('Money received', ctx.fm(summary.income), { sub: summary.income ? `Net ${ctx.fm(summary.income - summary.spending, { sign: true })}` : 'Income, salary, reimbursements', tone: summary.income ? 'good' : null }),
    kpi('Funds available', data.accounts.length ? ctx.fm(funds.available) : '—', { sub: data.accounts.length ? (funds.owed ? `Card balance owed ${ctx.fm(funds.owed)}` : 'Tracked balances (not live bank data)') : 'Add accounts to track', onClick: () => ctx.go('#/funds') }),
    total !== null ? kpi(remaining >= 0 ? 'Under budget' : 'Over budget', ctx.fm(Math.abs(remaining)), { tone: remaining >= 0 ? 'good' : 'bad', sub: remaining >= 0 ? 'Saved vs approved budget so far' : 'Overspent vs approved budget' }) : null,
    (() => { const sv = calc.priceSavings(data.purchases, from, to); return sv.rows.length ? kpi('Price changes', ctx.fm(Math.abs(sv.net)), { tone: sv.net >= 0 ? 'good' : 'bad', sub: sv.net >= 0 ? 'Paid less than last time for the same items' : 'Paid more than last time for the same items', onClick: () => ctx.go('#/prices') }) : null; })()));

  // Insights
  const ins = calc.insights({ currency: settings.currency, summary, prevSummary, bmap, categories: data.categories, movers: movers.filter((m) => m.stats.latest.date >= addMonths(month, -2) + '-01'), items: data.itemsById });
  if (ins.length) root.append(h('section', { class: 'card' }, h('h3', {}, 'Insights'), h('ul', { class: 'insights' }, ins.map((i) => h('li', { class: `tone-${i.tone}` }, i.text)))));

  // Quick actions
  root.append(h('section', { class: 'quick' },
    h('button', { class: 'quick-btn', onclick: () => openTransactionForm(ctx, { type: 'expense' }) }, icon('plus'), 'Expense'),
    h('a', { class: 'quick-btn', href: '#/scan' }, icon('camera'), 'Scan receipt'),
    h('button', { class: 'quick-btn', onclick: () => openTransactionForm(ctx, { type: 'income' }) }, icon('download'), 'Money in'),
    h('a', { class: 'quick-btn', href: '#/list' }, icon('list'), 'Grocery list')));

  // Trend
  const trendSection = h('section', { class: 'card' });
  const drawTrend = () => {
    const n = ctx.ui.trendN || 6;
    const tr = calc.trend(data.transactions, month, n, data.categories);
    trendSection.replaceChildren(
      h('div', { class: 'card-head' }, h('h3', {}, 'Spending trend'), segmented([[3, '3M'], [6, '6M'], [12, '12M']], n, (v) => { ctx.ui.trendN = v; drawTrend(); }, { label: 'Trend period' })),
      barChart(tr.map((t) => ({ label: monthLabel(t.month, { short: true }).split(' ')[0], title: monthLabel(t.month), values: [t.grocery, t.nonGrocery] })), { series: [{ name: 'Groceries', cls: 'bar-a' }, { name: 'Other', cls: 'bar-b' }], format: (v) => ctx.fm(v) }),
      (() => { const tot = tr.reduce((a, t) => a + t.spending, 0); const avg = Math.round(tot / n); return h('p', { class: 'muted small' }, `${n}-month total ${ctx.fm(tot)} · average ${ctx.fm(avg)} per month`); })());
  };
  drawTrend();
  root.append(trendSection);

  // Category distribution
  const cats = [...summary.byCategory.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    const top = cats.slice(0, 7);
    const rest = cats.slice(7).reduce((a, [, v]) => a + v, 0);
    const items = top.map(([id, v], i) => ({ label: `${catIcon(ctx, id)} ${ctx.data.catsById.get(id)?.name || 'Other'}`, value: v, color: ctx.data.catsById.get(id)?.color || PALETTE[i % PALETTE.length] }));
    if (rest > 0) items.push({ label: 'Others', value: rest, color: '#94a3b8' });
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Where the money went'), donut(items, { format: (v) => ctx.fm(v), centerLabel: 'Total', centerValue: ctx.fm(summary.spending, { compact: true }) })));
  }

  // Budget utilisation
  const rows = calc.budgetRows(bmap, summary, data.categories);
  if (rows.length) {
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Category budgets'), h('a', { href: '#/funds?tab=budgets', class: 'link' }, 'Edit')),
      rows.map((r) => h('div', { class: 'budget-row' },
        h('div', { class: 'budget-top' }, h('span', {}, `${catIcon(ctx, r.categoryId)} ${r.name}`), h('span', { class: r.remaining < 0 ? 'bad' : 'muted' }, `${ctx.fm(r.spent)} / ${ctx.fm(r.budget)}`)),
        progress(r.pct),
        h('div', { class: 'small ' + (r.remaining < 0 ? 'bad' : 'muted') }, r.remaining >= 0 ? `${ctx.fm(r.remaining)} remaining` : `${ctx.fm(-r.remaining)} over budget`)))));
  }

  // Grocery planning
  const active = data.lists.filter((l) => l.status === 'active').sort((a, b) => (a.month < b.month ? 1 : -1));
  if (active.length) {
    const l = active[0];
    const entries = data.listEntries.filter((e) => e.listId === l.id);
    const t = calc.listTotals(entries);
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Grocery planning'), h('a', { class: 'link', href: `#/list/${l.id}` }, 'Open list')),
      h('p', {}, h('b', {}, l.name), h('span', { class: 'muted' }, ` · ${monthLabel(l.month)}`)),
      progress(t.planned ? (t.purchased / t.planned) * 100 : 0, { tone: 'good' }),
      h('p', { class: 'muted small' }, `${t.purchased} of ${t.planned} bought · ${t.remaining} remaining · about ${ctx.fm(t.estRemaining)} still to spend${t.unknownPrice ? ` (+${t.unknownPrice} without a price yet)` : ''}`)));
  } else {
    root.append(h('a', { class: 'banner banner-info', href: '#/list' }, icon('list'), h('span', {}, 'Plan this month’s groceries — create a list from last month in one tap.')));
  }

  // Top merchants + frequent items
  const merchants = [...summary.byMerchant.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
  if (merchants.length) {
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Top merchants'),
      h('ol', { class: 'rank' }, merchants.map((m) => h('li', {}, h('span', { class: 'grow' }, m.name), h('span', { class: 'muted small' }, `${m.count}× `), h('b', {}, ctx.fm(m.amount)))))));
  }
  const freq = calc.frequentItems(data.purchases, addMonths(month, -2) + '-01', to, 6);
  if (freq.length) {
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Most bought items'), h('span', { class: 'muted small' }, 'last 3 months')),
      h('ol', { class: 'rank' }, freq.map((f) => h('li', {}, h('a', { class: 'grow link-plain', href: `#/items/${f.itemId}` }, data.itemsById.get(f.itemId)?.name || 'Item'), h('span', { class: 'muted small' }, `${f.count}× `), h('b', {}, ctx.fm(f.spent)))))));
  }
  const ups = movers.filter((m) => m.pct > 0).slice(0, 4);
  const downs = movers.filter((m) => m.pct < 0).slice(0, 4);
  if (ups.length || downs.length) {
    const mv = (m) => h('a', { class: 'row', href: `#/items/${m.itemId}` },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, data.itemsById.get(m.itemId)?.name || 'Item'), h('span', { class: 'row-sub' }, `${ctx.fm(Math.round(m.stats.change.previousUnit))} → ${ctx.fm(Math.round(m.stats.change.latestUnit))} per ${m.stats.change.unitLabel}`)),
      pill(formatPct(m.pct), m.pct > 0 ? 'bad' : 'good'));
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Grocery price changes'), h('a', { class: 'link', href: '#/prices' }, 'All prices')),
      ups.length ? h('div', {}, h('h4', { class: 'sub-head bad' }, '▲ Price increases'), ups.map(mv)) : null,
      downs.length ? h('div', {}, h('h4', { class: 'sub-head good' }, '▼ Price decreases'), downs.map(mv)) : null));
  }

  // Recent transactions
  const recent = [...data.transactions].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1)).slice(0, 6);
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Recent transactions'), h('a', { class: 'link', href: '#/expenses' }, 'See all')),
    recent.length ? recent.map((t) => txnRow(ctx, t)) : h('p', { class: 'muted' }, 'Nothing recorded yet. Add an expense or scan a receipt to get started — every figure on this page comes from what you record.')));

  return root;
}
