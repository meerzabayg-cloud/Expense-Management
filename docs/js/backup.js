// Backup, restore and CSV export.
// Encrypted backups use AES-256-GCM with a key derived from your password
// (PBKDF2-SHA-256, 310,000 rounds). Without the password the file cannot
// be opened — by anyone, including you. There is no recovery mechanism.

import { tx, STORES, DB_VERSION } from './db.js';
import { toDecimalString } from './money.js';

export const BACKUP_FORMAT = 'smart-family-expense-backup';
const PBKDF2_ITER = 310000;
const DATA_STORES = Object.keys(STORES);

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt, iterations = PBKDF2_ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(plain, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return { alg: 'AES-GCM-256', kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}

export async function decryptText(envelope, password) {
  const key = await deriveKey(password, unb64(envelope.salt), envelope.iterations || PBKDF2_ITER);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv) }, key, unb64(envelope.data));
    return dec.decode(pt);
  } catch {
    throw new Error('Wrong password, or the backup file is damaged.');
  }
}

async function blobToDataURL(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'image/jpeg'};base64,${b64(buf)}`;
}
function dataURLToBlob(url) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url || '');
  if (!m) return null;
  return new Blob([unb64(m[2])], { type: m[1] });
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Collect every record into a plain object. */
export async function snapshot({ includeImages = true } = {}) {
  const data = await tx(DATA_STORES, 'readonly', async (h) => {
    const out = {};
    for (const s of DATA_STORES) out[s] = await h.all(s);
    return out;
  });
  if (includeImages) {
    data.receiptImages = await Promise.all(data.receiptImages.map(async (r) => ({ receiptId: r.receiptId, type: r.type, size: r.size, createdAt: r.createdAt, dataURL: await blobToDataURL(r.blob) })));
  } else {
    data.receiptImages = [];
  }
  const counts = Object.fromEntries(DATA_STORES.map((s) => [s, data[s].length]));
  return { data, counts };
}

/** Build the backup file text. With a password, the content is encrypted. */
export async function buildBackup({ password, includeImages = true, appVersion = '' } = {}) {
  const { data, counts } = await snapshot({ includeImages });
  const payload = JSON.stringify({ data });
  const checksum = await sha256Hex(payload);
  const meta = { format: BACKUP_FORMAT, version: 1, schemaVersion: DB_VERSION, appVersion, createdAt: new Date().toISOString(), counts, checksum, encrypted: !!password };
  if (password) return JSON.stringify({ ...meta, envelope: await encryptText(payload, password) });
  return JSON.stringify({ ...meta, payload: JSON.parse(payload) });
}

/** Read a backup file (decrypting if needed) and check it is complete. Does not change anything yet. */
export async function readBackup(text, password) {
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('This file is not a backup from this app.'); }
  if (file?.format !== BACKUP_FORMAT) throw new Error('This file is not a backup from this app.');
  if (file.schemaVersion > DB_VERSION) throw new Error('This backup was made by a newer version of the app. Please update the app first.');
  let payloadText;
  if (file.encrypted) {
    if (!password) { const e = new Error('This backup is password-protected. Enter its password.'); e.needsPassword = true; throw e; }
    payloadText = await decryptText(file.envelope, password);
  } else {
    payloadText = JSON.stringify(file.payload);
  }
  const checksum = await sha256Hex(payloadText);
  if (file.checksum && checksum !== file.checksum) throw new Error('The backup file is damaged (checksum does not match).');
  const { data } = JSON.parse(payloadText);
  for (const s of DATA_STORES) {
    if (data[s] !== undefined && !Array.isArray(data[s])) throw new Error(`The backup file is damaged (${s}).`);
    for (const r of data[s] || []) {
      const kp = STORES[s].keyPath;
      if (!r || typeof r !== 'object' || r[kp] === undefined) throw new Error(`The backup contains an invalid ${s} record.`);
    }
  }
  return { meta: file, data };
}

/** Replace all data on this device with the backup, then verify the record counts. */
export async function restoreBackup(data) {
  await tx(DATA_STORES, 'readwrite', async (h) => {
    for (const s of DATA_STORES) await h.clear(s);
    for (const s of DATA_STORES) {
      for (const r of data[s] || []) {
        if (s === 'receiptImages') {
          const blob = r.blob instanceof Blob ? r.blob : dataURLToBlob(r.dataURL);
          if (blob) await h.put(s, { receiptId: r.receiptId, blob, type: blob.type, size: blob.size, createdAt: r.createdAt });
        } else {
          await h.put(s, r);
        }
      }
    }
  });
  const counts = await tx(DATA_STORES, 'readonly', async (h) => {
    const c = {};
    for (const s of DATA_STORES) c[s] = await h.count(s);
    return c;
  });
  const problems = DATA_STORES.filter((s) => s !== 'receiptImages' && (data[s] || []).length !== counts[s]);
  if (problems.length) throw new Error(`Restore check failed for: ${problems.join(', ')}. Please try again.`);
  return counts;
}

export async function wipeAll() {
  await tx(DATA_STORES, 'readwrite', async (h) => { for (const s of DATA_STORES) await h.clear(s); });
}

/* ---------------- CSV ---------------- */

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // protect spreadsheet apps from formula injection
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function transactionsCSV(transactions, { categories, accounts, digits = 2 }) {
  const cat = new Map(categories.map((c) => [c.id, c]));
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const rows = [['Date', 'Type', 'Amount', 'Currency', 'Category', 'Subcategory', 'Merchant/Payee', 'Account', 'To account', 'Notes', 'Receipt']];
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const t of sorted) {
    const c = cat.get(t.categoryId);
    const parent = c?.parentId ? cat.get(c.parentId) : null;
    rows.push([t.date, t.type, toDecimalString(t.amountMinor, digits), t.currency, parent ? parent.name : c?.name || '', parent ? c?.name : '', t.merchant, acc.get(t.accountId)?.name || '', acc.get(t.toAccountId)?.name || '', t.notes, t.receiptId ? 'yes' : '']);
  }
  return toCSV(rows);
}

export function purchasesCSV(purchases, { items, digits = 2 }) {
  const it = new Map(items.map((i) => [i.id, i]));
  const rows = [['Date', 'Item', 'Store', 'Quantity', 'Pack size', 'Unit', 'Total paid', 'Discount', 'Receipt text']];
  for (const p of [...purchases].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    rows.push([p.date, it.get(p.itemId)?.name || '', p.merchant, p.qty, p.packSize || '', p.packUnit, toDecimalString(p.totalMinor, digits), toDecimalString(p.discountMinor || 0, digits), p.description]);
  }
  return toCSV(rows);
}
