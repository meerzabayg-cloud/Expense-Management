// Business operations. Every operation that touches more than one kind of
// record runs in a single database transaction, so a receipt, its expense
// and its price-history entries are always saved together or not at all.

import { tx, all, get, byIndex, put, uid } from './db.js';
import { normaliseName } from './match.js';
import { allocate } from './money.js';
import { todayISO, monthOf, addMonths, advance, isValidISODate } from './dates.js';
import { GROCERY_CATEGORY_ID } from './calc.js';

export const DEFAULT_SETTINGS = {
  currency: 'AED',
  digits: 2,
  theme: 'system',
  onboarded: false,
  userName: '',
  imageRetention: 'compressed', // 'compressed' | 'none'
  lastBackupAt: null,
  backupReminderDays: 14,
  defaultAccountId: null,
};

export const EXPENSE_CATEGORIES = [
  ['exp-groceries', 'Groceries', '🛒', '#16a34a'],
  ['exp-housing', 'Housing & Rent', '🏠', '#7c3aed'],
  ['exp-utilities', 'Utilities', '💡', '#0891b2'],
  ['exp-transport', 'Transport & Fuel', '🚗', '#ea580c'],
  ['exp-medical', 'Medical & Healthcare', '🩺', '#dc2626'],
  ['exp-education', 'Education', '🎓', '#2563eb'],
  ['exp-shopping', 'Shopping', '🛍️', '#db2777'],
  ['exp-dining', 'Dining & Restaurants', '🍽️', '#f59e0b'],
  ['exp-entertainment', 'Entertainment', '🎬', '#8b5cf6'],
  ['exp-subscriptions', 'Subscriptions', '🔁', '#0d9488'],
  ['exp-travel', 'Travel', '✈️', '#0284c7'],
  ['exp-family', 'Family & Children', '👨‍👩‍👧', '#e11d48'],
  ['exp-personal', 'Personal Expenses', '🙂', '#65a30d'],
  ['exp-misc', 'Miscellaneous', '📦', '#64748b'],
];

export const INCOME_CATEGORIES = [
  ['inc-salary', 'Salary', '💼', '#16a34a'],
  ['inc-business', 'Business income', '🏪', '#0d9488'],
  ['inc-reimbursement', 'Reimbursement', '↩️', '#2563eb'],
  ['inc-gift', 'Gift / Family support', '🎁', '#db2777'],
  ['inc-other', 'Other income', '➕', '#64748b'],
];

export const GROCERY_CATEGORIES = [
  ['gro-vegetables', 'Vegetables', '🥦'], ['gro-fruits', 'Fruits', '🍎'], ['gro-dairy', 'Dairy', '🥛'],
  ['gro-meat', 'Meat', '🥩'], ['gro-fish', 'Fish', '🐟'], ['gro-frozen', 'Frozen Foods', '🧊'],
  ['gro-grains', 'Rice & Grains', '🌾'], ['gro-cooking', 'Cooking Essentials', '🧂'], ['gro-bakery', 'Bakery', '🍞'],
  ['gro-beverages', 'Beverages', '🧃'], ['gro-snacks', 'Snacks', '🍪'], ['gro-cleaning', 'Household Cleaning', '🧽'],
  ['gro-personal', 'Personal Care', '🧴'], ['gro-other', 'Other', '🛍️'],
];

export const ACCOUNT_TYPES = {
  cash: 'Cash', bank: 'Bank account', debit: 'Debit card', credit: 'Credit card', wallet: 'Digital wallet', other: 'Other',
};

export const TXN_TYPES = {
  expense: 'Expense', income: 'Money received', transfer: 'Transfer', refund: 'Refund', adjustment: 'Balance adjustment',
};

const STARTER_ITEMS = [
  ['Tomatoes', 'gro-vegetables', 'kg', 1], ['Onions', 'gro-vegetables', 'kg', 2], ['Potatoes', 'gro-vegetables', 'kg', 2],
  ['Cucumber', 'gro-vegetables', 'kg', 1], ['Bananas', 'gro-fruits', 'kg', 1], ['Apples', 'gro-fruits', 'kg', 1],
  ['Fresh Milk', 'gro-dairy', 'l', 2], ['Laban', 'gro-dairy', 'l', 1], ['Yoghurt', 'gro-dairy', 'pc', 2], ['Eggs', 'gro-dairy', 'tray', 1],
  ['Cheese', 'gro-dairy', 'pack', 1], ['Butter', 'gro-dairy', 'pack', 1], ['Chicken', 'gro-meat', 'kg', 1],
  ['Basmati Rice', 'gro-grains', 'kg', 5], ['Bread', 'gro-bakery', 'pack', 2], ['Cooking Oil', 'gro-cooking', 'l', 1.5],
  ['Sugar', 'gro-cooking', 'kg', 1], ['Salt', 'gro-cooking', 'pack', 1], ['Tea', 'gro-beverages', 'pack', 1],
  ['Drinking Water', 'gro-beverages', 'pack', 1], ['Dishwashing Liquid', 'gro-cleaning', 'bottle', 1],
  ['Laundry Detergent', 'gro-cleaning', 'pack', 1], ['Tissue Paper', 'gro-cleaning', 'pack', 1], ['Toothpaste', 'gro-personal', 'pc', 1],
];

