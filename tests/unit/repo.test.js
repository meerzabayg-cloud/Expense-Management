// Workflow tests against a real IndexedDB implementation (fake-indexeddb).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as db from '../../docs/js/db.js';
import * as repo from '../../docs/js/repo.js';
import { buildBackup, readBackup, restoreBackup, wipeAll } from '../../docs/js/backup.js';
import { accountBalances, summariseMonth, itemPriceStats, listTotals } from '../../docs/js/calc.js';

globalThis.IDBKeyRange = IDBKeyRange;

beforeEach(async () => {
  await db.closeDB();
  db._setIndexedDB(new IDBFactory());
  await repo.ensureSeeded();
});

test('receipt confirmation creates expense, price history, aliases and ticks the list — atomically', async () => {
  const rice = await repo.saveItem({ name: 'Basmati Rice', categoryId: 'gro-grains', unit: 'kg' });
  const milk = await repo.saveItem({ name: 'Fresh Milk', categoryId: 'gro-dairy', unit: 'l' });
  const list = await repo.createList({ name: 'October', month: '2026-10' });
  await repo.addListEntry(list.id, rice.id, 1);
  await repo.addListEntry(list.id, milk.id, 2);
  const bank = await repo.saveAccount({ name: 'Bank', type: 'bank', openingBalanceMinor: 100000 });

  const draft = {
    header: { merchant: 'Lulu', date: '2026-10-04', totalMinor: 4250, taxMinor: 202, taxMode: 'tax-included', accountId: bank.id, receiptDiscountMinor: 0 },
    lines: [
      { description: 'INDIA GATE BASMATI 5KG', itemId: rice.id, qty: 1, packSize: 5, packUnit: 'kg', totalMinor: 2800 },
      { description: 'FRESH MILK 2L', itemId: milk.id, qty: 2, packSize: 1, packUnit: 'l', totalMinor: 1450 },
    ],
    fingerprint: 'lulu|2026-10-04|4250|',
  };
  const res = await repo.confirmReceipt(draft, { currency: 'AED' });
  const all = await repo.loadAll();
  assert.equal(all.transactions.length, 1);
  assert.equal(all.transactions[0].amountMinor, 4250);
  assert.equal(all.purchases.length, 2);
  assert.ok(all.aliases.some((a) => a.alias === 'INDIA GATE BASMATI 5KG'));
  const entries = all.listEntries;
  assert.ok(entries.every((e) => e.checked));
  assert.equal(listTotals(entries).actual, 4250);
  assert.equal(accountBalances(all.accounts, all.transactions).get(bank.id), 100000 - 4250);
  assert.equal((await repo.findDuplicateReceipt({ fingerprint: draft.fingerprint })).length, 1);

  // A failing receipt (missing item) must not leave partial data behind
  await assert.rejects(repo.confirmReceipt({ header: { ...draft.header }, lines: [{ description: 'X', qty: 1, totalMinor: 100 }] }));
  assert.equal((await repo.loadAll()).transactions.length, 1);

  // Deleting the expense together with its receipt removes price history and unticks the list
  await repo.deleteTransaction(res.transactionId, { withReceipt: true });
  const after = await repo.loadAll();
  assert.equal(after.transactions.length, 0);
  assert.equal(after.purchases.length, 0);
  assert.equal(after.receipts.length, 0);
  assert.ok(after.listEntries.every((e) => !e.checked));
  assert.equal(accountBalances(after.accounts, after.transactions).get(bank.id), 100000);
});

test('ticking a list item records price but no expense until asked; no duplicates when a receipt follows', async () => {
  const eggs = await repo.saveItem({ name: 'Eggs', categoryId: 'gro-dairy', unit: 'tray' });
  const list = await repo.createList({ name: 'Nov', month: '2026-11' });
  const e = await repo.addListEntry(list.id, eggs.id, 1);
  await repo.checkListEntry(e.id, { qty: 1, totalMinor: 1800, store: 'Spinneys', date: '2026-11-03', packUnit: 'tray' });
  let all = await repo.loadAll();
  assert.equal(all.transactions.length, 0, 'ticking must not create an expense');
  assert.equal(all.purchases.length, 1);
  // scanning the same day's receipt reuses that price entry instead of duplicating it
  await repo.confirmReceipt({ header: { merchant: 'Spinneys', date: '2026-11-03', totalMinor: 1800 }, lines: [{ description: 'EGGS 30S', itemId: eggs.id, qty: 1, packUnit: 'tray', totalMinor: 1800 }] });
  all = await repo.loadAll();
  assert.equal(all.purchases.length, 1);
  assert.equal(all.transactions.length, 1);
  await assert.rejects(repo.uncheckListEntry(e.id), /saved expense/);
});

test('create expense from list groups by store and is not repeated', async () => {
  const a = await repo.saveItem({ name: 'Apples' });
  const b = await repo.saveItem({ name: 'Bananas' });
  const list = await repo.createList({ month: '2026-11' });
  const ea = await repo.addListEntry(list.id, a.id, 1);
  const eb = await repo.addListEntry(list.id, b.id, 1);
  await repo.checkListEntry(ea.id, { totalMinor: 900, store: 'Lulu', date: '2026-11-02' });
  await repo.checkListEntry(eb.id, { totalMinor: 600, store: 'Lulu', date: '2026-11-02' });
  const created = await repo.createExpenseFromList(list.id, {});
  assert.equal(created.length, 1);
  assert.equal(created[0].amountMinor, 1500);
  assert.equal((await repo.createExpenseFromList(list.id, {})).length, 0);
});

