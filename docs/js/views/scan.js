import { h, icon, field, select, moneyInput, toast, busy, confirmDialog, openSheet, pill, setFieldError } from '../ui.js';
import * as repo from '../repo.js';
import { parseReceiptText, validateReceipt, receiptFingerprint } from '../receipt-parser.js';
import { findMatches, guessCategory, tidyName } from '../match.js';
import { toDecimalString } from '../money.js';
import { UNIT_OPTIONS, UNITS, sizeFromText, fmtNum } from '../units.js';
import { todayISO, dateLabel, isValidISODate } from '../dates.js';
import { categoryOptions, accountOptions, merchantList, pickItem } from './forms.js';
import { checkImageFile, loadBitmap, prepareForOCR, compressForStorage, hashFile } from '../images.js';
import { recognise, scannerCached } from '../ocr.js';
import { GROCERY_CATEGORY_ID } from '../calc.js';

const AUTO_MATCH = 0.72;
let lineSeq = 0;

export async function renderScan(ctx) {
  if (ctx.ui.scanDraft) return renderReview(ctx, ctx.ui.scanDraft);
  const root = h('div', { class: 'view' });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', id: 'cam-input', onchange: (e) => onFile(ctx, e.target.files?.[0], root) });
  const gallery = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'gal-input', onchange: (e) => onFile(ctx, e.target.files?.[0], root) });
  root.append(
    h('section', { class: 'scan-hero' },
      h('div', { class: 'scan-illus', 'aria-hidden': 'true' }, icon('scan', { size: 46 })),
      h('h2', {}, 'Scan a receipt'),
      h('p', { class: 'muted' }, 'Take a clear, flat photo in good light, or pick a photo or screenshot. You will check every line before anything is saved.')),
    camera, gallery,
    h('label', { for: 'cam-input', class: 'btn btn-primary btn-block btn-lg' }, icon('camera'), 'Take photo'),
    h('label', { for: 'gal-input', class: 'btn btn-secondary btn-block btn-lg' }, icon('image'), 'Choose photo or screenshot'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => { ctx.ui.scanDraft = blankDraft(ctx); ctx.refresh(); } }, icon('edit'), 'Enter a receipt manually'),
    h('div', { class: 'card privacy-card' }, icon('shield'),
      h('div', {}, h('b', {}, 'Private by design. '), 'Text recognition runs on this phone. Receipt photos are never uploaded anywhere.')),
    h('p', { class: 'muted small', id: 'scanner-status' }, ''),
    tips());
  scannerCached().then((ok) => { const el = root.querySelector('#scanner-status'); if (el) el.textContent = ok ? '✓ Scanner is saved for offline use.' : navigator.onLine ? 'The scanner (about 7 MB) downloads the first time you use it, then works offline.' : 'You are offline and the scanner has not been downloaded yet. You can still enter receipts manually.'; });

  const recent = [...ctx.data.receipts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  if (recent.length) {
    root.append(h('h3', { class: 'section-title' }, 'Recently saved receipts'), h('div', { class: 'card' }, recent.map((r) => h('a', { class: 'row', href: '#/history?receipt=' + r.id },
      h('span', { class: 'row-icon' }, '🧾'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.merchant || 'Receipt'), h('span', { class: 'row-sub' }, `${dateLabel(r.date)} · ${r.lineCount} items`)),
      h('span', { class: 'row-amount' }, ctx.fm(r.totalMinor))))));
  }
  return root;
}

function tips() {
  return h('details', { class: 'card tips' }, h('summary', {}, 'Tips for better scans'),
    h('ul', {}, h('li', {}, 'Lay the receipt flat on a dark surface and fill the screen with it.'),
      h('li', {}, 'Avoid shadows and glare; hold the phone directly above.'),
      h('li', {}, 'For long receipts, take two photos and scan them separately — or scan one and add the remaining lines manually.'),
      h('li', {}, 'Screenshots of e-receipts (Talabat, Noon, Carrefour app) usually scan best.')));
}

