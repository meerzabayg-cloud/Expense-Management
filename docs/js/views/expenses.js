import { h, icon, select, emptyState, openSheet } from '../ui.js';
import * as repo from '../repo.js';
import * as calc from '../calc.js';
import { monthLabel, dateLabel, monthOf } from '../dates.js';
import { openTransactionForm, openRecurringForm, categoryOptions, catLabel, catIcon } from './forms.js';
import { txnRow, monthPicker } from './dashboard.js';

export async function renderExpenses(ctx, params) {
  const { data } = ctx;
  const root = h('div', { class: 'view' });
  const f = ctx.ui.expFilter ||= { q: '', type: 'all', categoryId: '', accountId: '', scope: 'month' };
  if (params.filter === 'grocery') { f.categoryId = calc.GROCERY_CATEGORY_ID; f.type = 'expense'; }

  root.append(h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary grow', onclick: () => openTransactionForm(ctx, { type: 'expense' }) }, icon('plus'), 'Add expense'),
    h('button', { class: 'btn btn-secondary', onclick: () => openTransactionForm(ctx, { type: 'income' }) }, 'Money in'),
    h('button', { class: 'btn btn-secondary', 'aria-label': 'Recurring payments', onclick: () => recurringSheet(ctx) }, icon('repeat'))));

  if (f.scope === 'month') root.append(monthPicker(ctx, () => ctx.refresh()));

  const q = h('input', { type: 'search', placeholder: 'Search merchant, notes, amount…', value: f.q, 'aria-label': 'Search transactions' });
  const typeSel = select([['all', 'All types'], ['expense', 'Expenses'], ['income', 'Money received'], ['refund', 'Refunds'], ['transfer', 'Transfers'], ['adjustment', 'Adjustments']], f.type, { 'aria-label': 'Type' });
  const catSel = select([['', 'All categories'], ...categoryOptions(ctx, 'expense'), ...categoryOptions(ctx, 'income')], f.categoryId, { 'aria-label': 'Category' });
  const accSel = select([['', 'All accounts'], ...data.accounts.map((a) => [a.id, a.name])], f.accountId, { 'aria-label': 'Account' });
  const scopeSel = select([['month', 'Selected month'], ['all', 'All time']], f.scope, { 'aria-label': 'Period' });
  const listBox = h('div');
  const apply = () => {
    Object.assign(f, { q: q.value, type: typeSel.value, categoryId: catSel.value, accountId: accSel.value });
    draw();
  };
  [typeSel, catSel, accSel].forEach((s) => s.addEventListener('change', apply));
  q.addEventListener('input', apply);
  scopeSel.addEventListener('change', () => { f.scope = scopeSel.value; ctx.refresh(); });
  root.append(h('div', { class: 'filters' }, q, h('div', { class: 'filter-row' }, typeSel, catSel), h('div', { class: 'filter-row' }, accSel, data.accounts.length ? scopeSel : scopeSel)), listBox);

  function draw() {
    const needle = f.q.trim().toLowerCase();
    const inCat = (t) => !f.categoryId || t.categoryId === f.categoryId || data.catsById.get(t.categoryId)?.parentId === f.categoryId;
    const list = data.transactions.filter((t) =>
      (f.scope === 'all' || monthOf(t.date) === ctx.ui.month) &&
      (f.type === 'all' || t.type === f.type) && inCat(t) &&
      (!f.accountId || t.accountId === f.accountId || t.toAccountId === f.accountId) &&
      (!needle || `${t.merchant} ${t.notes} ${catLabel(ctx, t.categoryId)} ${(t.amountMinor / 10 ** ctx.settings.digits).toFixed(ctx.settings.digits)}`.toLowerCase().includes(needle)))
      .sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
    if (!list.length) {
      listBox.replaceChildren(data.transactions.length ? h('p', { class: 'muted center' }, 'No transactions match these filters.') : emptyState('wallet', 'No transactions yet', 'Add your first expense, record money received, or scan a grocery receipt.'));
      return;
    }
    let spend = 0; let income = 0;
    for (const t of list) { spend += calc.spendingEffect(t); if (t.type === 'income') income += t.amountMinor; }
    const groups = calc.groupBy(list, (t) => t.date);
    listBox.replaceChildren(
      h('div', { class: 'summary-strip' }, h('span', {}, `${list.length} shown`), h('span', {}, 'Spent ', h('b', {}, ctx.fm(spend))), income ? h('span', {}, 'Received ', h('b', { class: 'good' }, ctx.fm(income))) : null),
      ...[...groups.entries()].map(([date, ts]) => h('section', { class: 'card day' }, h('h4', { class: 'day-head' }, dateLabel(date)), ts.map((t) => txnRow(ctx, t)))));
  }
  draw();
  return root;
}

function recurringSheet(ctx) {
  const rec = ctx.data.recurring;
  let s;
  s = openSheet('Recurring payments', h('div', {},
    h('p', { class: 'hint' }, 'Rent, utilities, subscriptions, school fees, salary… When one is due, the dashboard asks you to record or skip it.'),
    rec.length ? rec.map((r) => h('button', { class: 'row', type: 'button', onclick: () => { s.close(); openRecurringForm(ctx, r); } },
      h('span', { class: 'row-icon' }, catIcon(ctx, r.categoryId)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.merchant || catLabel(ctx, r.categoryId)), h('span', { class: 'row-sub' }, `${{ monthly: 'Monthly', weekly: 'Weekly', yearly: 'Yearly' }[r.frequency]} · next ${dateLabel(r.nextDate)}${r.active ? '' : ' · paused'}`)),
      h('span', { class: `row-amount ${r.type === 'income' ? 'good' : ''}` }, ctx.fm(r.amountMinor)))) : h('p', { class: 'muted' }, 'No recurring payments yet.'),
    h('button', { class: 'btn btn-primary btn-block', onclick: () => { s.close(); openRecurringForm(ctx); } }, icon('plus'), 'Add recurring payment')));
}
