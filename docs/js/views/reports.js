import { h, icon, segmented, downloadFile, pill } from '../ui.js';
import * as calc from '../calc.js';
import { barChart, donut, progress, PALETTE } from '../charts.js';
import { monthLabel, addMonths, monthsBack, monthOf } from '../dates.js';
import { formatPct, pctChange } from '../money.js';
import { transactionsCSV, purchasesCSV } from '../backup.js';
import { catIcon } from './forms.js';
import { monthPicker } from './dashboard.js';

export async function renderReports(ctx) {
  const { data } = ctx;
  const root = h('div', { class: 'view' });
  const period = ctx.ui.reportPeriod || 1;
  const end = ctx.ui.month;
  const months = monthsBack(end, period);
  const from = `${months[0]}-01`; const to = `${end}-31`;
  const prevMonths = monthsBack(addMonths(months[0], -1), period);

  root.append(monthPicker(ctx, () => ctx.refresh()));
  root.append(h('div', { class: 'center' }, segmented([[1, 'Month'], [3, '3 months'], [6, '6 months'], [12, '12 months']], period, (v) => { ctx.ui.reportPeriod = v; ctx.refresh(); }, { label: 'Report period' })));

  const sum = (ms) => {
    const acc = { spending: 0, grocery: 0, nonGrocery: 0, income: 0, count: 0, byCategory: new Map(), byMerchant: new Map() };
    for (const m of ms) {
      const s = calc.summariseMonth(data.transactions, m, data.categories);
      acc.spending += s.spending; acc.grocery += s.grocery; acc.nonGrocery += s.nonGrocery; acc.income += s.income; acc.count += s.count;
      for (const [k, v] of s.byCategory) acc.byCategory.set(k, (acc.byCategory.get(k) || 0) + v);
      for (const [k, v] of s.byMerchant) { const c = acc.byMerchant.get(k) || { name: v.name, amount: 0, count: 0 }; c.amount += v.amount; c.count += v.count; acc.byMerchant.set(k, c); }
    }
    return acc;
  };
  const cur = sum(months);
  const prev = sum(prevMonths);
  const label = period === 1 ? monthLabel(end) : `${monthLabel(months[0], { short: true })} – ${monthLabel(end, { short: true })}`;
  const prevLabel = period === 1 ? monthLabel(prevMonths[0]) : 'previous period';

  root.append(h('section', { class: 'card' },
    h('h3', {}, label),
    h('div', { class: 'stat-grid' },
      stat('Total spending', ctx.fm(cur.spending), deltaText(ctx, cur.spending, prev.spending, prevLabel)),
      stat('Groceries', ctx.fm(cur.grocery), deltaText(ctx, cur.grocery, prev.grocery, prevLabel)),
      stat('Other spending', ctx.fm(cur.nonGrocery), deltaText(ctx, cur.nonGrocery, prev.nonGrocery, prevLabel)),
      stat('Money received', ctx.fm(cur.income), cur.income ? `Net ${ctx.fm(cur.income - cur.spending, { sign: true })}` : ''))));

  // Budget vs actual
  const budgetRows = [];
  let budgetTotal = 0; let budgetSpent = 0; let anyBudget = false;
  for (const m of months) {
    const bmap = calc.budgetsForMonth(data.budgets, m);
    const s = calc.summariseMonth(data.transactions, m, data.categories);
    const tb = calc.totalBudget(bmap);
    if (tb !== null) { anyBudget = true; budgetTotal += tb; budgetSpent += s.spending; }
    for (const r of calc.budgetRows(bmap, s, data.categories)) {
      const x = budgetRows.find((y) => y.categoryId === r.categoryId);
      if (x) { x.budget += r.budget; x.spent += r.spent; } else budgetRows.push({ ...r });
    }
  }
  if (anyBudget) {
    const v = budgetTotal - budgetSpent;
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Budget vs actual'),
      h('p', { class: v >= 0 ? 'good' : 'bad' }, v >= 0 ? `${ctx.fm(v)} under budget (${ctx.fm(budgetSpent)} of ${ctx.fm(budgetTotal)})` : `${ctx.fm(-v)} over budget (${ctx.fm(budgetSpent)} of ${ctx.fm(budgetTotal)})`),
      progress((budgetSpent / budgetTotal) * 100),
      h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', {}, 'Budget'), h('th', {}, 'Actual'), h('th', {}, 'Variance'))),
        h('tbody', {}, budgetRows.map((r) => { const vv = r.budget - r.spent; return h('tr', {}, h('td', {}, `${catIcon(ctx, r.categoryId)} ${r.name}`), h('td', {}, ctx.fm(r.budget)), h('td', {}, ctx.fm(r.spent)), h('td', { class: vv >= 0 ? 'good' : 'bad' }, `${vv >= 0 ? '▼ ' : '▲ '}${ctx.fm(Math.abs(vv))}`)); }))),
      h('p', { class: 'muted small' }, '▼ green = under budget (favourable) · ▲ red = over budget (unfavourable)')));
  }

  // Category breakdown + changes
  const cats = [...cur.byCategory.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Spending by category'),
      donut(cats.slice(0, 8).map(([id, v], i) => ({ label: `${catIcon(ctx, id)} ${data.catsById.get(id)?.name || 'Other'}`, value: v, color: data.catsById.get(id)?.color || PALETTE[i % PALETTE.length] })), { format: (v) => ctx.fm(v), centerLabel: 'Total', centerValue: ctx.fm(cur.spending, { compact: true }) }),
      h('h4', { class: 'sub-head' }, `Change vs ${prevLabel}`),
      h('table', { class: 'table' }, h('tbody', {}, [...new Set([...cur.byCategory.keys(), ...prev.byCategory.keys()])].map((k) => {
        const a = cur.byCategory.get(k) || 0; const b = prev.byCategory.get(k) || 0; const d = a - b;
        return { k, a, b, d };
      }).filter((r) => r.a || r.b).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).map((r) => h('tr', {},
        h('td', {}, `${catIcon(ctx, r.k)} ${data.catsById.get(r.k)?.name || 'Other'}`), h('td', {}, ctx.fm(r.a)),
        h('td', { class: r.d > 0 ? 'bad' : r.d < 0 ? 'good' : 'muted' }, r.d === 0 ? '—' : `${r.d > 0 ? '▲' : '▼'} ${ctx.fm(Math.abs(r.d))}${r.b ? ` (${formatPct(pctChange(r.b, r.a))})` : ''}`)))))));
  }

  // Monthly trend for the period (or 6 months if single month)
  const trendMonths = period === 1 ? 6 : period;
  const tr = calc.trend(data.transactions, end, trendMonths, data.categories);
  root.append(h('section', { class: 'card' }, h('h3', {}, `${trendMonths}-month trend`),
    barChart(tr.map((t) => ({ label: monthLabel(t.month, { short: true }).split(' ')[0], title: monthLabel(t.month), values: [t.spending, t.income] })), { series: [{ name: 'Spending', cls: 'bar-a' }, { name: 'Received', cls: 'bar-c' }], format: (v) => ctx.fm(v) })));

  // Merchants
  const merchants = [...cur.byMerchant.values()].sort((a, b) => b.amount - a.amount).slice(0, 10);
  if (merchants.length) root.append(h('section', { class: 'card' }, h('h3', {}, 'Top merchants'), h('ol', { class: 'rank' }, merchants.map((m) => h('li', {}, h('span', { class: 'grow' }, m.name), h('span', { class: 'muted small' }, `${m.count}× `), h('b', {}, ctx.fm(m.amount)))))));

  // Grocery: planned vs actual
  const lists = data.lists.filter((l) => months.includes(l.month));
  if (lists.length) {
    let est = 0; let act = 0; let estBought = 0;
    for (const l of lists) {
      for (const e of data.listEntries.filter((x) => x.listId === l.id)) {
        const ee = e.estPriceMinor ? Math.round(e.estPriceMinor * (e.plannedQty || 1)) : 0;
        est += ee;
        if (e.checked && Number.isFinite(e.actualTotalMinor)) { act += e.actualTotalMinor; estBought += ee; }
      }
    }
    const v = estBought - act;
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Planned vs actual groceries'),
      h('div', { class: 'stat-grid' }, stat('Planned (all list items)', ctx.fm(est)), stat('Estimate for items bought', ctx.fm(estBought)), stat('Actually paid', ctx.fm(act)),
        stat('Variance', ctx.fm(Math.abs(v)), estBought ? (v >= 0 ? 'Paid less than planned' : 'Paid more than planned') : '', v >= 0 ? 'good' : 'bad')),
      h('p', { class: 'muted small' }, 'Compares only items that were ticked with a price, so unbought items don’t distort the result.')));
  }

  // Price savings (price movement, not budget)
  const sv = calc.priceSavings(data.purchases, from, to);
  if (sv.rows.length) {
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Price changes on repeat purchases'),
      h('div', { class: 'stat-grid' }, stat('Paid less than last time', ctx.fm(sv.saved), '', 'good'), stat('Paid more than last time', ctx.fm(sv.extra), '', 'bad'), stat('Net effect', ctx.fm(Math.abs(sv.net)), sv.net >= 0 ? 'favourable' : 'unfavourable', sv.net >= 0 ? 'good' : 'bad')),
      h('p', { class: 'muted small' }, 'Each purchase is compared with your previous comparable purchase of the same item, per kg/L/piece. This shows price movement — it is separate from budget savings.'),
      h('a', { class: 'link', href: '#/prices' }, 'See item-by-item prices →')));
  }

  // Store comparison
  const stores = calc.storeComparison(data.purchases.filter((p) => p.date >= addMonths(end, -11) + '-01'));
  if (stores.length >= 2) {
    root.append(h('section', { class: 'card' }, h('h3', {}, 'Store price comparison'),
      h('p', { class: 'muted small' }, 'For items you bought at more than one store in the last 12 months: how much more each store charged on average than the cheapest store for the same item.'),
      h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Store'), h('th', {}, 'Items'), h('th', {}, 'Cheapest for'), h('th', {}, 'Avg. premium'))),
        h('tbody', {}, stores.map((s, i) => h('tr', {}, h('td', {}, i === 0 ? h('b', {}, s.store) : s.store), h('td', {}, String(s.items)), h('td', {}, String(s.cheapestCount)), h('td', { class: s.avgPremiumPct < 1 ? 'good' : 'bad' }, s.avgPremiumPct < 0.5 ? 'cheapest' : `+${s.avgPremiumPct.toFixed(1)}%`)))))));
  }

  // Exports
  const txIn = data.transactions.filter((t) => months.includes(monthOf(t.date)));
  const pIn = data.purchases.filter((p) => months.includes(monthOf(p.date)));
  root.append(h('section', { class: 'card' }, h('h3', {}, 'Export (CSV for Excel / Google Sheets)'),
    h('div', { class: 'btn-col' },
      h('button', { class: 'btn btn-secondary', disabled: !txIn.length, onclick: () => downloadFile(`transactions-${months[0]}${period > 1 ? '-to-' + end : ''}.csv`, transactionsCSV(txIn, { categories: data.categories, accounts: data.accounts, digits: ctx.settings.digits }), 'text/csv') }, icon('download'), `Transactions in this period (${txIn.length})`),
      h('button', { class: 'btn btn-secondary', disabled: !data.transactions.length, onclick: () => downloadFile('transactions-all.csv', transactionsCSV(data.transactions, { categories: data.categories, accounts: data.accounts, digits: ctx.settings.digits }), 'text/csv') }, icon('download'), `All transactions (${data.transactions.length})`),
      h('button', { class: 'btn btn-secondary', disabled: !pIn.length, onclick: () => downloadFile(`grocery-purchases-${months[0]}.csv`, purchasesCSV(pIn, { items: data.items, digits: ctx.settings.digits }), 'text/csv') }, icon('download'), `Grocery purchases in this period (${pIn.length})`))));

  if (!data.transactions.length) root.prepend(h('div', { class: 'banner banner-info' }, icon('info'), h('span', {}, 'Reports are built only from what you record. Add expenses or scan receipts and this page fills in automatically.')));
  return root;
}

function stat(label, value, sub = '', tone = '') {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: `stat-value ${tone}` }, value), sub ? h('span', { class: 'stat-sub' }, sub) : null);
}

function deltaText(ctx, a, b, prevLabel) {
  if (!b) return '';
  const d = a - b;
  if (!d) return `same as ${prevLabel}`;
  return `${d > 0 ? '▲' : '▼'} ${ctx.fm(Math.abs(d))} (${formatPct(pctChange(b, a))}) vs ${prevLabel}`;
}
