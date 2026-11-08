// Shared forms used on several screens.
import { h, field, select, moneyInput, openSheet, toast, busy, setFieldError, confirmDialog, datalist, icon, segmented } from '../ui.js';
import * as repo from '../repo.js';
import { uid } from '../db.js';
import { todayISO, monthLabel } from '../dates.js';
import { toDecimalString } from '../money.js';
import { UNIT_OPTIONS, UNITS } from '../units.js';
import { findMatches } from '../match.js';
import { GROCERY_CATEGORY_ID } from '../calc.js';

export function categoryOptions(ctx, kind, { includeEmpty = false } = {}) {
  const cats = ctx.data.categories.filter((c) => c.kind === kind && !c.archived);
  const roots = cats.filter((c) => !c.parentId).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.name.localeCompare(b.name));
  const out = includeEmpty ? [['', 'Choose…']] : [];
  for (const r of roots) {
    out.push([r.id, `${r.icon || ''} ${r.name}`.trim()]);
    for (const c of cats.filter((x) => x.parentId === r.id).sort((a, b) => a.name.localeCompare(b.name))) out.push([c.id, `    ↳ ${c.name}`]);
  }
  return out;
}

export function accountOptions(ctx, { includeNone = true } = {}) {
  const out = includeNone ? [['', 'Not tracked']] : [];
  for (const a of ctx.data.accounts.filter((x) => !x.archived)) out.push([a.id, `${a.name} (${repo.ACCOUNT_TYPES[a.type]})`]);
  return out;
}

export function merchantList(ctx) {
  const ms = [...ctx.data.merchants].sort((a, b) => (b.uses || 0) - (a.uses || 0)).map((m) => m.name);
  return datalist('merchant-list', ms.slice(0, 200));
}

