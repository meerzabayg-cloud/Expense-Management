import { h, icon, openSheet, field, select, moneyInput, toast, busy, confirmDialog, emptyState, pill, setFieldError } from '../ui.js';
import * as repo from '../repo.js';
import * as calc from '../calc.js';
import { progress } from '../charts.js';
import { monthLabel, currentMonth, todayISO, dateLabel, addMonths } from '../dates.js';
import { toDecimalString, formatPct } from '../money.js';
import { UNIT_OPTIONS, UNITS, fmtNum } from '../units.js';
import { pickItem, accountOptions, merchantList, catIcon } from './forms.js';

export async function renderLists(ctx) {
  const { data } = ctx;
  const root = h('div', { class: 'view' });
  const active = data.lists.filter((l) => l.status === 'active').sort((a, b) => (a.month < b.month ? 1 : -1));
  const done = data.lists.filter((l) => l.status === 'completed').sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : (b.completedAt || 0) - (a.completedAt || 0)));

  root.append(h('button', { class: 'btn btn-primary btn-block', onclick: () => openNewList(ctx) }, icon('plus'), 'New grocery list'));

  if (!data.lists.length) {
    root.append(emptyState('list', 'No grocery lists yet', 'Create a list for this month. Next month you can generate it from what you bought, so planning takes seconds.'));
  }
  if (active.length) {
    root.append(h('h3', { class: 'section-title' }, 'Active lists'));
    for (const l of active) root.append(listCard(ctx, l));
  }
  if (data.templates.length) {
    root.append(h('h3', { class: 'section-title' }, 'Templates'));
    root.append(h('div', { class: 'card' }, data.templates.map((t) => h('div', { class: 'row static' },
      h('span', { class: 'row-icon' }, '📋'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t.name), h('span', { class: 'row-sub' }, `${t.entries.length} items`)),
      h('span', { class: 'row-actions' },
        h('button', { class: 'btn btn-small btn-ghost', 'aria-label': `Delete template ${t.name}`, onclick: async () => { if (await confirmDialog({ title: 'Delete template?', message: `“${t.name}” will be removed. Lists made from it are not affected.`, confirmText: 'Delete', danger: true })) { await repo.deleteTemplate(t.id); ctx.refresh(); } } }, icon('trash', { size: 18 })),
        h('button', { class: 'btn btn-small btn-primary', onclick: () => openNewList(ctx, { mode: 'template', templateId: t.id, name: t.name }) }, 'Use'))))));
  }
  if (done.length) {
    root.append(h('h3', { class: 'section-title' }, 'Monthly history'));
    for (const l of done.slice(0, 36)) root.append(listCard(ctx, l));
  }
  return root;
}

function listCard(ctx, l) {
  const entries = ctx.data.listEntries.filter((e) => e.listId === l.id);
  const t = calc.listTotals(entries);
  return h('a', { class: 'card list-card', href: `#/list/${l.id}` },
    h('div', { class: 'card-head' }, h('h3', {}, l.name), l.status === 'completed' ? pill('Completed', 'neutral') : pill(monthLabel(l.month, { short: true }), 'info')),
    progress(t.planned ? (t.purchased / t.planned) * 100 : 0, { tone: 'good' }),
    h('p', { class: 'muted small' }, `${t.purchased}/${t.planned} bought · est. ${ctx.fm(t.estTotal)}${t.actual ? ` · paid ${ctx.fm(t.actual)}` : ''}`));
}

