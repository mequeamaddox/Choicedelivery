// The owner's expense log (#/expenses): add expenses with a receipt photo, see spending by category, and
// each month's money in, driver pay, expenses and what's left. Download a CSV for taxes.
import { html, useState, api, useApi, formatMoney } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, Field, ActionButton } from './components.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthLabel = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// Photos are shrunk to a readable JPEG (receipts don't need 12 megapixels); PDFs go as they are.
function readReceipt(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.onload = () => {
      if (file.type === 'application/pdf') {
        if (reader.result.length > 4 * 1024 * 1024) reject(new Error('That PDF is too big (3 MB max)'));
        else resolve(reader.result);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a photo we can read"));
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function openReceipt(id) {
  const { receipt } = await api(`/expenses/${id}/receipt`);
  const [head, b64] = receipt.split(',');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: head.slice(5, head.indexOf(';')) });
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

function downloadCsv(data) {
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [['Date', 'Category', 'Vendor', 'Note', 'Amount', 'Receipt'],
    ...[...data.expenses].reverse().map((e) => [e.day, e.categoryLabel, e.vendor, e.note, (e.cents / 100).toFixed(2), e.hasReceipt ? 'yes' : '']),
    [], ['Category totals'], ...data.byCategory.map((c) => ['', c.label, '', '', (c.cents / 100).toFixed(2), ''])];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = `expenses-${data.year}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function AddExpense({ categories, onAdded }) {
  const blank = { day: today(), amount: '', category: 'fuel', vendor: '', note: '', receipt: null };
  const [v, setV] = useState(blank);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fileKey, setFileKey] = useState(0); // resets the file input after saving
  const submit = async (e) => {
    e.preventDefault();
    setError(null); setSaved(false); setBusy(true);
    try {
      await api('/expenses', { method: 'POST', body: {
        day: v.day, cents: Math.round(Number(v.amount) * 100), category: v.category, vendor: v.vendor, note: v.note, receipt: v.receipt,
      } });
      setV({ ...blank, category: v.category }); setFileKey(fileKey + 1); setSaved(true); onAdded();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return html`
    <form class="card stack" onSubmit=${submit}>
      <h2>Add an expense</h2>
      <${Alert} error=${error} />
      ${saved && html`<${Alert} tone="success">Saved.<//>`}
      <div class="grid-2">
        <${Field} label="Amount ($)"><input type="number" required min="0.01" step="0.01" inputmode="decimal" value=${v.amount}
          onInput=${(e) => setV({ ...v, amount: e.target.value })} /><//>
        <${Field} label="Date"><input type="date" required max=${today()} value=${v.day} onInput=${(e) => setV({ ...v, day: e.target.value })} /><//>
        <${Field} label="Category"><select value=${v.category} onChange=${(e) => setV({ ...v, category: e.target.value })}>
          ${Object.entries(categories).map(([k, label]) => html`<option value=${k}>${label}</option>`)}</select><//>
        <${Field} label="Where (optional)"><input placeholder="e.g. QT, AutoZone, USAA" maxlength="120" value=${v.vendor}
          onInput=${(e) => setV({ ...v, vendor: e.target.value })} /><//>
      </div>
      <${Field} label="Note (optional)"><input maxlength="500" placeholder="What it was for" value=${v.note} onInput=${(e) => setV({ ...v, note: e.target.value })} /><//>
      <${Field} label="Receipt (optional)" hint="Take a photo or pick a file. Keep the paper copy too if it's a big purchase.">
        <input key=${fileKey} type="file" accept="image/*,application/pdf"
          onChange=${async (e) => { const f = e.target.files[0]; setError(null); try { setV({ ...v, receipt: f ? await readReceipt(f) : null }); } catch (err) { setError(err); e.target.value = ''; } }} /><//>
      ${v.receipt?.startsWith('data:image') && html`<img class="receipt-preview" src=${v.receipt} alt="Receipt" />`}
      <div><button class="btn primary" disabled=${busy}>${busy ? 'Saving…' : 'Save expense'}</button></div>
    </form>`;
}

export function ExpensesPage() {
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const r = useApi(`/expenses?year=${year}`);
  const [error, setError] = useState(null);
  const d = r.data;
  const sum = (k) => (d ? d.months.reduce((t, m) => t + m[k], 0) : 0);
  // Months with anything in them (and the current month), newest first.
  const shownMonths = d ? d.months.filter((m) => m.month === today().slice(0, 7)
    || ((m.revenueCents || m.gigCents || m.driverPayCents || m.expenseCents) && m.month <= today().slice(0, 7))).reverse() : [];
  const byMonth = {};
  for (const e of d?.expenses || []) (byMonth[e.day.slice(0, 7)] ||= []).push(e);
  return html`
    <${Layout}>
      <${PageHeader} title="Expenses" subtitle="Business spending, receipts and what's left each month. Only you see this." />
      <div class="inline mileage-bar">
        <select aria-label="Year" value=${year} onChange=${(e) => setYear(Number(e.target.value))}>
          ${[thisYear, thisYear - 1, thisYear - 2].map((y) => html`<option value=${y}>${y}</option>`)}
        </select>
        ${d && html`<button type="button" class="btn" onClick=${() => downloadCsv(d)}>Download for taxes (CSV)</button>`}
      </div>
      <${Alert} error=${error || r.error} />
      ${!d ? html`<${Spinner} />` : html`
        <div class="stat-row four">
          <div class="stat"><span class="muted small">Choice Delivery, ${year}</span><strong>${formatMoney(sum('revenueCents'))}</strong></div>
          <div class="stat"><span class="muted small">Gig apps</span><strong>${formatMoney(sum('gigCents'))}</strong></div>
          <div class="stat"><span class="muted small">Driver pay</span><strong>${formatMoney(sum('driverPayCents'))}</strong></div>
          <div class="stat"><span class="muted small">Expenses</span><strong>${formatMoney(sum('expenseCents'))}</strong></div>
          <div class="stat"><span class="muted small">What's left</span><strong>${formatMoney(sum('netCents'))}</strong></div>
        </div>
        ${(d.months.some((m) => m.revenueCents || m.driverPayCents)) && html`<section class="card">
          <h2>Numbers from test orders?</h2>
          <p class="small">Before real work starts, you can delete every order so far: their stops, photos, charges and history,
            plus test invoices and Net terms applications. Order numbers start again at CD-100001. Companies, logins, drivers and
            your settings stay. <strong>This can't be undone.</strong></p>
          <${ActionButton} class="btn danger" onError=${setError}
            onClick=${async () => {
              const typed = window.prompt('This permanently deletes every order, invoice and Net terms application. Type DELETE to confirm.');
              if (typed == null) return;
              const c = await api('/expenses/delete-all-orders', { method: 'POST', body: { confirm: typed.trim() } });
              window.alert(`Deleted ${c.orders} order${c.orders === 1 ? '' : 's'}, ${c.invoices} invoice${c.invoices === 1 ? '' : 's'} and ${c.applications} application${c.applications === 1 ? '' : 's'}.`);
              r.reload();
            }}>Delete all orders so far<//>
        </section>`}
        <${AddExpense} categories=${d.categories} onAdded=${r.reload} />
        <section class="card">
          <h2>By month</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Month</th><th>Choice Delivery</th><th>Gig apps</th><th>Driver pay</th><th>Expenses</th><th>What's left</th></tr></thead>
            <tbody>${shownMonths.map((m) => html`<tr key=${m.month}>
              <td data-label="Month">${monthLabel(m.month)}</td>
              <td data-label="Choice Delivery">${formatMoney(m.revenueCents)}</td>
              <td data-label="Gig apps">${formatMoney(m.gigCents)}</td>
              <td data-label="Driver pay">${formatMoney(m.driverPayCents)}</td>
              <td data-label="Expenses">${formatMoney(m.expenseCents)}</td>
              <td data-label="What's left"><strong class=${m.netCents < 0 ? 'error-text' : ''}>${formatMoney(m.netCents)}</strong></td>
            </tr>`)}</tbody>
          </table></div>
          <p class="small muted">Gig apps is the pay and tips from your shift log on the Gig page. Choice Delivery is what you actually collected or billed: card payments (less refunds), deliveries on a
            monthly invoice account, and paid extra charges. Orders you booked yourself count once you mark them paid. Card
            processing fees aren't included; add them as an expense from your Stripe payouts. This is a guide, not your tax return:
            your tax preparer decides what's deductible.</p>
        </section>
        ${d.byCategory.length > 0 && html`<section class="card">
          <h2>By category, ${year}</h2>
          <dl class="facts">${d.byCategory.map((c) => html`<dt>${c.label}</dt><dd>${formatMoney(c.cents)}</dd>`)}</dl>
        </section>`}
        ${!d.expenses.length ? html`<${Empty} title=${`No expenses logged for ${year}`}>Add one above. Fuel, insurance, phone, repairs and supplies all count.<//>`
        : Object.entries(byMonth).map(([month, list]) => html`
          <section class="card" key=${month}>
            <h2>${monthLabel(month)} <span class="muted small">· ${formatMoney(list.reduce((t, e) => t + e.cents, 0))}</span></h2>
            <ul class="plain-list">${list.map((e) => html`<li key=${e.id}>
              <span><strong>${formatMoney(e.cents)}</strong> · ${e.categoryLabel}${e.vendor ? ` · ${e.vendor}` : ''}
                <span class="muted small"> · ${dayLabel(e.day)}${e.note ? ` · ${e.note}` : ''}</span></span>
              <span class="nowrap">
                ${e.hasReceipt && html`<${ActionButton} class="btn small" onError=${setError} onClick=${() => openReceipt(e.id)}>Receipt<//>`}
                <${ActionButton} class="btn small" onError=${setError} confirmText="Delete this expense?"
                  onClick=${async () => { await api(`/expenses/${e.id}`, { method: 'DELETE' }); r.reload(); }}>Delete<//>
              </span>
            </li>`)}</ul>
          </section>`)}`}
    <//>`;
}
