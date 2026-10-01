// Driver portal: works in any phone browser at app.choicedeliverysc.com, no app install needed.
import {
  html, useState, useEffect, useRef, api, navigate, useApi, getUser, formatDate, timeAgo, mapsLink, STATUS, ACTIVE_STATUSES,
  SERVICE_LEVEL_LABELS, formatMoney, currentPath,
} from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, StatusBadge, RouteSummary, ActionButton, StopTimeline, Logo } from './components.js';

// ---------- Online status + location sharing ----------
// While online, the phone's location is sent every ~30s (and when it moves) so dispatch and
// customers can see where the driver is. Stops when going offline or closing the page.
let watchId = null;
let lastSent = 0;
function startSharing() {
  if (watchId != null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition((pos) => {
    if (Date.now() - lastSent < 30000) return;
    lastSent = Date.now();
    api('/users/me/location', { method: 'PUT', body: { lat: pos.coords.latitude, lng: pos.coords.longitude } }).catch(() => {});
  }, () => {}, { enableHighAccuracy: true, maximumAge: 15000 });
}
function stopSharing() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

// The phone's position right now, sent with "I've arrived" and "Delivered" so the server can check
// the driver is at the stop's address.
function hereNow() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("This browser can't share your location. Use the Choice Delivery Driver app.")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => reject(new Error("We need your location to confirm you're at the stop. Allow location for this site and try again.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

function OnlineToggle() {
  const me = useApi('/users/me');
  const [online, setOnline] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { if (me.data) setOnline(!!me.data.isOnline); }, [me.data]);
  useEffect(() => { if (online) startSharing(); else stopSharing(); }, [online]);
  if (online === null) return null;
  const toggle = async () => {
    setError(null);
    try {
      await api('/users/me/availability', { method: 'PUT', body: { online: !online } });
      setOnline(!online);
    } catch (e) { setError(e); }
  };
  return html`
    <div class=${`online-toggle ${online ? 'on' : ''}`}>
      <div>
        <strong>${online ? "You're online" : "You're offline"}</strong>
        <div class="small">${online ? 'Sharing your location with dispatch while this page is open.' : 'Go online to get new job alerts and share your location.'}</div>
      </div>
      <button type="button" class=${`btn ${online ? '' : 'primary'}`} onClick=${toggle}>${online ? 'Go offline' : 'Go online'}</button>
      ${error && html`<${Alert} error=${error} />`}
    </div>`;
}

// ---------- Job lists ----------
function JobCard({ o, action }) {
  const first = o.stops[0];
  return html`
    <article class="job-card" onClick=${() => navigate(`/driver/job/${o.id}`)}>
      <div class="job-head">
        <strong>${o.orderNumber}</strong>
        ${o.driverPayCents != null && html`<span class="pay">${formatMoney(o.driverPayCents)}</span>`}
        ${o.serviceLevel === 'rush' && html`<span class="badge amber">Rush</span>`}
        <${StatusBadge} status=${o.status} />
      </div>
      <${RouteSummary} stops=${o.stops} />
      <div class="muted small">
        ${o.stops.length} stops${o.distanceMiles != null ? ` · about ${o.distanceMiles} mi` : ''}${o.vehicleType ? ` · ${o.vehicleType}` : ''}
        ${first?.contactName ? ` · pickup: ${first.contactName}` : ''}
      </div>
      ${action}
    </article>`;
}

// Shown instead of jobs until the driver is approved (or while they're on hold / have expired documents).
function DriverStatusCard({ user }) {
  const c = user.checklist || { missing: [], expired: [] };
  const title = { applied: 'Application received', rejected: 'Application not approved', suspended: 'Your account is on hold' }[user.driverStatus]
    || 'Action needed';
  return html`
    <section class="card stack">
      <h2>${title}</h2>
      <p>${user.workBlocker}</p>
      ${user.reviewNote && user.driverStatus !== 'applied' && html`<p class="small muted">${user.reviewNote}</p>`}
      ${c.missing.length > 0 && html`<div class="small"><strong>Finish your profile in the driver app:</strong>
        <ul>${c.missing.map((m) => html`<li>${m}</li>`)}</ul></div>`}
      <a class="btn primary" href="#/driver-app">Get the driver app</a>
    </section>`;
}

export function DriverJobsPage() {
  const me = getUser();
  if (me.workBlocker) return html`<${Layout}><${PageHeader} title="Jobs" /><${DriverStatusCard} user=${me} /><//>`;
  return html`<${DriverJobsList} />`;
}

function DriverJobsList() {
  const mine = useApi(`/orders?mine=true&status=${ACTIVE_STATUSES.join(',')}`, { pollMs: 15000 });
  const open = useApi('/orders?status=pending', { pollMs: 15000 });
  const [error, setError] = useState(null);
  const available = (open.data || []).filter((o) => !o.driver);
  const accept = (id) => async () => {
    await api(`/orders/${id}/accept`, { method: 'POST' });
    navigate(`/driver/job/${id}`);
  };
  return html`
    <${Layout}>
      <${PageHeader} title="Jobs" />
      <${OnlineToggle} />
      <${Alert} error=${error || mine.error || open.error} />
      <h2 class="section-title">Your active jobs</h2>
      ${mine.loading ? html`<${Spinner} />` : !mine.data?.length ? html`<p class="muted">No active jobs. Accept one below.</p>` : html`
        <div class="job-list">${mine.data.map((o) => html`<${JobCard} key=${o.id} o=${o}
          action=${html`<button class="btn primary block">Continue →</button>`} />`)}</div>`}
      <h2 class="section-title">Available jobs</h2>
      ${open.loading ? html`<${Spinner} />` : !available.length ? html`
        <${Empty} title="No open jobs right now">New jobs appear here automatically.<//>` : html`
        <div class="job-list">${available.map((o) => html`<${JobCard} key=${o.id} o=${o}
          action=${html`<span onClick=${(e) => e.stopPropagation()}>
            <${ActionButton} class="btn primary block" onError=${setError} onClick=${accept(o.id)}>Accept job<//></span>`} />`)}</div>`}
    <//>`;
}

// Getting paid: set up direct deposit once (Stripe's secure form collects the bank account, and a debit
// card for instant pay), then either wait for the free Wednesday bank deposit or get paid now to the
// debit card for a small fee.
function Payouts({ earnings, onPaid }) {
  const st = useApi('/payouts/me/stripe');
  const destination = useApi(st.data?.payoutsEnabled ? '/payouts/me/payout-method' : null);
  const dest = destination.data;
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = st.data;
  const e = earnings;
  if (!s?.available || !e) return null;
  const setUp = async () => {
    setBusy(true); setError(null);
    try { window.location.href = (await api('/payouts/me/stripe/onboard', { method: 'POST' })).url; } catch (err) { setError(err); setBusy(false); }
  };
  const payNow = async () => {
    if (!window.confirm(`Get ${formatMoney(e.instant.netCents)} now? A ${formatMoney(e.instant.feeCents)} fee ($1.50 + 1.5%) comes out of your ${formatMoney(e.owedCents)}.`)) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await api('/payouts/me/instant', { method: 'POST', body: { expectedNetCents: e.instant.netCents } });
      setDone(r.instant
        ? `${formatMoney(r.netCents)} is on its way to your debit card. It usually arrives within 30 minutes.`
        : `Your bank can't take instant payments, so we sent the full ${formatMoney(r.netCents)} by regular bank deposit (1–2 business days), no fee.`);
      onPaid();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const next = e.nextPayoutAt && new Date(e.nextPayoutAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return html`
    <section class="card stack">
      <h2>Getting paid ${s.payoutsEnabled ? html`<span class="badge green">Direct deposit on</span>` : s.connected ? html`<span class="badge amber">Not finished</span>` : ''}</h2>
      <${Alert} error=${error} /><${Alert} tone="success">${done}<//>
      ${!s.payoutsEnabled ? html`
        <p class="small muted">${s.connected ? 'Finish your direct-deposit setup to get paid.'
          : 'Add your bank account (and a debit card if you want instant pay). Stripe, our payments partner, keeps them secure; it takes about 5 minutes.'}</p>
        <button class="btn primary" disabled=${busy} onClick=${setUp}>${busy ? 'Opening…' : s.connected ? 'Finish direct-deposit setup' : 'Set up direct deposit'}</button>`
      : html`
        <div class="payout-options">
          <div>
            <strong>Free bank deposit</strong>
            <p class="small muted">Everything you're owed goes to your bank ${next ? html`<strong>${next}</strong>` : 'every Wednesday at 9 AM'}. Arrives in 1–2 business days.</p>
          </div>
          <div>
            <strong>Instant to your debit card</strong>
            <p class="small muted">$1.50 + 1.5% fee. Usually arrives within 30 minutes.</p>
            ${dest && !dest.instantMethod && html`<p class="small"><a href="#/driver/payout-method">Add a debit card</a> to use instant pay.</p>`}
            ${e.owedCents > 0 && html`
              <button class="btn primary" disabled=${busy || !e.instant.available} onClick=${payNow}>
                ${busy ? 'Sending…' : `Get ${formatMoney(e.instant.netCents)} now`}
              </button>
              ${!e.instant.available && html`<p class="small muted">Not enough owed yet for instant pay.</p>`}`}
          </div>
        </div>
        <p class="small">${dest?.method ? html`Paying to <strong>${dest.method.label}</strong> · ` : ''}<a href="#/driver/payout-method">Change bank or debit card</a></p>`}
    </section>`;
}

export function DriverHistoryPage() {
  const done = useApi('/orders?mine=true&status=completed&limit=100');
  const earnings = useApi('/payouts/me');
  const e = earnings.data;
  return html`
    <${Layout}>
      <${PageHeader} title="History" subtitle="Your completed deliveries and earnings." />
      ${e && html`<div class="stat-row">
        <div class="stat"><span class="muted small">Owed to you</span><strong>${formatMoney(e.owedCents)}</strong></div>
        <div class="stat"><span class="muted small">Last 7 days</span><strong>${formatMoney(e.last7DaysCents)}</strong></div>
        <div class="stat"><span class="muted small">Paid, last 60 days</span><strong>${formatMoney(e.paidLast60DaysCents)}</strong></div>
      </div>`}
      <${Payouts} earnings=${e} onPaid=${() => { earnings.reload(); done.reload(); }} />
      <${Alert} error=${done.error} />
      ${done.loading ? html`<${Spinner} />` : !done.data?.length ? html`<${Empty} title="No completed jobs yet" />` : html`
        <div class="job-list">${done.data.map((o) => html`<${JobCard} key=${o.id} o=${o}
          action=${html`<div class="muted small">Delivered ${formatDate(o.completedAt)} · ${o.driverPaidAt ? `paid ${formatDate(o.driverPaidAt)}` : 'not paid out yet'}</div>`} />`)}</div>`}
    <//>`;
}

// ---------- Proof of delivery ----------
function SignaturePad({ onChange }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  useEffect(() => {
    const c = canvas.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);
  const point = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const down = (e) => {
    drawing.current = true;
    canvas.current.setPointerCapture(e.pointerId);
    const ctx = canvas.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(...point(e));
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvas.current.getContext('2d');
    ctx.lineTo(...point(e));
    ctx.stroke();
    hasInk.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasInk.current) onChange(canvas.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvas.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    hasInk.current = false;
    onChange(null);
  };
  return html`
    <div class="signature">
      <canvas ref=${canvas} class="signature-pad" aria-label="Sign here"
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}></canvas>
      <div class="signature-foot"><span class="muted small">Sign above</span><button type="button" class="link" onClick=${clear}>Clear</button></div>
    </div>`;
}

// Shrinks a camera photo to at most 1280px so it uploads quickly on mobile data.
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read that photo"));
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function CompleteStopForm({ order, stop, onDone }) {
  const [signature, setSignature] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isPickup = stop.type === 'pickup';
  const submit = async (e) => {
    e.preventDefault();
    if (isPickup && !signature && !photo) { setError(new Error('Add a signature or a photo as proof.')); return; }
    if (!isPickup && (!signature || !photo)) { setError(new Error("Take a delivery photo and get the receiver's signature.")); return; }
    setBusy(true); setError(null);
    try {
      const location = await hereNow();
      onDone(await api(`/orders/${order.id}/stops/${stop.id}/complete`, {
        method: 'POST', body: { signature: signature || undefined, photo: photo || undefined, printedName: name || undefined, location },
      }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return html`
    <form class="stack" onSubmit=${submit}>
      <h3>${isPickup ? 'Confirm pickup' : 'Confirm delivery'}</h3>
      <p class="muted small">${isPickup ? 'Add a signature or a photo.' : "A delivery photo and the receiver's signature are both required."}</p>
      <${Alert} error=${error} />
      <label class="field"><span class="field-label">${isPickup ? 'Name of person handing off' : 'Name of person receiving'}</span>
        <input value=${name} onInput=${(e) => setName(e.target.value)} autocomplete="off" /></label>
      <${SignaturePad} onChange=${setSignature} />
      <label class="btn block photo-btn">
        ${photo ? 'Retake photo' : '📷 Take a photo'}
        <input type="file" accept="image/*" capture="environment" class="visually-hidden"
          onChange=${async (e) => { const f = e.target.files[0]; if (f) { try { setPhoto(await readPhoto(f)); } catch (err) { setError(err); } } }} />
      </label>
      ${photo && html`<img class="photo-preview" src=${photo} alt="Proof photo" />`}
      <button class="btn primary block big" disabled=${busy}>${busy ? 'Saving…' : isPickup ? 'Picked up ✓' : 'Delivered ✓'}</button>
    </form>`;
}

// ---------- One job ----------
export function DriverJobPage({ id }) {
  const { data: loaded, error: loadError, loading } = useApi(`/orders/${encodeURIComponent(id)}`, { pollMs: 20000 });
  const [override, setOverride] = useState(null);
  const [error, setError] = useState(null);
  const order = override && (!loaded || new Date(override.updatedAt) >= new Date(loaded.updatedAt)) ? override : loaded;

  if (loading && !order) return html`<${Layout}><${Spinner} /><//>`;
  if (!order) return html`<${Layout}><${Alert} error=${loadError} /><a href="#/driver">Back to jobs</a><//>`;

  const next = order.stops.find((s) => s.status !== 'completed');
  const mine = !!order.driver;
  return html`
    <${Layout}>
      <a class="back" href="#/driver">← Jobs</a>
      <${PageHeader} title=${html`${order.orderNumber} <${StatusBadge} status=${order.status} />`}
        subtitle=${`${SERVICE_LEVEL_LABELS[order.serviceLevel] || ''}${order.vehicleType ? ` · ${order.vehicleType}` : ''}${order.distanceMiles != null ? ` · about ${order.distanceMiles} mi` : ''}`} />
      <${Alert} error=${error} />
      ${order.driverPayCents != null && html`<p class="card pay-card">Your pay: <strong>${formatMoney(order.driverPayCents)}</strong>${order.driverPaidAt ? html` <span class="badge green">Paid</span>` : ''}</p>`}
      ${order.description && html`<p class="card small"><strong>Load:</strong> ${order.description}${order.weight ? ` · ${order.weight}` : ''}${order.numberOfPieces ? ` · ${order.numberOfPieces} pcs` : ''}</p>`}

      ${!mine && order.status === 'pending' && html`
        <${ActionButton} class="btn primary block big" onError=${setError}
          onClick=${async () => setOverride(await api(`/orders/${order.id}/accept`, { method: 'POST' }))}>Accept job<//>`}

      ${mine && next && html`
        <section class="card next-stop">
          <div class="muted small">Next stop · ${next.type === 'pickup' ? 'Pickup' : 'Drop-off'} ${next.sequence} of ${order.stops.length}</div>
          <h2 class="stop-big">${next.address}</h2>
          ${(next.contactName || next.contactPhone) && html`<p>${next.contactName}</p>`}
          ${next.instructions && html`<p class="muted">“${next.instructions}”</p>`}
          <div class="grid-2 tight">
            <a class="btn block" href=${`https://www.google.com/maps/dir/?api=1&destination=${next.location ? `${next.location.lat},${next.location.lng}` : encodeURIComponent(next.address)}`}
              target="_blank" rel="noopener">🧭 Navigate</a>
            ${next.contactPhone ? html`<a class="btn block" href=${`tel:${next.contactPhone}`}>📞 Call</a>` : html`<span></span>`}
          </div>
          ${next.status === 'pending' && html`
            <${ActionButton} class="btn block big" onError=${setError}
              onClick=${async () => setOverride(await api(`/orders/${order.id}/stops/${next.id}/arrive`, { method: 'POST', body: { location: await hereNow() } }))}>
              I've arrived
            <//>`}
          ${next.status !== 'pending' && html`<${CompleteStopForm} key=${next.id} order=${order} stop=${next} onDone=${setOverride} />`}
        </section>`}

      ${order.status === 'completed' && html`<div class="card done-card"><h2>Delivered 🎉</h2><p>Nice work. <a href="#/driver">Back to jobs</a></p></div>`}

      <section class="card">
        <h2>Route</h2>
        <${StopTimeline} stops=${order.stops} showProof=${mine} />
      </section>
      ${order.notes.length > 0 && html`
        <section class="card"><h2>Notes</h2>
          <ul class="notes">${order.notes.map((n) => html`<li><p>${n.note}</p><span class="muted small">${n.authorRole || ''} · ${timeAgo(n.createdAt)}</span></li>`)}</ul>
        </section>`}
    <//>`;
}

// ---------- Bank & debit card ----------
// Stripe's secure embedded form, inside our page, for adding or changing where pay goes (bank account
// for the free Wednesday deposit, debit card for instant pay). Opened from History on the website, or
// from the driver app with a 15-minute link (?t=...) that works for this page only.
let connectJs = null;
function loadConnectJs() {
  if (window.StripeConnect?.init) return Promise.resolve(window.StripeConnect);
  if (!connectJs) {
    connectJs = new Promise((resolve, reject) => {
      window.StripeConnect = window.StripeConnect || {};
      window.StripeConnect.onLoad = () => resolve(window.StripeConnect);
      const s = document.createElement('script');
      s.src = 'https://connect-js.stripe.com/v1.0/connect.js';
      s.async = true;
      s.onerror = () => { connectJs = null; reject(new Error("Couldn't load the secure form. Check your connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  return connectJs;
}

export function PayoutMethodPage() {
  const linkToken = new URLSearchParams(currentPath().split('?')[1] || '').get('t');
  const call = (path, method = 'GET') => (linkToken
    ? fetch(path, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${linkToken}` } }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Something went wrong');
      return d;
    })
    : api(path, { method }));
  const box = useRef(null);
  const [dest, setDest] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = () => call('/payouts/me/payout-method').then(setDest).catch(setError);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
        const first = await call('/payouts/me/account-session', 'POST');
        const StripeConnect = await loadConnectJs();
        if (cancelled) return;
        let secret = first.clientSecret;
        const instance = StripeConnect.init({
          publishableKey: first.publishableKey,
          fetchClientSecret: async () => {
            if (secret) { const s = secret; secret = null; return s; }
            return (await call('/payouts/me/account-session', 'POST')).clientSecret;
          },
          appearance: { variables: { colorPrimary: '#0f766e', fontFamily: 'inherit', borderRadius: '10px' } },
        });
        const el = instance.create('account-management');
        if (box.current) { box.current.innerHTML = ''; box.current.appendChild(el); }
      } catch (err) { if (!cancelled) setError(err); } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  const body = html`
    <section class="card stack">
      <h2>Where your pay goes</h2>
      ${dest?.method
        ? html`<p>Paying to <strong>${dest.method.label}</strong>.</p>
          <p class="small muted">${dest.instantMethod ? html`Instant pay goes to <strong>${dest.instantMethod.label}</strong>.`
            : 'To use instant pay, add a debit card below.'}</p>`
        : !loading && !error && html`<p class="small muted">No bank account or card yet.</p>`}
      <${Alert} error=${error} />
      ${loading && html`<${Spinner} />`}
      <div ref=${box} class="stripe-embed"></div>
      <p class="small muted">Your bank and card details are kept by Stripe, our payments partner; Choice Delivery never sees the full numbers.
        After making a change, <button class="link" onClick=${refresh}>refresh</button> to see it here.</p>
    </section>`;
  if (linkToken) {
    return html`<div class="page narrow"><${Logo} /><h1>Bank & debit card</h1>${body}
      <p class="muted small">When you're done, go back to the Choice Delivery Driver app.</p></div>`;
  }
  return html`<${Layout}><a class="back" href="#/driver/history">← Earnings</a><${PageHeader} title="Bank & debit card" />${body}<//>`;
}
