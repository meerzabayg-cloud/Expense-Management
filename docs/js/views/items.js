import { h, icon, select, emptyState, toast, confirmDialog, pill, openSheet, field, moneyInput, busy, setFieldError } from '../ui.js';
import * as repo from '../repo.js';
import * as calc from '../calc.js';
import { lineChart } from '../charts.js';
import { dateLabel, todayISO } from '../dates.js';
import { formatPct } from '../money.js';
import { UNITS, UNIT_OPTIONS, fmtNum, describeQty, unitPrice } from '../units.js';
import { openItemForm, categoryOptions, pickItem, catIcon, merchantList } from './forms.js';

export async function renderItems(ctx) {
  const { data } = ctx;
  const root = h('div', { class: 'view' });
  const f = ctx.ui.itemFilter ||= { q: '', cat: '', archived: false };
  const byItem = calc.groupBy(data.purchases, (p) => p.itemId);

  root.append(h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary grow', onclick: () => openItemForm(ctx) }, icon('plus'), 'Add item'),
    data.items.length < 10 ? h('button', { class: 'btn btn-secondary', onclick: async () => { const n = await repo.addStarterItems(); toast(n ? `${n} common items added (no prices)` : 'Starter items already added'); ctx.refresh(); } }, 'Add common items') : null));

  const q = h('input', { type: 'search', placeholder: 'Search items…', value: f.q, 'aria-label': 'Search items' });
  const cat = select([['', 'All categories'], ...categoryOptions(ctx, 'grocery')], f.cat, { 'aria-label': 'Category' });
  const arch = h('label', { class: 'check-row small' }, h('input', { type: 'checkbox', checked: f.archived }), 'Show archived');
  const box = h('div');
  const draw = () => {
    f.q = q.value; f.cat = cat.value; f.archived = arch.firstChild.checked;
    const needle = f.q.trim().toLowerCase();
    const aliasHits = new Set(needle ? data.aliases.filter((a) => a.alias.toLowerCase().includes(needle)).map((a) => a.itemId) : []);
    const items = data.items.filter((i) => (f.archived || !i.archived) && (!f.cat || i.categoryId === f.cat) && (!needle || i.name.toLowerCase().includes(needle) || (i.brand || '').toLowerCase().includes(needle) || aliasHits.has(i.id)))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!data.items.length) { box.replaceChildren(emptyState('tag', 'Your grocery catalogue is empty', 'Items are added automatically when you scan receipts, or you can add them yourself. Tap “Add common items” for a quick start.')); return; }
    const groups = calc.groupBy(items, (i) => i.categoryId);
    box.replaceChildren(
      h('p', { class: 'muted small' }, `${items.length} item${items.length === 1 ? '' : 's'}`),
      ...[...groups.entries()].sort((a, b) => (data.catsById.get(a[0])?.sort ?? 999) - (data.catsById.get(b[0])?.sort ?? 999)).map(([cid, its]) =>
        h('section', { class: 'card' }, h('h3', {}, `${data.catsById.get(cid)?.icon || ''} ${data.catsById.get(cid)?.name || 'Other'}`),
          its.map((it) => {
            const st = calc.itemPriceStats(byItem.get(it.id) || []);
            return h('a', { class: 'row', href: `#/items/${it.id}` },
              h('span', { class: 'row-main' },
                h('span', { class: 'row-title' }, it.name, it.brand ? h('span', { class: 'muted small' }, ` · ${it.brand}`) : null, it.archived ? h('span', { class: 'pill pill-neutral tiny' }, 'archived') : null),
                h('span', { class: 'row-sub' }, st ? `${ctx.fm(st.latest.totalMinor)} · ${describeQty(st.latest)} · ${dateLabel(st.latest.date)}${st.latest.merchant ? ' · ' + st.latest.merchant : ''}` : 'Not bought yet')),
              st?.change?.pct !== null && st?.change && Math.abs(st.change.pct) >= 0.5 ? pill(formatPct(st.change.pct), st.change.pct > 0 ? 'bad' : 'good') : null);
          }))));
  };
  q.addEventListener('input', draw); cat.addEventListener('change', draw); arch.firstChild.addEventListener('change', draw);
  root.append(h('div', { class: 'filters' }, q, h('div', { class: 'filter-row' }, cat, arch)), box);
  draw();
  return root;
}

