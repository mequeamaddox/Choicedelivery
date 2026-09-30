import {
  html, useState, useEffect, api, getUser, isStaff, navigate, useApi, formatDate, timeAgo, formatMoney, mapsLink,
  trackingUrl, ACTIVE_STATUSES, VEHICLE_TYPES, SERVICE_LEVEL_LABELS,
} from './lib.js';
import {
  Layout, PageHeader, Alert, Spinner, Empty, Field, StatusBadge, StopTimeline, RouteSummary, ActionButton, AddressInput,
} from './components.js';

const FILTERS = [
  { key: 'active', label: 'In progress', statuses: ['pending', ...ACTIVE_STATUSES] },
  { key: 'pending', label: 'Needs driver', statuses: ['pending'] },
  { key: 'completed', label: 'Delivered', statuses: ['completed'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { key: 'all', label: 'All', statuses: [] },
];

// Dispatch switch for the $15 bad-weather surcharge on new orders.
function WeatherSwitch() {
  const settings = useApi('/settings');
  const on = settings.data?.bad_weather === true;
  return html`
    <${ActionButton} class=${`btn ${on ? 'warn' : ''}`}
      confirmText=${on ? 'Turn off bad-weather pricing?' : 'Turn on bad-weather pricing? New orders get a $15 weather surcharge until you turn it off.'}
      onClick=${async () => { await api('/settings/bad-weather', { method: 'PUT', body: { enabled: !on } }); settings.reload(); }}>
      ${on ? '⛈ Bad weather: ON' : 'Bad weather: off'}
    <//>`;
}

export function OrdersPage() {
  const user = getUser();
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const f = FILTERS.find((x) => x.key === filter);
  const path = `/orders?limit=200${f.statuses.length ? `&status=${f.statuses.join(',')}` : ''}`;
  const { data, error, loading } = useApi(path, { pollMs: 30000 });
  const q = search.trim().toLowerCase();
  const rows = (data || []).filter((o) => !q || [o.orderNumber, o.trackingNumber, o.organization?.name, o.driver?.name,
    ...o.stops.map((s) => `${s.address} ${s.contactName}`)].join(' ').toLowerCase().includes(q));

  return html`
    <${Layout}>
      ${isStaff(user) ? html`
        <${PageHeader} title="Orders" subtitle="Every order across all companies."
          actions=${html`<${WeatherSwitch} /><a class="btn primary" href="#/orders/new">+ New order</a>`} />` : html`
        <section class="welcome">
          <div>
            <h1>Welcome back${user.name ? `, ${user.name.split(' ')[0]}` : ''}!</h1>
            <p>Ready for delivery across the Southeast? We deliver up to 200 miles from Columbia.</p>
          </div>
          <a class="btn" href="#/orders/new">+ New order</a>
        </section>`}
      <div class="toolbar">
        <div class="tabs" role="tablist">
          ${FILTERS.map((x) => html`<button role="tab" aria-selected=${filter === x.key}
            class=${filter === x.key ? 'tab active' : 'tab'} onClick=${() => setFilter(x.key)}>${x.label}</button>`)}
        </div>
        <input class="search" type="search" placeholder="Search order #, address, contact…" value=${search}
          onInput=${(e) => setSearch(e.target.value)} aria-label="Search orders" />
      </div>
      <${Alert} error=${error} />
      ${loading ? html`<${Spinner} />` : rows.length === 0 ? html`
        <${Empty} title="No orders here yet">
          ${filter === 'active' ? 'New orders you book will show up here.' : 'Try a different filter.'}
        <//>` : html`
        <div class="table-wrap">
          <table class="orders">
            <thead><tr>
              <th>Order</th><th>Route</th>${isStaff(user) && html`<th>Company</th>`}<th>Driver</th><th>Status</th><th>Booked</th>
            </tr></thead>
            <tbody>
              ${rows.map((o) => html`
                <tr class="clickable" onClick=${() => navigate(`/orders/${o.id}`)}>
                  <td data-label="Order"><a class="nowrap" href=${`#/orders/${o.id}`} onClick=${(e) => e.stopPropagation()}><strong>${o.orderNumber}</strong></a>
                    <div class="muted small">${o.serviceLevel === 'rush' ? 'Rush · ' : ''}${o.vehicleType}</div></td>
                  <td data-label="Route"><${RouteSummary} stops=${o.stops} /></td>
                  ${isStaff(user) && html`<td data-label="Company">${o.organization?.name || html`<span class="muted">Internal</span>`}</td>`}
                  <td data-label="Driver">${o.driver?.name || html`<span class="muted">—</span>`}</td>
                  <td data-label="Status"><${StatusBadge} status=${o.status} /></td>
                  <td data-label="Booked" class="muted small">${formatDate(o.createdAt)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>`}
    <//>`;
}

// ---------- New order ----------

const blankStop = (type) => ({ type, address: '', location: null, contactName: '', contactPhone: '', instructions: '' });

// Live quote from the server (same formula used when the order is booked).
function useQuote(stops, serviceLevel, scheduledAt) {
  const [quote, setQuote] = useState(null);
  const key = JSON.stringify([stops.map((s) => [s.address, s.location]), serviceLevel, scheduledAt]);
  useEffect(() => {
    if (stops.some((s) => !s.address.trim() && !s.location)) { setQuote(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = await api('/public/quote', { method: 'POST', body: {
          stops: stops.map((s) => ({ address: s.address, location: s.location || undefined })), serviceLevel,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        } });
        if (!cancelled) setQuote(q);
      } catch { /* the estimate is optional */ }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [key]);
  return quote;
}

// Itemized price, as on the original quote page.
export function PriceBreakdown({ q }) {
  if (!q) return null;
  return html`
    <dl class="breakdown">
      <dt>Base delivery (first ${q.baseMiles} miles)</dt><dd>${formatMoney(q.baseFeeCents)}</dd>
      ${q.extraMileageCents > 0 && html`<dt>Distance fee (${q.extraMiles} mi × ${formatMoney(q.perMileCents)})</dt><dd>+${formatMoney(q.extraMileageCents)}</dd>`}
      ${q.rushFeeCents > 0 && html`<dt>Rush delivery</dt><dd>+${formatMoney(q.rushFeeCents)}</dd>`}
      ${(q.surcharges || []).map((sc) => html`<dt>${sc.label}</dt><dd>+${formatMoney(sc.cents)}</dd>`)}
      <dt class="total">Total</dt><dd class="total">${formatMoney(q.totalCents)}</dd>
    </dl>`;
}

function StopEditor({ stops, setStops }) {
  const update = (i, patch) => setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, d) => {
    const next = [...stops];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setStops(next);
  };
  const remove = (i) => setStops(stops.filter((_, j) => j !== i));
  const add = () => setStops([...stops.slice(0, -1), blankStop('dropoff'), stops[stops.length - 1]]);
  return html`
    <div class="stops-editor">
      ${stops.map((s, i) => html`
        <fieldset class="stop-card">
          <legend>
            <select value=${s.type} onChange=${(e) => update(i, { type: e.target.value })} aria-label="Stop type">
              <option value="pickup">Pickup</option><option value="dropoff">Drop-off</option>
            </select>
            <span class="muted small">Stop ${i + 1}</span>
          </legend>
          <div class="stop-tools">
            <button type="button" class="icon-btn" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label="Move up">↑</button>
            <button type="button" class="icon-btn" disabled=${i === stops.length - 1} onClick=${() => move(i, 1)} aria-label="Move down">↓</button>
            <button type="button" class="icon-btn" disabled=${stops.length <= 2} onClick=${() => remove(i)} aria-label="Remove stop">✕</button>
          </div>
          <${Field} label="Address" hint=${s.location ? '✓ Located on the map' : 'Start typing and pick a suggestion so drivers get a map pin.'}>
            <${AddressInput} required placeholder="Street, city, state, ZIP" value=${s.address}
              onChange=${(patch) => update(i, patch)} />
          <//>
          <div class="grid-2">
            <${Field} label="Contact name"><input value=${s.contactName} onInput=${(e) => update(i, { contactName: e.target.value })} /><//>
            <${Field} label="Contact phone"><input type="tel" value=${s.contactPhone} onInput=${(e) => update(i, { contactPhone: e.target.value })} /><//>
          </div>
          <${Field} label="Instructions for the driver"><input placeholder="Dock number, gate code, who to ask for…" value=${s.instructions}
            onInput=${(e) => update(i, { instructions: e.target.value })} /><//>
        </fieldset>`)}
      <button type="button" class="btn" onClick=${add}>+ Add another stop</button>
    </div>`;
}

export function NewOrderPage() {
  const user = getUser();
  const staff = isStaff(user);
  const companies = useApi(staff ? '/organizations' : null);
  const pricing = useApi('/public/pricing');
  const [stops, setStops] = useState([blankStop('pickup'), blankStop('dropoff')]);
  const [v, setV] = useState({
    serviceLevel: 'standard', vehicleType: 'Car', weight: '', numberOfPieces: '', description: '', trackingNumber: '',
    scheduledAt: '', organizationId: '', price: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (name) => ({ value: v[name], onInput: (e) => setV({ ...v, [name]: e.target.value }) });
  const quote = useQuote(stops, v.serviceLevel, v.scheduledAt);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (stops[0].type !== 'pickup' || stops[stops.length - 1].type !== 'dropoff') {
      setError(new Error('The first stop must be a pickup and the last stop a drop-off.'));
      return;
    }
    setBusy(true);
    try {
      const body = {
        serviceLevel: v.serviceLevel, vehicleType: v.vehicleType, weight: v.weight, numberOfPieces: v.numberOfPieces, description: v.description,
        trackingNumber: v.trackingNumber || undefined,
        scheduledAt: v.scheduledAt ? new Date(v.scheduledAt).toISOString() : undefined,
        stops,
      };
      if (staff) {
        if (v.organizationId) body.organizationId = v.organizationId;
        if (v.price !== '') body.priceCents = Math.round(Number(v.price) * 100);
      }
      const order = await api('/orders', { method: 'POST', body });
      navigate(`/orders/${order.id}`);
    } catch (err) {
      setError(err);
      window.scrollTo(0, 0);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${Layout}>
      <${PageHeader} title="New order" subtitle="Drivers are notified as soon as you book." />
      <form class="form-layout" onSubmit=${submit}>
        <${Alert} error=${error} />
        <section class="card">
          <h2>Route</h2>
          <${StopEditor} stops=${stops} setStops=${setStops} />
        </section>
        <section class="card">
          <h2>Service</h2>
          <div class="choice-grid" role="radiogroup" aria-label="Service level">
            ${(pricing.data?.serviceLevels || []).map((l) => html`
              <label class=${`choice ${v.serviceLevel === l.id ? 'selected' : ''}`}>
                <input type="radio" name="serviceLevel" value=${l.id} checked=${v.serviceLevel === l.id}
                  onChange=${() => setV({ ...v, serviceLevel: l.id })} />
                <span><strong>${l.id === 'rush' ? 'Rush delivery' : 'Standard delivery'}</strong>
                  <span class="muted small">${l.id === 'rush' ? '2 hours or less' : `${formatMoney(pricing.data.baseFeeCents)} base, first ${pricing.data.baseMiles} miles`}</span></span>
                <span class="price push">${l.feeCents ? `+${formatMoney(l.feeCents)}` : ''}</span>
              </label>`)}
          </div>
          <${Field} label="Vehicle needed">
            <select value=${v.vehicleType} onChange=${(e) => setV({ ...v, vehicleType: e.target.value })}>
              ${(pricing.data?.vehicleTypes || VEHICLE_TYPES).map((t) => html`<option>${t}</option>`)}
            </select>
          <//>
          <div class="estimate">
            <div class="estimate-head">
              <span><strong>Estimated price</strong>${quote?.distanceMiles != null ? html`<span class="muted"> · about ${quote.distanceMiles} miles</span>` : ''}</span>
              <span class="price">${quote ? formatMoney(quote.totalCents) : '—'}</span>
            </div>
            ${quote ? html`<${PriceBreakdown} q=${quote} />
              <p class="muted small">${quote.note}</p>`
              : html`<p class="muted small">Enter the addresses to see your price.</p>`}
            ${staff && html`<p class="muted small">Dispatch can set a custom price below.</p>`}
          </div>
        </section>
        <section class="card">
          <h2>Shipment</h2>
          <div class="grid-2">
            <${Field} label="Pickup time" hint="Leave empty for as soon as possible.">
              <input type="datetime-local" ...${bind('scheduledAt')} />
            <//>
            <${Field} label="Total weight"><input placeholder="e.g. 120 lbs" ...${bind('weight')} /><//>
            <${Field} label="Number of pieces"><input inputmode="numeric" placeholder="e.g. 4" ...${bind('numberOfPieces')} /><//>
          </div>
          <${Field} label="What are we moving?"><textarea rows="3" placeholder="Pallets of tile, boxed parts, fragile items…" ...${bind('description')}></textarea><//>
          <${Field} label="Your reference / tracking number" hint="Optional. Drivers can scan it as a barcode at pickup.">
            <input ...${bind('trackingNumber')} />
          <//>
        </section>
        ${staff && html`
          <section class="card">
            <h2>Dispatch</h2>
            <div class="grid-2">
              <${Field} label="Company">
                <select ...${bind('organizationId')} onChange=${(e) => setV({ ...v, organizationId: e.target.value })}>
                  <option value="">Internal / no company</option>
                  ${(companies.data || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
                </select>
              <//>
              <${Field} label="Custom price (USD)" hint="Leave empty to use the calculated price."><input type="number" min="0" step="0.01" ...${bind('price')} /><//>
            </div>
          </section>`}
        <div class="form-actions">
          <a class="btn" href="#/orders">Cancel</a>
          <button class="btn primary" disabled=${busy}>${busy ? 'Booking…' : 'Book delivery'}</button>
        </div>
      </form>
    <//>`;
}

// ---------- Order detail ----------

const EVENT_LABELS = {
  created: 'Order booked',
  accepted: 'Driver accepted',
  assigned: 'Driver assigned by dispatch',
  unassigned: 'Driver removed by dispatch',
  stop_arrived: 'Driver arrived',
  stop_completed: 'Completed',
  completed: 'Delivered',
  cancelled: 'Cancelled',
  updated: 'Order updated',
  note_added: 'Note added',
  imported: 'Imported from the old system',
};

function describeEvent(e) {
  const base = EVENT_LABELS[e.type] || e.type;
  if (e.type === 'stop_arrived' && e.data?.type) return `${base} at ${e.data.type === 'pickup' ? 'pickup' : 'drop-off'}`;
  if (e.type === 'stop_completed' && e.data?.type) {
    const who = e.data.printedName ? `, signed by ${e.data.printedName}` : e.data.barcode ? ', barcode scanned' : '';
    return `${e.data.type === 'pickup' ? 'Picked up' : 'Dropped off'}${who}`;
  }
  if (e.type === 'cancelled' && e.data?.reason) return `${base}: ${e.data.reason}`;
  return base;
}

function DispatchPanel({ order, onChange, setError }) {
  const drivers = useApi('/users?role=driver');
  const [driverId, setDriverId] = useState(order.driver?.id || '');
  const [price, setPrice] = useState(order.priceCents == null ? '' : (order.priceCents / 100).toFixed(2));
  const closed = ['completed', 'cancelled'].includes(order.status);
  const active = (drivers.data || []).filter((d) => d.isActive)
    .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || (a.name || a.email).localeCompare(b.name || b.email));
  return html`
    <section class="card">
      <h2>Dispatch</h2>
      <${Field} label="Driver">
        <div class="inline">
          <select value=${driverId} onChange=${(e) => setDriverId(e.target.value)} disabled=${closed}>
            <option value="">Unassigned (open to all drivers)</option>
            ${active.map((d) => html`<option value=${d.id}>${d.isOnline ? '● ' : '○ '}${d.name || d.email}${d.vehicleType ? ` · ${d.vehicleType}` : ''}</option>`)}
          </select>
          <${ActionButton} disabled=${closed || driverId === (order.driver?.id || '')} onError=${setError}
            onClick=${async () => onChange(await api(`/orders/${order.id}/assign`, { method: 'POST', body: { driverId: driverId || null } }))}>
            Save
          <//>
        </div>
      <//>
      <${Field} label="Price (USD)">
        <div class="inline">
          <input type="number" min="0" step="0.01" value=${price} onInput=${(e) => setPrice(e.target.value)} disabled=${closed} />
          <${ActionButton} disabled=${closed} onError=${setError}
            onClick=${async () => onChange(await api(`/orders/${order.id}`, { method: 'PATCH',
              body: { priceCents: price === '' ? null : Math.round(Number(price) * 100) } }))}>
            Save
          <//>
        </div>
      <//>
    </section>`;
}

export function OrderPage({ id }) {
  const user = getUser();
  const staff = isStaff(user);
  const { data: loaded, error: loadError, loading } = useApi(`/orders/${encodeURIComponent(id)}`, { pollMs: 15000 });
  const [override, setOverride] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  // Prefer whichever is newer: the last action's response or the latest poll.
  const order = override && (!loaded || new Date(override.updatedAt) >= new Date(loaded.updatedAt)) ? override : loaded;

  if (loading && !order) return html`<${Layout}><${Spinner} /><//>`;
  if (!order) return html`<${Layout}><${Alert} error=${loadError} /><a href="#/orders">Back to orders</a><//>`;

  const canCancel = staff ? !['completed', 'cancelled'].includes(order.status) : order.status === 'pending';
  const link = order.trackingUrlToken && trackingUrl(order.trackingUrlToken);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copy this tracking link:', link); }
  };

  return html`
    <${Layout}>
      <a class="back" href="#/orders">← Orders</a>
      <${PageHeader}
        title=${html`${order.orderNumber} <${StatusBadge} status=${order.status} />`}
        subtitle=${`Booked ${formatDate(order.createdAt)}${order.organization ? ` · ${order.organization.name}` : ''}`}
        actions=${html`
          ${link && html`<button class="btn" onClick=${copyLink}>${copied ? 'Link copied ✓' : 'Copy tracking link'}</button>`}
          ${canCancel && html`<${ActionButton} class="btn danger" onError=${setError}
            confirmText="Cancel this order? The driver (if any) will be notified."
            onClick=${async () => setOverride(await api(`/orders/${order.id}/cancel`, { method: 'POST', body: {} }))}>Cancel order<//>`}`} />
      <${Alert} error=${error} />
      <div class="detail-grid">
        <div class="stack">
          <section class="card">
            <h2>Route</h2>
            <${StopTimeline} stops=${order.stops} showProof=${true} />
          </section>
          <section class="card">
            <h2>Notes</h2>
            ${order.notes.length === 0 && html`<p class="muted">No notes yet.</p>`}
            <ul class="notes">
              ${order.notes.map((n) => html`<li><p>${n.note}</p><span class="muted small">${n.authorRole ? `${n.authorRole} · ` : ''}${timeAgo(n.createdAt)}</span></li>`)}
            </ul>
            <form class="inline" onSubmit=${async (e) => {
              e.preventDefault();
              if (!note.trim()) return;
              try { setOverride(await api(`/orders/${order.id}/notes`, { method: 'POST', body: { note } })); setNote(''); }
              catch (err) { setError(err); }
            }}>
              <input placeholder="Add a note for dispatch and the driver" value=${note} onInput=${(e) => setNote(e.target.value)} aria-label="New note" />
              <button class="btn">Add</button>
            </form>
          </section>
        </div>
        <div class="stack">
          <section class="card">
            <h2>Driver</h2>
            ${order.driver ? html`
              <p><strong>${order.driver.name || 'Driver'}</strong></p>
              ${order.driver.phoneNumber && html`<p><a href=${`tel:${order.driver.phoneNumber}`}>${order.driver.phoneNumber}</a></p>`}
              ${order.driver.location && html`<p class="small">Last location ${timeAgo(order.driver.locationUpdatedAt)}${' · '}<a href=${mapsLink(order.driver.location)} target="_blank" rel="noopener">open map</a></p>`}`
            : html`<p class="muted">${order.status === 'cancelled' ? 'No driver.' : 'Waiting for a driver to accept.'}</p>`}
          </section>
          ${staff && html`<${DispatchPanel} key=${order.id} order=${order} onChange=${setOverride} setError=${setError} />`}
          <section class="card">
            <h2>Shipment</h2>
            <dl class="facts">
              <dt>Service</dt><dd>${SERVICE_LEVEL_LABELS[order.serviceLevel] || '—'}</dd>
              <dt>Vehicle</dt><dd>${order.vehicleType || '—'}</dd>
              <dt>Weight</dt><dd>${order.weight || '—'}</dd>
              <dt>Pieces</dt><dd>${order.numberOfPieces || '—'}</dd>
              <dt>Pickup time</dt><dd>${order.scheduledAt ? formatDate(order.scheduledAt) : 'ASAP'}</dd>
              <dt>Reference</dt><dd>${order.trackingNumber || '—'}</dd>
              <dt>Distance</dt><dd>${order.distanceMiles != null ? `about ${order.distanceMiles} mi` : '—'}</dd>
              <dt>Price</dt><dd>${formatMoney(order.priceCents)}${order.priceIsCustom ? ' (set by dispatch)' : ''}</dd>
            </dl>
            ${order.priceBreakdown && !order.priceIsCustom && html`<${PriceBreakdown} q=${order.priceBreakdown} />`}
            ${order.description && html`<p class="small">${order.description}</p>`}
          </section>
          <section class="card">
            <h2>History</h2>
            <ol class="events">
              ${order.events.map((e) => html`<li><span>${describeEvent(e)}</span><span class="muted small">${formatDate(e.at)}</span></li>`)}
            </ol>
          </section>
        </div>
      </div>
    <//>`;
}