function openNewList(ctx, preset = {}) {
  const month = h('input', { type: 'month', value: preset.month || currentMonth() });
  const name = h('input', { type: 'text', value: preset.name || `Groceries ${monthLabel(currentMonth())}`, maxlength: 60 });
  const opts = [['blank', 'Start empty'], ['previous', 'From last month’s purchases & list']];
  if (ctx.data.templates.length) opts.push(['template', 'From a template']);
  const mode = select(opts, preset.mode || (ctx.data.purchases.length || ctx.data.lists.length ? 'previous' : 'blank'));
  const tpl = select(ctx.data.templates.map((t) => [t.id, t.name]), preset.templateId || ctx.data.templates[0]?.id);
  const tplField = field('Template', tpl);
  const sync = () => { tplField.style.display = mode.value === 'template' ? '' : 'none'; };
  mode.addEventListener('change', sync);
  month.addEventListener('change', () => { if (/^Groceries /.test(name.value)) name.value = `Groceries ${monthLabel(month.value)}`; });
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Create list');
  let s;
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    await busy(save, async () => {
      try {
        const l = await repo.createList({ name: name.value, month: month.value, mode: mode.value, templateId: tpl.value });
        s.close();
        await ctx.refresh({ rerender: false });
        const n = ctx.data.listEntries.filter((x) => x.listId === l.id).length;
        if (mode.value === 'previous' && !n) toast('Nothing was bought last month yet, so the list starts empty.');
        else if (n) toast(`List created with ${n} items`, { tone: 'good' });
        ctx.go(`#/list/${l.id}`);
      } catch (err) { toast(err.message, { tone: 'error' }); }
    });
  } }, field('List name', name), field('Month', month), field('Start from', mode, { hint: 'Last month’s quantities and latest prices are used as estimates. You can change everything afterwards.' }), tplField, save);
  s = openSheet('New grocery list', form);
  sync();
}

export async function renderListDetail(ctx, { id }) {
  const { data } = ctx;
  const list = data.lists.find((l) => l.id === id);
  if (!list) return emptyState('list', 'List not found', 'It may have been deleted.', h('a', { class: 'btn btn-primary', href: '#/list' }, 'All lists'));
  ctx.setTitle(list.name);
  const entries = data.listEntries.filter((e) => e.listId === id);
  const t = calc.listTotals(entries);
  const purchasesByItem = calc.groupBy(data.purchases, (p) => p.itemId);
  const root = h('div', { class: 'view' });
  ctx.ui.hideBought ??= false;

  // budget context for the list's month
  const summary = calc.summariseMonth(data.transactions, list.month, data.categories);
  const gb = calc.budgetsForMonth(data.budgets, list.month).get(calc.GROCERY_CATEGORY_ID)?.amountMinor ?? null;
  const unbilled = entries.filter((e) => e.checked && e.purchaseId && !data.purchases.find((p) => p.id === e.purchaseId)?.transactionId);
  const unbilledTotal = unbilled.reduce((s, e) => s + (e.actualTotalMinor || 0), 0);

  root.append(h('section', { class: 'kpi-hero compact' },
    h('div', { class: 'hero-top' },
      h('span', { class: 'kpi-label' }, `${monthLabel(list.month)}${list.status === 'completed' ? ' · completed' : ''}`),
      h('span', { class: 'hero-value' }, `${t.purchased} / ${t.planned}`),
      h('span', { class: 'hero-sub' }, `bought · ${t.remaining} remaining`)),
    progress(t.planned ? (t.purchased / t.planned) * 100 : 0, { tone: 'good' }),
    h('div', { class: 'stat-grid' },
      stat('Estimated total', ctx.fm(t.estTotal)),
      stat('Still to buy (est.)', ctx.fm(t.estRemaining)),
      stat('Paid so far', ctx.fm(t.actual)),
      gb !== null ? stat('Grocery budget left', ctx.fm(gb - summary.grocery), gb - summary.grocery < 0 ? 'bad' : '') : stat('Grocery budget', 'Not set'),
      gb !== null ? stat('Left after this list', ctx.fm(gb - summary.grocery - t.estRemaining - unbilledTotal), gb - summary.grocery - t.estRemaining - unbilledTotal < 0 ? 'bad' : 'good') : null),
    t.unknownPrice ? h('p', { class: 'hero-note' }, `${t.unknownPrice} item${t.unknownPrice > 1 ? 's have' : ' has'} no estimated price yet.`) : null));

  const actions = h('div', { class: 'chip-row' },
    list.status === 'active' ? h('button', { class: 'chip chip-primary', onclick: () => pickItem(ctx, { title: 'Add to list', exclude: new Set(entries.map((e) => e.itemId)), onPick: async (it) => { await repo.addListEntry(list.id, it.id, it.typicalQty); toast(`${it.name} added`, { tone: 'good' }); ctx.refresh(); } }) }, icon('plus', { size: 16 }), 'Add item') : null,
    h('button', { class: 'chip', 'aria-pressed': String(ctx.ui.hideBought), onclick: () => { ctx.ui.hideBought = !ctx.ui.hideBought; ctx.refresh(); } }, ctx.ui.hideBought ? 'Show bought' : 'Hide bought'),
    h('button', { class: 'chip', onclick: () => listMenu(ctx, list, entries, t) }, icon('menu', { size: 16 }), 'More'));
  root.append(actions);

  if (unbilled.length) {
    root.append(h('div', { class: 'banner banner-info' }, icon('info'),
      h('span', { class: 'grow' }, `${unbilled.length} ticked item${unbilled.length > 1 ? 's' : ''} (${ctx.fm(unbilledTotal)}) ${unbilled.length > 1 ? 'are' : 'is'} not in your expenses yet. Scan the receipt, or record them as an expense.`),
      h('button', { class: 'btn btn-small btn-primary', onclick: () => expenseFromList(ctx, list) }, 'Record')));
  }

  if (!entries.length) {
    root.append(emptyState('list', 'This list is empty', 'Add the items you plan to buy. Prices from your past purchases are filled in automatically.'));
    return root;
  }

  const groups = calc.groupBy([...entries].sort((a, b) => a.name.localeCompare(b.name)), (e) => e.categoryId || 'gro-other');
  const catOrder = [...groups.keys()].sort((a, b) => (data.catsById.get(a)?.sort ?? 999) - (data.catsById.get(b)?.sort ?? 999));
  for (const cid of catOrder) {
    const es = groups.get(cid).filter((e) => !(ctx.ui.hideBought && e.checked));
    if (!es.length) continue;
    const cat = data.catsById.get(cid);
    const grpTotals = calc.listTotals(groups.get(cid));
    root.append(h('section', { class: 'card list-group' },
      h('div', { class: 'card-head' }, h('h3', {}, `${cat?.icon || '🛍️'} ${cat?.name || 'Other'}`), h('span', { class: 'muted small' }, `${grpTotals.purchased}/${grpTotals.planned} · ${ctx.fm(grpTotals.estTotal)}`)),
      es.map((e) => entryRow(ctx, list, e, purchasesByItem.get(e.itemId) || []))));
  }
  return root;
}