const now = () => Date.now();

/* ---------------- Settings ---------------- */

export async function getSettings() {
  const rows = await all('settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export async function saveSettings(patch) {
  await tx('settings', 'readwrite', async (h) => {
    for (const [key, value] of Object.entries(patch)) await h.put('settings', { key, value });
  });
}

/* ---------------- Seeding ---------------- */

export async function ensureSeeded() {
  await tx(['categories'], 'readwrite', async (h) => {
    const existing = await h.all('categories');
    const have = new Set(existing.map((c) => c.id));
    let sort = 0;
    for (const [id, name, icon, color] of EXPENSE_CATEGORIES) if (!have.has(id)) await h.put('categories', { id, name, icon, color, kind: 'expense', parentId: null, sort: sort++, builtIn: true });
    for (const [id, name, icon, color] of INCOME_CATEGORIES) if (!have.has(id)) await h.put('categories', { id, name, icon, color, kind: 'income', parentId: null, sort: sort++, builtIn: true });
    for (const [id, name, icon] of GROCERY_CATEGORIES) if (!have.has(id)) await h.put('categories', { id, name, icon, kind: 'grocery', parentId: null, sort: sort++, builtIn: true });
  });
}

export async function addStarterItems() {
  const existing = await all('items');
  const have = new Set(existing.map((i) => i.nameNorm));
  let added = 0;
  await tx(['items'], 'readwrite', async (h) => {
    for (const [name, categoryId, unit, typicalQty] of STARTER_ITEMS) {
      const nameNorm = normaliseName(name);
      if (have.has(nameNorm)) continue;
      await h.put('items', newItemRecord({ name, categoryId, unit, typicalQty }));
      added++;
    }
  });
  return added;
}

/* ---------------- Categories ---------------- */

export async function saveCategory(cat) {
  const name = String(cat.name || '').trim();
  if (!name) throw new Error('Please enter a category name.');
  if (name.length > 40) throw new Error('Category name is too long.');
  const rec = { id: cat.id || uid(), name, icon: cat.icon || '🏷️', color: cat.color || '#64748b', kind: cat.kind || 'expense', parentId: cat.parentId || null, sort: cat.sort ?? 999, archived: !!cat.archived, builtIn: !!cat.builtIn };
  await put('categories', rec);
  return rec;
}

/* ---------------- Merchants ---------------- */

async function rememberMerchant(h, name) {
  const n = String(name || '').trim();
  if (!n) return;
  const nameNorm = n.toLowerCase().replace(/\s+/g, ' ');
  const found = await h.byIndex('merchants', 'nameNorm', nameNorm);
  if (found.length) { const m = found[0]; m.lastUsed = now(); m.uses = (m.uses || 0) + 1; await h.put('merchants', m); }
  else await h.put('merchants', { id: uid(), name: n, nameNorm, uses: 1, lastUsed: now() });
}

/* ---------------- Accounts ---------------- */

export async function saveAccount(a) {
  const name = String(a.name || '').trim();
  if (!name) throw new Error('Please enter a name for this account.');
  if (!ACCOUNT_TYPES[a.type]) throw new Error('Please choose an account type.');
  if (!Number.isSafeInteger(a.openingBalanceMinor ?? 0)) throw new Error('Opening balance is not valid.');
  const rec = {
    id: a.id || uid(), name, type: a.type, openingBalanceMinor: a.openingBalanceMinor || 0,
    openingDate: a.openingDate || todayISO(), creditLimitMinor: a.type === 'credit' ? a.creditLimitMinor || null : null,
    archived: !!a.archived, createdAt: a.createdAt || now(),
  };
  await put('accounts', rec);
  return rec;
}

/* ---------------- Transactions ---------------- */

export function validateTransaction(t) {
  const errors = {};
  if (!TXN_TYPES[t.type]) errors.type = 'Choose a transaction type.';
  if (!Number.isSafeInteger(t.amountMinor)) errors.amountMinor = 'Enter a valid amount.';
  else if (t.type === 'adjustment' ? t.amountMinor === 0 : t.amountMinor <= 0) errors.amountMinor = 'Amount must be greater than zero.';
  else if (Math.abs(t.amountMinor) > 1e12) errors.amountMinor = 'Amount is too large.';
  if (!isValidISODate(t.date)) errors.date = 'Enter a valid date.';
  if ((t.type === 'expense' || t.type === 'refund') && !t.categoryId) errors.categoryId = 'Choose a category.';
  if (t.type === 'transfer') {
    if (!t.accountId) errors.accountId = 'Choose the account money leaves.';
    if (!t.toAccountId) errors.toAccountId = 'Choose the account money goes to.';
    if (t.accountId && t.accountId === t.toAccountId) errors.toAccountId = 'Choose two different accounts.';
  }
  if (t.type === 'adjustment' && !t.accountId) errors.accountId = 'Choose the account to adjust.';
  if ((t.notes || '').length > 500) errors.notes = 'Notes are too long (500 characters max).';
  return errors;
}

/**
 * Create or update a transaction. The id is generated when the form opens,
 * so pressing Save twice cannot create two copies.
 */
export async function saveTransaction(t, { currency } = {}) {
  const errors = validateTransaction(t);
  if (Object.keys(errors).length) { const e = new Error(Object.values(errors)[0]); e.fields = errors; throw e; }
  return tx(['transactions', 'merchants'], 'readwrite', async (h) => {
    const existing = t.id ? await h.get('transactions', t.id) : null;
    const rec = {
      ...(existing || {}),
      id: t.id || uid(), type: t.type, amountMinor: t.amountMinor, currency: t.currency || currency || existing?.currency || 'AED',
      date: t.date, categoryId: t.type === 'transfer' || t.type === 'adjustment' ? null : t.categoryId || null,
      merchant: String(t.merchant || '').trim().slice(0, 80), accountId: t.accountId || null,
      toAccountId: t.type === 'transfer' ? t.toAccountId : null, notes: String(t.notes || '').trim(),
      receiptId: t.receiptId ?? existing?.receiptId ?? null, listId: t.listId ?? existing?.listId ?? null,
      recurringId: t.recurringId ?? existing?.recurringId ?? null,
      createdAt: existing?.createdAt || now(), updatedAt: now(),
    };
    await h.put('transactions', rec);
    if (rec.merchant && (rec.type === 'expense' || rec.type === 'refund')) await rememberMerchant(h, rec.merchant);
    return rec;
  });
}

/**
 * Delete a transaction. Balances are always recalculated from the remaining
 * transactions, so they reverse automatically. If the expense came from a
 * receipt, the receipt and its price-history lines can be removed too.
 */
export async function deleteTransaction(id, { withReceipt = false } = {}) {
  await tx(['transactions', 'purchases', 'receipts', 'receiptImages', 'listEntries'], 'readwrite', async (h) => {
    const t = await h.get('transactions', id);
    if (!t) return;
    const linked = await h.byIndex('purchases', 'transactionId', id);
    for (const p of linked) {
      if (withReceipt) {
        if (p.listEntryId) await unlinkEntry(h, p.listEntryId, p.id);
        await h.del('purchases', p.id);
      } else {
        // keep the price history, just detach it from the deleted expense
        p.transactionId = null; await h.put('purchases', p);
      }
    }
    if (t.receiptId) {
      if (withReceipt) { await h.del('receipts', t.receiptId); await h.del('receiptImages', t.receiptId); }
      else { const r = await h.get('receipts', t.receiptId); if (r) { r.transactionId = null; await h.put('receipts', r); } }
    }
    await h.del('transactions', id);
  });
}

async function unlinkEntry(h, entryId, purchaseId) {
  const e = await h.get('listEntries', entryId);
  if (e && e.purchaseId === purchaseId) {
    e.purchaseId = null; e.checked = false; e.actualTotalMinor = null; e.actualQty = null;
    await h.put('listEntries', e);
  }
}

/* ---------------- Recurring ---------------- */

export async function saveRecurring(r) {
  const errors = validateTransaction({ ...r, date: r.nextDate });
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  if (!['weekly', 'monthly', 'yearly'].includes(r.frequency)) throw new Error('Choose how often it repeats.');
  const rec = { ...r, id: r.id || uid(), anchorDay: r.anchorDay || Number(r.nextDate.slice(8, 10)), active: r.active !== false, createdAt: r.createdAt || now() };
  await put('recurring', rec);
  return rec;
}

export function dueRecurring(recurring, today = todayISO()) {
  return recurring.filter((r) => r.active && r.nextDate <= today).sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
}

/** Record the due occurrence as a real transaction (after the user taps "Record"). */
export async function recordRecurring(id, { currency } = {}) {
  return tx(['recurring', 'transactions', 'merchants'], 'readwrite', async (h) => {
    const r = await h.get('recurring', id);
    if (!r) throw new Error('Recurring item not found.');
    const tid = `rec-${r.id}-${r.nextDate}`; // deterministic: the same occurrence can only be recorded once
    const exists = await h.get('transactions', tid);
    if (!exists) {
      await h.put('transactions', {
        id: tid, type: r.type, amountMinor: r.amountMinor, currency: r.currency || currency || 'AED', date: r.nextDate,
        categoryId: r.categoryId || null, merchant: r.merchant || '', accountId: r.accountId || null, toAccountId: r.toAccountId || null,
        notes: r.notes || '', recurringId: r.id, receiptId: null, listId: null, createdAt: now(), updatedAt: now(),
      });
      if (r.merchant) await rememberMerchant(h, r.merchant);
    }
    r.nextDate = advance(r.nextDate, r.frequency, r.anchorDay);
    await h.put('recurring', r);
    return tid;
  });
}

export async function skipRecurring(id) {
  await tx('recurring', 'readwrite', async (h) => {
    const r = await h.get('recurring', id);
    if (!r) return;
    r.nextDate = advance(r.nextDate, r.frequency, r.anchorDay);
    await h.put('recurring', r);
  });
}

/* ---------------- Budgets ---------------- */

export async function setBudget(month, categoryId, amountMinor) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month.');
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('Enter a valid budget amount.');
  const id = `${month}|${categoryId}`;
  await put('budgets', { id, month, categoryId, amountMinor, updatedAt: now() });
}