function blankDraft(ctx, extra = {}) {
  return {
    header: { merchant: '', date: todayISO(), time: null, receiptNo: '', paymentMethod: null, totalMinor: null, taxMinor: null, receiptDiscountMinor: 0, taxMode: 'tax-included', categoryId: GROCERY_CATEGORY_ID, accountId: ctx.settings.defaultAccountId || '', notes: '' },
    lines: [], warnings: [], rawText: '', imageHash: null, imageBlob: null, previewURL: null, source: 'manual', updateLists: true, receiptId: null, ...extra,
  };
}

async function onFile(ctx, file, root) {
  if (!file) return;
  let status;
  try {
    checkImageFile(file);
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill good', style: { width: '3%' } }));
    const label = h('p', { class: 'muted center' }, 'Opening photo…');
    status = openSheet('Reading receipt', h('div', { class: 'center' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), label, bar, h('p', { class: 'muted small center' }, 'This takes 5–30 seconds on most phones. Everything stays on your device.')));
    const [hash, bitmap] = await Promise.all([hashFile(file), loadBitmap(file)]);
    label.textContent = 'Improving contrast…';
    const ocrCanvas = await prepareForOCR(bitmap);
    const keep = ctx.settings.imageRetention !== 'none' ? await compressForStorage(bitmap) : null;
    const result = await recognise(ocrCanvas, (m) => {
      const pct = m.status === 'recognizing text' ? 15 + m.progress * 85 : Math.min(15, (m.progress || 0) * 15);
      bar.firstChild.style.width = `${Math.max(3, pct)}%`;
      label.textContent = m.status === 'recognizing text' ? `Reading text… ${Math.round(m.progress * 100)}%` : 'Starting the scanner…';
    });
    bitmap.close?.();
    const draft = draftFromOCR(ctx, result, { imageHash: hash, imageBlob: keep });
    if (keep) draft.previewURL = URL.createObjectURL(keep);
    status.close();
    ctx.ui.scanDraft = draft;
    ctx.refresh();
  } catch (e) {
    console.error(e);
    status?.close();
    const again = await confirmDialog({ title: 'Could not read this receipt', message: `${e.message || e} You can enter the receipt manually instead.`, confirmText: 'Enter manually' });
    if (again) { ctx.ui.scanDraft = blankDraft(ctx); ctx.refresh(); }
  } finally {
    root.querySelectorAll('input[type=file]').forEach((i) => { i.value = ''; });
  }
}

function matchMerchant(ctx, name) {
  if (!name) return '';
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = ctx.data.merchants.find((m) => { const k = m.name.toLowerCase().replace(/[^a-z0-9]/g, ''); return k === n || (n.length > 3 && (k.startsWith(n) || n.startsWith(k))); });
  return known ? known.name : name;
}

export function draftFromOCR(ctx, result, extra) {
  const parsed = parseReceiptText(result.lines?.length ? result.lines : result.text, { digits: ctx.settings.digits });
  const d = blankDraft(ctx, { ...extra, source: 'ocr', rawText: result.text, warnings: parsed.warnings, ocrConfidence: Math.round(result.confidence || 0) });
  Object.assign(d.header, {
    merchant: matchMerchant(ctx, parsed.merchant || ''), date: parsed.date || todayISO(), time: parsed.time, receiptNo: parsed.receiptNo || '',
    paymentMethod: parsed.paymentMethod, totalMinor: parsed.totalMinor, taxMinor: parsed.taxMinor, receiptDiscountMinor: parsed.receiptDiscountMinor || 0,
  });
  d.headerFlags = { merchant: !parsed.merchant || !parsed.merchantConfident, date: !parsed.date || parsed.dateFuture, total: parsed.totalMinor === null };
  if (parsed.paymentMethod) {
    const want = parsed.paymentMethod === 'cash' ? ['cash'] : parsed.paymentMethod === 'card' ? ['credit', 'debit', 'bank'] : ['wallet'];
    const acc = ctx.data.accounts.find((a) => !a.archived && want.includes(a.type));
    if (acc) d.header.accountId = acc.id;
  }
  d.lines = parsed.items.map((it) => makeLine(ctx, it));
  return d;
}

