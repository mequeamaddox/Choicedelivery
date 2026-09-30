// Driver portal: works in any phone browser at app.choicedeliverysc.com, no app install needed.
import {
  html, useState, useEffect, useRef, api, navigate, useApi, formatDate, timeAgo, mapsLink, STATUS, ACTIVE_STATUSES,
  SERVICE_LEVEL_LABELS,
} from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, StatusBadge, RouteSummary, ActionButton, StopTimeline } from './components.js';

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

export function DriverJobsPage() {
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

export function DriverHistoryPage() {
  const done = useApi('/orders?mine=true&status=completed&limit=100');
  return html`
    <${Layout}>
      <${PageHeader} title="History" subtitle="Your completed deliveries." />
      <${Alert} error=${done.error} />
      ${done.loading ? html`<${Spinner} />` : !done.data?.length ? html`<${Empty} title="No completed jobs yet" />` : html`
        <div class="job-list">${done.data.map((o) => html`<${JobCard} key=${o.id} o=${o}
          action=${html`<div class="muted small">Delivered ${formatDate(o.completedAt)}</div>`} />`)}</div>`}
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
    if (!signature && !photo) { setError(new Error('Add a signature or a photo as proof.')); return; }
    setBusy(true); setError(null);
    try {
      onDone(await api(`/orders/${order.id}/stops/${stop.id}/complete`, {
        method: 'POST', body: { signature: signature || undefined, photo: photo || undefined, printedName: name || undefined },
      }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return html`
    <form class="stack" onSubmit=${submit}>
      <h3>${isPickup ? 'Confirm pickup' : 'Confirm delivery'}</h3>
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
              onClick=${async () => setOverride(await api(`/orders/${order.id}/stops/${next.id}/arrive`, { method: 'POST' }))}>
              I've arrived
            <//>`}
          <${CompleteStopForm} key=${next.id} order=${order} stop=${next} onDone=${setOverride} />
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