function stat(label, value, tone = '') {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: `stat-value ${tone}` }, value));
}

function entryRow(ctx, list, e, purchases) {
  const st = calc.itemPriceStats(purchases);
  const last = st?.latest;
  const est = e.estPriceMinor ? Math.round(e.estPriceMinor * (e.plannedQty || 1)) : null;
  const unitLabel = UNITS[e.unit]?.label || e.unit || '';
  const lastLine = last ? `Last: ${ctx.fm(last.totalMinor)} for ${fmtNum(last.qty)}${last.packSize ? '×' + fmtNum(last.packSize) : ''} ${UNITS[last.packUnit]?.label || ''} · ${dateLabel(last.date, { withYear: false })}${last.merchant ? ' · ' + last.merchant : ''}` : 'No purchase history yet';
  let change = null;
  if (e.checked && e.purchaseId && st?.change && st.latest.id === e.purchaseId && st.change.pct !== null) change = st.change.pct;
  else if (!e.checked && st?.change?.pct !== null && st?.change) change = st.change.pct;
  const box = h('button', { class: `checkbox ${e.checked ? 'on' : ''}`, type: 'button', role: 'checkbox', 'aria-checked': String(!!e.checked), 'aria-label': `${e.checked ? 'Untick' : 'Tick'} ${e.name}`, disabled: list.status !== 'active',
    onclick: (ev) => { ev.stopPropagation(); e.checked ? untick(ctx, e) : tickSheet(ctx, e, last); } }, e.checked ? icon('check', { size: 18 }) : null);
  return h('div', { class: `entry ${e.checked ? 'done' : ''}` },
    box,
    h('button', { class: 'entry-main', type: 'button', onclick: () => editEntry(ctx, list, e) },
      h('span', { class: 'entry-title' }, e.name, e.carriedFrom ? h('span', { class: 'pill pill-neutral tiny' }, 'carried') : null),
      h('span', { class: 'entry-sub' }, e.checked
        ? `Bought ${fmtNum(e.actualQty ?? e.plannedQty)} ${unitLabel}${e.actualTotalMinor !== null && e.actualTotalMinor !== undefined ? ' for ' + ctx.fm(e.actualTotalMinor) : ' (no price)'}${e.store ? ' at ' + e.store : ''}`
        : `${fmtNum(e.plannedQty)} ${unitLabel}${est !== null ? ' · est. ' + ctx.fm(est) : ''}`),
      h('span', { class: 'entry-last' }, lastLine)),
    change !== null && Math.abs(change) >= 0.5 ? pill(formatPct(change), change > 0 ? 'bad' : 'good') : null);
}