function makeLine(ctx, it) {
  const line = {
    key: ++lineSeq, description: it.description || '', itemId: null, matchScore: 0, newItemName: '', newItemCategoryId: 'gro-other',
    qty: it.qty || 1, packSize: it.packSize ?? null, packUnit: it.packUnit || 'pc', totalMinor: it.totalMinor ?? null, discountMinor: it.discountMinor || 0,
    include: true, flags: it.flags || [], confidence: it.confidence ?? 100,
  };
  autoMatch(ctx, line);
  return line;
}

function autoMatch(ctx, line) {
  const m = line.description ? findMatches(line.description, ctx.data.items, ctx.data.aliases, { limit: 3 }) : [];
  if (m.length && m[0].score >= AUTO_MATCH) {
    line.itemId = m[0].itemId; line.matchScore = m[0].score; line.newItemName = '';
    const it = ctx.data.itemsById.get(line.itemId);
    if (it && line.packUnit === 'pc' && it.unit && it.unit !== 'pc' && !line.packSize) line.packUnit = it.unit;
  } else {
    line.itemId = null; line.matchScore = m[0]?.score || 0;
    line.newItemName = tidyName(line.description.replace(/\s*\d+(?:[.,]\d+)?\s*(kg|g|gm|ml|l|ltr|pcs|pc)\b/i, '')) || '';
    line.newItemCategoryId = guessCategory(line.description);
  }
  line.suggestions = m;
}

/* ---------------- Review & confirmation ---------------- */

