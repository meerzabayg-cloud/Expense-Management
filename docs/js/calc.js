// Pure financial calculations. Nothing here reads or writes storage, so
// every figure on screen can be traced back to stored records, and the
// functions can be tested automatically.

import { monthOf, monthsBack, addMonths, daysBetween } from './dates.js';
import { unitPrice, comparable, displayQuantity } from './units.js';
import { pctChange, formatMoney, formatPct } from './money.js';

export const GROCERY_CATEGORY_ID = 'exp-groceries';
export const UNCATEGORISED_ID = 'exp-misc';

export function catMap(categories) {
  const m = new Map();
  for (const c of categories) m.set(c.id, c);
  return m;
}

export function rootCategoryId(id, cmap) {
  let cur = cmap.get(id);
  let guard = 0;
  while (cur && cur.parentId && guard++ < 10) cur = cmap.get(cur.parentId) || null;
  return cur ? cur.id : id || UNCATEGORISED_ID;
}

export function isGrocery(categoryId, cmap) {
  return rootCategoryId(categoryId, cmap) === GROCERY_CATEGORY_ID;
}

/**
 * Signed effect of a transaction on spending:
 * expense = +amount, refund = −amount (money returned to you), everything else 0.
 * Transfers and adjustments are never spending; income is never negative spending.
 */
export function spendingEffect(t) {
  if (t.type === 'expense') return t.amountMinor;
  if (t.type === 'refund') return -t.amountMinor;
  return 0;
}

export function summariseMonth(transactions, month, categories) {
  const cmap = catMap(categories);
  const s = { month, income: 0, expenses: 0, refunds: 0, spending: 0, grocery: 0, nonGrocery: 0, count: 0, byCategory: new Map(), byMerchant: new Map(), bySubcategory: new Map() };
  for (const t of transactions) {
    if (monthOf(t.date) !== month) continue;
    if (t.type === 'income') { s.income += t.amountMinor; continue; }
    const eff = spendingEffect(t);
    if (!eff) continue;
    s.count++;
    if (t.type === 'expense') s.expenses += t.amountMinor; else s.refunds += t.amountMinor;
    s.spending += eff;
    const root = rootCategoryId(t.categoryId, cmap);
    if (root === GROCERY_CATEGORY_ID) s.grocery += eff; else s.nonGrocery += eff;
    s.byCategory.set(root, (s.byCategory.get(root) || 0) + eff);
    if (t.categoryId && t.categoryId !== root) s.bySubcategory.set(t.categoryId, (s.bySubcategory.get(t.categoryId) || 0) + eff);
    const mk = (t.merchant || '').trim();
    if (mk) {
      const key = mk.toLowerCase();
      const cur = s.byMerchant.get(key) || { name: mk, amount: 0, count: 0 };
      cur.amount += eff; cur.count++;
      s.byMerchant.set(key, cur);
    }
  }
  return s;
}

/**
 * Tracked balance of every account, derived from its opening balance and
 * all transactions. For credit cards the balance is normally negative
 * (money owed) and is never counted as available cash.
 */
export function accountBalances(accounts, transactions, { asOf } = {}) {
  const bal = new Map();
  for (const a of accounts) bal.set(a.id, a.openingBalanceMinor || 0);
  for (const t of transactions) {
    if (asOf && t.date > asOf) continue;
    const amt = t.amountMinor;
    switch (t.type) {
      case 'expense': if (bal.has(t.accountId)) bal.set(t.accountId, bal.get(t.accountId) - amt); break;
      case 'income':
      case 'refund': if (bal.has(t.accountId)) bal.set(t.accountId, bal.get(t.accountId) + amt); break;
      case 'transfer':
        if (bal.has(t.accountId)) bal.set(t.accountId, bal.get(t.accountId) - amt);
        if (bal.has(t.toAccountId)) bal.set(t.toAccountId, bal.get(t.toAccountId) + amt);
        break;
      case 'adjustment': if (bal.has(t.accountId)) bal.set(t.accountId, bal.get(t.accountId) + amt); break; // signed
      default: break;
    }
  }
  return bal;
}

export function fundsSummary(accounts, balances) {
  let available = 0; let owed = 0; let creditAvailable = 0;
  for (const a of accounts) {
    if (a.archived) continue;
    const b = balances.get(a.id) || 0;
    if (a.type === 'credit') {
      if (b < 0) owed += -b; else available += 0; // a positive credit balance is a refund due, not spendable cash
      if (a.creditLimitMinor) creditAvailable += Math.max(0, a.creditLimitMinor + Math.min(b, 0));
    } else {
      available += b;
    }
  }
  return { available, owed, creditAvailable };
}

/** Budget map for a month: the latest budget set on or before that month, per category. */
export function budgetsForMonth(budgets, month) {
  const best = new Map();
  for (const b of budgets) {
    if (b.month > month) continue;
    const cur = best.get(b.categoryId);
    if (!cur || cur.month < b.month) best.set(b.categoryId, b);
  }
  const out = new Map();
  for (const [cat, b] of best) if (b.amountMinor > 0) out.set(cat, { amountMinor: b.amountMinor, inherited: b.month !== month, setIn: b.month });
  return out;
}

