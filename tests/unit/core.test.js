import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatMoney, toDecimalString, allocate, mulQty, pctChange } from '../../docs/js/money.js';
import { unitPrice, comparable, sizeFromText, normaliseUnit, displayQuantity } from '../../docs/js/units.js';
import { normaliseName, findMatches, similarity } from '../../docs/js/match.js';
import { parseReceiptText, validateReceipt, parseDate, receiptFingerprint } from '../../docs/js/receipt-parser.js';
import { summariseMonth, accountBalances, fundsSummary, budgetsForMonth, totalBudget, itemPriceStats, priceSavings, listTotals, insights, budgetRows } from '../../docs/js/calc.js';
import { advance, addMonths, monthsBack, isValidISODate } from '../../docs/js/dates.js';
import { csvEscape } from '../../docs/js/backup.js';

test('parseMoney handles common formats exactly', () => {
  assert.equal(parseMoney('12'), 1200);
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('12.50'), 1250);
  assert.equal(parseMoney('0.10'), 10);
  assert.equal(parseMoney('1,234.56'), 123456);
  assert.equal(parseMoney('1.234,56'), 123456);
  assert.equal(parseMoney('12,50'), 1250);
  assert.equal(parseMoney('1,234'), 123400);
  assert.equal(parseMoney('AED 32.00'), 3200);
  assert.equal(parseMoney('0.005'), 1); // rounds half up
  assert.equal(parseMoney('1.005'), 101);
  assert.equal(parseMoney('-5'), null);
  assert.equal(parseMoney('-5', 2, { allowNegative: true }), -500);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('1.2.3.4'), 123400);
  assert.equal(parseMoney('3.250', 3), 3250);
  assert.equal(parseMoney(0.1 + 0.2), 30);
});

test('formatMoney and decimals', () => {
  assert.equal(formatMoney(123456, 'AED'), 'AED 1,234.56');
  assert.equal(formatMoney(-500, 'AED'), '−AED 5.00');
  assert.equal(formatMoney(500, 'AED', { sign: true }), '+AED 5.00');
  assert.equal(formatMoney(1234, 'KWD'), 'KWD 1.234');
  assert.equal(toDecimalString(5, 2), '0.05');
  assert.equal(toDecimalString(-1250, 2), '-12.50');
});

