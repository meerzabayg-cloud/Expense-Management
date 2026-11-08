import { h, icon, segmented, field, moneyInput, toast, busy, openSheet, emptyState, setFieldError } from '../ui.js';
import * as repo from '../repo.js';
import * as calc from '../calc.js';
import { progress } from '../charts.js';
import { monthLabel, dateLabel } from '../dates.js';
import { toDecimalString } from '../money.js';
import { openAccountForm, openTransactionForm, openCategoryForm, catIcon } from './forms.js';
import { monthPicker, txnRow } from './dashboard.js';

export async function renderFunds(ctx, params) {
  const tab = ctx.ui.fundsTab = params.tab || ctx.ui.fundsTab || 'accounts';
  const root = h('div', { class: 'view' });
  root.append(h('div', { class: 'center' }, segmented([['accounts', 'Accounts'], ['budgets', 'Budgets'], ['categories', 'Categories']], tab, (v) => ctx.go(`#/funds?tab=${v}`), { label: 'Section' })));
  if (tab === 'budgets') root.append(budgets(ctx));
  else if (tab === 'categories') root.append(categories(ctx));
  else root.append(accounts(ctx));
  return root;
}

function accounts(ctx) {
  const { data } = ctx;
  const box = h('div');
  const bal = calc.accountBalances(data.accounts, data.transactions);
  const f = calc.fundsSummary(data.accounts, bal);
  box.append(h('section', { class: 'kpi-hero compact' },
    h('div', { class: 'hero-top' }, h('span', { class: 'kpi-label' }, 'Funds available (tracked)'), h('span', { class: 'hero-value' }, ctx.fm(f.available)),
      h('span', { class: 'hero-sub' }, f.owed ? `Credit card balance owed: ${ctx.fm(f.owed)}` : 'Cash, bank, debit and wallet balances')),
    h('p', { class: 'hero-note' }, 'These balances are calculated from what you record here. They are not read from your bank and may differ from your real balance — use “Adjust balance” to correct them.')));
  box.append(h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary grow', onclick: () => openAccountForm(ctx) }, icon('plus'), 'Add account'),
    data.accounts.length >= 2 ? h('button', { class: 'btn btn-secondary', onclick: () => openTransactionForm(ctx, { type: 'transfer' }) }, 'Transfer') : null));
  if (!data.accounts.length) {
    box.append(emptyState('bank', 'No accounts yet', 'Add where your money is kept — cash, bank account, cards or wallets — with their current balances. Tracking accounts is optional.'));
    return box;
  }
  for (const a of [...data.accounts].sort((x, y) => Number(x.archived) - Number(y.archived))) {
    const b = bal.get(a.id) || 0;
    const recent = data.transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 3);
    box.append(h('section', { class: `card ${a.archived ? 'muted-card' : ''}` },
      h('div', { class: 'card-head' },
        h('div', {}, h('h3', {}, a.name), h('span', { class: 'muted small' }, `${repo.ACCOUNT_TYPES[a.type]}${a.archived ? ' · archived' : ''}`)),
        h('div', { class: 'right' }, h('div', { class: `acct-bal ${b < 0 ? 'bad' : ''}` }, a.type === 'credit' && b <= 0 ? ctx.fm(-b) : ctx.fm(b)), h('div', { class: 'muted small' }, a.type === 'credit' ? (b <= 0 ? 'owed' : 'credit balance') : 'balance'))),
      a.type === 'credit' && a.creditLimitMinor ? h('div', {}, progress((Math.max(0, -b) / a.creditLimitMinor) * 100), h('p', { class: 'muted small' }, `Limit ${ctx.fm(a.creditLimitMinor)} · unused limit ${ctx.fm(Math.max(0, a.creditLimitMinor + Math.min(0, b)))} (this is borrowing, not your money)`)) : null,
      recent.map((t) => txnRow(ctx, t)),
      h('div', { class: 'chip-row' },
        h('button', { class: 'chip', onclick: () => openTransactionForm(ctx, { type: 'income', preset: { accountId: a.id } }) }, 'Money in'),
        h('button', { class: 'chip', onclick: () => openTransactionForm(ctx, { type: 'adjustment', preset: { accountId: a.id } }) }, 'Adjust balance'),
        a.type === 'credit' ? h('button', { class: 'chip', onclick: () => openTransactionForm(ctx, { type: 'transfer', preset: { toAccountId: a.id } }) }, 'Pay card') : null,
        h('button', { class: 'chip', onclick: () => openAccountForm(ctx, a) }, icon('edit', { size: 16 }), 'Edit'),
        ctx.settings.defaultAccountId !== a.id && !a.archived ? h('button', { class: 'chip', onclick: async () => { await repo.saveSettings({ defaultAccountId: a.id }); toast(`${a.name} is now the default`); ctx.refresh(); } }, 'Make default') : h('span', { class: 'chip chip-static' }, a.archived ? '' : '★ Default'))));
  }
  return box;
}

