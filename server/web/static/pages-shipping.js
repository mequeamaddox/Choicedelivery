// Shipping forms: fill in who's sending, who's receiving and what; saving gives a label with a
// Code 128 barcode (the form's code) to print and stick on the package. "Book a delivery" carries
// the details into a new order with the code as its reference number, so the driver app's barcode
// scan finds the job.
import { html, useState, api, navigate, useApi, formatDate } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, Field, Logo } from './components.js';
import { code128Svg } from './barcode.js';

const blankParty = () => ({ name: '', company: '', address: '', phone: '', email: '' });

function PartyFields({ title, value, onChange }) {
  const bind = (k) => ({ value: value[k], onInput: (e) => onChange({ ...value, [k]: e.target.value }) });
  return html`<fieldset class="card stack ship-party">
    <h2>${title}</h2>
    <div class="grid-2">
      <${Field} label="Name"><input ...${bind('name')} autocomplete="name" /><//>
      <${Field} label="Company (optional)"><input ...${bind('company')} autocomplete="organization" /><//>
    </div>
    <${Field} label="Address"><input required ...${bind('address')} autocomplete="street-address" placeholder="Street, city, state, ZIP" /><//>
    <div class="grid-2">
      <${Field} label="Phone"><input type="tel" ...${bind('phone')} autocomplete="tel" /><//>
      <${Field} label="Email (optional)"><input type="email" ...${bind('email')} autocomplete="email" /><//>
    </div>
  </fieldset>`;
}

export function ShippingFormPage() {
  const list = useApi('/shipping-forms');
  const [shipper, setShipper] = useState(blankParty());
  const [recipient, setRecipient] = useState(blankParty());
  const [v, setV] = useState({ pieces: '1', weightLbs: '', description: '', reference: '', instructions: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k], onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const form = await api('/shipping-forms', { method: 'POST', body: { shipper, recipient, ...v } });
      navigate(`/shipping-forms/${form.code}`);
    } catch (x) { setError(x); setBusy(false); }
  };
  return html`<${Layout}>
    <${PageHeader} title="Shipping form" subtitle="Saving it creates a label with a barcode to print and put on the package." />
    <form class="stack" onSubmit=${save}>
      <${PartyFields} title="Shipper (from)" value=${shipper} onChange=${setShipper} />
      <${PartyFields} title="Recipient (to)" value=${recipient} onChange=${setRecipient} />
      <fieldset class="card stack">
        <h2>Shipment</h2>
        <div class="grid-2">
          <${Field} label="Pieces"><input type="number" min="1" step="1" ...${bind('pieces')} /><//>
          <${Field} label="Total weight (lbs)"><input type="number" min="0" step="any" ...${bind('weightLbs')} /><//>
        </div>
        <${Field} label="What's being shipped"><input ...${bind('description')} placeholder="e.g. 2 boxes of legal documents" /><//>
        <${Field} label="Your reference (optional)" hint="PO, invoice or case number. Printed on the label."><input ...${bind('reference')} /><//>
        <${Field} label="Special instructions (optional)"><textarea rows="3" ...${bind('instructions')}></textarea><//>
      </fieldset>
      <${Alert} error=${error} />
      <div><button class="btn primary" disabled=${busy}>${busy ? 'Saving…' : 'Save and create label'}</button></div>
    </form>
    <section class="card stack">
      <h2>Saved shipping forms</h2>
      ${list.loading ? html`<${Spinner} />` : !list.data?.length ? html`<${Empty} title="None yet">Forms you save show up here.<//>` : html`
        <div class="table-wrap"><table>
          <thead><tr><th>Code</th><th>To</th><th>Saved</th><th>Order</th></tr></thead>
          <tbody>${list.data.map((f) => html`<tr class="clickable" onClick=${() => navigate(`/shipping-forms/${f.code}`)}>
            <td><a href=${`#/shipping-forms/${f.code}`}>${f.code}</a></td>
            <td>${f.recipient.company || f.recipient.name}<div class="small muted">${f.recipient.address}</div></td>
            <td>${formatDate(f.createdAt)}</td>
            <td>${f.orders[0]?.orderNumber || '—'}</td></tr>`)}</tbody>
        </table></div>`}
    </section>
  <//>`;
}

function PartyBlock({ label, p }) {
  return html`<div class="label-party"><div class="label-tag">${label}</div>
    ${p.company && html`<div class="label-strong">${p.company}</div>`}
    ${p.name && html`<div class=${p.company ? '' : 'label-strong'}>${p.name}</div>`}
    <div>${p.address}</div>${p.phone && html`<div>${p.phone}</div>`}</div>`;
}

export function ShippingLabelPage({ code }) {
  const { data: f, error, loading } = useApi(`/shipping-forms/${encodeURIComponent(code)}`);
  if (loading) return html`<${Layout}><${Spinner} /><//>`;
  if (!f) return html`<${Layout}><${Alert} error=${error} /><a href="#/shipping-form">Back to shipping forms</a><//>`;
  const order = f.orders[0];
  return html`<${Layout}>
    <a class="back no-print" href="#/shipping-form">← Shipping forms</a>
    <div class="no-print"><${PageHeader} title=${`Shipping form ${f.code}`} subtitle=${`Saved ${formatDate(f.createdAt)}${f.createdBy ? ` by ${f.createdBy}` : ''}`} /></div>
    <div class="inline no-print label-actions">
      <button class="btn primary" onClick=${() => window.print()}>Print label</button>
      ${order ? html`<a class="btn" href=${`#/orders/${order.id}`}>View order ${order.orderNumber}</a>`
        : html`<a class="btn" href=${`#/orders/new?form=${f.code}`}>Book a delivery for this shipment</a>`}
    </div>
    <article class="ship-label">
      <header class="label-head"><${Logo} /><div class="label-code">${f.code}</div></header>
      <div class="label-parties"><${PartyBlock} label="From" p=${f.shipper} /><${PartyBlock} label="To" p=${f.recipient} /></div>
      <div class="label-meta">
        <div><span class="label-tag">Pieces</span>${f.pieces ?? '—'}</div>
        <div><span class="label-tag">Weight</span>${f.weightLbs != null ? `${f.weightLbs} lbs` : '—'}</div>
        ${f.reference && html`<div><span class="label-tag">Reference</span>${f.reference}</div>`}
      </div>
      ${f.description && html`<p class="label-desc">${f.description}</p>`}
      ${f.instructions && html`<p class="label-desc"><strong>Instructions:</strong> ${f.instructions}</p>`}
      <div class="label-barcode" dangerouslySetInnerHTML=${{ __html: code128Svg(f.code, { height: 70 }) }}></div>
      <div class="label-code-text">${f.code}</div>
      <footer class="label-foot">Choice Delivery SC · (803) 949-7034 · choicedeliverysc.com</footer>
    </article>
  <//>`;
}