export function catLabel(ctx, id) {
  const c = ctx.data.catsById.get(id);
  if (!c) return 'Uncategorised';
  const p = c.parentId ? ctx.data.catsById.get(c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
}

export function catIcon(ctx, id) {
  const c = ctx.data.catsById.get(id);
  const p = c?.parentId ? ctx.data.catsById.get(c.parentId) : null;
  return (p || c)?.icon || '🏷️';
}

/* ---------------- Transaction form ---------------- */

export function openTransactionForm(ctx, { txn = null, type = 'expense', preset = {} } = {}) {
  const editing = !!txn;
  const t = { id: txn?.id || uid(), type: txn?.type || type, ...preset, ...(txn || {}) };
  const d = ctx.settings.digits;
  const container = h('div');
  const draw = () => {
    container.replaceChildren(build());
  };
  const values = {
    amount: t.amountMinor !== undefined && t.amountMinor !== null ? toDecimalString(Math.abs(t.amountMinor), d) : '',
    adjSign: (t.amountMinor || 0) < 0 ? '-' : '+',
    date: t.date || todayISO(), categoryId: t.categoryId || (t.type === 'income' ? 'inc-salary' : ''),
    merchant: t.merchant || '', accountId: t.accountId ?? ctx.settings.defaultAccountId ?? '', toAccountId: t.toAccountId || '', notes: t.notes || '',
  };
  let s;
  function build() {
    const typeSeg = editing ? null : segmented(Object.entries(repo.TXN_TYPES).map(([k, v]) => [k, v]), t.type, (v) => {
      collect(); t.type = v;
      if (v === 'income' && !String(values.categoryId).startsWith('inc-')) values.categoryId = 'inc-salary';
      if ((v === 'expense' || v === 'refund') && String(values.categoryId).startsWith('inc-')) values.categoryId = '';
      draw();
    }, { label: 'Transaction type' });
    const amount = moneyInput({ name: 'amount', value: values.amount, 'aria-label': 'Amount' });
    const adjSign = t.type === 'adjustment' ? select([['+', 'Increase balance (+)'], ['-', 'Decrease balance (−)']], values.adjSign, { name: 'adjSign' }) : null;
    const date = h('input', { type: 'date', name: 'date', value: values.date, max: '2100-12-31' });
    const catKind = t.type === 'income' ? 'income' : 'expense';
    const category = (t.type === 'expense' || t.type === 'refund' || t.type === 'income') ? select(categoryOptions(ctx, catKind, { includeEmpty: true }), values.categoryId, { name: 'categoryId' }) : null;
    const merchant = (t.type !== 'transfer' && t.type !== 'adjustment') ? h('input', { type: 'text', name: 'merchant', value: values.merchant, list: 'merchant-list', autocomplete: 'off', maxlength: 80, placeholder: t.type === 'income' ? 'e.g. Employer' : 'e.g. Carrefour' }) : null;
    const account = select(accountOptions(ctx, { includeNone: t.type !== 'transfer' && t.type !== 'adjustment' }), values.accountId, { name: 'accountId' });
    const toAccount = t.type === 'transfer' ? select([['', 'Choose…'], ...accountOptions(ctx, { includeNone: false })], values.toAccountId, { name: 'toAccountId' }) : null;
    const notes = h('textarea', { name: 'notes', rows: 2, maxlength: 500, placeholder: 'Optional' }, values.notes);
    const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, editing ? 'Save changes' : 'Save');
    const acctLabel = { expense: 'Paid from', income: 'Received into', refund: 'Refunded to', transfer: 'From account', adjustment: 'Account' }[t.type];
    const hintText = {
      transfer: 'Moving money between your own accounts (e.g. paying a credit card from the bank). Not counted as spending or income.',
      refund: 'Money returned to you for an earlier purchase. Reduces your spending in the chosen category.',
      adjustment: 'Corrects a tracked balance to match reality. Not counted as income or spending.',
      income: 'Salary, reimbursements, gifts or any money received.',
      expense: '',
    }[t.type];
    const form = h('form', { class: 'form', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(save); } },
      typeSeg,
      hintText ? h('p', { class: 'hint' }, hintText) : null,
      field(`Amount (${ctx.settings.currency})`, amount),
      adjSign ? field('Direction', adjSign) : null,
      field('Date', date),
      category ? field(t.type === 'income' ? 'Source' : 'Category', category) : null,
      merchant ? field(t.type === 'income' ? 'From (payer)' : 'Merchant / payee', merchant) : null,
      ctx.data.accounts.length ? field(acctLabel, account, { hint: t.type === 'expense' && ctx.data.accounts.some((a) => a.type === 'credit') ? 'Credit card spending increases the amount owed; it does not reduce your cash.' : null }) : h('p', { class: 'hint' }, 'Tip: add your cash, bank and card accounts in Funds & Budgets to track balances.'),
      toAccount ? field('To account', toAccount) : null,
      field('Notes', notes),
      merchantList(ctx),
      h('div', { class: 'btn-row' },
        editing ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: () => removeTxn() }, icon('trash'), 'Delete') : null,
        save));
    form._controls = { amount, adjSign, date, category, merchant, account, toAccount, notes };
    container._form = form;
    return form;
  }
  function collect() {
    const c = container._form?._controls;
    if (!c) return;
    values.amount = c.amount.value; values.date = c.date.value; values.notes = c.notes.value;
    if (c.adjSign) values.adjSign = c.adjSign.value;
    if (c.category) values.categoryId = c.category.value;
    if (c.merchant) values.merchant = c.merchant.value;
    values.accountId = c.account.value;
    if (c.toAccount) values.toAccountId = c.toAccount.value;
  }
  async function submit(btn) {
    collect();
    const c = container._form._controls;
    let amountMinor = ctx.parse(values.amount);
    if (amountMinor === null) { setFieldError(c.amount, 'Enter a valid amount, e.g. 25.50'); c.amount.focus(); return; }
    setFieldError(c.amount, '');
    if (t.type === 'adjustment' && values.adjSign === '-') amountMinor = -amountMinor;
    const rec = { ...txn, id: t.id, type: t.type, amountMinor, date: values.date, categoryId: values.categoryId || null, merchant: values.merchant, accountId: values.accountId || null, toAccountId: values.toAccountId || null, notes: values.notes, currency: txn?.currency || ctx.settings.currency };
    const errs = repo.validateTransaction(rec);
    const map = { amountMinor: c.amount, date: c.date, categoryId: c.category, accountId: c.account, toAccountId: c.toAccount, notes: c.notes };
    for (const [k, el] of Object.entries(map)) if (el) setFieldError(el, errs[k] || '');
    if (Object.keys(errs).length) return;
    await busy(btn, async () => {
      try {
        await repo.saveTransaction(rec, { currency: ctx.settings.currency });
        s.close();
        const moved = rec.date.slice(0, 7) !== ctx.ui.month;
        if (moved) ctx.ui.month = rec.date.slice(0, 7); // show the month the transaction belongs to
        toast(editing ? 'Changes saved' : moved ? `Saved in ${monthLabel(ctx.ui.month)}` : 'Saved', { tone: 'good' });
        await ctx.refresh();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  }
  async function removeTxn() {
    let withReceipt = false;
    const extra = txn.receiptId ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox', onchange: (e) => { withReceipt = e.target.checked; } }), 'Also delete the scanned receipt and its price-history lines') : null;
    const ok = await confirmDialog({ title: 'Delete transaction?', message: 'This cannot be undone. Account balances will be recalculated automatically.', confirmText: 'Delete', danger: true, extra });
    if (!ok) return;
    await repo.deleteTransaction(txn.id, { withReceipt });
    s.close();
    toast('Deleted', { tone: 'good' });
    await ctx.refresh();
  }
  draw();
  s = openSheet(editing ? 'Edit transaction' : 'Add transaction', container);
  return s;
}

/* ---------------- Account form ---------------- */

export function openAccountForm(ctx, account = null) {
  const d = ctx.settings.digits;
  const name = h('input', { type: 'text', value: account?.name || '', maxlength: 40, placeholder: 'e.g. ENBD Current, Wallet cash' });
  const type = select(Object.entries(repo.ACCOUNT_TYPES), account?.type || 'bank');
  const opening = moneyInput({ value: account ? toDecimalString(Math.abs(account.openingBalanceMinor), d) : '' });
  const owed = h('input', { type: 'checkbox', checked: account ? account.openingBalanceMinor < 0 : false });
  const date = h('input', { type: 'date', value: account?.openingDate || todayISO() });
  const limit = moneyInput({ value: account?.creditLimitMinor ? toDecimalString(account.creditLimitMinor, d) : '' });
  const limitField = field('Credit limit (optional)', limit, { hint: 'For information only — a credit limit is never counted as available money.' });
  const owedRow = h('label', { class: 'check-row' }, owed, 'This is money owed (e.g. an unpaid credit card balance)');
  const sync = () => { limitField.style.display = type.value === 'credit' ? '' : 'none'; };
  type.addEventListener('change', () => { if (type.value === 'credit' && !opening.value) owed.checked = true; sync(); });
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save account');
  let s;
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const amt = opening.value.trim() ? ctx.parse(opening.value) : 0;
    if (amt === null) { setFieldError(opening, 'Enter a valid amount'); return; }
    const lim = limit.value.trim() ? ctx.parse(limit.value) : null;
    await busy(save, async () => {
      try {
        await repo.saveAccount({ ...account, name: name.value, type: type.value, openingBalanceMinor: owed.checked ? -amt : amt, openingDate: date.value, creditLimitMinor: lim });
        s.close(); toast('Account saved', { tone: 'good' }); await ctx.refresh();
      } catch (err) { toast(err.message, { tone: 'error' }); }
    });
  } },
    field('Account name', name), field('Type', type),
    field(`Opening balance (${ctx.settings.currency})`, opening, { hint: 'The amount in this account when you started tracking it. This is your own record — it is not connected to your bank.' }),
    owedRow, field('Balance as of', date), limitField,
    h('div', { class: 'btn-row' },
      account ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
        const ok = await confirmDialog({ title: account.archived ? 'Restore account?' : 'Archive account?', message: account.archived ? 'The account will appear in lists again.' : 'Archived accounts are hidden from forms and totals. Their past transactions are kept.', confirmText: account.archived ? 'Restore' : 'Archive' });
        if (!ok) return;
        await repo.saveAccount({ ...account, archived: !account.archived }); s.close(); await ctx.refresh();
      } }, account.archived ? 'Restore' : 'Archive') : null,
      save));
  s = openSheet(account ? 'Edit account' : 'Add account', form);
  sync();
}

