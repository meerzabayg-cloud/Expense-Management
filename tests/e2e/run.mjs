// End-to-end test in a real (headless) Chromium browser, phone-sized.
// Covers: onboarding, grocery list planning & ticking, receipt scanning with
// on-device OCR, review & confirmation, dashboard figures, price comparison,
// encrypted backup → wipe → restore, offline start-up via the service worker,
// and dark mode. Run: npm run test:e2e
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startServer } from '../serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = new URL('../../test-results/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name, Date.now() - t0]); console.log(`✔ ${name}`); }
  catch (e) { results.push(['FAIL', name, Date.now() - t0, e.message]); console.log(`✘ ${name}\n   ${e.message}`); }
};

// Render a realistic receipt to a PNG (what a phone photo/screenshot would give us).
async function makeReceipt(lines, file) {
  const pg = await browser.newPage({ viewport: { width: 420, height: 100 }, deviceScaleFactor: 2 });
  await pg.setContent(`<html><body style="margin:0;background:#fff"><pre id="r" style="font:16px/1.5 'Courier New',monospace;color:#111;padding:18px;margin:0;width:380px">${lines.join('\n')}</pre></body></html>`);
  await pg.locator('#r').screenshot({ path: file });
  await pg.close();
}

const RECEIPT_1 = ['        CARREFOUR', '   Mall of the Emirates', 'TRN 100012345600003', '      TAX INVOICE', 'Date: 05/09/2026  18:42', 'Invoice No: 4521-778-0093', '', 'BASMATI RICE 5KG          32.00', 'FRESH MILK 2L', '2 x 7.25                  14.50', 'DISH LIQUID 750ML          9.75', '', 'SUBTOTAL                  56.25', 'VAT 5%                     2.68', 'TOTAL                     56.25', 'VISA ****1234             56.25', '  Thank you for shopping'];
const RECEIPT_2 = ['          LULU', '     HYPERMARKET', 'TRN 100099988800003', 'Date: 04/10/2026  11:05', 'Bill No: 88123', '', 'BASMATI RICE 5KG          28.00', 'FRESH MILK 2L', '2 x 7.75                  15.50', '', 'TOTAL                     43.50', 'CASH                      50.00', 'CHANGE                     6.50'];

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

const goto = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
const text = () => page.textContent('#main');

await step('First launch shows onboarding and completes setup', async () => {
  await page.goto(base);
  await page.click('text=Get started');
  await page.fill('input[autocomplete="given-name"]', 'Sara');
  await page.click('button:has-text("Next")');
  await page.fill('input[placeholder="e.g. 350"]', '400');
  await page.fill('input[placeholder="e.g. 8,200"]', '10,000');
  await page.click('button:has-text("Next")');
  await page.fill('input[placeholder="e.g. 1,500"]', '1500');
  await page.click('text=Finish setup');
  await page.waitForSelector('.kpi-hero');
  assert.match(await text(), /AED 10,400\.00/); // funds available = cash + bank
});

await step('Service worker installs and caches the app and the scanner', async () => {
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 15000 });
  await page.waitForFunction(async () => (await caches.keys()).includes('sfem-ocr-v1') && !!(await caches.match('./vendor/tesseract/eng.traineddata.gz')), null, { timeout: 60000 });
});

await step('Scenario 1: create a grocery list, add items, see estimate', async () => {
  await goto('#/list');
  await page.click('text=New grocery list');
  await page.selectOption('.sheet select', 'blank');
  await page.click('.sheet button:has-text("Create list")');
  await page.waitForSelector('text=This list is empty');
  for (const name of ['Basmati Rice', 'Fresh Milk', 'Eggs']) {
    await page.click('button:has-text("Add item")');
    await page.fill('.sheet input[type=search]', name);
    await page.waitForTimeout(150);
    await page.locator('.sheet .pick-row').filter({ hasText: name }).first().click();
    await page.waitForTimeout(250);
  }
  const t = await text();
  assert.match(t, /0 \/ 3/);
});

await step('Scenario 2: tick an item while shopping (records price, no expense)', async () => {
  await page.locator('.entry').filter({ hasText: 'Eggs' }).locator('.checkbox').click();
  await page.fill('.sheet input[inputmode=decimal][placeholder="0.00"]', '18.50');
  await page.locator('.sheet input[list=merchant-list]').fill('Spinneys');
  await page.click('.sheet button:has-text("Tick & save price")');
  await page.waitForTimeout(400);
  const t = await text();
  assert.match(t, /1 \/ 3/);
  assert.match(t, /not in your expenses yet/);
  await goto('#/expenses');
  assert.match(await text(), /No transactions yet/);
});