/* ---------------- Items (grocery catalogue) ---------------- */

function newItemRecord({ name, brand, categoryId, subcategory, unit, typicalQty, packSize, preferredStore, targetPriceMinor }) {
  return {
    id: uid(), name: String(name).trim(), nameNorm: normaliseName(`${name}`), brand: (brand || '').trim(),
    categoryId: categoryId || 'gro-other', subcategory: (subcategory || '').trim(), unit: unit || 'pc',
    typicalQty: Number(typicalQty) > 0 ? Number(typicalQty) : 1, packSize: Number(packSize) > 0 ? Number(packSize) : null,
    preferredStore: (preferredStore || '').trim(), targetPriceMinor: Number.isSafeInteger(targetPriceMinor) ? targetPriceMinor : null,
    archived: false, createdAt: now(), updatedAt: now(),
  };
}

/** Returns an existing item that has the same normalised name or alias, if any. */
export async function findDuplicateItem(name, exceptId) {
  const n = normaliseName(name);
  if (!n) return null;
  const items = await byIndex('items', 'nameNorm', n);
  const hit = items.find((i) => i.id !== exceptId && !i.archived);
  if (hit) return hit;
  const al = await byIndex('aliases', 'aliasNorm', n);
  for (const a of al) {
    if (a.itemId === exceptId) continue;
    const it = await get('items', a.itemId);
    if (it && !it.archived) return it;
  }
  return null;
}