/* ---------------- Item form ---------------- */

export function openItemForm(ctx, item = null, { onSaved, presetName = '' } = {}) {
  const d = ctx.settings.digits;
  const name = h('input', { type: 'text', value: item?.name || presetName, maxlength: 80, placeholder: 'e.g. Basmati Rice' });
  const brand = h('input', { type: 'text', value: item?.brand || '', maxlength: 40, placeholder: 'Optional' });
  const cat = select(categoryOptions(ctx, 'grocery'), item?.categoryId || 'gro-other');
  const sub = h('input', { type: 'text', value: item?.subcategory || '', maxlength: 40, placeholder: 'Optional, e.g. Leafy greens' });
  const unit = select(UNIT_OPTIONS.map((u) => [u, UNITS[u].label]), item?.unit || 'pc');
  const typical = h('input', { type: 'text', inputmode: 'decimal', value: item?.typicalQty ?? 1 });
  const packSize = h('input', { type: 'text', inputmode: 'decimal', value: item?.packSize ?? '', placeholder: 'Optional, e.g. 5 for a 5 kg bag' });
  const store = h('input', { type: 'text', value: item?.preferredStore || '', list: 'merchant-list', maxlength: 60 });
  const target = moneyInput({ value: item?.targetPriceMinor ? toDecimalString(item.targetPriceMinor, d) : '' });
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save item');
  let s;
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const tq = Number(String(typical.value).replace(',', '.'));
    const ps = packSize.value.trim() ? Number(String(packSize.value).replace(',', '.')) : null;
    if (!(tq > 0)) { setFieldError(typical, 'Enter a quantity greater than 0'); return; }
    if (ps !== null && !(ps > 0)) { setFieldError(packSize, 'Enter a size greater than 0'); return; }
    const tp = target.value.trim() ? ctx.parse(target.value) : null;
    const rec = { ...item, name: name.value, brand: brand.value, categoryId: cat.value, subcategory: sub.value, unit: unit.value, typicalQty: tq, packSize: ps, preferredStore: store.value, targetPriceMinor: tp };
    await busy(save, async () => {
      try {
        const saved = await repo.saveItem(rec);
        s.close(); toast('Item saved', { tone: 'good' }); await ctx.refresh({ rerender: !onSaved });
        onSaved?.(saved);
      } catch (err) {
        if (err.duplicate) {
          setFieldError(name, err.message);
          const use = await confirmDialog({ title: 'Already in catalogue', message: `${err.message} Use the existing item instead?`, confirmText: 'Use existing' });
          if (use) { s.close(); onSaved?.(err.duplicate); }
        } else toast(err.message, { tone: 'error' });
      }
    });
  } },
    field('Item name', name), field('Brand', brand), field('Category', cat), field('Subcategory', sub),
    h('div', { class: 'grid-2' }, field('Unit', unit), field('Usual quantity', typical)),
    field('Pack size (in the unit above)', packSize, { hint: 'Used for fair price comparison between different pack sizes.' }),
    field('Preferred store', store), field(`Target price (${ctx.settings.currency}, optional)`, target),
    merchantList(ctx), save);
  s = openSheet(item ? 'Edit item' : 'New grocery item', form);
}