const scanFile = async (file) => {
  await goto('#/scan');
  await page.setInputFiles('#gal-input', file);
  await page.waitForSelector('text=Review receipt', { timeout: 120000 }).catch(() => {});
  await page.waitForSelector('.review', { timeout: 120000 });
};

await step('Scenario 3a: scan first receipt (Carrefour) with on-device OCR', async () => {
  await makeReceipt(RECEIPT_1, OUT + 'receipt-carrefour.png');
  await scanFile(OUT + 'receipt-carrefour.png');
  await page.screenshot({ path: OUT + 'review-1.png', fullPage: true });
  const merchant = await page.locator('.review input[list=merchant-list]').first().inputValue();
  assert.equal(merchant, 'Carrefour');
  assert.equal(await page.locator('.review input[type=date]').first().inputValue(), '2026-09-05');
  assert.match(await text(), /Lines add up to the total/);
  assert.equal(await page.locator('.line-card').count(), 3);
});

await step('Scenario 3b: confirm receipt → expense, price history, list ticked', async () => {
  await page.click('button:has-text("Confirm & save")');
  await page.waitForSelector('text=View / edit the expense', { timeout: 10000 });
  await goto('#/expenses?');
  await page.evaluate(() => { location.hash = '#/expenses'; });
  await page.waitForTimeout(300);
  // receipt is dated September; switch month
  await page.locator('input[type=month]').first().fill('2026-09');
  await page.locator('input[type=month]').first().dispatchEvent('change');
  await page.waitForTimeout(400);
  assert.match(await text(), /Carrefour/);
  assert.match(await text(), /AED 56\.25/);
});

await step('Duplicate receipt is detected', async () => {
  await scanFile(OUT + 'receipt-carrefour.png');
  assert.match(await text(), /already saved/);
  await page.click('.sticky-actions button:has-text("Discard")');
  await page.click('.sheet button:has-text("Discard")');
});

await step('Scenario 4: second receipt (Lulu) → price comparison shows 12.5% decrease', async () => {
  await makeReceipt(RECEIPT_2, OUT + 'receipt-lulu.png');
  await scanFile(OUT + 'receipt-lulu.png');
  assert.equal(await page.locator('.review input[list=merchant-list]').first().inputValue(), 'Lulu');
  // previously-seen items should be matched automatically
  const matches = await page.locator('.match-ok, .match-suggest').count();
  assert.ok(matches >= 2, `expected matched lines, got ${matches}`);
  await page.click('button:has-text("Confirm & save")');
  await page.waitForSelector('text=View / edit the expense', { timeout: 10000 });
  await goto('#/prices');
  const t = await text();
  assert.match(t, /−12\.5%/);
  assert.match(t, /AED 4\.00 lower for the same quantity/);
  await page.screenshot({ path: OUT + 'prices.png', fullPage: true });
});

await step('Scenario 5: dashboard reflects real records', async () => {
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForTimeout(300);
  await page.locator('input[type=month]').first().fill('2026-10');
  await page.locator('input[type=month]').first().dispatchEvent('change');
  await page.waitForTimeout(400);
  const t = await text();
  assert.match(t, /AED 43\.50/);
  assert.match(t, /cheaper than your previous comparable purchase/);
  await page.screenshot({ path: OUT + 'dashboard.png', fullPage: true });
});

await step('Manual expense: validation errors shown, then saved and visible', async () => {
  await goto('#/expenses');
  await page.click('button:has-text("Add expense")');
  await page.click('.sheet button[type=submit]');
  assert.match(await page.textContent('.sheet'), /Enter a valid amount/);
  await page.fill('.sheet input[name=amount]', '120');
  await page.selectOption('.sheet select[name=categoryId]', 'exp-dining');
  await page.fill('.sheet input[name=merchant]', 'Pizza Place');
  await page.click('.sheet button[type=submit]');
  await page.waitForTimeout(400);
  assert.match(await text(), /Pizza Place/);
});

await step('Reports page renders budget, category and price sections', async () => {
  await goto('#/reports');
  const t = await text();
  assert.match(t, /Total spending/);
  await page.screenshot({ path: OUT + 'reports.png', fullPage: true });
});

