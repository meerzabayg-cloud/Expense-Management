// Money helpers. All amounts are stored as integers in "minor units"
// (e.g. fils for AED: AED 12.50 is stored as 1250). This avoids the
// rounding errors that floating-point numbers cause in financial maths.

export const CURRENCIES = {
  AED: { digits: 2, name: 'UAE Dirham' },
  SAR: { digits: 2, name: 'Saudi Riyal' },
  QAR: { digits: 2, name: 'Qatari Riyal' },
  KWD: { digits: 3, name: 'Kuwaiti Dinar' },
  BHD: { digits: 3, name: 'Bahraini Dinar' },
  OMR: { digits: 3, name: 'Omani Rial' },
  USD: { digits: 2, name: 'US Dollar' },
  EUR: { digits: 2, name: 'Euro' },
  GBP: { digits: 2, name: 'British Pound' },
  INR: { digits: 2, name: 'Indian Rupee' },
  PKR: { digits: 2, name: 'Pakistani Rupee' },
  PHP: { digits: 2, name: 'Philippine Peso' },
  EGP: { digits: 2, name: 'Egyptian Pound' },
  JPY: { digits: 0, name: 'Japanese Yen' },
};

export function digitsFor(currency) {
  return CURRENCIES[currency]?.digits ?? 2;
}

/**
 * Parse user-typed money text into integer minor units.
 * Accepts "12", "12.5", "12.50", "1,234.50", "1 234,50", "AED 12.50", "-3.00".
 * Returns null when the text is not a valid amount.
 */
export function parseMoney(input, digits = 2, { allowNegative = false } = {}) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return parseMoney(input.toFixed(digits), digits, { allowNegative });
  }
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[A-Za-z \s]/g, '').replace(/[^\d.,\-−]/g, '');
  s = s.replace('−', '-');
  let negative = false;
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (!s || /-/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart, fracPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('');
    [intPart, fracPart = ''] = s.split(dec);
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    const commas = s.split(',').length - 1;
    if (commas === 1 && after > 0 && after <= Math.max(digits, 2) && after !== 3) {
      [intPart, fracPart] = s.split(',');
    } else {
      intPart = s.split(',').join('');
    }
  } else if (lastDot >= 0) {
    const dots = s.split('.').length - 1;
    if (dots > 1) intPart = s.split('.').join('');
    else [intPart, fracPart] = s.split('.');
  } else {
    intPart = s;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (!intPart && !fracPart) return null;
  if (fracPart.length > digits) {
    // round half up on the extra digits
    const keep = fracPart.slice(0, digits);
    const next = Number(fracPart[digits]);
    let val = BigInt((intPart || '0') + keep.padEnd(digits, '0'));
    if (next >= 5) val += 1n;
    const n = Number(val);
    if (!Number.isSafeInteger(n)) return null;
    if (negative && !allowNegative) return null;
    return negative ? -n : n;
  }
  const n = Number((intPart || '0') + fracPart.padEnd(digits, '0'));
  if (!Number.isSafeInteger(n)) return null;
  if (negative && !allowNegative) return null;
  return negative ? -n : n;
}

/** Convert minor units to a plain decimal string, e.g. 1250 -> "12.50". */
export function toDecimalString(minor, digits = 2) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '';
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  if (digits === 0) return (neg ? '-' : '') + String(abs);
  const s = String(abs).padStart(digits + 1, '0');
  return (neg ? '-' : '') + s.slice(0, -digits) + '.' + s.slice(-digits);
}

function group(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format minor units for display: formatMoney(1250, 'AED') -> "AED 12.50". */
export function formatMoney(minor, currency = 'AED', { digits, sign = false, compact = false } = {}) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  const d = digits ?? digitsFor(currency);
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  let body;
  if (compact && abs >= 100000 * 10 ** d) {
    const major = abs / 10 ** d;
    body = major >= 1e6 ? (major / 1e6).toFixed(1) + 'M' : (major / 1e3).toFixed(1) + 'K';
  } else {
    const s = toDecimalString(abs, d);
    const [i, f] = s.split('.');
    body = group(i) + (f !== undefined ? '.' + f : '');
  }
  const prefix = neg ? '−' : sign && minor > 0 ? '+' : '';
  return `${prefix}${currency} ${body}`;
}

/** Multiply an amount in minor units by a (possibly fractional) quantity, rounding to nearest minor unit. */
export function mulQty(minor, qty) {
  const r = minor * qty;
  return Math.round(r + (r >= 0 ? 1e-9 : -1e-9));
}

/** Split an amount into parts proportional to weights, guaranteeing the parts add up exactly. */
export function allocate(totalMinor, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? totalMinor : 0));
  const raw = weights.map((w) => (totalMinor * w) / sum);
  const floors = raw.map(Math.floor);
  let rem = totalMinor - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < order.length && rem > 0; k++, rem--) floors[order[k][1]] += 1;
  return floors;
}

/** Percentage change from a to b, or null if a is zero/missing. */
export function pctChange(from, to) {
  if (!from || from === 0 || to === null || to === undefined) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

export function formatPct(p, { sign = true, digits = 1 } = {}) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  const v = Math.abs(p).toFixed(digits).replace(/\.0+$/, '');
  return (sign ? (p > 0 ? '+' : p < 0 ? '−' : '') : '') + v + '%';
}
