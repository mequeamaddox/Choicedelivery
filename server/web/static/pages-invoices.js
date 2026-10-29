// Invoices for companies billed on account (#/invoices, #/invoices/:id). Dispatch sees what each company owes,
// creates and sends invoices, and records payments; customers on an account see their own invoices.
import { html, useState, api, useApi, getUser, isStaff, navigate, formatMoney } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, Field, ActionButton } from './components.js';

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const issued = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function InvoiceStatus({ i }) {
  if (i.status === 'paid') return html`<span class="badge green">Paid</span>`;
  if (i.status === 'void') return html`<span class="badge gray">Void</span>`;
  if (i.overdue) return html`<span class="badge red">Overdue</span>`;
  return i.sentAt ? html`<span class="badge blue">Sent</span>` : html`<span class="badge amber">Not sent</span>`;
}

function InvoiceTable({ invoices, showCompany }) {
  if (!invoices.length) return html`<${Empty} title="No invoices yet" />`;
  return html`
    <div class="table-wrap"><table>
      <thead><tr><th>Invoice</th>${showCompany && html`<th>Company</th>`}<th>Issued</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>${invoices.map((i) => html`<tr key=${i.id} class="clickable" onClick=${() => navigate(`/invoices/${i.id}`)}>
        <td data-label="Invoice"><a href=${`#/invoices/${i.id}`}><strong>${i.invoiceNumber}</strong></a></td>
        ${showCompany && html`<td data-label="Company">${i.company}</td>`}
        <td data-label="Issued">${issued(i.issuedAt)}</td>
        <td data-label="Due">${day(i.dueDate)} <span class="muted small">· ${i.terms}</span></td>
        <td data-label="Amount"><strong>${formatMoney(i.totalCents)}</strong></td>
        <td data-label="Status"><${InvoiceStatus} i=${i} /></td>
      </tr>`)}</tbody>
    </table></div>`;
}