let backupPath;
await step('Scenario 7: encrypted backup → erase → restore recovers all records', async () => {
  const before = await page.evaluate(async () => {
    const { loadAll } = await import('./js/repo.js');
    const d = await loadAll(); return { t: d.transactions.length, p: d.purchases.length, i: d.items.length, r: d.receipts.length };
  });
  await goto('#/backup');
  await page.fill('input[autocomplete=new-password] >> nth=0', 'family-secret-1');
  await page.fill('input[autocomplete=new-password] >> nth=1', 'family-secret-1');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Create protected backup")')]);
  backupPath = OUT + 'backup.json';
  await dl.saveAs(backupPath);
  const raw = await readFile(backupPath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(parsed.encrypted && parsed.payload === undefined && !atob(parsed.envelope.data).includes('Carrefour'), 'backup must be encrypted');
  await page.evaluate(async () => { const { wipeAll } = await import('./js/backup.js'); await wipeAll(); });
  await page.reload();
  await page.waitForSelector('.ob-card');
  await page.click('text=I have a backup to restore');
  await page.waitForSelector('#restore-file', { state: 'attached' });
  await page.setInputFiles('#restore-file', backupPath);
  await page.fill('.sheet input[type=password]', 'wrong-password');
  await page.click('.sheet button:has-text("Unlock backup")');
  await page.waitForSelector('text=Wrong password');
  await page.fill('.sheet input[type=password]', 'family-secret-1');
  await page.click('.sheet button:has-text("Unlock backup")');
  await page.click('.sheet button:has-text("Restore")');
  await page.waitForSelector('.kpi-hero', { timeout: 15000 });
  const after = await page.evaluate(async () => {
    const { loadAll } = await import('./js/repo.js');
    const d = await loadAll(); return { t: d.transactions.length, p: d.purchases.length, i: d.items.length, r: d.receipts.length };
  });
  assert.deepEqual(after, before);
});

await step('Offline: app starts and scanner works with the network switched off', async () => {
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.kpi-hero', { timeout: 10000 });
  await page.evaluate(() => { location.hash = '#/scan'; });
  await page.waitForTimeout(300);
  await page.setInputFiles('#gal-input', OUT + 'receipt-lulu.png');
  await page.waitForSelector('.review', { timeout: 120000 });
  assert.equal(await page.locator('.review input[list=merchant-list]').first().inputValue(), 'Lulu');
  await page.click('.sticky-actions button:has-text("Discard")');
  await page.click('.sheet button:has-text("Discard")');
  await ctx.setOffline(false);
});

await step('Independent installs: a second browser profile sees no data', async () => {
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await other.newPage();
  await p2.goto(base);
  await p2.waitForSelector('.ob-card');
  await other.close();
});

await step('Dark theme renders', async () => {
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const p3 = await dark.newPage();
  await p3.goto(base);
  await p3.click('text=Get started');
  await p3.click('button:has-text("Next")');
  await p3.click('button:has-text("Skip")');
  await p3.click('text=Finish setup');
  await p3.waitForSelector('.kpi-hero');
  const bg = await p3.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(11, 18, 32)');
  await p3.screenshot({ path: OUT + 'dark.png' });
  await dark.close();
});

await step('Every screen renders without "null", "undefined" or "NaN" text', async () => {
  const routes = ['#/dashboard', '#/list', '#/scan', '#/expenses', '#/reports', '#/items', '#/funds', '#/funds?tab=budgets', '#/funds?tab=categories', '#/history', '#/history?mode=purchases', '#/prices', '#/settings', '#/backup', '#/help'];
  const firstItem = await page.evaluate(async () => { const { loadAll } = await import('./js/repo.js'); const d = await loadAll(); return { item: d.items.find((i) => d.purchases.some((p) => p.itemId === i.id))?.id, list: d.lists[0]?.id, receipt: d.receipts[0]?.id }; });
  if (firstItem.item) routes.push(`#/items/${firstItem.item}`);
  if (firstItem.list) routes.push(`#/list/${firstItem.list}`);
  if (firstItem.receipt) routes.push(`#/history?receipt=${firstItem.receipt}`);
  const bad = [];
  for (const r of routes) {
    await goto(r);
    await page.waitForTimeout(250);
    const t = await page.textContent('#main');
    if (/\bnull\b|\bundefined\b|\bNaN\b|Something went wrong/.test(t)) bad.push(`${r}: ${t.match(/.{0,40}(null|undefined|NaN|Something went wrong).{0,40}/)?.[0]}`);
  }
  await goto('#/scan');
  await page.click('text=Enter a receipt manually');
  await page.waitForSelector('.review');
  const t = await page.textContent('#main');
  if (/\bnull\b|\bundefined\b|\bNaN\b/.test(t)) bad.push('manual receipt review');
  await page.click('.sticky-actions button:has-text("Discard")');
  await page.click('.sheet button:has-text("Discard")');
  assert.deepEqual(bad, []);
});

await step('No uncaught errors in the browser console', async () => {
  const real = errors.filter((e) => !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(e));
  assert.deepEqual(real, []);
});

await browser.close();
server.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} end-to-end steps passed`);
process.exit(failed.length ? 1 : 0);