function budgets(ctx) {
  const { data } = ctx;
  const month = ctx.ui.month;
  const bmap = calc.budgetsForMonth(data.budgets, month);
  const summary = calc.summariseMonth(data.transactions, month, data.categories);
  const box = h('div');
  box.append(monthPicker(ctx, () => ctx.refresh()));
  const total = calc.totalBudget(bmap);
  box.append(h('section', { class: 'card' },
    h('h3', {}, `Budget for ${monthLabel(month)}`),
    total !== null ? h('div', {}, progress((summary.spending / total) * 100),
      h('p', { class: summary.spending > total ? 'bad' : 'good' }, summary.spending > total ? `${ctx.fm(summary.spending - total)} over the total budget of ${ctx.fm(total)}` : `${ctx.fm(total - summary.spending)} left of ${ctx.fm(total)} (spent ${ctx.fm(summary.spending)})`))
      : h('p', { class: 'muted' }, 'No budget yet. Set an overall monthly limit and/or limits per category.'),
    h('p', { class: 'muted small' }, 'A budget you set applies to this month and every following month until you change it. Budgets are spending plans — they do not move money.')));

  const rows = [['total', '🎯 Overall monthly budget', null]];
  for (const c of data.categories.filter((x) => x.kind === 'expense' && !x.parentId && !x.archived).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999))) rows.push([c.id, `${c.icon} ${c.name}`, c]);
  box.append(h('section', { class: 'card' }, h('h3', {}, 'Monthly limits'),
    h('p', { class: 'muted small' }, 'Leave the overall budget empty to use the sum of the category budgets.'),
    rows.map(([id, label]) => {
      const b = bmap.get(id);
      const spent = id === 'total' ? summary.spending : summary.byCategory.get(id) || 0;
      return h('button', { class: 'row', type: 'button', onclick: () => editBudget(ctx, month, id, label, b) },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label),
          h('span', { class: 'row-sub' }, b ? `${ctx.fm(spent)} spent of ${ctx.fm(b.amountMinor)}${b.inherited ? ` · set in ${monthLabel(b.setIn, { short: true })}` : ''}` : spent ? `${ctx.fm(spent)} spent · no limit` : 'No limit'),
          b ? progress((spent / b.amountMinor) * 100) : null),
        h('span', { class: 'row-amount' }, b ? ctx.fm(b.amountMinor) : 'Set'));
    })));
  return box;
}

function editBudget(ctx, month, categoryId, label, current) {
  const amt = moneyInput({ value: current ? toDecimalString(current.amountMinor, ctx.settings.digits) : '' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save');
  let s;
  s = openSheet(label.replace(/^\S+\s/, ''), h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const v = amt.value.trim() ? ctx.parse(amt.value) : 0;
    if (v === null) { setFieldError(amt, 'Enter a valid amount'); return; }
    await busy(save, async () => { await repo.setBudget(month, categoryId, v); s.close(); toast(v ? 'Budget saved' : 'Budget removed', { tone: 'good' }); ctx.refresh(); });
  } },
    field(`Monthly limit from ${monthLabel(month)} (${ctx.settings.currency})`, amt, { hint: 'Enter 0 or leave empty to remove the limit from this month onwards.' }),
    h('div', { class: 'btn-row' }, current ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await repo.setBudget(month, categoryId, 0); s.close(); ctx.refresh(); } }, 'Remove') : null, save)));
}

function categories(ctx) {
  const { data } = ctx;
  const box = h('div');
  for (const [kind, title] of [['expense', 'Expense categories'], ['income', 'Income sources'], ['grocery', 'Grocery item categories']]) {
    const cats = data.categories.filter((c) => c.kind === kind);
    const roots = cats.filter((c) => !c.parentId).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
    box.append(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, title), h('button', { class: 'chip chip-primary', onclick: () => openCategoryForm(ctx, { kind }) }, icon('plus', { size: 16 }), 'Add')),
      roots.map((r) => [
        h('button', { class: `row ${r.archived ? 'muted' : ''}`, type: 'button', onclick: () => openCategoryForm(ctx, { kind, category: r }) }, h('span', { class: 'row-icon' }, r.icon), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name, r.archived ? ' (hidden)' : '')), icon('edit', { size: 16 })),
        ...cats.filter((c) => c.parentId === r.id).map((c) => h('button', { class: `row sub ${c.archived ? 'muted' : ''}`, type: 'button', onclick: () => openCategoryForm(ctx, { kind, category: c }) }, h('span', { class: 'row-icon' }, '↳'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name, c.archived ? ' (hidden)' : '')), icon('edit', { size: 16 }))),
      ])));
  }
  return box;
}