export async function renderItemDetail(ctx, { id }) {
  const { data } = ctx;
  const item = data.itemsById.get(id);
  if (!item) return emptyState('tag', 'Item not found', 'It may have been merged or deleted.', h('a', { class: 'btn btn-primary', href: '#/items' }, 'Catalogue'));
  ctx.setTitle(item.name);
  const purchases = data.purchases.filter((p) => p.itemId === id);
  const st = calc.itemPriceStats(purchases);
  const aliases = data.aliases.filter((a) => a.itemId === id);
  const root = h('div', { class: 'view' });

  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, `${catIcon(ctx, item.categoryId)} ${item.name}`), item.archived ? pill('Archived', 'neutral') : null),
    h('p', { class: 'muted small' }, [data.catsById.get(item.categoryId)?.name, item.subcategory, item.brand, `usual ${fmtNum(item.typicalQty)} ${UNITS[item.unit]?.label || item.unit}`, item.packSize ? `pack ${fmtNum(item.packSize)} ${UNITS[item.unit]?.label}` : null, item.preferredStore ? `prefers ${item.preferredStore}` : null].filter(Boolean).join(' · ')),
    h('div', { class: 'chip-row' },
      h('button', { class: 'chip', onclick: () => openItemForm(ctx, item) }, icon('edit', { size: 16 }), 'Edit'),
      h('button', { class: 'chip', onclick: () => addPurchase(ctx, item) }, icon('plus', { size: 16 }), 'Record a price'),
      h('button', { class: 'chip', onclick: () => mergeInto(ctx, item) }, icon('merge', { size: 16 }), 'Merge'),
      h('button', { class: 'chip', onclick: async () => { await repo.saveItem({ ...item, archived: !item.archived }, { allowDuplicate: true }); toast(item.archived ? 'Restored' : 'Archived'); ctx.refresh(); } }, icon('archive', { size: 16 }), item.archived ? 'Restore' : 'Archive'))));

  if (st) root.append(priceCard(ctx, item, st));
  else root.append(emptyState('trend', 'No price history yet', 'Prices are recorded when you scan a receipt containing this item or tick it on a grocery list with a price.'));

  if (st && st.history.length >= 2) {
    const pts = st.history.filter((p) => unitPrice(p)?.dim === st.latestUnit?.dim).map((p) => ({ label: dateLabel(p.date, { withYear: false }), value: unitPrice(p).perUnit }));
    const chart = lineChart(pts, { format: (v) => `${ctx.fm(Math.round(v))}/${st.latestUnit.label}` });
    if (chart) root.append(h('section', { class: 'card' }, h('h3', {}, `Price per ${st.latestUnit.label} over time`), chart));
  }

  if (purchases.length) {
    root.append(h('section', { class: 'card' }, h('h3', {}, `Purchase history (${purchases.length})`),
      [...calc.sortPurchases(purchases)].reverse().map((p) => {
        const u = unitPrice(p);
        return h('div', { class: 'row static' },
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `${ctx.fm(p.totalMinor)} · ${describeQty(p)}`),
            h('span', { class: 'row-sub' }, `${dateLabel(p.date)}${p.merchant ? ' · ' + p.merchant : ''}${u ? ` · ${ctx.fm(Math.round(u.perUnit))}/${u.label}` : ''}${p.discountMinor ? ` · discount ${ctx.fm(p.discountMinor)}` : ''}${p.receiptId ? ' · 🧾' : p.source === 'list' ? ' · from list' : ''}`),
            p.description ? h('span', { class: 'row-sub muted' }, `“${p.description}”`) : null),
          !p.receiptId && !p.transactionId ? h('button', { class: 'icon-btn', 'aria-label': 'Delete this price', onclick: async () => { if (await confirmDialog({ title: 'Delete this price?', message: 'It will be removed from the price history.', confirmText: 'Delete', danger: true })) { await repo.deletePurchase(p.id); ctx.refresh(); } } }, icon('trash', { size: 18 })) : null);
      })));
  }

  root.append(h('section', { class: 'card' }, h('h3', {}, 'Also known as'),
    h('p', { class: 'muted small' }, 'Receipt wordings that you confirmed as this item. They are recognised automatically next time.'),
    aliases.length ? aliases.map((a) => h('div', { class: 'row static' }, h('span', { class: 'row-main' }, a.alias), h('button', { class: 'icon-btn', 'aria-label': `Remove alias ${a.alias}`, onclick: async () => { await repo.deleteAlias(a.id); ctx.refresh(); } }, icon('close', { size: 18 })))) : h('p', { class: 'muted' }, 'None yet.'),
    h('form', { class: 'inline-form', onsubmit: async (e) => { e.preventDefault(); const v = e.target.alias.value.trim(); if (!v) return; await repo.addAlias(item.id, v); ctx.refresh(); } },
      h('input', { name: 'alias', type: 'text', placeholder: 'Add another name, e.g. “FC MILK”', maxlength: 80, 'aria-label': 'New alias' }), h('button', { class: 'btn btn-secondary', type: 'submit' }, 'Add'))));
  return root;
}

