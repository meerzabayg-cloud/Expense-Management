// Product-name normalisation and fuzzy matching, used to recognise that
// "BASMATI RICE 5KG" on a receipt is the same product as "Basmati Rice"
// in the catalogue. Matches are always shown to the user for confirmation.

const ABBREVIATIONS = {
  chkn: 'chicken', chk: 'chicken', ckn: 'chicken', chick: 'chicken',
  veg: 'vegetable', vegs: 'vegetables', veggies: 'vegetables',
  tom: 'tomato', toms: 'tomatoes', tomatoe: 'tomato',
  pot: 'potato', pota: 'potato', potat: 'potato',
  onio: 'onion', oni: 'onion',
  bnn: 'banana', banan: 'banana',
  mlk: 'milk', mik: 'milk',
  frs: 'fresh', frsh: 'fresh', fr: 'fresh',
  yog: 'yoghurt', yogurt: 'yoghurt', yghrt: 'yoghurt', laban: 'laban',
  chs: 'cheese', chese: 'cheese',
  btr: 'butter', bttr: 'butter',
  brd: 'bread', bred: 'bread',
  org: 'organic', orgn: 'organic',
  lf: 'low fat', ff: 'full fat', fc: 'full cream',
  wht: 'white', brwn: 'brown', brn: 'brown',
  bsmt: 'basmati', basmti: 'basmati',
  oil: 'oil', sunfl: 'sunflower', sunflwr: 'sunflower', veg_oil: 'vegetable oil',
  wtr: 'water', mnrl: 'mineral', mineral: 'mineral',
  jce: 'juice', juic: 'juice',
  tsu: 'tissue', tiss: 'tissue', tissu: 'tissue',
  dtrg: 'detergent', detrg: 'detergent', deterg: 'detergent',
  shmp: 'shampoo', shamp: 'shampoo',
  tpst: 'toothpaste', toothp: 'toothpaste',
  frz: 'frozen', frzn: 'frozen',
  eg: 'egg', eggs: 'egg',
  bf: 'beef', mttn: 'mutton', mutn: 'mutton', lmb: 'lamb',
  fsh: 'fish', shrmp: 'shrimp', prwn: 'prawn', prawns: 'prawn',
  sug: 'sugar', sgr: 'sugar', slt: 'salt',
  flr: 'flour', atta: 'atta',
  tea: 'tea', cof: 'coffee', coff: 'coffee',
  cuc: 'cucumber', cucmbr: 'cucumber',
  aple: 'apple', apl: 'apple', apples: 'apple',
  orng: 'orange', oranges: 'orange',
};

const STOP = new Set(['the', 'and', 'of', 'with', 'a', 'pcs', 'pc', 'kg', 'g', 'gm', 'ml', 'l', 'ltr', 'x', 'pk', 'pkt', 'pack']);

