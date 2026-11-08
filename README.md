# Smart Family Expense & Grocery Manager

A private, offline-first **Progressive Web App (PWA)** for planning groceries, scanning receipts, and tracking household expenses, funds, budgets and grocery prices. It installs on iPhone and Android from a web link. You don't need an app store or a developer account.

- 📖 **User guide (non-technical):** [USER_GUIDE.md](USER_GUIDE.md)
- 🚀 **How to publish it (one-time, about 5 minutes):** [DEPLOYMENT.md](DEPLOYMENT.md)
- 🧪 **Test evidence and known limitations:** [TESTING.md](TESTING.md)

## Highlights

| Module | What it does |
|---|---|
| Dashboard | Monthly spending, groceries vs other spending, money received, budget remaining, tracked funds, under/over budget, month-over-month change, 3/6/12-month trend, category donut, budget bars, top merchants, most-bought items, price increases/decreases, recent transactions, due recurring payments, and plain-language insights. |
| Grocery lists | Lists can start blank, from last month's purchases and list (with last prices as estimates), or from a template. Items are grouped by category. Ticking an item can record the actual qty, price, store and date, and shows last price, date and store with a % change. The list shows estimated total, remaining cost and remaining grocery budget. Lists can be completed and carried forward, saved as templates, and kept in monthly history. |
| Receipt scanning | Camera, gallery or screenshot. OCR runs **on the device** (Tesseract.js, WebAssembly) and never uploads. Extracts store, date, time, receipt no., items, qty × unit price, weights, discounts, VAT, total and payment method. Includes a full **review and correction screen**: low-confidence lines are highlighted, catalogue matches are suggested, totals are reconciled with an explanation of any difference, duplicates are detected (same photo or same store, date and total), and nothing is saved before you confirm. A manual-entry fallback is available. |
| Expenses | Expenses, money received, refunds, transfers and balance adjustments. Supports custom categories and subcategories, search and filters, recurring payments (always confirmed by the user), and edit or delete with automatic balance recalculation. |
| Funds & budgets | Cash, bank, debit, credit, wallet and other accounts with opening balances. Credit limits are never counted as cash. Monthly overall and per-category budgets carry forward to later months. |
| Price intelligence | Latest vs previous comparable purchase, normalised per kg, L or piece. Shows absolute and % change, the money difference for the same quantity, lowest, highest and average price, best store, and purchase frequency. Store-level comparison. Price savings are kept separate from budget savings. |
| Reports | Budget vs actual, category changes, trend, top merchants, planned vs actual groceries, price movement, store comparison, and CSV export. |
| Data safety | Everything is stored in IndexedDB on the device. Backups are password-encrypted (AES-256-GCM, PBKDF2 310k) and restores are verified. The app requests persistent storage, sends backup reminders, and offers a receipt-photo retention setting. |

## Architecture

- **No build step and no framework.** The app is plain HTML, CSS and JavaScript ES modules in [`docs/`](docs/), so any static host can serve it as-is.
- **Storage:** IndexedDB (`smart-family-expense`, schema v1) holds 15 object stores with indexes: settings, categories, items, aliases, merchants, purchases (price history), lists, listEntries, templates, receipts, receiptImages, transactions, accounts, budgets and recurring. Multi-record operations (for example, saving a receipt) run in **one transaction**, so either all records are written or none are. Schema migrations are versioned in `docs/js/db.js`.
- **Money:** all amounts are integers in minor units (fils/cents). Proportional splits use largest-remainder allocation so the parts always add up exactly.
- **Derived figures:** balances, totals and dashboards are always recalculated from stored transactions and are never stored separately, so they can't drift out of sync.
- **Offline:** a service worker (`docs/sw.js`) pre-caches the app shell and the OCR engine (about 11 MB including both WASM variants). Updates are versioned, and the user is asked before switching to a new version.
- **Security:** a strict Content-Security-Policy (no third-party origins). All user and receipt text is inserted with `textContent`. CSV export is protected against formula injection. Image type and size checks are applied.
- **Third-party code:** only [Tesseract.js 5.1.1](https://github.com/naptha/tesseract.js) (Apache-2.0), bundled locally in `docs/vendor/tesseract/`. There are no analytics, trackers or CDNs.

```
docs/                 ← the deployable app (static files)
  index.html, manifest.webmanifest, sw.js, css/, icons/
  js/app.js           shell, router, update handling
  js/db.js            IndexedDB schema, transactions, migrations
  js/repo.js          business operations (receipts, lists, transactions…)
  js/calc.js          pure financial & price calculations
  js/receipt-parser.js OCR text → structured receipt
  js/ocr.js, images.js on-device OCR + image preprocessing
  js/backup.js        encrypted backup/restore, CSV
  js/views/*.js       screens
tests/unit/           calculation, parser and database workflow tests (node:test)
tests/e2e/run.mjs     full browser test incl. real OCR, backup/restore, offline
```

## Run and test locally

```bash
npm install          # only installs the test helper (fake-indexeddb)
npm test             # unit + workflow tests
npm run test:e2e     # browser end-to-end test (needs Playwright + Chromium)
npm run serve        # http://127.0.0.1:8080/
```

## Costs

Hosting on GitHub Pages is **free**. The app has no servers, databases, subscriptions or paid APIs. See [DEPLOYMENT.md](DEPLOYMENT.md) for the one requirement on private repositories.
