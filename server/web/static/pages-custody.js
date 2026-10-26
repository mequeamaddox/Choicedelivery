// Chain-of-custody record for one order (#/orders/:id/custody): every handoff with time, names, GPS check,
// piece count, seal and signature. Print it or save it as a PDF; dispatch can also email it.
import { html, useState, api, useApi, getUser, isStaff } from './lib.js';
import { Layout, Alert, Spinner, ActionButton, Logo } from './components.js';

const when = (d) => new Date(d).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
});

function EmailReport({ id }) {
  const [to, setTo] = useState('');
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  return html`
    <div class="card no-print">
      <h2>Email this record</h2>
      <p class="small muted">Leave the address empty to send it to the customer on the order. Signatures and photos stay on file;
        to share those, use Print / Save as PDF and attach the PDF.</p>
      <${Alert} error=${error} />
      ${sent && html`<${Alert} tone="success">Sent to ${sent}.<//>`}
      <div class="inline">
        <input type="email" placeholder="Customer's email" value=${to} onInput=${(e) => setTo(e.target.value)} aria-label="Email address" />
        <${ActionButton} class="btn primary" onError=${setError}
          onClick=${async () => { setError(null); setSent((await api(`/orders/${id}/custody/email`, { method: 'POST', body: { to } })).to); }}>Send<//>
      </div>
    </div>`;
}

export function CustodyPage({ id }) {
  const r = useApi(`/orders/${id}/custody`);
  const c = r.data;
  const facts = c ? [
    ['Order', c.orderNumber], ['Customer', c.customer], ['Reference', c.reference], ['Contents', c.description],
    ['Pieces', c.pieces], ['Seal number', c.sealNumber], ['Temperature', c.temperature],
    ['From', c.from], ['To', c.to], ['Driver', c.driver],
  ].filter(([, v]) => v) : [];
  return html`
    <${Layout}>
      <div class="inline no-print custody-bar">
        <a class="back" href=${`#/orders/${id}`}>← Back to the order</a>
        ${c && html`<button class="btn primary push" onClick=${() => window.print()}>Print / Save as PDF</button>`}
      </div>
      <${Alert} error=${r.error} />
      ${!c ? (r.loading ? html`<${Spinner} />` : null) : html`
        <article class="card custody">
          <header class="custody-head">
            <${Logo} />
            <div><h1>Chain of custody</h1><p class="muted">${c.orderNumber} · generated ${when(c.generatedAt)} (Eastern)</p></div>
          </header>
          <dl class="facts">${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
          ${c.exceptions > 0 && html`<div class="alert error" role="status"><strong>${c.exceptions} exception${c.exceptions === 1 ? '' : 's'} recorded.</strong> Highlighted below.</div>`}
          ${!c.custodyRequired && html`<p class="small muted">This order wasn't booked with chain of custody, so pieces and seals weren't checked at each stop.</p>`}
          <ol class="custody-log">
            ${c.entries.map((x) => html`<li class=${x.exception ? 'exception' : ''}>
              <div class="custody-time">${when(x.at)}</div>
              <div class="custody-body">
                <strong>${x.event}</strong>${x.person ? html` <span class="muted">· ${x.person}</span>` : ''}
                ${x.address && html`<div class="muted small">${x.address}</div>`}
                ${x.handedBy && html`<div>Handed over by <strong>${x.handedBy}</strong></div>`}
                ${x.receivedBy && html`<div>Received by <strong>${x.receivedBy}</strong></div>`}
                ${(x.pieceCount != null || x.sealSeen) && html`<div>${x.pieceCount != null ? `Pieces counted: ${x.pieceCount}` : ''}${x.pieceCount != null && x.sealSeen ? ' · ' : ''}${x.sealSeen ? `Seal: ${x.sealSeen}` : ''}</div>`}
                ${x.details.length > 0 && html`<div class=${`small ${x.exception ? 'custody-flag' : 'muted'}`}>${x.details.join(' · ')}</div>`}
                ${(x.signature || x.photo) && html`<div class="custody-proof">
                  ${x.signature && html`<img src=${x.signature} alt="Signature" class="custody-sig" />`}
                  ${x.photo && html`<img src=${x.photo} alt="Photo" class="custody-photo" />`}</div>`}
              </div>
            </li>`)}
          </ol>
          <p class="small muted">Times and GPS positions are recorded automatically by the driver's phone. Choice Delivery SC ·
            choicedeliverysc.com · info@choicedeliverysc.com</p>
        </article>
        ${isStaff(getUser()) && html`<${EmailReport} id=${id} />`}`}
    <//>`;
}
