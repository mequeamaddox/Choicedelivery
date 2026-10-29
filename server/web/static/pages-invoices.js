// Invoices for companies billed on account (#/invoices, #/invoices/:id). Dispatch sees what each company owes,
// creates and sends invoices, and records payments; customers on an account see their own invoices.
import { html, useState, useEffect, api, useApi, getUser, isStaff, navigate, formatMoney, refreshUser } from './lib.js';
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

const termsLabel = (d) => (Number(d) === 0 ? 'Due on receipt' : `Net ${d}`);

// Pending Net terms applications, for dispatch to approve (terms, optional limit) or decline.
function Applications({ onDecided }) {
  const apps = useApi('/invoices/applications?status=pending');
  const [error, setError] = useState(null);
  const [form, setForm] = useState({});
  const f = (a) => form[a.id] || { termsDays: String(a.data.requestedTerms || 30), limit: '', note: '' };
  const set = (a, patch) => setForm({ ...form, [a.id]: { ...f(a), ...patch } });
  const decide = (a, approve) => async () => {
    const v = f(a);
    await api(`/invoices/applications/${a.id}/decide`, { method: 'POST', body: {
      approve, termsDays: Number(v.termsDays), creditLimitCents: v.limit ? Math.round(Number(v.limit) * 100) : undefined, note: v.note,
    } });
    apps.reload(); onDecided?.();
  };
  if (!apps.data?.length) return null;
  return html`
    <section class="card stack">
      <h2>Applications for Net terms <span class="badge amber">${apps.data.length}</span></h2>
      <${Alert} error=${error} />
      ${apps.data.map((a) => html`<div key=${a.id} class="application">
        <h3>${a.company} <span class="muted small">· applied ${issued(a.submittedAt)}${a.submittedBy ? ` by ${a.submittedBy}` : ''}</span></h3>
        <dl class="facts">
          <dt>Legal name</dt><dd>${a.data.legalName}${a.data.dba ? ` (DBA ${a.data.dba})` : ''}</dd>
          ${a.data.ein && html`<dt>EIN</dt><dd>${a.data.ein}</dd>`}
          <dt>Address</dt><dd>${a.data.address}</dd>
          ${a.data.yearsInBusiness && html`<dt>In business</dt><dd>${a.data.yearsInBusiness}</dd>`}
          ${a.data.monthlyDeliveries && html`<dt>Deliveries / month</dt><dd>${a.data.monthlyDeliveries}</dd>`}
          <dt>Accounts payable</dt><dd>${a.data.apName} · ${a.data.apEmail}${a.data.apPhone ? ` · ${a.data.apPhone}` : ''}</dd>
          <dt>Wants</dt><dd>${termsLabel(a.data.requestedTerms)}${a.data.poRequired ? ' · PO numbers on invoices' : ''}</dd>
          ${a.data.references.length > 0 && html`<dt>References</dt><dd>${a.data.references.map((r) => html`<div>${[r.company, r.contact, r.phone, r.email].filter(Boolean).join(' · ')}</div>`)}</dd>`}
          ${a.data.notes && html`<dt>Notes</dt><dd>${a.data.notes}</dd>`}
        </dl>
        <div class="grid-2">
          <${Field} label="Terms"><select value=${f(a).termsDays} onChange=${(e) => set(a, { termsDays: e.target.value })}>
            <option value="0">Due on receipt</option><option value="15">Net 15</option><option value="30">Net 30</option>
            <option value="45">Net 45</option><option value="60">Net 60</option></select><//>
          <${Field} label="Account limit ($, optional)" hint="You'll see a warning when they owe more than this.">
            <input type="number" min="0" step="50" inputmode="decimal" value=${f(a).limit} onInput=${(e) => set(a, { limit: e.target.value })} /><//>
        </div>
        <${Field} label="Note to them (optional)"><input maxlength="500" value=${f(a).note} onInput=${(e) => set(a, { note: e.target.value })} /><//>
        <div class="inline">
          <${ActionButton} class="btn primary" onError=${setError} confirmText=${`Approve ${a.company} for monthly invoicing on ${termsLabel(f(a).termsDays)}?`}
            onClick=${decide(a, true)}>Approve<//>
          <${ActionButton} class="btn danger" onError=${setError} confirmText=${`Decline ${a.company}'s application? They're emailed and keep paying by card.`}
            onClick=${decide(a, false)}>Decline<//>
        </div>
      </div>`)}
    </section>`;
}