test('allocate always sums exactly', () => {
  const parts = allocate(1000, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
  assert.deepEqual(parts.sort(), [333, 333, 334].sort());
  assert.equal(allocate(7, [0, 0]).reduce((a, b) => a + b, 0), 7);
  assert.equal(mulQty(895, 1.235), 1105);
  assert.equal(pctChange(3200, 2800), -12.5);
  assert.equal(pctChange(0, 100), null);
});

test('rice example: AED 32 → AED 28 for 5 kg is 12.5% decrease, AED 4 saving', () => {
  const prev = { itemId: 'rice', date: '2026-09-05', merchant: 'Carrefour', qty: 1, packSize: 5, packUnit: 'kg', totalMinor: 3200 };
  const latest = { itemId: 'rice', date: '2026-10-04', merchant: 'Lulu', qty: 1, packSize: 5, packUnit: 'kg', totalMinor: 2800 };
  const st = itemPriceStats([latest, prev]);
  assert.equal(st.latest.merchant, 'Lulu');
  assert.equal(st.previous.merchant, 'Carrefour');
  assert.equal(st.change.pct, -12.5);
  assert.equal(st.change.equivalentDiff, -400);
  assert.equal(st.lowest.p.merchant, 'Lulu');
  assert.equal(Math.round(st.average), 600); // (3200+2800)/10kg per kg
  assert.equal(st.stores[0].store, 'Lulu');
  const sv = priceSavings([prev, latest], '2026-10-01', '2026-10-31');
  assert.equal(sv.saved, 400);
  assert.equal(sv.extra, 0);
});

test('price normalisation compares different pack sizes fairly and refuses incomparable units', () => {
  const a = { qty: 2, packSize: 500, packUnit: 'g', totalMinor: 1000 }; // 1 kg for 10.00
  const b = { qty: 1, packSize: 1, packUnit: 'kg', totalMinor: 1200 };
  assert.equal(unitPrice(a).perUnit, 1000);
  assert.equal(unitPrice(b).perUnit, 1200);
  assert.equal(displayQuantity(a), 1);
  assert.ok(comparable(a, b));
  assert.ok(!comparable(a, { qty: 1, packUnit: 'l', totalMinor: 500 }));
  assert.ok(!comparable({ qty: 1, packUnit: 'pack', packSize: 6 }, { qty: 1, packUnit: 'pack', packSize: 12 }));
  const st = itemPriceStats([{ ...a, date: '2026-01-01' }, { ...b, date: '2026-02-01' }, { qty: 1, packUnit: 'l', totalMinor: 99, date: '2026-01-15' }]);
  assert.equal(Math.round(st.change.pct), 20); // compared with the 500 g packs, skipping the litre purchase
  assert.deepEqual(sizeFromText('BASMATI RICE 5KG'), { packSize: 5, packUnit: 'kg' });
  assert.deepEqual(sizeFromText('Milk 1.5 Ltr'), { packSize: 1.5, packUnit: 'l' });
  assert.equal(normaliseUnit('Pcs'), 'pc');
});

test('name normalisation and matching', () => {
  assert.equal(normaliseName('CHKN BREAST 1KG'), 'chicken breast');
  assert.equal(normaliseName('Tomatoes'), normaliseName('TOM'));
  const items = [
    { id: 'r', name: 'Basmati Rice', nameNorm: normaliseName('Basmati Rice') },
    { id: 'm', name: 'Fresh Milk', nameNorm: normaliseName('Fresh Milk') },
    { id: 'a', name: 'Almond Milk', nameNorm: normaliseName('Almond Milk') },
  ];
  assert.equal(findMatches('INDIA GATE BASMATI RICE 5KG', items)[0].itemId, 'r');
  assert.equal(findMatches('FRS MLK 2L', items)[0].itemId, 'm');
  const aliases = [{ itemId: 'm', aliasNorm: normaliseName('AL RAWABI FC MILK') }];
  const hit = findMatches('Al Rawabi FC Milk 2L', items, aliases)[0];
  assert.equal(hit.itemId, 'm'); assert.equal(hit.score, 1);
  assert.ok(similarity('milk', 'almond milk') < 0.8);
});

const SAMPLE = `CARREFOUR
Mall of the Emirates, Dubai
TRN 100012345600003
TAX INVOICE
Date: 04/10/2026 18:42
Invoice No: 4521-778-0093
BASMATI RICE 5KG          28.00
FRESH MILK 2L
2 x 7.25                  14.50
TOMATO LOOSE
1.235 kg x 4.95            6.11
Promo discount            -1.00
DISH LIQUID 750ML          9.75
SUBTOTAL                  57.36
VAT 5%                     2.73
TOTAL                     57.36
VISA ************1234     57.36
Thank you for shopping`;

test('receipt parser extracts header, items, discounts and totals', () => {
  const r = parseReceiptText(SAMPLE, { today: new Date(2026, 10, 8) });
  assert.equal(r.merchant, 'Carrefour');
  assert.equal(r.date, '2026-10-04');
  assert.equal(r.time, '18:42');
  assert.equal(r.receiptNo, '4521-778-0093');
  assert.equal(r.totalMinor, 5736);
  assert.equal(r.taxMinor, 273);
  assert.equal(r.paymentMethod, 'card');
  assert.equal(r.items.length, 4);
  const [rice, milk, tom, dish] = r.items;
  assert.equal(rice.totalMinor, 2800); assert.equal(rice.packSize, 5); assert.equal(rice.packUnit, 'kg');
  assert.equal(milk.description, 'FRESH MILK 2L'); assert.equal(milk.qty, 2); assert.equal(milk.unitPriceMinor, 725); assert.equal(milk.totalMinor, 1450);
  assert.equal(tom.qty, 1.235); assert.equal(tom.packUnit, 'kg'); assert.equal(tom.discountMinor, 100);
  assert.equal(dish.totalMinor, 975);
  const v = validateReceipt({ items: r.items, receiptDiscountMinor: r.receiptDiscountMinor, taxMinor: r.taxMinor, totalMinor: r.totalMinor });
  assert.equal(v.ok, true); assert.equal(v.mode, 'tax-included'); assert.equal(v.difference, 0);
});

test('receipt validation reports unexplained differences', () => {
  const v = validateReceipt({ items: [{ totalMinor: 1000 }, { totalMinor: 500 }], taxMinor: 75, totalMinor: 1600 });
  assert.equal(v.ok, false); assert.equal(v.difference, 100);
  const v2 = validateReceipt({ items: [{ totalMinor: 1000 }, { totalMinor: 500 }], taxMinor: 75, totalMinor: 1575 });
  assert.equal(v2.ok, true); assert.equal(v2.mode, 'tax-added');
});

test('receipt parser flags low-confidence lines and missing data', () => {
  const r = parseReceiptText([{ text: 'Some Shop', conf: 90 }, { text: 'BRE4D 3.50', conf: 40 }]);
  assert.ok(r.items[0].flags.includes('low-confidence'));
  assert.ok(r.warnings.some((w) => /total/i.test(w)));
  assert.ok(r.warnings.some((w) => /date/i.test(w)));
});

test('date parsing', () => {
  assert.equal(parseDate('05 Oct 2026').iso, '2026-10-05');
  assert.equal(parseDate('2026-09-05').iso, '2026-09-05');
  assert.equal(parseDate('10/25/2026').iso, '2026-10-25'); // month-first when day > 12
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(receiptFingerprint({ merchant: 'Lulu Hyper', date: '2026-10-04', totalMinor: 100, receiptNo: 'a1' }), 'luluhyper|2026-10-04|100|A1');
});

const CATS = [
  { id: 'exp-groceries', name: 'Groceries' }, { id: 'exp-dining', name: 'Dining' }, { id: 'exp-utilities', name: 'Utilities' },
  { id: 'sub-veg', name: 'Veg market', parentId: 'exp-groceries' },
];

test('monthly summary separates income, transfers, refunds and spending (no double counting)', () => {
  const txns = [
    { type: 'income', amountMinor: 1000000, date: '2026-10-01', accountId: 'bank' },
    { type: 'expense', amountMinor: 30000, date: '2026-10-02', categoryId: 'exp-groceries', merchant: 'Lulu', accountId: 'bank' },
    { type: 'expense', amountMinor: 5000, date: '2026-10-03', categoryId: 'sub-veg', merchant: 'lulu', accountId: 'cash' },
    { type: 'expense', amountMinor: 20000, date: '2026-10-05', categoryId: 'exp-dining', accountId: 'cc' },
    { type: 'refund', amountMinor: 2000, date: '2026-10-06', categoryId: 'exp-dining', accountId: 'cc' },
    { type: 'transfer', amountMinor: 50000, date: '2026-10-07', accountId: 'bank', toAccountId: 'cash' },
    { type: 'transfer', amountMinor: 18000, date: '2026-10-08', accountId: 'bank', toAccountId: 'cc' },
    { type: 'adjustment', amountMinor: -100, date: '2026-10-09', accountId: 'cash' },
    { type: 'expense', amountMinor: 99999, date: '2026-09-30', categoryId: 'exp-utilities', accountId: 'bank' },
  ];
  const s = summariseMonth(txns, '2026-10', CATS);
  assert.equal(s.income, 1000000);
  assert.equal(s.spending, 30000 + 5000 + 20000 - 2000);
  assert.equal(s.grocery, 35000);
  assert.equal(s.nonGrocery, 18000);
  assert.equal(s.byMerchant.get('lulu').amount, 35000);
  const accounts = [
    { id: 'bank', type: 'bank', openingBalanceMinor: 500000 },
    { id: 'cash', type: 'cash', openingBalanceMinor: 10000 },
    { id: 'cc', type: 'credit', openingBalanceMinor: 0, creditLimitMinor: 1000000 },
  ];
  const bal = accountBalances(accounts, txns);
  assert.equal(bal.get('bank'), 500000 + 1000000 - 30000 - 50000 - 18000 - 99999);
  assert.equal(bal.get('cash'), 10000 - 5000 + 50000 - 100);
  assert.equal(bal.get('cc'), -20000 + 2000 + 18000);
  const f = fundsSummary(accounts, bal);
  assert.equal(f.available, bal.get('bank') + bal.get('cash')); // credit limit is NOT cash
  assert.equal(f.owed, 0);
});

test('budgets carry forward from earlier months and compute remaining', () => {
  const budgets = [
    { month: '2026-08', categoryId: 'exp-groceries', amountMinor: 150000 },
    { month: '2026-10', categoryId: 'exp-groceries', amountMinor: 120000 },
    { month: '2026-09', categoryId: 'exp-dining', amountMinor: 50000 },
    { month: '2026-12', categoryId: 'exp-dining', amountMinor: 1 },
  ];
  const b = budgetsForMonth(budgets, '2026-11');
  assert.equal(b.get('exp-groceries').amountMinor, 120000);
  assert.equal(b.get('exp-groceries').inherited, true);
  assert.equal(b.get('exp-dining').amountMinor, 50000);
  assert.equal(totalBudget(b), 170000);
  const s = summariseMonth([{ type: 'expense', amountMinor: 108000, date: '2026-11-02', categoryId: 'exp-groceries' }], '2026-11', CATS);
  const rows = budgetRows(b, s, CATS);
  assert.equal(rows.find((r) => r.categoryId === 'exp-groceries').remaining, 12000);
  const ins = insights({ currency: 'AED', summary: s, prevSummary: null, bmap: b, categories: CATS, movers: [], items: new Map() });
  assert.equal(ins[0].text, "Your grocery spending is AED 120.00 below this month's grocery budget.");
});

test('list totals', () => {
  const t = listTotals([
    { plannedQty: 2, estPriceMinor: 700, checked: true, actualTotalMinor: 1450 },
    { plannedQty: 1, estPriceMinor: 2800, checked: false },
    { plannedQty: 1, estPriceMinor: null, checked: false },
  ]);
  assert.deepEqual(t, { planned: 3, purchased: 1, remaining: 2, estTotal: 4200, estRemaining: 2800, actual: 1450, unknownPrice: 1 });
});

test('date helpers', () => {
  assert.equal(advance('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.equal(advance('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.equal(advance('2028-02-29', 'yearly', 29), '2029-02-28');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.deepEqual(monthsBack('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
  assert.ok(!isValidISODate('2026-13-01'));
});

test('CSV escaping prevents formula injection', () => {
  assert.equal(csvEscape('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvEscape('-12.50'), '-12.50');
  assert.equal(csvEscape('a,b'), '"a,b"');
});

test('receipt parser copes with real OCR noise from the scanner', () => {
  const ocr = 'CARREFOUR\nDate: 05/09/2026 18:42\nBASMATI RICE 5KG          32.00\nFRESH MILK 2L\n2 xXx 7.25                  14.50\nDISH LIQUID 750ML          9.75\nSUBTOTAL                  56.25\nVAT 5%                     2.68\nTOTAL                    56.25\nVISA ****1234             56.25';
  const r = parseReceiptText(ocr);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[1].description, 'FRESH MILK 2L');
  assert.equal(r.items[1].qty, 2);
  assert.equal(r.totalMinor, 5625);
  assert.ok(validateReceipt({ items: r.items, taxMinor: r.taxMinor, totalMinor: r.totalMinor }).ok);
});
