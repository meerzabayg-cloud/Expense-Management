# Testing evidence, limitations and maintenance

## What was tested (8 November 2026)

### Automated unit and workflow tests: `npm test` (24 of 24 passing)
These run in Node.js against a real IndexedDB implementation (`fake-indexeddb`).

- **Money maths:** parsing of `12.5`, `1,234.56`, `1.234,56`, `12,50` and `AED 32.00`; rounding; 3-decimal currencies; splits that always add up exactly. Floating-point input (`0.1+0.2`) is stored exactly.
- **Rice example from the specification:** AED 32.00 (Carrefour) → AED 28.00 (Lulu) for 5 kg gives **AED 4.00 lower, −12.5%**, a lowest price of AED 5.60/kg and an average of AED 6.00/kg.
- **Unit normalisation:** 2 × 500 g compared with 1 kg. Litres are never compared with kilograms, and 6-packs are never compared with 12-packs.
- **Name matching:** abbreviations (`CHKN`, `FRS MLK`) and learned aliases are recognised, and "milk" is not confused with "almond milk".
- **Receipt parser:** store, date, time, invoice no., items, "2 x 7.25" lines, weighed items, line discounts, VAT, total and payment method. Also covers real OCR noise ("2 xXx 7.25"), low-confidence flags, missing-total warnings, day/month date order and the duplicate fingerprint.
- **Totals reconciliation:** detects whether VAT is included or added, and flags unexplained differences.
- **Monthly summary:** income, expenses, refunds, transfers and adjustments are counted correctly with no double counting. Credit card balances and limits are never counted as cash.
- **Budgets:** budgets carry forward to later months and remaining amounts are correct. The insight text "Your grocery spending is AED 120.00 below this month's grocery budget." is produced.
- **Receipt confirmation:** the expense, price history, aliases and list ticks are saved in **one transaction**. A failing receipt leaves no partial data. Deleting the expense with its receipt reverses everything, including balances.
- **List ticking:** ticking records a price but **no expense**. Scanning the same day's receipt reuses that price instead of duplicating it.
- **List expense:** "Record as expense" groups items by store and cannot be repeated.
- **Catalogue:** duplicate items are blocked. Merging items moves their history.
- **Next month's list:** generated from last month's purchases, using estimated prices.
- **Double save:** saving the same transaction twice does not create two records. Editing and deleting recalculate balances.
- **Recurring payments:** each occurrence is recorded only once, and dates advance correctly (31 Jan → 28 Feb).
- **Encrypted backup:** the file contains no readable data. Wrong passwords and tampered files are rejected, and a full round-trip restores every record.
- **CSV export:** formula injection is blocked.

### Browser end-to-end test: `npm run test:e2e` (17 of 17 passing)
These run in real headless Chromium at phone size (390×844), with **real on-device OCR** on rendered receipt images:

1. The onboarding flow completes setup, and funds available show AED 10,400.00.
2. The service worker installs and caches the app plus the OCR engine (about 11 MB).
3. **Scenario 1:** create a list, add items and see the estimate.
4. **Scenario 2:** tick an item with a price; no expense is created.
5. **Scenario 3:** scan a Carrefour receipt. Store, date and total are correct, all 3 lines are found and the totals reconcile. Confirming creates the expense.
6. Scanning the same receipt again is flagged as a duplicate.
7. **Scenario 4:** scan a Lulu receipt. Items are auto-matched, and Price Comparison shows **−12.5%, AED 4.00 lower**.
8. **Scenario 5:** the dashboard shows the recorded totals and the price insight.
9. A manual expense shows a validation error, then saves and appears in the list.
10. The Reports page renders.
11. **Scenario 7:** create an encrypted backup, erase the device, restore (a wrong password is rejected) and get identical record counts.
12. **Offline:** with the network off, the app restarts and **OCR still works**.
13. **Scenario 6:** a separate browser profile starts empty, confirming independent installs.
14. Dark theme renders.
15. Every screen (15 routes plus detail pages and manual receipt entry) renders without "null", "undefined" or "NaN".
16. There are no console errors.

Screenshots are saved to `test-results/` when the test runs.

## Not tested here (please check on your own phone)

- **Real iPhone (Safari/iOS) and real Android phones.** Testing used Chromium only, which is the engine behind Chrome on Android. Safari on iPhone has not been run. The app uses only features supported by iOS 16.4+ and current Android Chrome, but the install flow, camera capture and offline behaviour should be checked on a real iPhone.
- **Photos of real, crumpled or faded paper receipts.** The tests used clean rendered receipts. Real photos will read less accurately. That is why every scan goes through the review screen, with highlighted low-confidence lines and the totals check.
- **The live deployment.** This environment cannot reach `github.io`, so no live URL was published or tested (see [DEPLOYMENT.md](DEPLOYMENT.md)).

## Known limitations

| Limitation | Why | Mitigation |
|---|---|---|
| Data can be lost if the phone is lost or reset, or the browser data is cleared | Data is stored only on the device, by design | Encrypted backups, reminders, and a persistent-storage request |
| No automatic sync between phones or family members | Syncing would require a server holding your financial data | Backup/restore to move data; CSV export to share reports |
| OCR reads English and Latin digits only | Only the English language pack is bundled, to keep the size small | Arabic product names may be misread; correct them on the review screen |
| OCR accuracy depends on photo quality | On-device OCR is less accurate than cloud services | Mandatory review, flags, totals reconciliation and manual entry. No cloud OCR is used, so nothing is uploaded |
| Very long receipts | A single photo may be too small to read | Scan in two parts, or add the missing lines manually |
| One currency per installation | Mixing currencies would make totals meaningless | The currency is chosen at setup (AED by default) |
| Balances are not bank-verified | The app has no bank connection | "Adjust balance" to correct them |
| iPhone storage eviction | Safari may clear site data that hasn't been used for a long time, mainly when not installed to the home screen | Install to the home screen and keep backups |

## Maintenance

- **Routine:** none. There are no servers, accounts or certificates to renew. GitHub Pages provides HTTPS automatically.
- **Updates:** edit `docs/`, increase `VERSION` in `docs/sw.js`, then push. Users get an "Update now" prompt.
- **Database changes:** add a migration in `docs/js/db.js` and increase `DB_VERSION`.
- **Before each release:** run `npm test` and `npm run test:e2e`.