export function totalBudget(bmap) {
  if (bmap.has('total')) return bmap.get('total').amountMinor;
  let sum = 0; let any = false;
  for (const [k, v] of bmap) if (k !== 'total') { sum += v.amountMinor; any = true; }
  return any ? sum : null;
}

export function budgetRows(bmap, summary, categories) {
  const cmap = catMap(categories);
  const rows = [];
  for (const [catId, b] of bmap) {
    if (catId === 'total') continue;
    const spent = summary.byCategory.get(catId) || 0;
    rows.push({ categoryId: catId, name: cmap.get(catId)?.name || 'Category', budget: b.amountMinor, spent, remaining: b.amountMinor - spent, pct: b.amountMinor ? (spent / b.amountMinor) * 100 : 0, inherited: b.inherited });
  }
  return rows.sort((a, b) => b.pct - a.pct);
}

export function trend(transactions, endMonth, count, categories) {
  return monthsBack(endMonth, count).map((m) => {
    const s = summariseMonth(transactions, m, categories);
    return { month: m, spending: s.spending, grocery: s.grocery, nonGrocery: s.nonGrocery, income: s.income };
  });
}

/* ---------------- Grocery price intelligence ---------------- */

export function sortPurchases(purchases) {
  return [...purchases].sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1));
}

/** Statistics for one product's purchase history (oldest → newest). */
export function itemPriceStats(purchasesForItem) {
  const ps = sortPurchases(purchasesForItem).filter((p) => p.totalMinor > 0 && p.qty > 0);
  if (!ps.length) return null;
  const latest = ps[ps.length - 1];
  const lu = unitPrice(latest);
  let previous = null;
  for (let i = ps.length - 2; i >= 0; i--) if (comparable(ps[i], latest)) { previous = ps[i]; break; }
  const sameDim = ps.filter((p) => comparable(p, latest));
  const ups = sameDim.map((p) => ({ p, u: unitPrice(p) })).filter((x) => x.u);
  let lowest = null; let highest = null; let sumCost = 0; let sumQty = 0;
  const byStore = new Map();
  for (const { p, u } of ups) {
    if (!lowest || u.perUnit < lowest.u.perUnit) lowest = { p, u };
    if (!highest || u.perUnit > highest.u.perUnit) highest = { p, u };
    const dq = displayQuantity(p);
    sumCost += p.totalMinor; sumQty += dq;
    const st = (p.merchant || 'Unknown store').trim();
    const cur = byStore.get(st.toLowerCase()) || { store: st, cost: 0, qty: 0, count: 0, best: Infinity };
    cur.cost += p.totalMinor; cur.qty += dq; cur.count++; cur.best = Math.min(cur.best, u.perUnit);
    byStore.set(st.toLowerCase(), cur);
  }
  const average = sumQty > 0 ? sumCost / sumQty : null; // quantity-weighted average price per unit
  const stores = [...byStore.values()].map((s) => ({ ...s, avgUnit: s.cost / s.qty })).sort((a, b) => a.avgUnit - b.avgUnit);

  let change = null;
  if (previous && lu) {
    const pu = unitPrice(previous);
    const diffPerUnit = lu.perUnit - pu.perUnit;
    change = {
      previousUnit: pu.perUnit,
      latestUnit: lu.perUnit,
      unitLabel: lu.label,
      diffPerUnit,
      pct: pctChange(pu.perUnit, lu.perUnit),
      // money difference for the same quantity as the latest purchase (negative = cheaper now)
      equivalentDiff: Math.round(diffPerUnit * displayQuantity(latest)),
      latestQty: displayQuantity(latest),
    };
  }
  let avgDaysBetween = null;
  if (ps.length >= 2) avgDaysBetween = Math.round(daysBetween(ps[0].date, latest.date) / (ps.length - 1));
  return { count: ps.length, latest, latestUnit: lu, previous, change, lowest, highest, average, stores, avgDaysBetween, history: ps };
}

/**
 * Price-based savings: for every purchase in the period, compare its unit price
 * with the previous comparable purchase of the same product and value the
 * difference at the quantity bought. Positive = you paid less than last time.
 * This is NOT budget savings — it measures price movement only.
 */
export function priceSavings(allPurchases, fromDate, toDate) {
  const byItem = groupBy(sortPurchases(allPurchases), (p) => p.itemId);
  let saved = 0; let extra = 0; const rows = [];
  for (const [itemId, ps] of byItem) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.date < fromDate || p.date > toDate) continue;
      let prev = null;
      for (let j = i - 1; j >= 0; j--) if (comparable(ps[j], p)) { prev = ps[j]; break; }
      if (!prev) continue;
      const u = unitPrice(p); const pu = unitPrice(prev);
      if (!u || !pu) continue;
      const delta = Math.round((pu.perUnit - u.perUnit) * displayQuantity(p));
      if (delta > 0) saved += delta; else extra += -delta;
      rows.push({ itemId, purchase: p, previous: prev, delta, pct: pctChange(pu.perUnit, u.perUnit) });
    }
  }
  return { saved, extra, net: saved - extra, rows };
}

