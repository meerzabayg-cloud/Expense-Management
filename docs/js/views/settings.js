import { h, icon, field, select, toast, busy, confirmDialog, openSheet, segmented, shareOrDownload, setFieldError } from '../ui.js';
import * as repo from '../repo.js';
import { CURRENCIES } from '../money.js';
import { todayISO, dateLabel } from '../dates.js';
import { buildBackup, readBackup, restoreBackup, wipeAll } from '../backup.js';
import { requestPersistence, storageEstimate, all } from '../db.js';
import { prepareScanner, scannerCached } from '../ocr.js';
import { accountOptions } from './forms.js';
import { applyTheme } from '../theme.js';

export async function renderSettings(ctx) {
  const s = ctx.settings;
  const root = h('div', { class: 'view' });
  const hasData = ctx.data.transactions.length + ctx.data.purchases.length + ctx.data.accounts.length > 0;

  const name = h('input', { type: 'text', value: s.userName, maxlength: 40, placeholder: 'Optional' });
  name.addEventListener('change', async () => { await repo.saveSettings({ userName: name.value.trim() }); toast('Saved'); ctx.refresh({ rerender: false }); });
  const cur = select(Object.entries(CURRENCIES).map(([k, v]) => [k, `${k} — ${v.name}`]), s.currency);
  cur.addEventListener('change', async () => {
    const digits = CURRENCIES[cur.value].digits;
    if (hasData && digits !== s.digits) { toast(`${cur.value} uses ${digits} decimal places; your records use ${s.digits}. Start a fresh installation to use it.`, { tone: 'error', timeout: 6000 }); cur.value = s.currency; return; }
    if (hasData && !(await confirmDialog({ title: 'Change currency label?', message: 'Existing amounts are NOT converted — only the currency shown changes. Only do this if all your records are actually in the new currency.', confirmText: 'Change' }))) { cur.value = s.currency; return; }
    await repo.saveSettings({ currency: cur.value, digits }); toast('Currency updated'); ctx.refresh();
  });
  const theme = segmented([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme, async (v) => { await repo.saveSettings({ theme: v }); applyTheme(v); ctx.refresh(); }, { label: 'Theme' });
  const acc = select(accountOptions(ctx), s.defaultAccountId || '');
  acc.addEventListener('change', async () => { await repo.saveSettings({ defaultAccountId: acc.value || null }); toast('Saved'); ctx.refresh({ rerender: false }); });
  const remind = select([[7, 'Every week'], [14, 'Every 2 weeks'], [30, 'Every month'], [9999, 'Never']], s.backupReminderDays);
  remind.addEventListener('change', async () => { await repo.saveSettings({ backupReminderDays: Number(remind.value) }); toast('Saved'); ctx.refresh({ rerender: false }); });
  const keep = select([['compressed', 'Keep a compressed copy (≈100–300 KB each)'], ['none', 'Don’t keep photos (data only)']], s.imageRetention);
  keep.addEventListener('change', async () => { await repo.saveSettings({ imageRetention: keep.value }); toast('Saved'); ctx.refresh({ rerender: false }); });

  root.append(
    h('section', { class: 'card form' }, h('h3', {}, 'General'), field('Your name', name), field('Currency', cur, { hint: 'Default AED. Amounts are stored exactly (in fils/cents), never as rounded decimals.' }), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Theme'), theme), ctx.data.accounts.length ? field('Default payment account', acc) : null),
    h('section', { class: 'card form' }, h('h3', {}, 'Receipt photos'), field('After scanning', keep), h('div', { id: 'img-usage', class: 'muted small' }, 'Calculating storage…'),
      h('button', { class: 'btn btn-ghost', onclick: async () => {
        if (!(await confirmDialog({ title: 'Delete all receipt photos?', message: 'All receipt data, items and prices are kept — only the photos are deleted to free space.', confirmText: 'Delete photos', danger: true }))) return;
        await repo.deleteAllReceiptImages(); toast('Photos deleted'); ctx.refresh();
      } }, icon('trash'), 'Delete all receipt photos')),
    h('section', { class: 'card form' }, h('h3', {}, 'Backups'), field('Remind me to back up', remind), h('a', { class: 'btn btn-secondary', href: '#/backup' }, icon('shield'), 'Backup & restore')),
    h('section', { class: 'card' }, h('h3', {}, 'Offline & storage'), h('div', { id: 'storage-info', class: 'small' }, 'Checking…'),
      h('div', { class: 'btn-col' },
        h('button', { class: 'btn btn-secondary', onclick: async (e) => { const r = await requestPersistence(); toast(r.persisted ? 'Storage is protected from automatic clean-up' : 'The browser did not grant protected storage. Installing the app to your home screen usually helps.', { timeout: 5000 }); drawStorage(); } }, 'Ask browser to keep data'),
        h('button', { class: 'btn btn-secondary', id: 'prep-ocr', onclick: async (e) => { const b = e.currentTarget; await busy(b, async () => { try { await prepareScanner(); toast('Scanner saved for offline use', { tone: 'good' }); } catch (err) { toast('Download failed — check your internet connection.', { tone: 'error' }); } }); drawStorage(); } }, 'Download scanner for offline use'))),
    h('section', { class: 'card' }, h('h3', {}, 'Danger zone'),
      h('p', { class: 'muted small' }, 'Erase everything stored by this app on this device. Make a backup first if you may need the data again.'),
      h('button', { class: 'btn btn-danger', onclick: () => eraseAll(ctx) }, 'Erase all data on this device')),
    h('p', { class: 'muted small center' }, `Version ${ctx.version} · no accounts, no tracking, no ads · data stays on this device`));

  async function drawStorage() {
    const el = root.querySelector('#storage-info');
    const est = await storageEstimate();
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    const ocr = await scannerCached();
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    el?.replaceChildren(
      h('p', {}, persisted ? '✓ Protected storage granted — the browser should not clear this data automatically.' : '⚠ Storage is not protected. The browser may delete data if the phone runs out of space or the app is unused for a long time (iPhone: about 7 days of not opening it in Safari; installed home-screen apps are treated better).'),
      h('p', {}, standalone ? '✓ Running as an installed app.' : 'ℹ Running in the browser. Install to your home screen for the best offline experience (see Help).'),
      h('p', {}, ocr ? '✓ Receipt scanner is available offline.' : 'ℹ Receipt scanner is not downloaded yet (≈7 MB).'),
      est ? h('p', { class: 'muted' }, `Using about ${(est.usage / 1048576).toFixed(1)} MB${est.quota ? ` of ${(est.quota / 1048576).toFixed(0)} MB available to this app` : ''}.`) : null);
    const imgs = await all('receiptImages');
    const size = imgs.reduce((a, b) => a + (b.size || 0), 0);
    root.querySelector('#img-usage')?.replaceChildren(`${imgs.length} receipt photo${imgs.length === 1 ? '' : 's'} stored · ${(size / 1048576).toFixed(1)} MB`);
  }
  drawStorage();
  return root;
}

async function eraseAll(ctx) {
  const input = h('input', { type: 'text', placeholder: 'Type ERASE', autocomplete: 'off', 'aria-label': 'Type ERASE to confirm' });
  const ok = await confirmDialog({ title: 'Erase all data?', message: 'Every transaction, list, item, receipt and setting on this device will be permanently deleted. This cannot be undone.', confirmText: 'Erase everything', danger: true, extra: h('div', { class: 'field' }, input) });
  if (!ok) return;
  if (input.value.trim().toUpperCase() !== 'ERASE') { toast('Not erased — you did not type ERASE.', { tone: 'error' }); return; }
  await wipeAll();
  await repo.ensureSeeded();
  toast('All data erased');
  await ctx.refresh({ rerender: false });
  location.hash = '#/dashboard';
  location.reload();
}

/* ---------------- Backup & restore ---------------- */

export async function renderBackup(ctx) {
  const s = ctx.settings;
  const root = h('div', { class: 'view' });
  const last = s.lastBackupAt ? new Date(s.lastBackupAt) : null;
  root.append(h('section', { class: `banner ${last ? 'banner-info' : 'banner-warn'}` }, icon('shield'),
    h('span', {}, last ? `Last backup: ${dateLabel(todayISO(last))}.` : 'No backup made yet.', ' Your data is stored only on this phone. If the phone is lost, reset, or the browser clears its storage, only a backup can bring it back.')));

  const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it again' });
  const imgs = h('input', { type: 'checkbox', checked: true });
  const exportBtn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('download'), 'Create protected backup');
  root.append(h('section', { class: 'card' },
    h('h3', {}, '1. Save a backup'),
    h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (pw.value.length < 8) { setFieldError(pw, 'Use at least 8 characters.'); return; }
      if (pw.value !== pw2.value) { setFieldError(pw2, 'The passwords do not match.'); return; }
      setFieldError(pw, ''); setFieldError(pw2, '');
      await busy(exportBtn, async () => {
        const text = await buildBackup({ password: pw.value, includeImages: imgs.checked, appVersion: ctx.version });
        const how = await shareOrDownload(`family-expense-backup-${todayISO()}.json`, text, 'application/json');
        if (how === 'cancelled') return;
        await repo.saveSettings({ lastBackupAt: Date.now() });
        pw.value = ''; pw2.value = '';
        toast('Backup created. Keep the file somewhere safe (Files, Google Drive, iCloud, e-mail to yourself).', { tone: 'good', timeout: 6000 });
        ctx.refresh();
      });
    } },
      field('Backup password', pw), field('Confirm password', pw2),
      h('p', { class: 'hint warn' }, '⚠ Write this password down. The backup is encrypted (AES-256) and cannot be opened without it — there is no way to recover a forgotten password.'),
      h('label', { class: 'check-row' }, imgs, 'Include receipt photos (larger file)'),
      exportBtn),
    h('details', {}, h('summary', { class: 'small' }, 'Advanced: backup without a password'),
      h('p', { class: 'muted small' }, 'Anyone who gets this file can read your financial data. Use only if you store it somewhere private.'),
      h('button', { class: 'btn btn-ghost', onclick: async (e) => { await busy(e.currentTarget, async () => { const text = await buildBackup({ includeImages: imgs.checked, appVersion: ctx.version }); const how = await shareOrDownload(`family-expense-backup-${todayISO()}-UNENCRYPTED.json`, text, 'application/json'); if (how !== 'cancelled') { await repo.saveSettings({ lastBackupAt: Date.now() }); ctx.refresh(); } }); } }, 'Save unencrypted backup'))));

  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'restore-file' });
  file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) startRestore(ctx, f); });
  root.append(h('section', { class: 'card' },
    h('h3', {}, '2. Restore from a backup'),
    h('p', { class: 'muted small' }, 'Use this on a new phone, or after the app data was cleared. Restoring replaces all data currently on this device with the backup.'),
    file, h('label', { for: 'restore-file', class: 'btn btn-secondary btn-block' }, icon('upload'), 'Choose backup file')));

  root.append(h('section', { class: 'card' }, h('h3', {}, 'Moving to a new phone'),
    h('ol', { class: 'steps' },
      h('li', {}, 'On the old phone: create a protected backup above and save the file to iCloud Drive / Google Drive, or send it to yourself.'),
      h('li', {}, 'On the new phone: open the app link, install it to the home screen, and complete the welcome screen.'),
      h('li', {}, 'Open More → Backup & Restore → Choose backup file, pick the file and enter your password.'),
      h('li', {}, 'Check your dashboard, then keep making regular backups on the new phone.'))));
  return root;
}