function renderReview(ctx, draft) {
  ctx.setTitle('Review receipt');
  const d = ctx.settings.digits;
  const H = draft.header;
  const root = h('div', { class: 'view review' });
  const validationBox = h('section', { class: 'card validation', 'aria-live': 'polite' });
  const dupBox = h('div');

  const recompute = async () => {
    const included = draft.lines.filter((l) => l.include);
    const v = validateReceipt({ items: included.map((l) => ({ totalMinor: l.totalMinor || 0, discountMinor: l.discountMinor || 0 })), receiptDiscountMinor: H.receiptDiscountMinor || 0, taxMinor: H.taxMinor || 0, totalMinor: H.totalMinor });
    if (v.mode === 'tax-added') H.taxMode = 'tax-added'; else if (v.mode === 'tax-included') H.taxMode = 'tax-included';
    draft.validation = v;
    validationBox.className = `card validation ${v.ok ? 'ok' : 'bad'}`;
    validationBox.replaceChildren(
      h('div', { class: 'val-row' }, h('span', {}, `Items (${included.length})`), h('b', {}, ctx.fm(included.reduce((s, l) => s + (l.totalMinor || 0), 0)))),
      included.some((l) => l.discountMinor) ? h('div', { class: 'val-row' }, h('span', {}, 'Line discounts'), h('b', {}, '−' + ctx.fm(included.reduce((s, l) => s + (l.discountMinor || 0), 0)))) : null,
      H.receiptDiscountMinor ? h('div', { class: 'val-row' }, h('span', {}, 'Receipt discount'), h('b', {}, '−' + ctx.fm(H.receiptDiscountMinor))) : null,
      H.taxMode === 'tax-added' && H.taxMinor ? h('div', { class: 'val-row' }, h('span', {}, 'VAT added'), h('b', {}, ctx.fm(H.taxMinor))) : null,
      h('div', { class: 'val-row strong' }, h('span', {}, 'Calculated'), h('b', {}, ctx.fm(v.expected))),
      h('div', { class: 'val-row strong' }, h('span', {}, 'Receipt total'), h('b', {}, H.totalMinor === null ? 'missing' : ctx.fm(H.totalMinor))),
      v.ok ? h('p', { class: 'good small' }, `✓ Lines add up to the total${v.mode === 'tax-included' ? (H.taxMinor ? ` (VAT ${ctx.fm(H.taxMinor)} is included in prices)` : '') : ' (VAT added on top)'}.`)
        : H.totalMinor === null ? h('p', { class: 'bad small' }, 'Enter the receipt total to check the lines.')
          : h('p', { class: 'bad small' }, `⚠ Unexplained difference of ${ctx.fm(Math.abs(v.difference))} (${v.difference > 0 ? 'total is higher than the lines — a line may be missing or misread' : 'lines add up to more than the total — check for a duplicate line, a missed discount or a misread price'}). The expense will use the receipt total.`));
    // duplicate detection
    const fp = receiptFingerprint({ merchant: H.merchant, date: H.date, totalMinor: H.totalMinor, receiptNo: H.receiptNo });
    draft.fingerprint = fp;
    const dups = (await repo.findDuplicateReceipt({ fingerprint: H.totalMinor ? fp : null, imageHash: draft.imageHash })).filter((r) => r.id !== draft.receiptId);
    const looseDup = ctx.data.transactions.find((t) => t.type === 'expense' && t.date === H.date && t.amountMinor === H.totalMinor && H.totalMinor && (t.merchant || '').toLowerCase() === (H.merchant || '').toLowerCase());
    draft.duplicates = dups;
    dupBox.replaceChildren(dups.length || looseDup ? h('div', { class: 'banner banner-bad' }, icon('alert'), h('span', {},
      dups.some((r) => r.imageHash && r.imageHash === draft.imageHash) ? 'This exact photo was already saved as a receipt. Saving again would count it twice.'
        : dups.length ? `A receipt from ${H.merchant || 'this store'} on ${dateLabel(H.date)} for ${ctx.fm(H.totalMinor)} is already saved. Is this a duplicate?`
          : `An expense of ${ctx.fm(H.totalMinor)} at ${H.merchant} on ${dateLabel(H.date)} already exists. Make sure you are not recording the same purchase twice.`)) : null);
  };

  // Header
  const merchant = h('input', { type: 'text', value: H.merchant, list: 'merchant-list', maxlength: 80, class: draft.headerFlags?.merchant ? 'flag' : '', oninput: (e) => { H.merchant = e.target.value; recompute(); } });
  const date = h('input', { type: 'date', value: H.date, class: draft.headerFlags?.date ? 'flag' : '', onchange: (e) => { H.date = e.target.value; recompute(); } });
  const total = moneyInput({ value: H.totalMinor !== null ? toDecimalString(H.totalMinor, d) : '', class: draft.headerFlags?.total ? 'flag' : '', oninput: (e) => { H.totalMinor = e.target.value.trim() ? ctx.parse(e.target.value) : null; recompute(); } });
  const tax = moneyInput({ value: H.taxMinor ? toDecimalString(H.taxMinor, d) : '', oninput: (e) => { H.taxMinor = e.target.value.trim() ? ctx.parse(e.target.value) : null; recompute(); } });
  const disc = moneyInput({ value: H.receiptDiscountMinor ? toDecimalString(H.receiptDiscountMinor, d) : '', oninput: (e) => { H.receiptDiscountMinor = e.target.value.trim() ? ctx.parse(e.target.value) || 0 : 0; recompute(); } });
  const recNo = h('input', { type: 'text', value: H.receiptNo || '', maxlength: 40, oninput: (e) => { H.receiptNo = e.target.value; recompute(); } });
  const cat = select(categoryOptions(ctx, 'expense'), H.categoryId, { onchange: (e) => { H.categoryId = e.target.value; } });
  const acc = select(accountOptions(ctx), H.accountId || '', { onchange: (e) => { H.accountId = e.target.value; } });
  const taxMode = select([['tax-included', 'VAT included in prices (usual in UAE)'], ['tax-added', 'VAT added on top of prices']], H.taxMode, { onchange: (e) => { H.taxMode = e.target.value; recompute(); } });

  root.append(
    draft.warnings?.length || draft.ocrConfidence !== undefined ? h('section', { class: 'banner banner-warn' }, icon('alert'),
      h('div', {}, draft.source === 'ocr' ? h('b', {}, `Scanned with ${draft.ocrConfidence}% average confidence. `) : null,
        'Please check highlighted fields carefully.', draft.warnings?.length ? h('ul', { class: 'small' }, draft.warnings.map((w) => h('li', {}, w))) : null)) : null,
    dupBox,
    draft.previewURL ? h('details', { class: 'card' }, h('summary', {}, 'Show receipt photo'), h('img', { src: draft.previewURL, alt: 'Receipt photo', class: 'receipt-img' })) : null,
    h('section', { class: 'card form' },
      h('h3', {}, 'Receipt details'),
      field('Store / merchant', merchant),
      h('div', { class: 'grid-2' }, field('Date', date), field(`Total paid (${ctx.settings.currency})`, total)),
      h('div', { class: 'grid-2' }, field('VAT / tax', tax), field('Receipt-level discount', disc)),
      field('VAT handling', taxMode),
      h('div', { class: 'grid-2' }, field('Receipt no.', recNo), field('Expense category', cat)),
      ctx.data.accounts.length ? field(`Paid from${H.paymentMethod ? ` (receipt says: ${H.paymentMethod})` : ''}`, acc) : null,
      merchantList(ctx)));

  const linesBox = h('div', { class: 'lines' });
  const drawLines = () => {
    linesBox.replaceChildren(...draft.lines.map((l) => lineCard(ctx, draft, l, { recompute, redraw: drawLines })));
  };
  drawLines();
  root.append(
    h('div', { class: 'card-head section-title' }, h('h3', {}, `Items (${draft.lines.length})`), h('button', { class: 'chip chip-primary', onclick: () => { draft.lines.push(makeLine(ctx, { description: '', qty: 1, totalMinor: null })); drawLines(); recompute(); setTimeout(() => linesBox.lastChild?.querySelector('input')?.focus(), 50); } }, icon('plus', { size: 16 }), 'Add line')),
    draft.lines.length ? null : h('p', { class: 'muted' }, 'Add each item to build price history, or just enter the total to record the expense.'),
    linesBox,
    validationBox,
    h('label', { class: 'check-row card' }, h('input', { type: 'checkbox', checked: draft.updateLists !== false, onchange: (e) => { draft.updateLists = e.target.checked; } }), 'Tick these items on my active grocery list'),
    draft.rawText ? h('details', { class: 'card' }, h('summary', {}, 'Show recognised text'), h('pre', { class: 'raw' }, draft.rawText)) : null);

  const saveBtn = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', onclick: () => save(ctx, draft, saveBtn, { merchant, date, total }) }, icon('check'), 'Confirm & save');
  root.append(h('div', { class: 'sticky-actions' },
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Discard this receipt?', message: 'Nothing has been saved yet.', confirmText: 'Discard', danger: true })) { discard(ctx); } } }, 'Discard'),
    saveBtn));
  recompute();
  return root;
}

