// Turns raw OCR text from a receipt photo into structured, editable data.
// The output is ALWAYS shown on the review screen; nothing here is saved
// automatically. Every guess carries flags so the UI can highlight it.

import { parseMoney } from './money.js';
import { normaliseUnit, sizeFromText } from './units.js';

export const KNOWN_MERCHANTS = [
  'Carrefour', 'Lulu', 'LuLu Hypermarket', 'Spinneys', 'Union Coop', 'Choithrams', 'Waitrose', 'Viva',
  'Nesto', 'Grandiose', 'Al Maya', 'Kibsons', 'Talabat Mart', 'Noon', 'Amazon', 'West Zone', 'Safeer',
  'Géant', 'Geant', 'Panda', 'Tamimi', 'Danube', 'Othaim', 'Al Madina', 'Day to Day', 'Sharjah Coop',
  'Abu Dhabi Coop', 'ADCOOP', 'Ajman Coop', 'Megamart', 'Almaya', 'Istanbul Supermarket', 'Organic Foods',
  'Zoom', 'ENOC', 'ADNOC', 'Emarat', 'IKEA', 'Ace', 'Boots', 'Life Pharmacy', 'Aster', 'Tesco', 'Sainsbury',
  'Asda', 'Aldi', 'Lidl', 'Walmart', 'Costco', 'Target',
];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const RE_AMOUNT_END = /(-?\s?\d{1,3}(?:[,\s]\d{3})*[.,]\d{2,3}|-?\d+[.,]\d{2,3})\s*(-)?\s*(?:[A-Z*#]{0,2}|AED|SAR|USD)?\s*$/i;
const RE_IGNORE = /\b(trn|tel|phone|fax|mob|www\.|http|email|e-mail|thank|visit again|welcome|cashier|counter|terminal|tid|mid|auth|approval|approved|batch|stan|rrn|aid|tvr|tsi|change due|^change|tendered|tender|cash given|balance|points|loyalty|member|share|items?\s*count|no\.? of items|total items|total qty|qty\s*:|signature|customer copy|merchant copy)\b/i;
const RE_ADDRESS = /\b(po box|p\.o\.|street|st\.|road|rd\.|building|bldg|tower|mall|branch|dubai|abu dhabi|sharjah|ajman|al ain|uae|u\.a\.e|emirates|riyadh|jeddah|doha)\b/i;
const RE_SUBTOTAL = /\bsub\s*-?\s*total\b/i;
const RE_TOTAL = /\b(grand\s*total|net\s*(total|amount|payable)|total\s*(amount|due|payable|aed|incl\.?)?|amount\s*(due|payable)|to\s*pay|balance\s*due|net\s*to\s*pay)\b/i;
const RE_TAX = /\b(vat|tax|gst)\b/i;
const RE_EXCL = /\b(excl|excluding|before\s*vat|without\s*vat|taxable)\b/i;
const RE_INCL = /\b(incl|including|inclusive)\b/i;
const RE_DISCOUNT = /\b(discount|disc|promo|promotion|offer|coupon|voucher|deal|markdown|less)\b/i;
const RE_SAVINGS = /\b(you\s*saved|total\s*sav(ing|ings)|savings|saved)\b/i;
const RE_PAYMENT = /\b(visa|master\s*card|mastercard|amex|american express|mada|apple\s*pay|google\s*pay|samsung\s*pay|cash|debit\s*card|credit\s*card|card\s*payment|card|nol|tabby|tamara|wallet)\b/i;
const RE_QTY_X = /(\d+(?:[.,]\d{1,3})?)\s*(kg|kgs|g|gm|l|ltr|pcs|pc|ea)?\s*[x×@*]+\s*(\d+[.,]\d{2,3})(?:\s*\/\s*(kg|l|pc|ea))?/i;

function cleanLine(s) {
  return String(s || '')
    .replace(/[|]/g, ' ')
    .replace(/(\d)\s*[oO]\s*(?=\d)/g, '$10') // 1O.50 -> 10.50
    .replace(/(\d)[,](\d{2})(?!\d)/g, '$1.$2') // 12,50 -> 12.50
    .replace(/(\d)\s*[xX×]{1,3}\s*(?=\d)/g, '$1 x ') // "2 xXx 7.25" (OCR noise) -> "2 x 7.25"
    .replace(/\s+/g, ' ')
    .trim();
}

function amountAtEnd(line, digits) {
  const m = line.match(RE_AMOUNT_END);
  if (!m) return null;
  let raw = m[1].replace(/\s/g, '');
  const trailingMinus = !!m[2];
  const minor = parseMoney(raw, digits, { allowNegative: true });
  if (minor === null) return null;
  return { minor: trailingMinus ? -Math.abs(minor) : minor, index: m.index, raw: m[0] };
}

export function parseDate(text, today = new Date()) {
  const s = String(text);
  let y, mo, d;
  let m = s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  if (!y) {
    m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
    if (m) {
      let a = +m[1], b = +m[2];
      y = +m[3]; if (y < 100) y += 2000;
      if (a > 12 && b <= 12) { d = a; mo = b; }
      else if (b > 12 && a <= 12) { mo = a; d = b; }
      else { d = a; mo = b; } // day-first default (UAE / UK / most of the world)
    }
  }
  if (!y) {
    m = s.match(/\b(\d{1,2})[\s\-/.]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-/.,]*(\d{4}|\d{2})\b/i);
    if (m) { d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3]; if (y < 100) y += 2000; }
  }
  if (!y) {
    m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-/.]*(\d{1,2})(?:st|nd|rd|th)?[\s,\-/.]*(\d{4})\b/i);
    if (m) { mo = MONTHS[m[1].toLowerCase()]; d = +m[2]; y = +m[3]; }
  }
  if (!y || !mo || !d || mo > 12 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const future = dt.getTime() - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) > 86400000;
  return { iso, future };
}

