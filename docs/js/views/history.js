import { h, icon, select, emptyState, toast, confirmDialog } from '../ui.js';
import * as repo from '../repo.js';
import * as calc from '../calc.js';
import { dateLabel, monthLabel, monthOf } from '../dates.js';
import { describeQty, unitPrice } from '../units.js';
import { get } from '../db.js';
import { openTransactionForm } from './forms.js';

export async function renderHistory(ctx, params) {
  const { data } = ctx;
  if (params.receipt) return receiptDetail(ctx, params.receipt);
  const root = h('div', { class: 'view' });
  const f = ctx.ui.histFilter ||= { mode: 'receipts', store: '' };
  const stores = [...new Set(data.purchases.map((p) => p.merchant).filter(Boolean))].sort();
  const mode = select([['receipts', 'Receipts'], ['purchases', 'All purchased items']], f.mode, { 'aria-label': 'Show' });
  const store = select([['', 'All stores'], ...stores.map((s) => [s, s])], f.store, { 'aria-label': 'Store' });
  const box = h('div');
  const draw = () => {
    f.mode = mode.value; f.store = store.value;
    if (f.mode === 'receipts') {
      const rs = data.receipts.filter((r) => !f.store || r.merchant === f.store).sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
      if (!rs.length) { box.replaceChildren(emptyState('history', 'No receipts saved yet', 'Scanned and manually entered receipts appear here.', h('a', { class: 'btn btn-primary', href: '#/scan' }, 'Scan a receipt'))); return; }
      const groups = calc.groupBy(rs, (r) => monthOf(r.date));
      box.replaceChildren(...[...groups.entries()].map(([m, list]) => h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, monthLabel(m)), h('span', { class: 'muted small' }, ctx.fm(list.reduce((s, r) => s + r.totalMinor, 0)))),
        list.map((r) => h('a', { class: 'row', href: `#/history?receipt=${r.id}` }, h('span', { class: 'row-icon' }, '🧾'),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.merchant || 'Receipt'), h('span', { class: 'row-sub' }, `${dateLabel(r.date)} · ${r.lineCount} items${r.validation && !r.validation.ok ? ' · ⚠ totals differed' : ''}`)),
          h('span', { class: 'row-amount' }, ctx.fm(r.totalMinor)))))));
    } else {
      const ps = calc.sortPurchases(data.purchases.filter((p) => !f.store || p.merchant === f.store)).reverse();
      if (!ps.length) { box.replaceChildren(emptyState('history', 'No purchases yet', 'Items you buy (from receipts or ticked lists with prices) appear here.')); return; }
      const groups = calc.groupBy(ps.slice(0, 600), (p) => p.date);
      box.replaceChildren(...[...groups.entries()].map(([d, list]) => h('section', { class: 'card day' }, h('h4', { class: 'day-head' }, dateLabel(d)),
        list.map((p) => { const u = unitPrice(p); return h('a', { class: 'row', href: `#/items/${p.itemId}` },
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, data.itemsById.get(p.itemId)?.name || 'Item'), h('span', { class: 'row-sub' }, `${describeQty(p)}${p.merchant ? ' · ' + p.merchant : ''}${u ? ` · ${ctx.fm(Math.round(u.perUnit))}/${u.label}` : ''}`)),
          h('span', { class: 'row-amount' }, ctx.fm(p.totalMinor))); }))));
    }
  };
  mode.addEventListener('change', draw); store.addEventListener('change', draw);
  root.append(h('div', { class: 'filters' }, h('div', { class: 'filter-row' }, mode, store)), box);
  draw();
  return root;
}

async function receiptDetail(ctx, id) {
  const { data } = ctx;
  const r = data.receipts.find((x) => x.id === id);
  const root = h('div', { class: 'view' });
  if (!r) return emptyState('history', 'Receipt not found', 'It may have been deleted.', h('a', { class: 'btn btn-primary', href: '#/history' }, 'All receipts'));
  ctx.setTitle(r.merchant || 'Receipt');
  const txn = data.transactions.find((t) => t.id === r.transactionId);
  const ps = data.purchases.filter((p) => p.receiptId === id);
  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, r.merchant || 'Receipt'), h('b', {}, ctx.fm(r.totalMinor))),
    h('p', { class: 'muted small' }, [dateLabel(r.date), r.time, r.receiptNo ? `No. ${r.receiptNo}` : null, r.paymentMethod ? `paid by ${r.paymentMethod}` : null].filter(Boolean).join(' · ')),
    r.taxMinor ? h('p', { class: 'small' }, `VAT: ${ctx.fm(r.taxMinor)}`) : null,
    r.receiptDiscountMinor ? h('p', { class: 'small' }, `Receipt discount: ${ctx.fm(r.receiptDiscountMinor)}`) : null,
    r.validation && !r.validation.ok && r.validation.difference !== null ? h('p', { class: 'bad small' }, `⚠ When saved, the item lines differed from the total by ${ctx.fm(Math.abs(r.validation.difference))}.`) : null,
    txn ? h('button', { class: 'btn btn-secondary btn-block', onclick: () => openTransactionForm(ctx, { txn }) }, icon('edit'), 'View / edit the expense') : h('p', { class: 'muted small' }, 'The expense for this receipt was deleted.')));
  root.append(h('section', { class: 'card' }, h('h3', {}, `Items (${ps.length})`),
    ps.map((p) => h('a', { class: 'row', href: `#/items/${p.itemId}` },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, data.itemsById.get(p.itemId)?.name || 'Item'), h('span', { class: 'row-sub' }, `${describeQty(p)}${p.description ? ` · “${p.description}”` : ''}${p.discountMinor ? ` · discount ${ctx.fm(p.discountMinor)}` : ''}`)),
      h('span', { class: 'row-amount' }, ctx.fm(p.totalMinor))))));
  const imgRec = await get('receiptImages', id);
  if (imgRec?.blob) {
    const url = URL.createObjectURL(imgRec.blob);
    root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Receipt photo'), h('span', { class: 'muted small' }, `${Math.round(imgRec.size / 1024)} KB`)),
      h('img', { src: url, alt: 'Receipt photo', class: 'receipt-img' }),
      h('button', { class: 'btn btn-ghost btn-block', onclick: async () => { if (await confirmDialog({ title: 'Delete photo?', message: 'The receipt data stays; only the image is removed to save space.', confirmText: 'Delete photo', danger: true })) { await repo.deleteReceiptImage(id); URL.revokeObjectURL(url); toast('Photo deleted'); ctx.refresh(); } } }, icon('trash'), 'Delete photo only')));
  }
  if (r.rawText) root.append(h('details', { class: 'card' }, h('summary', {}, 'Recognised text'), h('pre', { class: 'raw' }, r.rawText)));
  root.append(h('a', { class: 'btn btn-ghost btn-block', href: '#/history' }, 'All receipts'));
  return root;
}