function discard(ctx) {
  if (ctx.ui.scanDraft?.previewURL) URL.revokeObjectURL(ctx.ui.scanDraft.previewURL);
  ctx.ui.scanDraft = null;
  ctx.refresh();
}

function lineCard(ctx, draft, l, { recompute, redraw }) {
  const d = ctx.settings.digits;
  const item = l.itemId ? ctx.data.itemsById.get(l.itemId) : null;
  const flagged = l.flags.includes('low-confidence') || l.flags.includes('qty-mismatch') || l.flags.includes('unclear-name') || l.totalMinor === null;
  const desc = h('input', { type: 'text', value: l.description, maxlength: 80, placeholder: 'Item as written on receipt', 'aria-label': 'Receipt text', onchange: (e) => { l.description = e.target.value; if (!l.manualMatch) { autoMatch(ctx, l); redraw(); } } });
  const qty = h('input', { type: 'text', inputmode: 'decimal', value: fmtNum(l.qty), 'aria-label': 'Quantity', oninput: (e) => { const v = Number(e.target.value.replace(',', '.')); l.qty = v > 0 ? v : 1; } });
  const unit = select(UNIT_OPTIONS.map((u) => [u, UNITS[u].label]), l.packUnit, { 'aria-label': 'Unit', onchange: (e) => { l.packUnit = e.target.value; } });
  const pack = h('input', { type: 'text', inputmode: 'decimal', value: l.packSize ?? '', placeholder: 'size', 'aria-label': 'Pack size', oninput: (e) => { const v = Number(e.target.value.replace(',', '.')); l.packSize = v > 0 ? v : null; } });
  const amt = moneyInput({ value: l.totalMinor !== null ? toDecimalString(l.totalMinor, d) : '', 'aria-label': 'Line total', class: l.totalMinor === null ? 'flag' : '', oninput: (e) => { l.totalMinor = e.target.value.trim() ? ctx.parse(e.target.value) : null; e.target.classList.toggle('flag', l.totalMinor === null); recompute(); } });
  const disc = moneyInput({ value: l.discountMinor ? toDecimalString(l.discountMinor, d) : '', placeholder: '0.00', 'aria-label': 'Line discount', oninput: (e) => { l.discountMinor = e.target.value.trim() ? ctx.parse(e.target.value) || 0 : 0; recompute(); } });
  const include = h('input', { type: 'checkbox', checked: l.include, 'aria-label': 'Include this line', onchange: (e) => { l.include = e.target.checked; card.classList.toggle('excluded', !l.include); recompute(); } });

  const matchArea = item
    ? h('button', { type: 'button', class: `match ${l.manualMatch ? 'match-ok' : l.matchScore >= 0.95 ? 'match-ok' : 'match-suggest'}`, onclick: () => changeMatch() },
      h('span', {}, '→ ', h('b', {}, item.name)), h('span', { class: 'small muted' }, l.manualMatch ? ' chosen' : l.matchScore >= 0.95 ? ' known item' : ` suggested (${Math.round(l.matchScore * 100)}%) — tap to change`))
    : h('div', { class: 'match match-new' },
      h('span', { class: 'small' }, 'New catalogue item:'),
      h('input', { type: 'text', value: l.newItemName, maxlength: 80, 'aria-label': 'New item name', oninput: (e) => { l.newItemName = e.target.value; } }),
      select(categoryOptions(ctx, 'grocery'), l.newItemCategoryId, { 'aria-label': 'New item category', onchange: (e) => { l.newItemCategoryId = e.target.value; } }),
      h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => changeMatch() }, l.suggestions?.length ? `Match existing (${l.suggestions.length} similar)` : 'Match existing item'));

  function changeMatch() {
    pickItem(ctx, {
      title: 'Which item is this?',
      topAction: l.itemId ? { label: 'It is a new item (not in my catalogue)', onClick: () => { l.itemId = null; l.manualMatch = true; autoMatchNew(); redraw(); } } : null,
      onPick: (it) => { l.itemId = it.id; l.manualMatch = true; l.matchScore = 1; if (!l.packSize && l.packUnit === 'pc' && it.unit !== 'pc') l.packUnit = it.unit; redraw(); },
    });
  }
  function autoMatchNew() { l.newItemName = tidyName(l.description) || l.newItemName; l.newItemCategoryId = guessCategory(l.description); }

  const flagsText = [];
  if (l.flags.includes('low-confidence')) flagsText.push(`hard to read (${l.confidence}%)`);
  if (l.flags.includes('qty-mismatch')) flagsText.push('quantity × price ≠ total');
  if (l.flags.includes('unclear-name')) flagsText.push('name unclear');
  if (l.totalMinor === null) flagsText.push('amount missing');

  const card = h('div', { class: `line-card ${flagged ? 'flagged' : ''} ${l.include ? '' : 'excluded'}` },
    h('div', { class: 'line-top' }, h('label', { class: 'inc' }, include, h('span', { class: 'visually-hidden' }, 'Include')), desc,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete line', onclick: () => { draft.lines = draft.lines.filter((x) => x !== l); redraw(); recompute(); } }, icon('trash', { size: 18 }))),
    flagsText.length ? h('div', { class: 'flag-note' }, '⚠ ', flagsText.join(' · ')) : null,
    matchArea,
    h('div', { class: 'line-grid' },
      h('label', {}, h('span', {}, 'Qty'), qty), h('label', {}, h('span', {}, 'Unit'), unit), h('label', {}, h('span', {}, 'Pack'), pack),
      h('label', {}, h('span', {}, 'Line total'), amt), h('label', {}, h('span', {}, 'Discount'), disc)));
  return card;
}