export async function saveItem(item, { allowDuplicate = false } = {}) {
  const name = String(item.name || '').trim();
  if (!name) throw new Error('Please enter the item name.');
  if (name.length > 80) throw new Error('Item name is too long.');
  if (!allowDuplicate) {
    const dup = await findDuplicateItem(name, item.id);
    if (dup) { const e = new Error(`"${dup.name}" is already in your catalogue.`); e.duplicate = dup; throw e; }
  }
  if (item.id) {
    const cur = await get('items', item.id);
    const rec = { ...cur, ...newItemRecord({ ...cur, ...item, name }), id: item.id, createdAt: cur?.createdAt || now(), archived: !!item.archived };
    await put('items', rec);
    return rec;
  }
  const rec = newItemRecord({ ...item, name });
  await put('items', rec);
  return rec;
}

export async function addAlias(itemId, text) {
  const aliasNorm = normaliseName(text);
  if (!aliasNorm) return;
  await tx(['aliases', 'items'], 'readwrite', (h) => addAliasIn(h, itemId, text, aliasNorm));
}

async function addAliasIn(h, itemId, text, aliasNorm = normaliseName(text)) {
  if (!aliasNorm) return;
  const item = await h.get('items', itemId);
  if (item && item.nameNorm === aliasNorm) return;
  const existing = await h.byIndex('aliases', 'aliasNorm', aliasNorm);
  if (existing.some((a) => a.itemId === itemId)) return;
  for (const a of existing) await h.del('aliases', a.id); // an alias belongs to one item: the latest confirmation wins
  await h.put('aliases', { id: uid(), itemId, alias: String(text).trim().slice(0, 80), aliasNorm, createdAt: now() });
}

export async function deleteAlias(id) { await tx('aliases', 'readwrite', (h) => h.del('aliases', id)); }

/** Merge source item into target: history, list entries and aliases move to target; source is removed. */
export async function mergeItems(sourceId, targetId) {
  if (sourceId === targetId) throw new Error('Choose two different items to merge.');
  await tx(['items', 'aliases', 'purchases', 'listEntries'], 'readwrite', async (h) => {
    const src = await h.get('items', sourceId);
    const tgt = await h.get('items', targetId);
    if (!src || !tgt) throw new Error('Item not found.');
    for (const p of await h.byIndex('purchases', 'itemId', sourceId)) { p.itemId = targetId; await h.put('purchases', p); }
    for (const e of await h.byIndex('listEntries', 'itemId', sourceId)) { e.itemId = targetId; e.name = tgt.name; await h.put('listEntries', e); }
    for (const a of await h.byIndex('aliases', 'itemId', sourceId)) { a.itemId = targetId; await h.put('aliases', a); }
    await addAliasIn(h, targetId, src.name);
    await h.del('items', sourceId);
  });
}

