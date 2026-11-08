// Date helpers. Dates are stored as local "YYYY-MM-DD" strings and months
// as "YYYY-MM" so that a purchase made late in the evening is never moved
// into the next day by time-zone conversion.

const pad = (n) => String(n).padStart(2, '0');

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthOf(iso) { return iso ? String(iso).slice(0, 7) : null; }
export function currentMonth(d = new Date()) { return monthOf(todayISO(d)); }

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

export function monthsBack(endMonth, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(endMonth, -i));
  return out;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(month, { short = false } = {}) {
  if (!month) return '';
  const [y, m] = month.split('-').map(Number);
  const name = MONTH_NAMES[m - 1] || '';
  return short ? `${name.slice(0, 3)} ${String(y).slice(2)}` : `${name} ${y}`;
}

export function dateLabel(iso, { withYear = true } = {}) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}${withYear ? ' ' + y : ''}`;
}

export function isValidISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Advance a date by a recurring frequency, clamping to month end (31 Jan + 1 month = 28/29 Feb). */
export function advance(iso, frequency, anchorDay) {
  const [y, m, d] = iso.split('-').map(Number);
  if (frequency === 'weekly') return addDays(iso, 7);
  if (frequency === 'yearly') {
    const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    return `${y + 1}-${pad(m)}-${pad(Math.min(anchorDay || d, last))}`;
  }
  const next = addMonths(`${y}-${pad(m)}`, 1);
  const [ny, nm] = next.split('-').map(Number);
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${next}-${pad(Math.min(anchorDay || d, last))}`;
}