test('duplicate catalogue items are prevented and merge moves history', async () => {
  const milk = await repo.saveItem({ name: 'Fresh Milk' });
  await assert.rejects(repo.saveItem({ name: 'fresh  milk' }), /already in your catalogue/);
  const milk2 = await repo.saveItem({ name: 'Milk Full Cream' });
  await repo.savePurchase({ itemId: milk2.id, date: '2026-10-01', merchant: 'Lulu', qty: 1, packUnit: 'l', totalMinor: 650 });
  await repo.mergeItems(milk2.id, milk.id);
  const all = await repo.loadAll();
  assert.equal(all.items.filter((i) => /milk/i.test(i.name)).length, 1);
  assert.equal(all.purchases[0].itemId, milk.id);
  assert.ok(await repo.findDuplicateItem('Milk Full Cream'));
});

test('generate next month list from previous purchases with estimated prices', async () => {
  const rice = await repo.saveItem({ name: 'Rice' });
  await repo.savePurchase({ itemId: rice.id, date: '2026-10-04', merchant: 'Lulu', qty: 1, packSize: 5, packUnit: 'kg', totalMinor: 2800 });
  const list = await repo.createList({ month: '2026-11', mode: 'previous' });
  const all = await repo.loadAll();
  const entries = all.listEntries.filter((e) => e.listId === list.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].estPriceMinor, 2800);
  assert.equal(listTotals(entries).estTotal, 2800);
  const st = itemPriceStats(all.purchases);
  assert.equal(st.latest.merchant, 'Lulu');
});

test('saving a transaction twice with the same id does not duplicate it; deleting reverses balances', async () => {
  const cash = await repo.saveAccount({ name: 'Cash', type: 'cash', openingBalanceMinor: 5000 });
  const t = { id: 'fixed-id', type: 'expense', amountMinor: 1200, date: '2026-11-05', categoryId: 'exp-dining', accountId: cash.id };
  await repo.saveTransaction(t);
  await repo.saveTransaction(t);
  let all = await repo.loadAll();
  assert.equal(all.transactions.length, 1);
  assert.equal(accountBalances(all.accounts, all.transactions).get(cash.id), 3800);
  await repo.saveTransaction({ ...t, amountMinor: 2000 });
  all = await repo.loadAll();
  assert.equal(accountBalances(all.accounts, all.transactions).get(cash.id), 3000);
  await repo.deleteTransaction('fixed-id');
  all = await repo.loadAll();
  assert.equal(accountBalances(all.accounts, all.transactions).get(cash.id), 5000);
  await assert.rejects(repo.saveTransaction({ type: 'expense', amountMinor: 0, date: '2026-11-05', categoryId: 'exp-dining' }));
  await assert.rejects(repo.saveTransaction({ type: 'transfer', amountMinor: 10, date: '2026-11-05', accountId: cash.id, toAccountId: cash.id }));
});

test('recurring occurrences are recorded once each', async () => {
  const r = await repo.saveRecurring({ type: 'expense', amountMinor: 4500, categoryId: 'exp-subscriptions', merchant: 'Netflix', nextDate: '2026-10-31', frequency: 'monthly' });
  assert.equal(repo.dueRecurring([r], '2026-11-08').length, 1);
  await repo.recordRecurring(r.id);
  const all = await repo.loadAll();
  assert.equal(all.transactions.length, 1);
  assert.equal(all.recurring[0].nextDate, '2026-11-30');
  assert.equal(summariseMonth(all.transactions, '2026-10', all.categories).spending, 4500);
});

test('encrypted backup round-trip restores every record; wrong password is rejected', async () => {
  const item = await repo.saveItem({ name: 'Tea' });
  await repo.savePurchase({ itemId: item.id, date: '2026-10-01', qty: 1, packUnit: 'pack', totalMinor: 1500, merchant: 'Viva' });
  await repo.saveTransaction({ type: 'income', amountMinor: 900000, date: '2026-10-01', categoryId: 'inc-salary' });
  await repo.saveSettings({ currency: 'AED', userName: 'Test' });
  const before = await repo.loadAll();
  const text = await buildBackup({ password: 'correct horse' });
  const file = JSON.parse(text);
  assert.equal(file.payload, undefined, 'encrypted backup must not contain a readable payload');
  const { envelope, ...meta } = file;
  assert.ok(!JSON.stringify(meta).includes('Tea'), 'metadata must not leak data');
  assert.ok(!atob(envelope.data).includes('Tea'), 'ciphertext must not contain plaintext');
  await assert.rejects(readBackup(text, 'wrong'), /Wrong password/);
  await assert.rejects(readBackup(text), /password-protected/);
  const tampered = JSON.parse(text); tampered.envelope.data = tampered.envelope.data.slice(0, -8) + 'AAAAAAA=';
  await assert.rejects(readBackup(JSON.stringify(tampered), 'correct horse'));
  const { data } = await readBackup(text, 'correct horse');
  await wipeAll();
  assert.equal((await repo.loadAll()).items.length, 0);
  await restoreBackup(data);
  const after = await repo.loadAll();
  for (const k of Object.keys(before)) assert.equal(after[k].length, before[k].length, k);
  assert.equal((await repo.getSettings()).userName, 'Test');
});
