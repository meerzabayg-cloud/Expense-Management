import { h, icon, field, select, moneyInput, toast, busy } from '../ui.js';
import * as repo from '../repo.js';
import { CURRENCIES, parseMoney } from '../money.js';
import { currentMonth, todayISO } from '../dates.js';
import { requestPersistence } from '../db.js';
import { GROCERY_CATEGORY_ID } from '../calc.js';

export function renderOnboarding(ctx, onDone) {
  let step = 0;
  const root = h('div', { class: 'onboard' });
  const st = { name: '', currency: 'AED', cash: '', bank: '', grocery: '', total: '', starter: true };
  const draw = () => root.replaceChildren(steps[step]());

  const steps = [
    () => h('div', { class: 'ob-card' },
      h('div', { class: 'ob-logo', 'aria-hidden': 'true' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72 })),
      h('h1', {}, 'Smart Family Expense & Grocery Manager'),
      h('p', { class: 'lead' }, 'Plan groceries, scan receipts, track spending and budgets — all on your phone.'),
      h('ul', { class: 'ob-points' },
        h('li', {}, icon('shield'), h('span', {}, h('b', {}, 'Private. '), 'Your data is stored only on this device. No account, no cloud, no ads.')),
        h('li', {}, icon('scan'), h('span', {}, h('b', {}, 'Works offline. '), 'Receipt scanning runs on the phone itself.')),
        h('li', {}, icon('alert'), h('span', {}, h('b', {}, 'Back up regularly. '), 'If this phone is lost or the browser clears its data, only a backup file can restore it. The app will remind you.'))),
      h('button', { class: 'btn btn-primary btn-block btn-lg', onclick: () => { step = 1; draw(); } }, 'Get started'),
      h('a', { class: 'btn btn-ghost btn-block', href: '#/backup', onclick: async (e) => { e.preventDefault(); await finish(true); } }, 'I have a backup to restore')),
    () => {
      const name = h('input', { type: 'text', value: st.name, maxlength: 40, placeholder: 'Optional', autocomplete: 'given-name' });
      const cur = select(Object.entries(CURRENCIES).map(([k, v]) => [k, `${k} — ${v.name}`]), st.currency);
      return h('form', { class: 'ob-card form', onsubmit: (e) => { e.preventDefault(); st.name = name.value; st.currency = cur.value; step = 2; draw(); } },
        h('p', { class: 'step' }, 'Step 1 of 3'), h('h2', {}, 'About you'),
        field('Your first name', name), field('Currency', cur, { hint: 'AED is the default. This cannot easily be changed later, so choose the currency you spend in.' }),
        h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Next'));
    },
    () => {
      const cash = moneyInput({ value: st.cash, placeholder: 'e.g. 350' });
      const bank = moneyInput({ value: st.bank, placeholder: 'e.g. 8,200' });
      return h('form', { class: 'ob-card form', onsubmit: (e) => { e.preventDefault(); st.cash = cash.value; st.bank = bank.value; step = 3; draw(); } },
        h('p', { class: 'step' }, 'Step 2 of 3'), h('h2', {}, 'Your money (optional)'),
        h('p', { class: 'muted' }, 'Enter what you have now to track balances. You can add cards and wallets later, or skip this entirely. These are your own records — the app never connects to a bank.'),
        field(`Cash in hand (${st.currency})`, cash), field(`Main bank account (${st.currency})`, bank),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { st.cash = ''; st.bank = ''; step = 3; draw(); } }, 'Skip'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Next')));
    },
    () => {
      const grocery = moneyInput({ value: st.grocery, placeholder: 'e.g. 1,500' });
      const total = moneyInput({ value: st.total, placeholder: 'e.g. 6,000' });
      const starter = h('input', { type: 'checkbox', checked: st.starter });
      const btn = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Finish setup');
      return h('form', { class: 'ob-card form', onsubmit: async (e) => { e.preventDefault(); st.grocery = grocery.value; st.total = total.value; st.starter = starter.checked; await busy(btn, () => finish(false)); } },
        h('p', { class: 'step' }, 'Step 3 of 3'), h('h2', {}, 'Monthly budget (optional)'),
        field(`Grocery budget per month (${st.currency})`, grocery), field(`Total spending budget per month (${st.currency})`, total, { hint: 'Leave empty if you don’t want an overall limit.' }),
        h('label', { class: 'check-row' }, starter, 'Add 24 common grocery items to start my catalogue (names only, no prices)'),
        btn);
    },
  ];

  async function finish(restoreOnly) {
    const digits = CURRENCIES[st.currency]?.digits ?? 2;
    try {
      await repo.saveSettings({ onboarded: true, userName: st.name.trim(), currency: st.currency, digits });
      if (!restoreOnly) {
        let def = null;
        const cash = st.cash.trim() ? parseMoney(st.cash, digits, { allowNegative: true }) : null;
        const bank = st.bank.trim() ? parseMoney(st.bank, digits, { allowNegative: true }) : null;
        if (cash !== null) def = (await repo.saveAccount({ name: 'Cash', type: 'cash', openingBalanceMinor: cash, openingDate: todayISO() })).id;
        if (bank !== null) def = (await repo.saveAccount({ name: 'Bank account', type: 'bank', openingBalanceMinor: bank, openingDate: todayISO() })).id;
        if (def) await repo.saveSettings({ defaultAccountId: def });
        const g = st.grocery.trim() ? parseMoney(st.grocery, digits) : null;
        const t = st.total.trim() ? parseMoney(st.total, digits) : null;
        if (g) await repo.setBudget(currentMonth(), GROCERY_CATEGORY_ID, g);
        if (t) await repo.setBudget(currentMonth(), 'total', t);
        if (st.starter) await repo.addStarterItems();
      }
      requestPersistence();
      await onDone(restoreOnly ? '#/backup' : '#/dashboard');
      toast(restoreOnly ? 'Choose your backup file to restore' : `Welcome${st.name ? ', ' + st.name.trim() : ''}! You’re all set.`, { tone: 'good' });
    } catch (e) { toast(e.message, { tone: 'error' }); }
  }

  draw();
  return root;
}
