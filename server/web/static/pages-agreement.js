// Driver agreement form (#/driver/agreement): the driver reads the independent contractor agreement,
// fills in their legal name and mailing address, checks the boxes and signs with a finger. Dispatch and the
// driver can view and print the signed copy (#/people/<id>/agreement, or the driver's own page once signed).
import { html, useState, api, useApi, getUser, formatDate } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Field, Logo } from './components.js';
import { SignaturePad } from './pages-driver.js';

function AgreementText({ doc }) {
  return html`
    <div class="agreement-text">
      <p>${doc.intro}</p>
      ${doc.sections.map((s, i) => html`<section key=${i}>
        <h3>${i + 1}. ${s.title}</h3>
        <p>${s.text}</p>
        ${s.bullets.length > 0 && html`<ul>${s.bullets.map((b) => html`<li>${b}</li>`)}</ul>`}
        ${s.after && html`<p>${s.after}</p>`}
      </section>`)}
    </div>`;
}

const when = (d) => new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// The signed copy: the exact text they signed, what they filled in, and their signature.
function SignedCopy({ a, driverName }) {
  return html`
    <article class="card agreement-signed">
      <header class="custody-head"><${Logo} /><div><h1>${a.document.title}</h1>
        <p class="muted small">Version ${a.version} · signed ${when(a.signedAt)} (Eastern)</p></div></header>
      <${AgreementText} doc=${a.document} />
      <section class="agreement-parties">
        <h3>Signed by the Driver</h3>
        <dl class="facts">
          <dt>Legal name</dt><dd>${a.legalName}</dd>
          <dt>Mailing address</dt><dd>${a.address}, ${a.city}, ${a.state} ${a.zip}</dd>
          <dt>Phone</dt><dd>${a.phone}</dd>
          <dt>Email</dt><dd>${a.email}</dd>
          <dt>Agreed</dt><dd>Independent contractor status · background and driving record check · this Agreement</dd>
          <dt>Signed</dt><dd>${when(a.signedAt)}${a.ip ? ` · from ${a.ip}` : ''}</dd>
        </dl>
        <img src=${a.signature} alt=${`Signature of ${driverName || a.legalName}`} class="agreement-sig" />
        <p class="small muted">Choice Delivery SC agrees to this Agreement with the Driver as of the date signed.</p>
      </section>
    </article>`;
}

export function DriverAgreementPage() {
  const r = useApi('/driver-agreement');
  const [v, setV] = useState(null);
  const [consents, setConsents] = useState({ contractor: false, background: false, agree: false });
  const [signature, setSignature] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false); // signing again after a newer version
  const d = r.data;
  if (d && !v) setV({ legalName: d.prefill.legalName, address: '', city: d.prefill.city, state: d.prefill.state, zip: d.prefill.zip, phone: d.prefill.phone });
  const bind = (k) => ({ value: v?.[k] ?? '', onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!signature) { setError(new Error('Sign in the box with your finger or mouse.')); return; }
    setBusy(true);
    try {
      await api('/driver-agreement', { method: 'POST', body: { ...v, consents, signature } });
      setSigning(false);
      r.reload();
      window.scrollTo(0, 0);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const showForm = d && (!d.signed || signing);
  return html`
    <${Layout}>
      <div class="no-print"><${PageHeader} title="Driver agreement" subtitle="Read it, fill in your details and sign. Takes about 5 minutes." /></div>
      <${Alert} error=${r.error} />
      ${!d ? html`<${Spinner} />` : !showForm ? html`
        <div class="card no-print stack">
          <p><strong>✓ Signed ${formatDate(d.signed.signedAt)}.</strong> Thank you! Here's your copy.</p>
          <div class="inline wrap">
            <button class="btn primary" onClick=${() => window.print()}>Print / Save as PDF</button>
            ${d.signed.version !== d.current.version && html`<button class="btn" onClick=${() => setSigning(true)}>Review and sign the updated agreement</button>`}
          </div>
        </div>
        <${SignedCopy} a=${d.signed} driverName=${getUser()?.name} />`
      : html`
        <section class="card">
          <h2>${d.current.title}</h2>
          <div class="agreement-scroll"><${AgreementText} doc=${d.current} /></div>
        </section>
        <form class="card stack" onSubmit=${submit}>
          <h2>Your details</h2>
          <${Alert} error=${error} />
          <${Field} label="Full legal name"><input required autocomplete="name" ...${bind('legalName')} /><//>
          <${Field} label="Mailing address"><input required autocomplete="street-address" placeholder="Street and apartment" ...${bind('address')} /><//>
          <div class="grid-3">
            <${Field} label="City"><input required autocomplete="address-level2" ...${bind('city')} /><//>
            <${Field} label="State"><input required maxlength="2" autocomplete="address-level1" ...${bind('state')} /><//>
            <${Field} label="ZIP"><input required inputmode="numeric" maxlength="10" autocomplete="postal-code" ...${bind('zip')} /><//>
          </div>
          <${Field} label="Phone"><input required type="tel" autocomplete="tel" ...${bind('phone')} /><//>
          <label class="check-row"><input type="checkbox" checked=${consents.contractor} onChange=${(e) => setConsents({ ...consents, contractor: e.target.checked })} />
            <span class="small">I understand I'm an independent contractor, not an employee, and I'm responsible for my own taxes and vehicle costs.</span></label>
          <label class="check-row"><input type="checkbox" checked=${consents.background} onChange=${(e) => setConsents({ ...consents, background: e.target.checked })} />
            <span class="small">I agree to a background check and a driving record (MVR) check, now and while I drive with Choice Delivery.</span></label>
          <label class="check-row"><input type="checkbox" checked=${consents.agree} onChange=${(e) => setConsents({ ...consents, agree: e.target.checked })} />
            <span class="small">I've read the agreement above and agree to it. Signing here is the same as signing on paper.</span></label>
          <div><p class="field-label"><strong>Your signature</strong></p><${SignaturePad} onChange=${setSignature} /></div>
          <button class="btn primary block" disabled=${busy || !consents.contractor || !consents.background || !consents.agree}>${busy ? 'Signing…' : 'Sign the agreement'}</button>
        </form>`}
    <//>`;
}

export function SignedAgreementPage({ userId }) {
  const r = useApi(`/driver-agreement/${encodeURIComponent(userId)}`);
  return html`
    <${Layout}>
      <div class="inline no-print custody-bar">
        <a class="back" href=${`#/people/${userId}`}>← Back to the driver</a>
        ${r.data && html`<button class="btn primary push" onClick=${() => window.print()}>Print / Save as PDF</button>`}
      </div>
      <${Alert} error=${r.error} />
      ${r.data ? html`<${SignedCopy} a=${r.data} driverName=${r.data.driver?.name} />` : !r.error && html`<${Spinner} />`}
    <//>`;
}