function PayInstructions({ initial }) {
  const [text, setText] = useState(initial || '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  return html`
    <section class="card">
      <h2>Payment instructions on invoices</h2>
      <p class="small muted">Printed on every invoice under "Other ways to pay". For example who to make checks out to, your
        mailing address for checks (a PO box or business address, not your home), or bank details for ACH. Card payment is always offered.</p>
      <${Alert} error=${error} />
      ${saved && html`<${Alert} tone="success">Saved.<//>`}
      <textarea rows="4" maxlength="1000" value=${text} onInput=${(e) => { setText(e.target.value); setSaved(false); }}
        placeholder=${'Make checks payable to Choice Delivery LLC\nMail to: …\nFor ACH, email info@choicedeliverysc.com for our bank details.'}></textarea>
      <div class="actions"><${ActionButton} class="btn" onError=${setError}
        onClick=${async () => { await api('/invoices/settings', { method: 'PUT', body: { payInstructions: text } }); setSaved(true); }}>Save<//></div>
    </section>`;
}

export function InvoicesPage() {
  const staff = isStaff(getUser());
  const list = useApi('/invoices');
  const acc = useApi(staff ? '/invoices/accounts' : null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const reload = () => { list.reload(); acc.reload?.(); };
  const create = (orgId) => async () => {
    const i = await api('/invoices', { method: 'POST', body: { organizationId: orgId } });
    navigate(`/invoices/${i.id}`);
  };
  const runMonthly = async () => {
    const r = await api('/invoices/run-monthly', { method: 'POST' });
    setNotice(r.created.length ? `Created ${r.created.length} invoice${r.created.length === 1 ? '' : 's'} for last month. Open each one to send it.`
      : 'Nothing to invoice for last month.');
    reload();
  };
  const accounts = acc.data?.accounts || [];
  return html`
    <${Layout}>
      <${PageHeader} title="Invoices" subtitle=${staff ? 'Companies billed on account (Net 30 and other terms).' : 'Invoices for your company.'}
        actions=${staff && html`<${ActionButton} class="btn" onError=${setError} confirmText="Create invoices for every account's deliveries through the end of last month?"
          onClick=${runMonthly}>Invoice last month<//>`} />
      <${Alert} error=${error || list.error || acc.error} />
      ${notice && html`<${Alert} tone="success">${notice}<//>`}
      ${staff && html`
        <section class="card">
          <h2>Accounts</h2>
          <p class="small muted">Companies set to "Monthly account (invoice)" on the Companies page. Invoices are also created
            automatically on the 1st of each month for last month's deliveries, ready for you to review and send.</p>
          ${acc.loading && !acc.data ? html`<${Spinner} />` : !accounts.length ? html`<p class="muted small">No companies are billed on account yet.
            Switch one to "Monthly account (invoice)" on the <a href="#/companies">Companies</a> page.</p>` : html`
            <div class="table-wrap"><table>
              <thead><tr><th>Company</th><th>Terms</th><th>Not invoiced yet</th><th>Open</th><th>Overdue</th><th></th></tr></thead>
              <tbody>${accounts.map((a) => html`<tr key=${a.id}>
                <td data-label="Company"><strong>${a.name}</strong>${!a.billingEmail && html`<div class="small error-text">No billing email</div>`}</td>
                <td data-label="Terms">${a.terms}</td>
                <td data-label="Not invoiced yet">${a.unbilledCents ? html`${formatMoney(a.unbilledCents)} <span class="muted small">· ${a.unbilledLines} line${a.unbilledLines === 1 ? '' : 's'}</span>` : '—'}</td>
                <td data-label="Open">${a.openCents ? formatMoney(a.openCents) : '—'}</td>
                <td data-label="Overdue">${a.overdueCents ? html`<strong class="error-text">${formatMoney(a.overdueCents)}</strong>` : '—'}</td>
                <td>${a.unbilledCents > 0 && html`<${ActionButton} class="btn small" onError=${setError}
                  confirmText=${`Invoice ${a.name} for ${formatMoney(a.unbilledCents)} (everything delivered through today)?`}
                  onClick=${create(a.id)}>Create invoice<//>`}</td>
              </tr>`)}</tbody>
            </table></div>`}
        </section>`}
      <section class="card">
        <h2>${staff ? 'All invoices' : 'Your invoices'}</h2>
        ${list.loading && !list.data ? html`<${Spinner} />` : html`<${InvoiceTable} invoices=${list.data || []} showCompany=${staff} />`}
      </section>
      ${staff && acc.data && html`<${PayInstructions} initial=${acc.data.payInstructions} />`}
    <//>`;
}

export function InvoicePage({ id }) {
  const staff = isStaff(getUser());
  const r = useApi(`/invoices/${id}`);
  const [override, setOverride] = useState(null);
  const [error, setError] = useState(null);
  const [to, setTo] = useState(null);
  const [method, setMethod] = useState('check');
  const [note, setNote] = useState('');
  const i = override || r.data;
  if (!i) return html`<${Layout}>${r.loading ? html`<${Spinner} />` : html`<${Alert} error=${r.error} />`}<//>`;
  const sendTo = to ?? i.sentTo ?? i.billingEmail ?? '';
  const link = `/public/invoice/${i.publicToken}`;
  const act = (path, body) => async () => setOverride(await api(`/invoices/${i.id}/${path}`, { method: 'POST', body }));
  return html`
    <${Layout}>
      <a class="back" href="#/invoices">← Invoices</a>
      <${PageHeader} title=${html`${i.invoiceNumber} <${InvoiceStatus} i=${i} />`} subtitle=${`${i.company} · issued ${issued(i.issuedAt)}`}
        actions=${html`<a class="btn primary" href=${link} target="_blank" rel="noopener">View / print</a>
          <a class="btn" href=${`${link}/csv`}>Spreadsheet (CSV)</a>`} />
      <${Alert} error=${error} />
      <div class="grid-2 invoice-top">
        <section class="card">
          <dl class="facts">
            <dt>Amount</dt><dd><strong>${formatMoney(i.totalCents)}</strong></dd>
            <dt>Terms</dt><dd>${i.terms}</dd>
            <dt>Due</dt><dd>${day(i.dueDate)}${i.overdue ? html` <span class="badge red">Overdue</span>` : ''}</dd>
            <dt>Deliveries</dt><dd>${i.periodStart ? `${day(i.periodStart)} – ` : 'through '}${day(i.periodEnd)}</dd>
            <dt>Sent</dt><dd>${i.sentAt ? `${issued(i.sentAt)} to ${i.sentTo}` : 'Not yet'}${i.remindedAt ? ` · reminder ${issued(i.remindedAt)}` : ''}</dd>
            ${i.status === 'paid' && html`<dt>Paid</dt><dd>${issued(i.paidAt)} · ${i.paidMethodLabel}${i.paidNote ? ` · ${i.paidNote}` : ''}</dd>`}
          </dl>
        </section>
        ${staff && i.status === 'open' && html`
          <section class="card stack">
            <h2>${i.sentAt ? 'Send again' : 'Send it'}</h2>
            <${Field} label="Email to" hint="The company's billing email unless you change it.">
              <input type="email" value=${sendTo} onInput=${(e) => setTo(e.target.value)} /><//>
            <div class="inline">
              <${ActionButton} class="btn primary" onError=${setError} onClick=${act('send', { to: sendTo })}>${i.sentAt ? 'Resend invoice' : 'Send invoice'}<//>
              ${i.sentAt && html`<${ActionButton} class="btn" onError=${setError} onClick=${act('send', { to: sendTo, reminder: true })}>Send payment reminder<//>`}
            </div>
            <h2>Record a payment</h2>
            <div class="grid-2">
              <${Field} label="Paid by"><select value=${method} onChange=${(e) => setMethod(e.target.value)}>
                <option value="check">Check</option><option value="ach">ACH / bank transfer</option><option value="card">Card</option>
                <option value="cash">Cash</option><option value="other">Other</option></select><//>
              <${Field} label="Note"><input placeholder="Check number, etc." value=${note} onInput=${(e) => setNote(e.target.value)} /><//>
            </div>
            <div class="inline">
              <${ActionButton} class="btn" onError=${setError} confirmText=${`Mark ${i.invoiceNumber} paid (${formatMoney(i.totalCents)})?`}
                onClick=${act('paid', { method, note })}>Mark paid<//>
              <${ActionButton} class="btn danger" onError=${setError}
                confirmText="Void this invoice? Its deliveries go back to 'not invoiced yet' so you can fix them and invoice again."
                onClick=${act('void')}>Void<//>
            </div>
          </section>`}
      </div>
      <section class="card">
        <h2>Lines</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Delivery</th><th>PO / reference</th><th>Amount</th></tr></thead>
          <tbody>${i.lines.map((l) => html`<tr key=${l.id}>
            <td data-label="Date">${day(l.day)}</td>
            <td data-label="Delivery">${l.orderId && staff ? html`<a href=${`#/orders/${l.orderId}`}>${l.description}</a>` : l.description}</td>
            <td data-label="PO / reference">${l.reference || '—'}</td>
            <td data-label="Amount">${formatMoney(l.cents)}</td>
          </tr>`)}
          <tr><td colspan="3"><strong>Total</strong></td><td><strong>${formatMoney(i.totalCents)}</strong></td></tr></tbody>
        </table></div>
      </section>
    <//>`;
}