/* ---------------- Purchases ---------------- */

function purchaseRecord(p) {
  return {
    id: p.id || uid(), itemId: p.itemId, date: p.date, merchant: (p.merchant || '').trim(),
    qty: Number(p.qty) > 0 ? Number(p.qty) : 1, packSize: Number(p.packSize) > 0 ? Number(p.packSize) : null, packUnit: p.packUnit || 'pc',
    totalMinor: Math.round(p.totalMinor), discountMinor: p.discountMinor || 0, description: p.description || '',
    receiptId: p.receiptId || null, transactionId: p.transactionId || null, listEntryId: p.listEntryId || null,
    source: p.source || 'manual', createdAt: p.createdAt || now(),
  };
}

export async function savePurchase(p) {
  if (!p.itemId) throw new Error('Choose an item.');
  if (!isValidISODate(p.date)) throw new Error('Enter a valid date.');
  if (!Number.isSafeInteger(Math.round(p.totalMinor)) || p.totalMinor < 0) throw new Error('Enter a valid price.');
  return tx(['purchases', 'merchants'], 'readwrite', async (h) => {
    const rec = purchaseRecord(p);
    await h.put('purchases', rec);
    await rememberMerchant(h, rec.merchant);
    return rec;
  });
}

export async function deletePurchase(id) {
  await tx(['purchases', 'listEntries'], 'readwrite', async (h) => {
    const p = await h.get('purchases', id);
    if (!p) return;
    if (p.listEntryId) await unlinkEntry(h, p.listEntryId, p.id);
    await h.del('purchases', id);
  });
}

/* ---------------- Shopping lists ---------------- */

export async function createList({ name, month, mode = 'blank', templateId, sourceListId }) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose a month.');
  return tx(['lists', 'listEntries', 'items', 'purchases', 'templates'], 'readwrite', async (h) => {
    const list = { id: uid(), name: (name || '').trim() || 'Grocery list', month, status: 'active', createdAt: now(), completedAt: null };
    await h.put('lists', list);
    const items = new Map((await h.all('items')).map((i) => [i.id, i]));
    const purchases = await h.all('purchases');
    const lastByItem = lastPurchaseMap(purchases);
    const seeds = [];
    if (mode === 'previous') {
      const prev = addMonths(month, -1);
      const prevPurch = purchases.filter((p) => monthOf(p.date) === prev);
      const qtyByItem = new Map();
      for (const p of prevPurch) qtyByItem.set(p.itemId, (qtyByItem.get(p.itemId) || 0) + p.qty);
      const prevLists = (await h.all('lists')).filter((l) => l.month === prev && l.id !== list.id);
      for (const l of prevLists) for (const e of await h.byIndex('listEntries', 'listId', l.id)) if (!qtyByItem.has(e.itemId)) qtyByItem.set(e.itemId, e.plannedQty);
      for (const [itemId, qty] of qtyByItem) seeds.push({ itemId, qty });
    } else if (mode === 'template' && templateId) {
      const t = await h.get('templates', templateId);
      for (const e of t?.entries || []) seeds.push({ itemId: e.itemId, qty: e.qty });
    } else if (mode === 'carry' && sourceListId) {
      for (const e of await h.byIndex('listEntries', 'listId', sourceListId)) if (!e.checked) seeds.push({ itemId: e.itemId, qty: e.plannedQty, carriedFrom: sourceListId });
    }
    let sort = 0;
    const seen = new Set();
    for (const s of seeds) {
      const it = items.get(s.itemId);
      if (!it || it.archived || seen.has(it.id)) continue;
      seen.add(it.id);
      await h.put('listEntries', entryRecord(list.id, it, s.qty, lastByItem.get(it.id), sort++, s.carriedFrom));
    }
    return list;
  });
}

function lastPurchaseMap(purchases) {
  const m = new Map();
  for (const p of purchases) {
    const cur = m.get(p.itemId);
    if (!cur || cur.date < p.date || (cur.date === p.date && (cur.createdAt || 0) < (p.createdAt || 0))) m.set(p.itemId, p);
  }
  return m;
}

/** Estimated price per planned unit, taken from the last purchase (price per pack bought). */
function estimateFrom(last) {
  if (!last || !(last.qty > 0)) return null;
  return Math.round(last.totalMinor / last.qty);
}