// For customers (#/billing): how their company pays, and the application for monthly invoicing.
export function BillingPage() {
  const me = getUser();
  const orgId = me.organization?.id;
  const org = useApi(orgId ? `/organizations/${orgId}` : null);
  const app = useApi(orgId ? `/organizations/${orgId}/credit-application` : null);
  const [v, setV] = useState({ legalName: me.organization?.name || '', dba: '', ein: '', address: '', yearsInBusiness: '',
    apName: '', apEmail: '', apPhone: '', monthlyDeliveries: '', requestedTerms: '30', poRequired: false, notes: '', agreed: false,
    references: [{ company: '', contact: '', phone: '', email: '' }, { company: '', contact: '', phone: '', email: '' }] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k], onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const ref = (i, k) => ({ value: v.references[i][k], onInput: (e) => setV({ ...v, references: v.references.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)) }) });
  const submit = async (e) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await api(`/organizations/${orgId}/credit-application`, { method: 'POST', body: { ...v, requestedTerms: Number(v.requestedTerms) } });
      app.reload(); window.scrollTo(0, 0);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const o = org.data;
  const a = app.data;
  const invoiced = o?.billingMode === 'invoice';
  // Just approved: refresh the signed-in user so the menu and booking form switch to invoicing.
  useEffect(() => {
    if (invoiced && me.organization?.billingMode !== 'invoice') api('/auth/me').then((r) => refreshUser(r.user)).catch(() => {});
  }, [invoiced]);
  return html`
    <${Layout}>
      <${PageHeader} title="Billing" subtitle=${me.organization?.name || ''} />
      <${Alert} error=${org.error || app.error} />
      ${!o || app.loading ? html`<${Spinner} />` : invoiced ? html`
        <section class="card">
          <h2>Monthly invoicing</h2>
          <dl class="facts">
            <dt>Terms</dt><dd>${termsLabel(o.paymentTermsDays)}</dd>
            <dt>Invoices go to</dt><dd>${o.billingEmail || '—'}</dd>
            ${o.creditLimitCents && html`<dt>Account limit</dt><dd>${formatMoney(o.creditLimitCents)}</dd>`}
          </dl>
          <p class="small muted">There's nothing to pay when you book. You get one invoice a month listing every delivery; pay by check, ACH or card.</p>
          <a class="btn" href="#/invoices">See your invoices</a>
        </section>` : a?.status === 'pending' ? html`
        <section class="card">
          <h2>Application received</h2>
          <p>You applied for monthly invoicing on ${issued(a.submittedAt)}. We'll email you once it's reviewed, usually within 1–2 business days.
            Until then, keep booking and paying by card as usual.</p>
        </section>` : html`
        ${a?.status === 'declined' && html`<${Alert} tone="warn">Your last application wasn't approved${a.decisionNote ? `: ${a.decisionNote}` : ''}. You're welcome to apply again.<//>`}
        <form class="card stack" onSubmit=${submit}>
          <h2>Apply for monthly invoicing</h2>
          <p class="small muted">Right now you pay by card for each delivery. Businesses that ship with us regularly can be billed on
            account instead: book without paying, then get one invoice a month (usually Net 30). Takes about 3 minutes.</p>
          <${Alert} error=${error} />
          <h3>Business</h3>
          <div class="grid-2">
            <${Field} label="Legal business name"><input required ...${bind('legalName')} /><//>
            <${Field} label="DBA (optional)"><input ...${bind('dba')} /><//>
            <${Field} label="Business address"><input required autocomplete="street-address" ...${bind('address')} /><//>
            <${Field} label="EIN (optional)" hint="Your federal tax ID, if you have one."><input inputmode="numeric" maxlength="20" ...${bind('ein')} /><//>
            <${Field} label="Years in business (optional)"><input ...${bind('yearsInBusiness')} /><//>
            <${Field} label="Deliveries per month, roughly (optional)"><input placeholder="e.g. 20" ...${bind('monthlyDeliveries')} /><//>
          </div>
          <h3>Accounts payable</h3>
          <p class="small muted">Who receives and pays the invoices.</p>
          <div class="grid-2">
            <${Field} label="AP contact name"><input required ...${bind('apName')} /><//>
            <${Field} label="AP email" hint="Invoices are emailed here."><input type="email" required ...${bind('apEmail')} /><//>
            <${Field} label="AP phone (optional)"><input type="tel" ...${bind('apPhone')} /><//>
            <${Field} label="Terms you'd like"><select value=${v.requestedTerms} onChange=${(e) => setV({ ...v, requestedTerms: e.target.value })}>
              <option value="15">Net 15</option><option value="30">Net 30</option><option value="45">Net 45</option></select><//>
          </div>
          <label class="check-row small"><input type="checkbox" checked=${v.poRequired} onChange=${(e) => setV({ ...v, poRequired: e.target.checked })} />
            <span>We need a PO or job number on every invoice line</span></label>
          <h3>Trade references (optional)</h3>
          <p class="small muted">Vendors that bill you on terms. They help us approve you faster.</p>
          ${v.references.map((_, i) => html`<div class="grid-2" key=${i}>
            <${Field} label=${`Reference ${i + 1}: company`}><input ...${ref(i, 'company')} /><//>
            <${Field} label="Contact"><input ...${ref(i, 'contact')} /><//>
            <${Field} label="Their phone"><input type="tel" ...${ref(i, 'phone')} /><//>
            <${Field} label="Their email"><input type="email" ...${ref(i, 'email')} /><//>
          </div>`)}
          <${Field} label="Anything else we should know? (optional)"><textarea rows="2" maxlength="1000" ...${bind('notes')}></textarea><//>
          <label class="check-row small"><input type="checkbox" required checked=${v.agreed} onChange=${(e) => setV({ ...v, agreed: e.target.checked })} />
            <span>We agree to pay invoices in full by their due date. Accounts with late invoices may be switched back to paying by card.</span></label>
          <div><button class="btn primary" disabled=${busy}>${busy ? 'Sending…' : 'Submit application'}</button></div>
        </form>`}
    <//>`;
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
      ${staff && html`<${Applications} onDecided=${reload} />`}
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
                <td data-label="Open">${a.openCents ? formatMoney(a.openCents) : '—'}${a.creditLimitCents && html`<div class=${`small ${a.overLimit ? 'error-text' : 'muted'}`}>${a.overLimit ? 'Over' : 'Limit'} ${formatMoney(a.creditLimitCents)}</div>`}</td>
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
