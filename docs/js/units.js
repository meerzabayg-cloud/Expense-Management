// Units of measurement and price normalisation.
// Each unit belongs to a "dimension" and converts to a base unit so that,
// e.g., 500 g and 1 kg can be compared fairly. Units from different
// dimensions are never compared.

export const UNITS = {
  kg: { dim: 'mass', factor: 1000, label: 'kg' },
  g: { dim: 'mass', factor: 1, label: 'g' },
  lb: { dim: 'mass', factor: 453.592, label: 'lb' },
  l: { dim: 'volume', factor: 1000, label: 'L' },
  ml: { dim: 'volume', factor: 1, label: 'ml' },
  pc: { dim: 'count', factor: 1, label: 'pc' },
  dozen: { dim: 'count', factor: 12, label: 'dozen' },
  pack: { dim: 'pack', factor: 1, label: 'pack' },
  bottle: { dim: 'bottle', factor: 1, label: 'bottle' },
  can: { dim: 'can', factor: 1, label: 'can' },
  box: { dim: 'box', factor: 1, label: 'box' },
  bag: { dim: 'bag', factor: 1, label: 'bag' },
  bunch: { dim: 'bunch', factor: 1, label: 'bunch' },
  tray: { dim: 'tray', factor: 1, label: 'tray' },
};

export const UNIT_OPTIONS = Object.keys(UNITS);

const BASE_LABEL = { mass: 'kg', volume: 'L', count: 'pc' };
const BASE_DISPLAY_FACTOR = { mass: 1000, volume: 1000, count: 1 };

export function normaliseUnit(u) {
  if (!u) return null;
  const s = String(u).toLowerCase().trim().replace(/\.$/, '');
  const map = {
    kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
    gm: 'g', gms: 'g', gram: 'g', grams: 'g', gr: 'g', grm: 'g',
    ltr: 'l', ltrs: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l', lt: 'l',
    mls: 'ml', millilitre: 'ml', milliliter: 'ml',
    pcs: 'pc', piece: 'pc', pieces: 'pc', ea: 'pc', each: 'pc', nos: 'pc', no: 'pc', unit: 'pc', units: 'pc',
    pkt: 'pack', pk: 'pack', packet: 'pack', packs: 'pack', pkts: 'pack',
    btl: 'bottle', bottles: 'bottle', cans: 'can', tin: 'can', tins: 'can',
    lbs: 'lb', doz: 'dozen', dz: 'dozen', boxes: 'box', bags: 'bag',
  };
  const k = map[s] || s;
  return UNITS[k] ? k : null;
}

/**
 * Total quantity in the dimension's base unit.
 * qty = number of packs bought; packSize + packUnit describe one pack.
 * If no pack size is given, the quantity itself is in packUnit.
 */
export function baseQuantity({ qty, packSize, packUnit }) {
  const u = UNITS[packUnit];
  if (!u || !(qty > 0)) return null;
  const size = packSize > 0 ? packSize : 1;
  return { dim: u.dim, amount: qty * size * u.factor };
}

/**
 * Price per display base unit (per kg, per L, per pc, or per pack...) in minor units (float).
 * Returns null when it cannot be computed.
 */
export function unitPrice(purchase) {
  const b = baseQuantity(purchase);
  if (!b || !(b.amount > 0) || !Number.isFinite(purchase.totalMinor)) return null;
  const displayFactor = BASE_DISPLAY_FACTOR[b.dim] ?? 1;
  return { dim: b.dim, perUnit: (purchase.totalMinor / b.amount) * displayFactor, label: BASE_LABEL[b.dim] || UNITS[purchase.packUnit]?.label };
}

/** Quantity expressed in the display unit (kg, L, pc or the container), e.g. 2 × 500 g -> 1 (kg). */
export function displayQuantity(purchase) {
  const b = baseQuantity(purchase);
  if (!b) return null;
  return b.amount / (BASE_DISPLAY_FACTOR[b.dim] ?? 1);
}

/** Two purchases can be compared if their quantities share a dimension. */
export function comparable(a, b) {
  const ua = UNITS[a?.packUnit];
  const ub = UNITS[b?.packUnit];
  if (!ua || !ub || ua.dim !== ub.dim) return false;
  // Generic containers (pack/bottle/...) without a known size are only comparable
  // if the declared pack sizes match exactly.
  if (!['mass', 'volume', 'count'].includes(ua.dim)) {
    return (a.packSize || 1) === (b.packSize || 1);
  }
  return true;
}

export function describeQty({ qty, packSize, packUnit }) {
  const u = UNITS[packUnit]?.label || packUnit || '';
  const q = fmtNum(qty);
  if (packSize && packSize !== 1) return `${q} × ${fmtNum(packSize)} ${u}`;
  return `${q} ${u}`.trim();
}

export function fmtNum(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return String(Math.round(n * 1000) / 1000);
}

/** Try to read a pack size from a product description, e.g. "Rice Basmati 5kg" -> {packSize:5, packUnit:'kg'} */
export function sizeFromText(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*(kg|kgs|g|gm|gms|gr|ltr|lt|l|ml|lb|lbs|pcs|pc)\b/i);
  if (!m) return null;
  const unit = normaliseUnit(m[2]);
  const size = Number(m[1].replace(',', '.'));
  if (!unit || !(size > 0)) return null;
  return { packSize: size, packUnit: unit };
}