function entryRecord(listId, item, qty, last, sort, carriedFrom = null) {
  return {
    id: uid(), listId, itemId: item.id, name: item.name, categoryId: item.categoryId,
    plannedQty: Number(qty) > 0 ? Number(qty) : item.typicalQty || 1, unit: last?.packUnit || item.unit,
    estPriceMinor: estimateFrom(last), checked: false, actualQty: null, actualTotalMinor: null, store: '', date: null,
    purchaseId: null, carriedFrom, sort, createdAt: now(),
  };
}

export async function addListEntry(listId, itemId, qty) {
  return tx(['listEntries', 'items', 'purchases'], 'readwrite', async (h) => {
    const item = await h.get('items', itemId);
    if (!item) throw new Error('Item not found.');
    const existing = (await h.byIndex('listEntries', 'listId', listId)).find((e) => e.itemId === itemId);
    if (existing) { existing.plannedQty = (existing.plannedQty || 0) + (Number(qty) || item.typicalQty || 1); await h.put('listEntries', existing); return existing; }
    const last = lastPurchaseMap(await h.byIndex('purchases', 'itemId', itemId)).get(itemId);
    const e = entryRecord(listId, item, qty || item.typicalQty, last, now());
    await h.put('listEntries', e);
    return e;
  });
}

export async function updateListEntry(id, patch) {
  return tx('listEntries', 'readwrite', async (h) => {
    const e = await h.get('listEntries', id);
    if (!e) throw new Error('List item not found.');
    Object.assign(e, patch);
    await h.put('listEntries', e);
    return e;
  });
}

export async function removeListEntry(id) {
  await tx(['listEntries', 'purchases'], 'readwrite', async (h) => {
    const e = await h.get('listEntries', id);
    if (!e) return;
    if (e.purchaseId) {
      const p = await h.get('purchases', e.purchaseId);
      if (p && !p.transactionId && p.source === 'list') await h.del('purchases', p.id);
      else if (p) { p.listEntryId = null; await h.put('purchases', p); }
    }
    await h.del('listEntries', id);
  });
}

/**
 * Tick an item as bought. A price is optional: if entered, it is saved to
 * price history. Ticking never creates an expense on its own.
 */
export async function checkListEntry(id, { qty, packSize, packUnit, totalMinor, store, date, recordPrice = true }) {
  return tx(['listEntries', 'purchases', 'merchants'], 'readwrite', async (h) => {
    const e = await h.get('listEntries', id);
    if (!e) throw new Error('List item not found.');
    e.checked = true;
    e.actualQty = Number(qty) > 0 ? Number(qty) : e.plannedQty;
    e.store = (store || '').trim();
    e.date = isValidISODate(date) ? date : todayISO();
    e.actualTotalMinor = Number.isSafeInteger(totalMinor) && totalMinor >= 0 ? totalMinor : null;
    if (recordPrice && e.actualTotalMinor !== null && e.actualTotalMinor > 0) {
      const existing = e.purchaseId ? await h.get('purchases', e.purchaseId) : null;
      const rec = purchaseRecord({
        ...(existing || {}), id: existing?.id, itemId: e.itemId, date: e.date, merchant: e.store, qty: e.actualQty,
        packSize: packSize ?? existing?.packSize, packUnit: packUnit || existing?.packUnit || e.unit, totalMinor: e.actualTotalMinor,
        listEntryId: e.id, transactionId: existing?.transactionId || null, receiptId: existing?.receiptId || null, source: existing?.source || 'list',
      });
      await h.put('purchases', rec);
      e.purchaseId = rec.id;
      await rememberMerchant(h, e.store);
    }
    await h.put('listEntries', e);
    return e;
  });
}

export async function uncheckListEntry(id) {
  return tx(['listEntries', 'purchases'], 'readwrite', async (h) => {
    const e = await h.get('listEntries', id);
    if (!e) return null;
    if (e.purchaseId) {
      const p = await h.get('purchases', e.purchaseId);
      if (p && (p.transactionId || p.receiptId)) {
        throw new Error('This item is part of a saved expense or receipt. Edit or delete that expense first.');
      }
      if (p) await h.del('purchases', p.id);
    }
    Object.assign(e, { checked: false, purchaseId: null, actualQty: null, actualTotalMinor: null, store: '', date: null });
    await h.put('listEntries', e);
    return e;
  });
}

/**
 * Turn ticked items that have a price (and are not yet part of an expense)
 * into expense transactions — one per store and date.
 */