function tickSheet(ctx, e, last) {
  const d = ctx.settings.digits;
  const qty = h('input', { type: 'text', inputmode: 'decimal', value: fmtNum(e.plannedQty) });
  const unit = select(UNIT_OPTIONS.map((u) => [u, UNITS[u].label]), last?.packUnit || e.unit || 'pc');
  const packSize = h('input', { type: 'text', inputmode: 'decimal', value: last?.packSize ?? '', placeholder: 'optional' });
  const price = moneyInput({ value: e.estPriceMinor ? toDecimalString(Math.round(e.estPriceMinor * e.plannedQty), d) : '' });
  const store = h('input', { type: 'text', list: 'merchant-list', value: ctx.ui.lastStore || last?.merchant || '', maxlength: 60 });
  const date = h('input', { type: 'date', value: todayISO() });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Tick & save price');
  let s;
  const doTick = async (withPrice, btn) => {
    const q = Number(String(qty.value).replace(',', '.'));
    if (!(q > 0)) { setFieldError(qty, 'Enter a quantity'); return; }
    let total = null;
    if (withPrice) {
      total = ctx.parse(price.value);
      if (total === null || total <= 0) { setFieldError(price, 'Enter the price you paid, or tick without a price'); return; }
    }
    const ps = packSize.value.trim() ? Number(String(packSize.value).replace(',', '.')) : null;
    await busy(btn, async () => {
      ctx.ui.lastStore = store.value.trim();
      await repo.checkListEntry(e.id, { qty: q, packSize: ps, packUnit: unit.value, totalMinor: total, store: store.value, date: date.value, recordPrice: withPrice });
      s.close();
      ctx.refresh();
    });
  };
  const form = h('form', { class: 'form', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); doTick(true, save); } },
    h('p', { class: 'hint' }, 'Ticking marks the item as bought. A price is optional — it is saved to price history, but your expenses only change when you scan the receipt or choose “Record as expense”.'),
    h('div', { class: 'grid-2' }, field('Quantity', qty), field('Unit', unit)),
    field('Pack size', packSize, { hint: 'e.g. 5 for a 5 kg bag; leave empty for loose items' }),
    field(`Total paid for this line (${ctx.settings.currency})`, price),
    h('div', { class: 'grid-2' }, field('Store', store), field('Date', date)),
    merchantList(ctx),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: (ev) => doTick(false, ev.currentTarget) }, 'Tick without price'), save));
  s = openSheet(`Bought: ${e.name}`, form);
}

async function untick(ctx, e) {
  try {
    if (e.purchaseId) {
      const ok = await confirmDialog({ title: 'Untick item?', message: 'The price saved when you ticked it will be removed from price history.', confirmText: 'Untick' });
      if (!ok) return;
    }
    await repo.uncheckListEntry(e.id);
    ctx.refresh();
  } catch (err) { toast(err.message, { tone: 'error', timeout: 5000 }); }
}

function editEntry(ctx, list, e) {
  const d = ctx.settings.digits;
  const qty = h('input', { type: 'text', inputmode: 'decimal', value: fmtNum(e.plannedQty) });
  const unit = select(UNIT_OPTIONS.map((u) => [u, UNITS[u].label]), e.unit || 'pc');
  const est = moneyInput({ value: e.estPriceMinor ? toDecimalString(e.estPriceMinor, d) : '' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save');
  let s;
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    const q = Number(String(qty.value).replace(',', '.'));
    if (!(q > 0)) { setFieldError(qty, 'Enter a quantity greater than 0'); return; }
    const p = est.value.trim() ? ctx.parse(est.value) : null;
    if (est.value.trim() && p === null) { setFieldError(est, 'Enter a valid price'); return; }
    await busy(save, async () => { await repo.updateListEntry(e.id, { plannedQty: q, unit: unit.value, estPriceMinor: p }); s.close(); ctx.refresh(); });
  } },
    h('div', { class: 'grid-2' }, field('Planned quantity', qty), field('Unit', unit)),
    field(`Estimated price per ${UNITS[e.unit]?.label || 'unit'} (${ctx.settings.currency})`, est, { hint: 'Filled from your last purchase. Used for the estimated shopping total.' }),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn btn-ghost', href: `#/items/${e.itemId}` }, 'Price history'),
      list.status === 'active' ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
        if (await confirmDialog({ title: 'Remove from list?', message: `${e.name} will be removed from this list.`, confirmText: 'Remove', danger: true })) { await repo.removeListEntry(e.id); s.close(); ctx.refresh(); }
      } }, icon('trash'), 'Remove') : null,
      save));
  s = openSheet(e.name, form);
}

