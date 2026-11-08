// IndexedDB storage layer. Each kind of record lives in its own object
// store with indexes, and the schema is versioned so future updates can
// migrate data safely without losing anything.

export const DB_NAME = 'smart-family-expense';
export const DB_VERSION = 1;

export const STORES = {
  settings: { keyPath: 'key' },
  categories: { keyPath: 'id', indexes: { kind: 'kind', parentId: 'parentId' } },
  items: { keyPath: 'id', indexes: { nameNorm: 'nameNorm', categoryId: 'categoryId' } },
  aliases: { keyPath: 'id', indexes: { aliasNorm: 'aliasNorm', itemId: 'itemId' } },
  merchants: { keyPath: 'id', indexes: { nameNorm: { keyPath: 'nameNorm', unique: true } } },
  purchases: { keyPath: 'id', indexes: { itemId: 'itemId', date: 'date', receiptId: 'receiptId', transactionId: 'transactionId', listEntryId: 'listEntryId' } },
  lists: { keyPath: 'id', indexes: { month: 'month', status: 'status' } },
  listEntries: { keyPath: 'id', indexes: { listId: 'listId', itemId: 'itemId' } },
  templates: { keyPath: 'id' },
  receipts: { keyPath: 'id', indexes: { fingerprint: 'fingerprint', imageHash: 'imageHash', date: 'date' } },
  receiptImages: { keyPath: 'receiptId' },
  transactions: { keyPath: 'id', indexes: { date: 'date', type: 'type', categoryId: 'categoryId', accountId: 'accountId', toAccountId: 'toAccountId', receiptId: 'receiptId', recurringId: 'recurringId' } },
  accounts: { keyPath: 'id' },
  budgets: { keyPath: 'id', indexes: { month: 'month' } },
  recurring: { keyPath: 'id' },
};

// Migrations run in order; each receives the upgrade transaction.
const MIGRATIONS = {
  1(db) {
    for (const [name, def] of Object.entries(STORES)) {
      const store = db.createObjectStore(name, { keyPath: def.keyPath });
      for (const [idx, spec] of Object.entries(def.indexes || {})) {
        if (typeof spec === 'string') store.createIndex(idx, spec, { unique: false });
        else store.createIndex(idx, spec.keyPath, { unique: !!spec.unique });
      }
    }
  },
};

let dbPromise = null;
let idbFactory = typeof indexedDB !== 'undefined' ? indexedDB : null;

/** For tests: inject an IndexedDB implementation. */
export function _setIndexedDB(factory) { idbFactory = factory; dbPromise = null; }

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!idbFactory) { reject(new Error('This browser does not support offline storage (IndexedDB).')); return; }
    const req = idbFactory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      for (let v = ev.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v]?.(db, req.transaction);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; if (typeof location !== 'undefined') location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open the database'));
    req.onblocked = () => reject(new Error('Please close other open tabs of this app and try again.'));
  });
  return dbPromise;
}

export function closeDB() {
  if (!dbPromise) return Promise.resolve();
  return dbPromise.then((db) => { db.close(); dbPromise = null; });
}

export function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Run fn inside one IndexedDB transaction. Either every write in fn is
 * saved, or (if anything throws) none of them are.
 * fn receives a helper object with get/put/del/all/byIndex bound to the transaction.
 */
export async function tx(storeNames, mode, fn) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const t = db.transaction(names, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error('Database write failed'));
    t.onabort = () => reject(t.error || new Error('Database write was cancelled'));
  });
  const h = {
    raw: t,
    get: (s, key) => reqP(t.objectStore(s).get(key)),
    put: (s, val) => reqP(t.objectStore(s).put(val)),
    add: (s, val) => reqP(t.objectStore(s).add(val)),
    del: (s, key) => reqP(t.objectStore(s).delete(key)),
    all: (s) => reqP(t.objectStore(s).getAll()),
    byIndex: (s, index, value) => reqP(t.objectStore(s).index(index).getAll(value)),
    range: (s, index, lo, hi) => reqP(t.objectStore(s).index(index).getAll(IDBKeyRange.bound(lo, hi))),
    clear: (s) => reqP(t.objectStore(s).clear()),
    count: (s) => reqP(t.objectStore(s).count()),
  };
  let result;
  try {
    result = await fn(h);
  } catch (err) {
    try { t.abort(); } catch { /* already finished */ }
    await done.catch(() => {});
    throw err;
  }
  await done;
  return result;
}

export const get = (s, key) => tx(s, 'readonly', (h) => h.get(s, key));
export const all = (s) => tx(s, 'readonly', (h) => h.all(s));
export const byIndex = (s, i, v) => tx(s, 'readonly', (h) => h.byIndex(s, i, v));
export const range = (s, i, lo, hi) => tx(s, 'readonly', (h) => h.range(s, i, lo, hi));
export const put = (s, v) => tx(s, 'readwrite', (h) => h.put(s, v));
export const del = (s, k) => tx(s, 'readwrite', (h) => h.del(s, k));

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Ask the browser to protect our data from automatic clean-up. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return { supported: false, persisted: false };
    const already = await navigator.storage.persisted();
    if (already) return { supported: true, persisted: true };
    const persisted = await navigator.storage.persist();
    return { supported: true, persisted };
  } catch {
    return { supported: false, persisted: false };
  }
}

export async function storageEstimate() {
  try {
    if (!navigator.storage?.estimate) return null;
    return await navigator.storage.estimate();
  } catch { return null; }
}