export function priceCard(ctx, item, st) {
  const c = st.change;
  const lu = st.latestUnit;
  const rows = [];
  const row = (k, v, cls = '') => rows.push(h('div', { class: 'val-row' }, h('span', {}, k), h('b', { class: cls }, v)));
  row('Latest purchase', `${ctx.fm(st.latest.totalMinor)} for ${describeQty(st.latest)}`);
  row('Latest date & store', `${dateLabel(st.latest.date)}${st.latest.merchant ? ' · ' + st.latest.merchant : ''}`);
  if (st.previous) {
    row('Previous comparable', `${ctx.fm(st.previous.totalMinor)} for ${describeQty(st.previous)}`);
    row('Previous date & store', `${dateLabel(st.previous.date)}${st.previous.merchant ? ' · ' + st.previous.merchant : ''}`);
  }
  if (lu) row(`Latest price per ${lu.label}`, ctx.fm(Math.round(lu.perUnit)));
  if (st.lowest) row(`Lowest per ${st.lowest.u.label}`, `${ctx.fm(Math.round(st.lowest.u.perUnit))} · ${st.lowest.p.merchant || ''} ${dateLabel(st.lowest.p.date, { withYear: false })}`, 'good');
  if (st.highest && st.count > 1) row(`Highest per ${st.highest.u.label}`, ctx.fm(Math.round(st.highest.u.perUnit)), 'bad');
  if (st.average && st.count > 1) row(`Average per ${lu?.label}`, ctx.fm(Math.round(st.average)));
  if (st.stores.length > 1) row('Best store (average)', `${st.stores[0].store} · ${ctx.fm(Math.round(st.stores[0].avgUnit))}/${lu?.label}`, 'good');
  if (st.avgDaysBetween) row('Bought about every', `${st.avgDaysBetween} days (${st.count} purchases)`);
  if (item.targetPriceMinor && lu) row('Your target price', ctx.fm(item.targetPriceMinor), st.latest.totalMinor / (st.latest.qty || 1) <= item.targetPriceMinor ? 'good' : 'bad');

  let headline = null;
  if (c && c.pct !== null) {
    const same = Math.abs(c.pct) < 0.05;
    const tone = same ? 'neutral' : c.pct > 0 ? 'bad' : 'good';
    const qtyText = `${fmtNum(c.latestQty)} ${lu.label}`;
    headline = h('div', { class: `price-headline tone-${tone}` },
      h('span', { class: 'ph-pct' }, same ? 'No change' : `${formatPct(c.pct)}`),
      h('span', {}, same ? 'Same price per unit as last time.'
        : `${ctx.fm(Math.abs(c.equivalentDiff))} ${c.pct > 0 ? 'more' : 'less'} than your previous comparable purchase for the same ${qtyText} (${ctx.fm(Math.round(c.previousUnit))} → ${ctx.fm(Math.round(c.latestUnit))} per ${lu.label}).`));
  } else if (st.count > 1) {
    headline = h('p', { class: 'muted small' }, 'Earlier purchases used a different kind of unit, so they are not compared directly.');
  }
  return h('section', { class: 'card' }, h('h3', {}, 'Price intelligence'), headline, ...rows,
    c ? h('p', { class: 'muted small' }, 'This is a price comparison between purchases, not a budget saving.') : null);
}

function addPurchase(ctx, item) {
  const qty = h('input', { type: 'text', inputmode: 'decimal', value: fmtNum(item.typicalQty || 1) });
  const unit = select(UNIT_OPTIONS.map((u) => [u, UNITS[u].label]), item.unit || 'pc');
  const pack = h('input', { type: 'text', inputmode: 'decimal', value: item.packSize ?? '', placeholder: 'optional' });
  const total = moneyInput();
  const store = h('input', { type: 'text', list: 'merchant-list', value: item.preferredStore || '' });
  const date = h('input', { type: 'date', value: todayISO() });
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save price');
  let s;
  s = openSheet(`Record price: ${item.name}`, h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const q = Number(qty.value.replace(',', '.'));
    const t = ctx.parse(total.value);
    if (!(q > 0)) { setFieldError(qty, 'Enter a quantity'); return; }
    if (!t) { setFieldError(total, 'Enter the price paid'); return; }
    const ps = pack.value.trim() ? Number(pack.value.replace(',', '.')) : null;
    await busy(save, async () => {
      try { await repo.savePurchase({ itemId: item.id, qty: q, packUnit: unit.value, packSize: ps, totalMinor: t, merchant: store.value, date: date.value, source: 'manual' }); s.close(); toast('Price saved', { tone: 'good' }); ctx.refresh(); }
      catch (err) { toast(err.message, { tone: 'error' }); }
    });
  } },
    h('p', { class: 'hint' }, 'Adds a price to history only (for comparisons). It does not create an expense.'),
    h('div', { class: 'grid-2' }, field('Quantity', qty), field('Unit', unit)), field('Pack size', pack),
    field(`Total paid (${ctx.settings.currency})`, total), h('div', { class: 'grid-2' }, field('Store', store), field('Date', date)), merchantList(ctx), save));
}

function mergeInto(ctx, item) {
  pickItem(ctx, {
    title: `Merge “${item.name}” into…`, exclude: new Set([item.id]),
    onPick: async (target) => {
      const ok = await confirmDialog({ title: 'Merge items?', message: `All price history and list entries of “${item.name}” will move to “${target.name}”, and “${item.name}” will be remembered as another name for it. This cannot be undone.`, confirmText: 'Merge' });
      if (!ok) return;
      await repo.mergeItems(item.id, target.id);
      toast('Items merged', { tone: 'good' });
      await ctx.refresh({ rerender: false });
      ctx.go(`#/items/${target.id}`);
    },
  });
}