/* ---------------- Item picker ---------------- */

export function pickItem(ctx, { title = 'Add item', onPick, exclude = new Set(), topAction = null }) {
  const q = h('input', { type: 'search', placeholder: 'Search or type a new item…', autocomplete: 'off', 'aria-label': 'Search items' });
  const results = h('div', { class: 'pick-list' });
  let s;
  const draw = () => {
    const text = q.value.trim();
    const items = ctx.data.items.filter((i) => !i.archived);
    let list;
    if (text) {
      const m = findMatches(text, items, ctx.data.aliases, { limit: 12, min: 0.3 });
      const sub = items.filter((i) => i.name.toLowerCase().includes(text.toLowerCase()));
      const ids = [...new Set([...sub.map((i) => i.id), ...m.map((x) => x.itemId)])];
      list = ids.map((id) => ctx.data.itemsById.get(id)).filter(Boolean);
    } else {
      list = [...items].sort((a, b) => a.name.localeCompare(b.name));
    }
    results.replaceChildren(
      topAction ? h('button', { type: 'button', class: 'pick-row pick-new', onclick: () => { s.close(); topAction.onClick(); } }, icon('plus'), h('span', {}, topAction.label)) : null,
      text && !list.some((i) => i.name.toLowerCase() === text.toLowerCase())
        ? h('button', { type: 'button', class: 'pick-row pick-new', onclick: () => { s.close(); openItemForm(ctx, null, { presetName: text, onSaved: (it) => onPick(it) }); } }, icon('plus'), h('span', {}, `Create “${text}”`))
        : null,
      ...list.slice(0, 60).map((it) => h('button', { type: 'button', class: 'pick-row', disabled: exclude.has(it.id), onclick: () => { s.close(); onPick(it); } },
        h('span', { class: 'pick-emoji' }, catIcon(ctx, it.categoryId)),
        h('span', { class: 'grow' }, it.name, it.brand ? h('span', { class: 'muted small' }, ` · ${it.brand}`) : null),
        exclude.has(it.id) ? h('span', { class: 'muted small' }, 'on list') : null)),
      !list.length && !text ? h('p', { class: 'muted' }, 'Your catalogue is empty. Type a name above to create your first item.') : null);
  };
  q.addEventListener('input', draw);
  draw();
  s = openSheet(title, h('div', {}, q, results));
  setTimeout(() => q.focus(), 80);
}