export function normaliseName(text) {
  if (!text) return '';
  let s = String(text).toLowerCase();
  s = s.replace(/\d+(?:[.,]\d+)?\s*(kg|kgs|g|gm|gms|gr|ltr|lt|l|ml|lb|lbs|pcs|pc|x)\b/g, ' ');
  s = s.replace(/[^a-z؀-ۿ\s]/g, ' ');
  const tokens = s.split(/\s+/).filter(Boolean).map((t) => ABBREVIATIONS[t] || t);
  return tokens
    .join(' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .map(singular)
    .join(' ')
    .trim();
}

function singular(t) {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('oes')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

function bigrams(s) {
  const out = new Map();
  const str = ` ${s} `;
  for (let i = 0; i < str.length - 1; i++) {
    const g = str.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Dice coefficient similarity between two normalised strings (0..1). */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) { total += n; if (B.has(g)) inter += Math.min(n, B.get(g)); }
  for (const n of B.values()) total += n;
  const dice = (2 * inter) / total;
  // token containment bonus: "basmati rice" inside "india gate basmati rice"
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const lo = Math.min(ta.size, tb.size);
  const hi = Math.max(ta.size, tb.size);
  const containment = common / lo;
  return Math.max(dice, containment * (0.55 + 0.4 * (lo / hi)));
}

/**
 * Find best catalogue matches for a description.
 * items: [{id, name, nameNorm}], aliases: [{itemId, aliasNorm}]
 * Returns [{itemId, score, via}] sorted best first.
 */
export function findMatches(description, items, aliases = [], { limit = 5, min = 0.45 } = {}) {
  const q = normaliseName(description);
  if (!q) return [];
  const best = new Map();
  const consider = (itemId, score, via) => {
    const cur = best.get(itemId);
    if (!cur || cur.score < score) best.set(itemId, { itemId, score, via });
  };
  for (const a of aliases) {
    if (a.aliasNorm === q) consider(a.itemId, 1, 'alias');
    else consider(a.itemId, similarity(q, a.aliasNorm) * 0.98, 'alias');
  }
  for (const it of items) {
    if (it.archived) continue;
    const n = it.nameNorm || normaliseName(it.name);
    consider(it.id, similarity(q, n), 'name');
  }
  return [...best.values()].filter((m) => m.score >= min).sort((x, y) => y.score - x.score).slice(0, limit);
}

const CATEGORY_HINTS = [
  ['gro-dairy', /\b(milk|laban|yoghurt|yogurt|cheese|butter|cream|labneh|ghee|egg|eggs)\b/],
  ['gro-meat', /\b(chicken|beef|mutton|lamb|goat|mince|meat|sausage|turkey|steak|kebab)\b/],
  ['gro-fish', /\b(fish|shrimp|prawn|salmon|tuna|hammour|sardine|seafood|squid|crab)\b/],
  ['gro-frozen', /\b(frozen|ice cream|nugget|fries)\b/],
  ['gro-grains', /\b(rice|flour|atta|oats|pasta|noodle|wheat|semolina|lentil|dal|daal|bean|quinoa|cereal)\b/],
  ['gro-bakery', /\b(bread|bun|croissant|khubz|kubus|toast|cake|muffin|pita|paratha)\b/],
  ['gro-vegetables', /\b(tomato|onion|potato|cucumber|carrot|lettuce|cabbage|garlic|ginger|chilli|chili|pepper|capsicum|spinach|broccoli|cauliflower|eggplant|brinjal|zucchini|okra|bhindi|coriander|mint|parsley|lemon|vegetable|beans|peas|mushroom)\b/],
  ['gro-fruits', /\b(apple|banana|orange|grape|mango|melon|watermelon|papaya|pineapple|strawberr|berry|kiwi|pear|peach|plum|date|dates|pomegranate|fruit|avocado)\b/],
  ['gro-beverages', /\b(water|juice|soda|cola|pepsi|coke|tea|coffee|drink|nescafe|lipton|sprite|7up|energy)\b/],
  ['gro-snacks', /\b(chips|crisps|biscuit|cookie|chocolate|candy|sweet|nuts|popcorn|wafer|snack|lays|pringles)\b/],
  ['gro-cleaning', /\b(detergent|dish|tissue|bleach|cleaner|clorox|fairy|ariel|tide|softener|garbage|trash|bag|foil|wipes|sponge|napkin|kitchen roll|toilet roll)\b/],
  ['gro-personal', /\b(shampoo|soap|toothpaste|toothbrush|lotion|deodorant|razor|diaper|pampers|sanitary|conditioner|body wash|handwash|cotton)\b/],
  ['gro-cooking', /\b(oil|sugar|salt|spice|masala|vinegar|sauce|ketchup|mayonnaise|paste|honey|jam|stock|cumin|turmeric|olive)\b/],
];

/** Best-guess grocery category from a product description (user can change it). */
export function guessCategory(description) {
  const s = ' ' + String(description || '').toLowerCase() + ' ';
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(s)) return cat;
  return 'gro-other';
}

/** "INDIA GATE BASMATI RICE 5KG" -> "India Gate Basmati Rice 5kg" */
export function tidyName(description) {
  return String(description || '')
    .replace(/\s+/g, ' ').trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/(\d)\s*(Kg|G|Gm|Ml|L|Ltr|Pcs|Pc)\b/g, (m, n, u) => n + u.toLowerCase())
    .slice(0, 80);
}