export function frequentItems(purchases, fromDate, toDate, limit = 8) {
  const counts = new Map();
  for (const p of purchases) {
    if (p.date < fromDate || p.date > toDate) continue;
    const c = counts.get(p.itemId) || { itemId: p.itemId, count: 0, spent: 0 };
    c.count++; c.spent += p.totalMinor;
    counts.set(p.itemId, c);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.spent - a.spent).slice(0, limit);
}

export function priceMovers(purchases, { since } = {}) {
  const byItem = groupBy(purchases, (p) => p.itemId);
  const out = [];
  for (const [itemId, ps] of byItem) {
    const st = itemPriceStats(ps);
    if (!st?.change || st.change.pct === null) continue;
    if (since && st.latest.date < since) continue;
    out.push({ itemId, stats: st, pct: st.change.pct });
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

/** Store-level comparison: for items bought at 2+ stores, how much more each store costs vs the cheapest. */
export function storeComparison(purchases) {
  const byItem = groupBy(purchases, (p) => p.itemId);
  const storeScores = new Map();
  for (const [, ps] of byItem) {
    const st = itemPriceStats(ps);
    if (!st || st.stores.length < 2) continue;
    const cheapest = st.stores[0].avgUnit;
    for (const s of st.stores) {
      const cur = storeScores.get(s.store.toLowerCase()) || { store: s.store, items: 0, premiumPctSum: 0, cheapestCount: 0 };
      cur.items++;
      cur.premiumPctSum += ((s.avgUnit - cheapest) / cheapest) * 100;
      if (s === st.stores[0]) cur.cheapestCount++;
      storeScores.set(s.store.toLowerCase(), cur);
    }
  }
  return [...storeScores.values()].map((s) => ({ ...s, avgPremiumPct: s.premiumPctSum / s.items })).sort((a, b) => a.avgPremiumPct - b.avgPremiumPct);
}

/* ---------------- Shopping list maths ---------------- */

export function listTotals(entries) {
  let planned = 0; let estTotal = 0; let estRemaining = 0; let purchased = 0; let actual = 0; let unknownPrice = 0;
  for (const e of entries) {
    planned++;
    const est = e.estPriceMinor ? Math.round(e.estPriceMinor * (e.plannedQty || 1)) : 0;
    if (!e.estPriceMinor) unknownPrice++;
    estTotal += est;
    if (e.checked) {
      purchased++;
      if (Number.isFinite(e.actualTotalMinor)) actual += e.actualTotalMinor;
    } else {
      estRemaining += est;
    }
  }
  return { planned, purchased, remaining: planned - purchased, estTotal, estRemaining, actual, unknownPrice };
}

/* ---------------- Human-readable insights ---------------- */

export function insights({ currency, summary, prevSummary, bmap, categories, movers, items }) {
  const out = [];
  const cmap = catMap(categories);
  const fm = (m) => formatMoney(Math.abs(m), currency);
  const g = bmap.get(GROCERY_CATEGORY_ID);
  if (g) {
    const diff = g.amountMinor - summary.grocery;
    out.push(diff >= 0
      ? { tone: 'good', text: `Your grocery spending is ${fm(diff)} below this month's grocery budget.` }
      : { tone: 'bad', text: `Your grocery spending is ${fm(diff)} over this month's grocery budget.` });
  }
  const total = totalBudget(bmap);
  if (total !== null) {
    const diff = total - summary.spending;
    out.push(diff >= 0
      ? { tone: 'good', text: `You have ${fm(diff)} left in this month's total budget.` }
      : { tone: 'bad', text: `Total spending is ${fm(diff)} over this month's budget.` });
  }
  if (prevSummary && prevSummary.count > 0) {
    const changes = [];
    const keys = new Set([...summary.byCategory.keys(), ...prevSummary.byCategory.keys()]);
    for (const k of keys) {
      const d = (summary.byCategory.get(k) || 0) - (prevSummary.byCategory.get(k) || 0);
      if (d !== 0) changes.push([k, d]);
    }
    changes.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    for (const [k, d] of changes.slice(0, 2)) {
      const name = cmap.get(k)?.name || 'Other';
      out.push({ tone: d > 0 ? 'bad' : 'good', text: `Your ${name.toLowerCase()} spending ${d > 0 ? 'increased' : 'decreased'} by ${fm(d)} compared with last month.` });
    }
  }
  const itemName = (id) => items.get(id)?.name || 'An item';
  for (const m of (movers || []).slice(0, 2)) {
    if (Math.abs(m.pct) < 1) continue;
    out.push({ tone: m.pct > 0 ? 'bad' : 'good', text: `${itemName(m.itemId)} is ${formatPct(Math.abs(m.pct), { sign: false })} ${m.pct > 0 ? 'more expensive' : 'cheaper'} than your previous comparable purchase.` });
  }
  return out;
}

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function previousMonth(month) { return addMonths(month, -1); }