/* ---------------- Category form ---------------- */

export function openCategoryForm(ctx, { kind = 'expense', category = null } = {}) {
  const name = h('input', { type: 'text', value: category?.name || '', maxlength: 40 });
  const emoji = h('input', { type: 'text', value: category?.icon || '🏷️', maxlength: 4, class: 'emoji-input', 'aria-label': 'Icon (emoji)' });
  const parents = [['', '— Main category —'], ...ctx.data.categories.filter((c) => c.kind === kind && !c.parentId && c.id !== category?.id && !c.archived).map((c) => [c.id, c.name])];
  const parent = select(parents, category?.parentId || '');
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save category');
  let s;
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    if (category?.id === GROCERY_CATEGORY_ID && parent.value) { toast('Groceries must stay a main category.', { tone: 'error' }); return; }
    await busy(save, async () => {
      try { await repo.saveCategory({ ...category, kind, name: name.value, icon: emoji.value, parentId: parent.value || null }); s.close(); toast('Category saved', { tone: 'good' }); await ctx.refresh(); }
      catch (err) { toast(err.message, { tone: 'error' }); }
    });
  } },
    h('div', { class: 'grid-icon' }, field('Icon', emoji), field('Name', name)),
    kind !== 'grocery' ? field('Belongs to', parent, { hint: 'Make it a subcategory of a main category, or leave as a main category.' }) : null,
    h('div', { class: 'btn-row' },
      category && !category.builtIn ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await repo.saveCategory({ ...category, archived: !category.archived }); s.close(); await ctx.refresh(); } }, category.archived ? 'Restore' : 'Hide') : null,
      save));
  s = openSheet(category ? 'Edit category' : 'New category', form);
}

/* ---------------- Recurring form ---------------- */

export function openRecurringForm(ctx, rec = null) {
  const d = ctx.settings.digits;
  const type = select([['expense', 'Expense'], ['income', 'Money received']], rec?.type || 'expense');
  const amount = moneyInput({ value: rec ? toDecimalString(rec.amountMinor, d) : '' });
  const cat = select(categoryOptions(ctx, rec?.type === 'income' ? 'income' : 'expense', { includeEmpty: true }), rec?.categoryId || '');
  type.addEventListener('change', () => { cat.replaceWith(Object.assign(select(categoryOptions(ctx, type.value === 'income' ? 'income' : 'expense', { includeEmpty: true }), ''), { id: cat.id })); });
  const merchant = h('input', { type: 'text', value: rec?.merchant || '', list: 'merchant-list', placeholder: 'e.g. DEWA, Netflix, Landlord' });
  const freq = select([['monthly', 'Every month'], ['weekly', 'Every week'], ['yearly', 'Every year']], rec?.frequency || 'monthly');
  const next = h('input', { type: 'date', value: rec?.nextDate || todayISO() });
  const account = select(accountOptions(ctx), rec?.accountId || '');
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save');
  let s;
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const amt = ctx.parse(amount.value);
    if (!amt) { setFieldError(amount, 'Enter a valid amount'); return; }
    const catEl = form.querySelector(`#${cat.id}`) || cat;
    await busy(save, async () => {
      try {
        await repo.saveRecurring({ ...rec, type: type.value, amountMinor: amt, categoryId: catEl.value || null, merchant: merchant.value, frequency: freq.value, nextDate: next.value, accountId: account.value || null, currency: ctx.settings.currency, anchorDay: rec?.nextDate === next.value ? rec.anchorDay : null });
        s.close(); toast('Saved', { tone: 'good' }); await ctx.refresh();
      } catch (err) { toast(err.message, { tone: 'error' }); }
    });
  } },
    h('p', { class: 'hint' }, 'Recurring items are never recorded silently: when one is due, the dashboard asks you to confirm or skip it.'),
    field('Type', type), field(`Amount (${ctx.settings.currency})`, amount), field('Category', cat), field('Merchant / payee', merchant),
    field('Repeats', freq), field('Next due date', next), field('Account', account), merchantList(ctx),
    h('div', { class: 'btn-row' },
      rec ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await repo.saveRecurring({ ...rec, active: !rec.active }); s.close(); await ctx.refresh(); } }, rec.active ? 'Pause' : 'Resume') : null,
      save));
  s = openSheet(rec ? 'Edit recurring' : 'New recurring payment', form);
}