export function parseTime(text) {
  const m = String(text).match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?::([0-5]\d))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = +m[1];
  if (m[4]) { const pm = m[4].toLowerCase() === 'pm'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function findMerchant(lines) {
  const top = lines.slice(0, 10).join(' \n ').toLowerCase();
  const all = lines.join(' \n ').toLowerCase();
  for (const src of [top, all]) {
    for (const name of KNOWN_MERCHANTS) {
      const re = new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (re.test(src)) return { name: name === 'Geant' ? 'Géant' : name === 'LuLu Hypermarket' ? 'Lulu' : name, confident: true };
    }
  }
  for (const l of lines.slice(0, 6)) {
    const letters = (l.match(/[A-Za-z]/g) || []).length;
    if (letters >= 3 && !/\b(tax|invoice|receipt|welcome|vat|trn|tel|date|time|bill|copy|simplified)\b/i.test(l) && !/\d{3,}/.test(l)) {
      return { name: l.replace(/[^A-Za-z0-9&'\- ]/g, '').trim().slice(0, 40), confident: false };
    }
  }
  return null;
}

function findReceiptNo(lines) {
  for (const l of lines) {
    if (/\btrn\b/i.test(l)) continue;
    const m = l.match(/\b(?:receipt|invoice|inv|bill|trans(?:action)?|txn|order|ref|doc)\.?\s*(?:no|num|number|#|id)?\.?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i);
    if (m && /\d/.test(m[1])) return m[1];
  }
  return null;
}

/**
 * Parse receipt text.
 * @param {string|Array<{text:string, conf?:number}>} input
 * @param {{digits?:number, today?:Date}} opts
 */
export function parseReceiptText(input, { digits = 2, today = new Date() } = {}) {
  const rawLines = Array.isArray(input)
    ? input.map((l) => ({ text: l.text, conf: l.conf ?? 100 }))
    : String(input || '').split(/\r?\n/).map((t) => ({ text: t, conf: 100 }));
  const lines = rawLines.map((l) => ({ text: cleanLine(l.text), conf: l.conf })).filter((l) => l.text.length > 0);
  const texts = lines.map((l) => l.text);

  const result = {
    merchant: null, merchantConfident: false, date: null, dateFuture: false, time: null, receiptNo: null,
    items: [], subtotalMinor: null, receiptDiscountMinor: 0, savingsInfoMinor: null, taxMinor: null,
    totalMinor: null, exclTaxMinor: null, paymentMethod: null, warnings: [],
  };

  const merchant = findMerchant(texts);
  if (merchant) { result.merchant = merchant.name; result.merchantConfident = merchant.confident; }
  for (const t of texts) {
    if (!result.date) { const d = parseDate(t, today); if (d) { result.date = d.iso; result.dateFuture = d.future; } }
    if (!result.time && /\d[:.]\d\d/.test(t) && !/\d[.,]\d\d\s*$/.test(t)) result.time = parseTime(t);
    if (!result.time && /\b\d{1,2}:\d{2}\b/.test(t)) result.time = parseTime(t);
  }
  result.receiptNo = findReceiptNo(texts);

  let inSummary = false;
  let pendingDesc = null; // description line waiting for its price line
  const totals = [];

  for (let i = 0; i < lines.length; i++) {
    const { text, conf } = lines[i];
    const amt = amountAtEnd(text, digits);
    const lower = text.toLowerCase();

    if (!amt && (RE_SUBTOTAL.test(text) || RE_TAX.test(text) || RE_TOTAL.test(text))) { pendingDesc = null; continue; }
    if (RE_SUBTOTAL.test(text)) { if (amt) result.subtotalMinor = Math.abs(amt.minor); inSummary = true; pendingDesc = null; continue; }
    if (RE_TAX.test(text) && !(RE_INCL.test(text) && RE_TOTAL.test(text))) {
      if (amt) {
        if (RE_EXCL.test(text)) result.exclTaxMinor = Math.abs(amt.minor);
        else if (!/\d+(\.\d+)?\s*%\s*$/.test(text)) result.taxMinor = Math.abs(amt.minor);
      }
      inSummary = true; pendingDesc = null; continue;
    }
    if (RE_SAVINGS.test(text)) { if (amt) result.savingsInfoMinor = Math.abs(amt.minor); pendingDesc = null; continue; }
    if (RE_TOTAL.test(text) && !/\btotal\s*(items|qty|quantity|discount|savings?|vat|tax)\b/i.test(text)) {
      if (amt) {
        const prio = /grand|net|payable|due|to pay|incl/i.test(text) ? 2 : 1;
        totals.push({ minor: Math.abs(amt.minor), prio, i });
      }
      inSummary = true; pendingDesc = null; continue;
    }
    if (RE_DISCOUNT.test(text) && amt) {
      const v = Math.abs(amt.minor);
      const last = result.items[result.items.length - 1];
      if (!inSummary && last && !last.discountMinor) { last.discountMinor = v; last.flags.push('discount-applied'); }
      else result.receiptDiscountMinor += v;
      pendingDesc = null; continue;
    }
    if (RE_PAYMENT.test(text)) {
      if (!result.paymentMethod) {
        const pm = text.match(RE_PAYMENT)[1].toLowerCase();
        result.paymentMethod = /visa|master|amex|american|mada|debit|credit|card/.test(pm) ? 'card' : /apple|google|samsung|wallet|tabby|tamara|nol/.test(pm) ? 'wallet' : 'cash';
      }
      if (inSummary || !amt || totals.length) { pendingDesc = null; continue; }
    }
    if (RE_IGNORE.test(text)) { pendingDesc = null; continue; }
    if (inSummary) continue;

    if (!amt) {
      if (RE_ADDRESS.test(text)) { pendingDesc = null; continue; }
      const letters = (text.match(/[A-Za-z؀-ۿ]/g) || []).length;
      const isHeaderish = /\b(description|item|qty|price|amount|rate|total)\b/i.test(lower) && letters < 30;
      if (letters >= 3 && !isHeaderish && !parseDate(text, today)) pendingDesc = { text, conf };
      continue;
    }
    // negative amount on its own line = discount for the previous item
    if (amt.minor < 0) {
      const last = result.items[result.items.length - 1];
      if (last && !last.discountMinor) { last.discountMinor = Math.abs(amt.minor); last.flags.push('discount-applied'); }
      else result.receiptDiscountMinor += Math.abs(amt.minor);
      continue;
    }

    let desc = text.slice(0, amt.index).trim();
    let qty = 1; let packSize = null; let packUnit = 'pc'; let unitPriceMinor = null;
    const qm = desc.match(RE_QTY_X);
    if (qm) {
      qty = Number(qm[1].replace(',', '.'));
      const u = normaliseUnit(qm[2] || qm[4]);
      if (u) packUnit = u;
      unitPriceMinor = parseMoney(qm[3], digits);
      desc = (desc.slice(0, qm.index) + ' ' + desc.slice(qm.index + qm[0].length)).trim();
    }
    // trailing unit-price column: "MILK 1L 2 3.50 7.00"
    if (!qm) {
      const cols = desc.match(/^(.*?)(?:\s+(\d{1,3}(?:\.\d{1,3})?))\s+(\d+\.\d{2,3})$/);
      if (cols) {
        const q = Number(cols[2]); const up = parseMoney(cols[3], digits);
        if (q > 0 && up && Math.abs(up * q - amt.minor) <= Math.max(2, q)) { desc = cols[1]; qty = q; unitPriceMinor = up; }
      }
    }
    const letters = (desc.match(/[A-Za-z؀-ۿ]/g) || []).length;
    let lineConf = conf;
    if (letters < 3 && pendingDesc) { desc = (pendingDesc.text + ' ' + desc).trim(); lineConf = Math.min(conf, pendingDesc.conf); }
    else if (letters < 3) { pendingDesc = null; if (!desc) continue; }
    pendingDesc = null;
    desc = desc.replace(/^\d{6,}\s*/, '').replace(/\s{2,}/g, ' ').replace(/^[\-*.#\s]+/, '').trim();
    if (!desc) desc = 'Unknown item';

    const size = sizeFromText(desc);
    if (size && packUnit === 'pc') { packSize = size.packSize; packUnit = size.packUnit; }
    if (unitPriceMinor === null) unitPriceMinor = qty ? Math.round(amt.minor / qty) : amt.minor;

    const flags = [];
    if (lineConf < 70) flags.push('low-confidence');
    if (qm && unitPriceMinor !== null && Math.abs(Math.round(unitPriceMinor * qty) - amt.minor) > Math.max(2, Math.ceil(qty))) flags.push('qty-mismatch');
    if (desc === 'Unknown item' || letters < 3 && desc.length < 4) flags.push('unclear-name');

    result.items.push({ description: desc, qty, packSize, packUnit, unitPriceMinor, totalMinor: amt.minor, discountMinor: 0, confidence: Math.round(lineConf), flags });
  }

  if (totals.length) {
    const top = Math.max(...totals.map((t) => t.prio));
    const cands = totals.filter((t) => t.prio === top);
    result.totalMinor = cands[cands.length - 1].minor;
  }

  if (!result.merchant) result.warnings.push('Store name not found — please enter it.');
  else if (!result.merchantConfident) result.warnings.push('Store name is a guess — please check it.');
  if (!result.date) result.warnings.push('Receipt date not found — today\'s date was used.');
  if (result.dateFuture) result.warnings.push('Receipt date is in the future — please check it.');
  if (result.totalMinor === null) result.warnings.push('Receipt total not found — please enter it.');
  if (!result.items.length) result.warnings.push('No item lines were recognised — add them manually.');
  return result;
}

/**
 * Check that item lines add up to the receipt total.
 * VAT in the UAE is usually included in shelf prices; we accept either
 * "tax included" or "tax added on top" and report which one matched.
 */
export function validateReceipt({ items, receiptDiscountMinor = 0, taxMinor = 0, totalMinor }) {
  const itemsNet = items.reduce((s, it) => s + (Number(it.totalMinor) || 0) - (Number(it.discountMinor) || 0), 0);
  const inclusive = itemsNet - (receiptDiscountMinor || 0);
  const exclusive = inclusive + (taxMinor || 0);
  if (totalMinor === null || totalMinor === undefined) return { itemsNet, expected: inclusive, difference: null, mode: 'unknown', ok: false };
  const tol = 2; // allow 2 minor units of rounding difference
  if (Math.abs(inclusive - totalMinor) <= tol) return { itemsNet, expected: inclusive, difference: totalMinor - inclusive, mode: 'tax-included', ok: true };
  if (taxMinor && Math.abs(exclusive - totalMinor) <= tol) return { itemsNet, expected: exclusive, difference: totalMinor - exclusive, mode: 'tax-added', ok: true };
  return { itemsNet, expected: inclusive, difference: totalMinor - inclusive, mode: 'mismatch', ok: false };
}

/** A stable fingerprint used to detect the same receipt being imported twice. */
export function receiptFingerprint({ merchant, date, totalMinor, receiptNo }) {
  const m = String(merchant || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [m, date || '', totalMinor ?? '', String(receiptNo || '').toUpperCase()].join('|');
}