async function startRestore(ctx, f) {
  if (f.size > 200 * 1024 * 1024) { toast('This file is too large to be a backup.', { tone: 'error' }); return; }
  const text = await f.text();
  let result;
  try {
    result = await readBackup(text);
  } catch (e) {
    if (!e.needsPassword) { toast(e.message, { tone: 'error', timeout: 5000 }); return; }
    result = await askPassword(text);
    if (!result) return;
  }
  const c = result.meta.counts || {};
  const summary = h('ul', { class: 'small' },
    h('li', {}, `Created: ${new Date(result.meta.createdAt).toLocaleString()}`),
    h('li', {}, `${c.transactions ?? result.data.transactions?.length ?? 0} transactions, ${c.items ?? 0} grocery items, ${c.purchases ?? 0} prices`),
    h('li', {}, `${c.receipts ?? 0} receipts, ${c.lists ?? 0} lists, ${c.accounts ?? 0} accounts, ${c.budgets ?? 0} budgets`));
  const ok = await confirmDialog({ title: 'Replace data with this backup?', message: 'Everything currently on this device will be replaced by the backup below. If this device has data you want to keep, cancel and back it up first.', confirmText: 'Restore', danger: true, extra: summary });
  if (!ok) return;
  try {
    await restoreBackup(result.data);
    toast('Backup restored and verified', { tone: 'good', timeout: 5000 });
    await ctx.refresh({ rerender: false });
    location.hash = '#/dashboard';
    location.reload();
  } catch (e) {
    toast(`Restore failed: ${e.message}. Your previous data was not changed if the error happened before saving.`, { tone: 'error', timeout: 8000 });
  }
}

function askPassword(text) {
  return new Promise((resolve) => {
    const pw = h('input', { type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Unlock backup');
    let done = false;
    const s = openSheet('Backup password', h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      await busy(btn, async () => {
        try { const r = await readBackup(text, pw.value); done = true; s.close(); resolve(r); }
        catch (err) { setFieldError(pw, err.message); }
      });
    } }, field('Password used when the backup was made', pw), btn), { onClose: () => { if (!done) resolve(null); } });
  });
}