export async function createExpenseFromList(listId, { accountId, currency, categoryId = GROCERY_CATEGORY_ID } = {}) {
  return tx(['listEntries', 'purchases', 'transactions', 'lists'], 'readwrite', async (h) => {
    const list = await h.get('lists', listId);
    const entries = (await h.byIndex('listEntries', 'listId', listId)).filter((e) => e.checked && e.purchaseId);
    const groups = new Map();
    for (const e of entries) {
      const p = await h.get('purchases', e.purchaseId);
      if (!p || p.transactionId) continue;
      const key = `${p.merchant.toLowerCase()}|${p.date}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const created = [];
    for (const ps of groups.values()) {
      const amount = ps.reduce((s, p) => s + p.totalMinor, 0);
      if (amount <= 0) continue;
      const t = {
        id: uid(), type: 'expense', amountMinor: amount, currency: currency || 'AED', date: ps[0].date, categoryId,
        merchant: ps[0].merchant, accountId: accountId || null, toAccountId: null,
        notes: `${ps.length} item${ps.length > 1 ? 's' : ''} from list "${list?.name || ''}"`, listId, receiptId: null,
        createdAt: now(), updatedAt: now(),
      };
      await h.put('transactions', t);
      for (const p of ps) { p.transactionId = t.id; await h.put('purchases', p); }
      created.push(t);
    }
    return created;
  });
}

export async function completeList(listId, { carryForward = false } = {}) {
  const list = await get('lists', listId);
  if (!list) throw new Error('List not found.');
  await tx('lists', 'readwrite', async (h) => { list.status = 'completed'; list.completedAt = now(); await h.put('lists', list); });
  if (carryForward) {
    const entries = await byIndex('listEntries', 'listId', listId);
    if (entries.some((e) => !e.checked)) {
      return createList({ name: `${list.name} (carried forward)`, month: addMonths(list.month, 1), mode: 'carry', sourceListId: listId });
    }
  }
  return null;
}

export async function reopenList(listId) {
  await tx('lists', 'readwrite', async (h) => { const l = await h.get('lists', listId); if (l) { l.status = 'active'; l.completedAt = null; await h.put('lists', l); } });
}

export async function deleteList(listId) {
  await tx(['lists', 'listEntries', 'purchases'], 'readwrite', async (h) => {
    for (const e of await h.byIndex('listEntries', 'listId', listId)) {
      if (e.purchaseId) {
        const p = await h.get('purchases', e.purchaseId);
        // price history that is part of an expense or receipt is kept
        if (p) { if (!p.transactionId && !p.receiptId && p.source === 'list') await h.del('purchases', p.id); else { p.listEntryId = null; await h.put('purchases', p); } }
      }
      await h.del('listEntries', e.id);
    }
    await h.del('lists', listId);
  });
}

export async function renameList(listId, name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Please enter a name.');
  await tx('lists', 'readwrite', async (h) => { const l = await h.get('lists', listId); if (l) { l.name = n.slice(0, 60); await h.put('lists', l); } });
}

export async function deleteTemplate(id) { await tx('templates', 'readwrite', (h) => h.del('templates', id)); }

export async function saveTemplateFromList(listId, name) {
  const entries = await byIndex('listEntries', 'listId', listId);
  if (!entries.length) throw new Error('This list is empty.');
  const t = { id: uid(), name: (name || '').trim() || 'My template', entries: entries.map((e) => ({ itemId: e.itemId, qty: e.plannedQty })), createdAt: now() };
  await put('templates', t);
  return t;
}

/* ---------------- Receipts ---------------- */

export async function findDuplicateReceipt({ fingerprint, imageHash }) {
  const hits = [];
  if (imageHash) hits.push(...await byIndex('receipts', 'imageHash', imageHash));
  if (fingerprint) for (const r of await byIndex('receipts', 'fingerprint', fingerprint)) if (!hits.some((x) => x.id === r.id)) hits.push(r);
  return hits;
}

/**
 * Save a reviewed receipt. Creates, in one transaction:
 *  - the receipt record (+ optional compressed image)
 *  - one expense for the amount actually paid
 *  - a price-history line for each included item (creating new catalogue items if requested)
 *  - aliases so the same receipt wording is recognised next time
 *  - ticks matching unticked items on the active shopping list(s)
 */
export async function confirmReceipt(draft, { currency, digits = 2 } = {}) {
  const { header, lines } = draft;
  if (!isValidISODate(header.date)) throw new Error('Please enter a valid receipt date.');
  if (!Number.isSafeInteger(header.totalMinor) || header.totalMinor <= 0) throw new Error('Please enter the receipt total.');
  const included = lines.filter((l) => l.include !== false);
  for (const l of included) {
    if (!l.itemId && !l.newItemName) throw new Error(`Choose or create a catalogue item for "${l.description}".`);
    if (!Number.isSafeInteger(l.totalMinor) || l.totalMinor < 0) throw new Error(`Check the amount for "${l.description}".`);
  }
  const stores = ['receipts', 'receiptImages', 'transactions', 'purchases', 'items', 'aliases', 'listEntries', 'lists', 'merchants'];
  return tx(stores, 'readwrite', async (h) => {
    if (draft.receiptId && await h.get('receipts', draft.receiptId)) throw new Error('This receipt has already been saved.');
    const receiptId = draft.receiptId || uid();
    const transactionId = uid();
    const nets = included.map((l) => Math.max(0, l.totalMinor - (l.discountMinor || 0)));
    // spread receipt-level discount and any tax added on top across the lines
    const extra = (header.taxMode === 'tax-added' ? header.taxMinor || 0 : 0) - (header.receiptDiscountMinor || 0);
    const adj = extra ? allocate(Math.abs(extra), nets) : nets.map(() => 0);
    const activeLists = (await h.all('lists')).filter((l) => l.status === 'active');
    const openEntries = [];
    for (const l of activeLists) openEntries.push(...await h.byIndex('listEntries', 'listId', l.id));

    const purchaseIds = [];
    for (let i = 0; i < included.length; i++) {
      const l = included[i];
      let itemId = l.itemId;
      if (!itemId) {
        const nameNorm = normaliseName(l.newItemName);
        const same = (await h.byIndex('items', 'nameNorm', nameNorm)).find((x) => !x.archived);
        if (same) itemId = same.id;
        else {
          const it = newItemRecord({ name: l.newItemName, categoryId: l.newItemCategoryId || 'gro-other', unit: l.packUnit || 'pc', typicalQty: l.qty, packSize: l.packSize });
          await h.put('items', it);
          itemId = it.id;
        }
      }
      if (l.description && l.rememberAlias !== false) await addAliasIn(h, itemId, l.description);
      const total = nets[i] + (extra >= 0 ? adj[i] : -adj[i]);
      // reuse a price already recorded by ticking this item on a list the same day, instead of duplicating it
      let entry = openEntries.find((e) => e.itemId === itemId && (!e.checked || (e.purchaseId && e.date === header.date)));
      let purchaseId = null;
      if (entry?.checked) {
        const p = await h.get('purchases', entry.purchaseId);
        if (p && !p.transactionId && !p.receiptId) purchaseId = p.id;
        else entry = null; // already part of another expense — leave it alone
      }
      if (draft.updateLists === false && !purchaseId) entry = null;
      const rec = purchaseRecord({
        id: purchaseId || undefined, itemId, date: header.date, merchant: header.merchant, qty: l.qty, packSize: l.packSize, packUnit: l.packUnit,
        totalMinor: Math.max(0, total), discountMinor: l.discountMinor || 0, description: l.description, receiptId, transactionId,
        listEntryId: entry?.id || null, source: 'receipt',
      });
      await h.put('purchases', rec);
      purchaseIds.push(rec.id);
      if (entry) {
        Object.assign(entry, { checked: true, actualQty: rec.qty, actualTotalMinor: rec.totalMinor, store: header.merchant, date: header.date, purchaseId: rec.id });
        await h.put('listEntries', entry);
        openEntries.splice(openEntries.indexOf(entry), 1);
      }
    }

    await h.put('transactions', {
      id: transactionId, type: 'expense', amountMinor: header.totalMinor, currency: currency || 'AED', date: header.date,
      categoryId: header.categoryId || GROCERY_CATEGORY_ID, merchant: header.merchant || '', accountId: header.accountId || null,
      toAccountId: null, notes: header.notes || (header.receiptNo ? `Receipt ${header.receiptNo}` : 'Scanned receipt'),
      receiptId, listId: null, createdAt: now(), updatedAt: now(),
    });
    await h.put('receipts', {
      id: receiptId, merchant: header.merchant || '', date: header.date, time: header.time || null, receiptNo: header.receiptNo || null,
      totalMinor: header.totalMinor, taxMinor: header.taxMinor ?? null, receiptDiscountMinor: header.receiptDiscountMinor || 0,
      paymentMethod: header.paymentMethod || null, fingerprint: draft.fingerprint || null, imageHash: draft.imageHash || null,
      rawText: (draft.rawText || '').slice(0, 20000), validation: draft.validation || null, transactionId, purchaseIds,
      lineCount: included.length, createdAt: now(),
    });
    if (draft.imageBlob) await h.put('receiptImages', { receiptId, blob: draft.imageBlob, type: draft.imageBlob.type, size: draft.imageBlob.size, createdAt: now() });
    await rememberMerchant(h, header.merchant);
    return { receiptId, transactionId, purchaseIds };
  });
}

export async function deleteReceiptImage(receiptId) { await tx('receiptImages', 'readwrite', (h) => h.del('receiptImages', receiptId)); }
export async function deleteAllReceiptImages() { await tx('receiptImages', 'readwrite', (h) => h.clear('receiptImages')); }

/* ---------------- Everything ---------------- */

export async function loadAll() {
  const names = ['categories', 'items', 'aliases', 'merchants', 'purchases', 'lists', 'listEntries', 'templates', 'receipts', 'transactions', 'accounts', 'budgets', 'recurring'];
  return tx(names, 'readonly', async (h) => {
    const out = {};
    for (const n of names) out[n] = await h.all(n);
    return out;
  });
}
