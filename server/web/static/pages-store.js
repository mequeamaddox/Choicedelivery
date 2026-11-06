// Store delivery link: a store (e.g. a liquidation warehouse) gets a QR code for its counter. Customers scan
// it (or the cashier opens it on the store's tablet), enter where their purchase is going and pay for the
// delivery; the store's address is always the pickup and the order shows in the store's account.
// StoreKitPage (#/store-kit/<orgId>): turn it on (dispatch), see the link and print the counter sign.
import { html, useState, api, useApi, getUser, isStaff } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, ActionButton, Field } from './components.js';

export function StoreLinkPanel({ org, onChange }) {
  const [address, setAddress] = useState(org.address || '');
  const [error, setError] = useState(null);
  const set = async (enabled) => {
    setError(null);
    await api(`/organizations/${org.id}/store-link`, { method: 'POST', body: { enabled, address: address.trim() || undefined } });
    onChange();
  };
  return html`
    <div class="stack store-link-panel">
      <h3>Store delivery link</h3>
      <p class="small muted">For stores whose customers need their purchase delivered. A QR code at their counter opens a delivery
        form with the store as the pickup; the customer pays for the delivery by card. Orders show up in this company's account.</p>
      <${Alert} error=${error} />
      ${org.storeCode ? html`
        <div class="inline">
          <a class="btn primary small" href=${`#/store-kit/${org.id}`}>Link & printable QR sign</a>
          <${ActionButton} class="btn small" onError=${setError} confirmText="Turn off this store's delivery link? Their QR code stops working."
            onClick=${() => set(false)}>Turn off<//>
        </div>
        <p class="small muted">Pickup: ${org.address}</p>`
      : html`
        <${Field} label="Store address (the pickup for every delivery)"><input value=${address} placeholder="Street, city, SC ZIP"
          onInput=${(e) => setAddress(e.target.value)} /><//>
        <div><${ActionButton} class="btn primary small" onError=${setError} onClick=${() => set(true)}>Turn on store delivery link<//></div>`}
    </div>`;
}

export function StoreKitPage({ orgId }) {
  const user = getUser();
  const id = orgId || user.organization?.id;
  const r = useApi(id ? `/organizations/${id}` : null);
  const org = r.data;
  const store = useApi(org?.storeCode ? `/public/store/${org.storeCode}` : null);
  const [copied, setCopied] = useState(false);
  const url = store.data?.url;
  return html`
    <${Layout}>
      <div class="no-print">
        <${PageHeader} title="Store delivery link" subtitle=${org ? org.name : ''} />
        <${Alert} error=${r.error || store.error} />
      </div>
      ${!org ? html`<${Spinner} />` : !org.storeCode ? html`
        <section class="card"><p>${isStaff(user) ? 'Turn on the store delivery link for this company on the Companies page first.'
          : 'Your store delivery link isn\'t set up yet. Contact Choice Delivery to turn it on.'}</p></section>`
      : !url ? html`<${Spinner} />` : html`
        <section class="card stack no-print">
          <h2>How it works at the counter</h2>
          <ol class="small">
            <li>Print the sign below and put it by the register, or keep the link open on a tablet.</li>
            <li>The customer scans the code (or the cashier opens the link) and enters where the purchase is going.</li>
            <li>They see the price, pay by card, and get a live tracking link. The pickup is always ${org.address}.</li>
            <li>A driver comes to the store for it. You'll see every delivery under Orders in this account.</li>
          </ol>
          <input readonly value=${url} aria-label="Store delivery link" />
          <div class="inline wrap">
            <button class="btn" onClick=${async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* ignore */ } }}>${copied ? 'Copied ✓' : 'Copy link'}</button>
            <a class="btn" href=${`#/store/${org.storeCode}`} target="_blank" rel="noopener">Open the form</a>
            <button class="btn primary" onClick=${() => window.print()}>Print the sign</button>
          </div>
        </section>
        <article class="card store-sign">
          <img src="/static/logo.png" alt="Choice Delivery SC" class="store-sign-logo" />
          <h1>Need it delivered?</h1>
          <p class="store-sign-lead">Scan to have your purchase from <strong>${org.name}</strong> delivered today.</p>
          <img src=${`/public/store/${org.storeCode}/qr.svg`} alt="QR code for delivery" class="store-sign-qr" />
          <p class="store-sign-steps">Enter your address · See your price · Pay by card · Track your driver</p>
          <p class="store-sign-url">${url.replace(/^https?:\/\//, '')}</p>
          <p class="small muted">Same-day delivery across Columbia and the Midlands · (803) 949-7034</p>
        </article>`}
    <//>`;
}
