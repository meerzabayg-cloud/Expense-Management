import { h, select, emptyState, pill } from '../ui.js';
import * as calc from '../calc.js';
import { dateLabel } from '../dates.js';
import { formatPct } from '../money.js';
import { describeQty } from '../units.js';

export async function renderPrices(ctx) {
  const { data } = ctx;
  const root = h('div', { class: 'view' });
  const byItem = calc.groupBy(data.purchases, (p) => p.itemId);
  const rows = [];
  for (const [itemId, ps] of byItem) {
    const item = data.itemsById.get(itemId);
    if (!item) continue;
    const st = calc.itemPriceStats(ps);
    if (st) rows.push({ item, st });
  }
  if (!rows.length) return emptyState('trend', 'No prices recorded yet', 'Scan a receipt or tick list items with prices. When you buy the same item again, its price change shows up here.', h('a', { class: 'btn btn-primary', href: '#/scan' }, 'Scan a receipt'));

  const q = h('input', { type: 'search', placeholder: 'Search an item…', 'aria-label': 'Search' });
  const sort = select([['change', 'Biggest change first'], ['up', 'Price increases'], ['down', 'Price decreases'], ['recent', 'Recently bought'], ['name', 'Name A–Z']], ctx.ui.priceSort || 'change', { 'aria-label': 'Sort' });
  const box = h('div');
  const draw = () => {
    ctx.ui.priceSort = sort.value;
    const needle = q.value.trim().toLowerCase();
    let list = rows.filter((r) => !needle || r.item.name.toLowerCase().includes(needle));
    const pct = (r) => r.st.change?.pct ?? null;
    if (sort.value === 'up') list = list.filter((r) => pct(r) > 0).sort((a, b) => pct(b) - pct(a));
    else if (sort.value === 'down') list = list.filter((r) => pct(r) < 0).sort((a, b) => pct(a) - pct(b));
    else if (sort.value === 'recent') list.sort((a, b) => (a.st.latest.date < b.st.latest.date ? 1 : -1));
    else if (sort.value === 'name') list.sort((a, b) => a.item.name.localeCompare(b.item.name));
    else list.sort((a, b) => Math.abs(pct(b) ?? -1) - Math.abs(pct(a) ?? -1));
    box.replaceChildren(list.length ? h('div', {}, list.map(({ item, st }) => {
      const c = st.change;
      return h('a', { class: 'card price-row', href: `#/items/${item.id}` },
        h('div', { class: 'card-head' }, h('b', {}, item.name), c && c.pct !== null ? pill(Math.abs(c.pct) < 0.05 ? 'same' : formatPct(c.pct), Math.abs(c.pct) < 0.05 ? 'neutral' : c.pct > 0 ? 'bad' : 'good') : pill(st.count === 1 ? 'bought once' : 'not comparable', 'neutral')),
        h('div', { class: 'price-cols' },
          h('div', {}, h('span', { class: 'muted small' }, 'Latest'), h('b', {}, ctx.fm(st.latest.totalMinor)), h('span', { class: 'small' }, describeQty(st.latest)), h('span', { class: 'muted small' }, `${dateLabel(st.latest.date)}${st.latest.merchant ? ' · ' + st.latest.merchant : ''}`)),
          st.previous ? h('div', {}, h('span', { class: 'muted small' }, 'Previous'), h('b', {}, ctx.fm(st.previous.totalMinor)), h('span', { class: 'small' }, describeQty(st.previous)), h('span', { class: 'muted small' }, `${dateLabel(st.previous.date)}${st.previous.merchant ? ' · ' + st.previous.merchant : ''}`)) : h('div', { class: 'muted small' }, 'No earlier comparable purchase')),
        c ? h('p', { class: `small ${c.pct > 0 ? 'bad' : c.pct < 0 ? 'good' : 'muted'}` },
          Math.abs(c.pct) < 0.05 ? `Same price per ${c.unitLabel}.` : `${ctx.fm(Math.abs(c.equivalentDiff))} ${c.pct > 0 ? 'higher' : 'lower'} for the same quantity · ${ctx.fm(Math.round(c.latestUnit))}/${c.unitLabel} vs ${ctx.fm(Math.round(c.previousUnit))}/${c.unitLabel}`) : null,
        st.lowest && st.count > 1 ? h('p', { class: 'muted small' }, `Lowest ever ${ctx.fm(Math.round(st.lowest.u.perUnit))}/${st.lowest.u.label} at ${st.lowest.p.merchant || 'unknown store'} · average ${ctx.fm(Math.round(st.average))}/${st.latestUnit?.label}`) : null);
    })) : h('p', { class: 'muted center' }, 'No items match.'));
  };
  q.addEventListener('input', draw); sort.addEventListener('change', draw);
  root.append(h('p', { class: 'muted small' }, 'Prices are compared per kg, litre or piece so different pack sizes are fair. Items bought in incompatible units are not compared.'), h('div', { class: 'filters' }, q, sort), box);
  draw();
  return root;
}