function expenseFromList(ctx, list) {
  const account = select(accountOptions(ctx), ctx.settings.defaultAccountId || '');
  const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Record expense');
  let s;
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    await busy(save, async () => {
      const created = await repo.createExpenseFromList(list.id, { accountId: account.value || null, currency: ctx.settings.currency });
      s.close();
      toast(created.length ? `${created.length} expense${created.length > 1 ? 's' : ''} recorded (one per store and day)` : 'Nothing to record', { tone: 'good' });
      ctx.refresh();
    });
  } },
    h('p', { class: 'hint' }, 'Creates one Groceries expense per store and day from ticked items that have a price. Only do this if you will NOT scan the receipt for the same shopping trip, otherwise it would be counted twice.'),
    ctx.data.accounts.length ? field('Paid from', account) : null, save);
  s = openSheet('Record ticked items as expense', form);
}

function listMenu(ctx, list, entries, t) {
  let s;
  const item = (ic, label, fn, cls = '') => h('button', { class: `menu-item ${cls}`, type: 'button', onclick: () => { s.close(); fn(); } }, icon(ic), h('span', {}, label));
  s = openSheet('List options', h('div', { class: 'menu-list' },
    item('edit', 'Rename list', () => renameList(ctx, list)),
    entries.length ? item('copy', 'Save as reusable template', () => saveTemplate(ctx, list)) : null,
    list.status === 'active' ? item('check', 'Complete list & save to history', () => complete(ctx, list, t)) : item('repeat', 'Reopen list', async () => { await repo.reopenList(list.id); ctx.refresh(); }),
    item('trash', 'Delete list', async () => {
      if (await confirmDialog({ title: 'Delete this list?', message: 'The list is removed. Prices that are part of an expense or receipt stay in your history.', confirmText: 'Delete', danger: true })) { await repo.deleteList(list.id); toast('List deleted'); ctx.go('#/list'); }
    }, 'danger')));
}

function saveTemplate(ctx, list) {
  const name = h('input', { type: 'text', value: list.name.replace(/\s*\(carried forward\)/, ''), maxlength: 60 });
  let s;
  s = openSheet('Save as template', h('form', { class: 'form', onsubmit: async (e) => { e.preventDefault(); await repo.saveTemplateFromList(list.id, name.value); s.close(); toast('Template saved', { tone: 'good' }); ctx.refresh(); } },
    h('p', { class: 'hint' }, 'A template remembers the items and quantities so you can start future lists from it.'), field('Template name', name), h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save template')));
}

function renameList(ctx, list) {
  const name = h('input', { type: 'text', value: list.name, maxlength: 60 });
  let s;
  s = openSheet('Rename list', h('form', { class: 'form', onsubmit: async (e) => { e.preventDefault(); if (!name.value.trim()) return; await repo.renameList(list.id, name.value); s.close(); ctx.refresh(); } }, field('Name', name), h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Save')));
}

async function complete(ctx, list, t) {
  let carry = t.remaining > 0;
  const extra = t.remaining > 0 ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { carry = e.target.checked; } }), `Carry the ${t.remaining} unbought item${t.remaining > 1 ? 's' : ''} into a list for ${monthLabel(addMonths(list.month, 1))}`) : null;
  const ok = await confirmDialog({ title: 'Complete this list?', message: `${t.purchased} of ${t.planned} items bought. The list will be saved in your monthly history.`, confirmText: 'Complete', extra });
  if (!ok) return;
  const next = await repo.completeList(list.id, { carryForward: carry });
  toast('List completed', { tone: 'good' });
  await ctx.refresh({ rerender: false });
  ctx.go(next ? `#/list/${next.id}` : '#/list');
}
