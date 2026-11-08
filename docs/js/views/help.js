import { h, icon } from '../ui.js';

const S = (title, ...body) => h('details', { class: 'card help' }, h('summary', {}, title), ...body);
const P = (t) => h('p', {}, t);
const OL = (...li) => h('ol', { class: 'steps' }, li.map((x) => h('li', {}, x)));
const UL = (...li) => h('ul', {}, li.map((x) => h('li', {}, x)));

export async function renderHelp(ctx, params) {
  const link = location.origin + location.pathname.replace(/index\.html$/, '');
  const root = h('div', { class: 'view' });
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title: 'Smart Family Expense & Grocery Manager', text: 'A private grocery & expense tracker. Open the link and add it to your home screen:', url: link }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(link); alert('Link copied: ' + link); } catch { prompt('Copy this link:', link); }
  };
  root.append(
    h('section', { class: 'card' }, h('h3', {}, 'Share the app with family & friends'),
      P('Send them the link below. Each person installs their own copy on their own phone. Their data is completely separate from yours — nothing is shared or synchronised.'),
      h('div', { class: 'copy-link' }, h('code', {}, link)),
      h('button', { class: 'btn btn-primary btn-block', onclick: share }, icon('copy'), 'Share link')),

    S('📱 Install on iPhone (Safari)',
      OL('Open the app link in Safari (not inside WhatsApp/Instagram — tap “Open in Safari” first if needed).',
        'Tap the Share button (square with an arrow) at the bottom of the screen.',
        'Scroll down and tap “Add to Home Screen”, then “Add”.',
        'Open the app from its new home-screen icon. It now runs full-screen and works offline.'),
      P('Tip: on iPhone, data in a home-screen app is kept separately from Safari. Always use the home-screen icon so your data stays in one place.')),
    S('🤖 Install on Android (Chrome)',
      OL('Open the app link in Chrome.', 'Tap “Install app” in the banner, or open the ⋮ menu and tap “Install app” / “Add to Home screen”.', 'Confirm with “Install”. Open the app from its icon.')),

    S('🛒 Plan your monthly groceries',
      OL('Go to Grocery → New grocery list.', 'Choose “From last month’s purchases & list” to reuse what you bought last month (with latest prices), a template, or start empty.', 'Adjust quantities by tapping an item. The estimated total and the grocery budget left update instantly.')),
    S('✅ While shopping',
      OL('Open your list and tick items as you put them in the trolley.', 'Optionally enter the price you paid — it goes into price history.', 'Ticking does NOT create an expense by itself. Afterwards, scan the receipt (recommended) — it ticks remaining items and records the expense — or tap “Record” to turn the ticked prices into an expense.')),
    S('🧾 Scan a receipt',
      OL('Tap Scan → Take photo (or choose a screenshot).', 'Wait a few seconds while the phone reads the text — nothing is uploaded.', 'Check the store, date and total, then each line. Yellow lines were hard to read. Matching items from your catalogue are suggested — tap to change.', 'The box at the bottom checks that the lines add up to the total and explains any difference.', 'Tap “Confirm & save”. Your expense, price history and grocery list are updated together.'),
      P('If a receipt is too faded to read, use “Enter a receipt manually” — you can just enter the total, or add lines one by one.')),
    S('📈 Price comparison',
      P('Open any item (More → Grocery Catalogue, or tap it in a list) to see the latest and previous price, store, date, the change in money and %, and the lowest/average price. Prices are compared per kg, litre or piece, so a 2 kg bag and a 5 kg bag are compared fairly. Items bought in different kinds of units are never compared.'),
      P('“Price changes” show how much more or less you paid compared with last time. That is different from budget savings, which compare your spending with your budget.')),
    S('💰 Accounts, transfers and budgets',
      UL('Accounts (cash, bank, cards, wallets) are optional and only reflect what you record. Use “Adjust balance” to match your real balance.',
        'Paying your credit card from the bank is a Transfer — it is not counted as spending again.',
        'A credit card limit is never counted as available money.',
        'Budgets are set per month and continue into later months until you change them.',
        'Recurring payments (rent, DEWA, subscriptions) are suggested on the dashboard when due — you confirm each one.')),
    S('🛡️ Backups & moving to a new phone',
      P('Your data lives only on this phone. Make a protected backup every week or two (More → Backup & Restore) and keep the file in iCloud Drive, Google Drive or e-mail.'),
      OL('Old phone: create a protected backup and save the file.', 'New phone: install the app, complete the welcome screen (or tap “I have a backup to restore”).', 'Backup & Restore → Choose backup file → enter the password.'),
      P('The backup password cannot be recovered. If you forget it, that backup file cannot be opened by anyone.')),
    S('🔒 Privacy & storage limits', ...[
      P('No sign-up, no cloud database, no trackers or ads. Receipt photos are processed on the phone and never uploaded.'),
      P('Browser storage is reliable but not permanent: it can be lost if you clear browser data, uninstall the app, reset or lose the phone, or — on iPhone — if the app is not opened for a long period while the phone is low on storage. Keep backups.'),
      P('Automatic syncing between phones is not available, because it would require an online server holding your data. Use backup & restore to move data.'),
    ].map((x) => x), params.topic === 'storage' ? h('span', { id: 'storage-topic' }) : null),
    S('❓ Common questions',
      UL('Can my spouse see my expenses? Only if you hand them your phone or a backup file. Separate phones = separate data.',
        'Does it work without internet? Yes, after it has been opened once online. Updates download automatically when you are online.',
        'The scan missed a line — what do I do? Tap “Add line” on the review screen, or fix the misread line.',
        'I recorded something twice. Open the transaction (Expenses) and delete it — balances recalculate automatically.')));
  if (params.topic === 'storage') setTimeout(() => { const d = root.querySelector('#storage-topic')?.closest('details'); if (d) { d.open = true; d.scrollIntoView(); } }, 50);
  return root;
}