async function save(ctx, draft, btn, controls) {
  const H = draft.header;
  let bad = false;
  if (!isValidISODate(H.date)) { setFieldError(controls.date, 'Enter the receipt date'); bad = true; } else setFieldError(controls.date, '');
  if (!H.totalMinor || H.totalMinor <= 0) { setFieldError(controls.total, 'Enter the total you paid'); bad = true; } else setFieldError(controls.total, '');
  if (!H.merchant.trim()) { setFieldError(controls.merchant, 'Enter the store name'); bad = true; } else setFieldError(controls.merchant, '');
  if (bad) { toast('Please complete the highlighted fields.', { tone: 'error' }); controls.total.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const included = draft.lines.filter((l) => l.include);
  const missing = included.find((l) => l.totalMinor === null || (!l.itemId && !l.newItemName.trim()));
  if (missing) { toast(`Check the line “${missing.description || 'new line'}” — it needs an item name and amount, or untick it.`, { tone: 'error', timeout: 5000 }); return; }
  if (draft.duplicates?.length) {
    const ok = await confirmDialog({ title: 'Possible duplicate', message: 'A matching receipt is already saved. Save this one as well?', confirmText: 'Save anyway', danger: true });
    if (!ok) return;
  }
  if (draft.validation && !draft.validation.ok) {
    const ok = await confirmDialog({ title: 'Totals do not match', message: `The lines differ from the receipt total by ${ctx.fm(Math.abs(draft.validation.difference))}. The expense will be recorded as ${ctx.fm(H.totalMinor)} (the receipt total). Save anyway?`, confirmText: 'Save anyway' });
    if (!ok) return;
  }
  await busy(btn, async () => {
    try {
      draft.receiptId ||= crypto.randomUUID?.() || String(Date.now());
      const res = await repo.confirmReceipt({
        ...draft,
        lines: included.map((l) => ({ ...l, newItemName: l.itemId ? null : l.newItemName.trim(), packSize: l.packSize ?? sizeFromText(l.description)?.packSize ?? null })),
      }, { currency: ctx.settings.currency, digits: ctx.settings.digits });
      if (draft.previewURL) URL.revokeObjectURL(draft.previewURL);
      ctx.ui.scanDraft = null;
      toast(`Receipt saved: ${ctx.fm(H.totalMinor)} at ${H.merchant}`, { tone: 'good' });
      await ctx.refresh({ rerender: false });
      ctx.go(`#/history?receipt=${res.receiptId}`);
    } catch (e) {
      toast(e.message, { tone: 'error', timeout: 5000 });
      if (/already been saved/.test(e.message)) { ctx.ui.scanDraft = null; ctx.refresh(); }
    }
  });
}
