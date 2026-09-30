import {
  html, useState, useEffect, api, getUser, isStaff, navigate, useApi, formatDate, timeAgo, formatMoney, mapsLink,
  trackingUrl, ACTIVE_STATUSES, VEHICLE_TYPES, SERVICE_LEVEL_LABELS, PAYMENT_STATUS, startCheckout,
} from './lib.js';
import {
  Layout, PageHeader, Alert, Spinner, Empty, Field, StatusBadge, StopTimeline, RouteSummary, ActionButton, AddressInput, DemoBadge,
} from './components.js';

const FILTERS = [
  { key: 'active', label: 'In progress', statuses: ['pending', ...ACTIVE_STATUSES] },
  { key: 'pending', label: 'Needs driver', statuses: ['pending'] },
  { key: 'quotes', label: 'Quotes', statuses: ['quote'] },
  { key: 'completed', label: 'Delivered', statuses: ['completed'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { key: 'all', label: 'All', statuses: [] },
];

// Admin-only: fill the system with sample companies, drivers, orders and leads, or remove them.
function DemoDataButton({ onChange }) {
  const status = useApi('/demo');
  const loaded = status.data?.loaded;
  const toggle = async () => {
    if (loaded) await api('/demo', { method: 'DELETE' });
    else await api('/demo', { method: 'POST' });
    await status.reload();
    onChange();
  };
  if (!status.data) return null;
  return html`
    <${ActionButton} class="btn"
      confirmText=${loaded
        ? 'Remove all demo data? Only records marked "Demo" are deleted; your real data is not touched.'
        : 'Load demo data? This adds sample companies, drivers, orders and leads, all marked "Demo". Real drivers never see demo orders, and you can remove it all with one click.'}
      onClick=${toggle}>
      ${loaded ? 'Remove demo data' : 'Load demo data'}
    <//>`;
}

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
  const { data, error, loading, reload } = useApi(path, { pollMs: 30000 });
  const q = search.trim().toLowerCase();
  const rows = (data || []).filter((o) => !q || [o.orderNumber, o.trackingNumber, o.organization?.name, o.driver?.name,
    ...o.stops.map((s) => `${s.address} ${s.contactName}`)].join(' ').toLowerCase().includes(q));

  return html`
    <${Layout}>
      ${isStaff(user) ? html`
        <${PageHeader} title="Orders" subtitle="Every order across all companies."
          actions=${html`${user.role === 'admin' && html`<${DemoDataButton} onChange=${reload} />`}<${WeatherSwitch} /><a class="btn primary" href="#/orders/new">+ New order</a>`} />` : html`
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
          ${filter === 'active' ? 'New orders you book will show up here.'
            : filter === 'quotes' ? 'Use "Save quote" on a new order to keep a price and book it later.' : 'Try a different filter.'}
        <//>` : html`
        <div class="table-wrap">
          <table class="orders">
            <thead><tr>
              <th>Order</th><th>Route</th>${isStaff(user) && html`<th>Company</th>`}<th>Driver</th><th>Status</th><th>Booked</th>
            </tr></thead>
            <tbody>
              ${rows.map((o) => html`
                <tr class="clickable" onClick=${() => navigate(`/orders/${o.id}`)}>
                  <td data-label="Order"><a class="nowrap" href=${`#/orders/${o.id}`} onClick=${(e) => e.stopPropagation()}><strong>${o.orderNumber}</strong></a><${DemoBadge} on=${o.isDemo} />
                    <div class="muted small">${o.serviceLevel === 'rush' ? 'Rush · ' : ''}${o.vehicleType}</div></td>
                  <td data-label="Route"><${RouteSummary} stops=${o.stops} /></td>
                  ${isStaff(user) && html`<td data-label="Company">${o.organization?.name || html`<span class="muted">Internal</span>`}</td>`}
                  <td data-label="Driver">${o.driver?.name || html`<span class="muted">—</span>`}</td>
                  <td data-label="Status"><${StatusBadge} status=${o.status} />${o.status === 'quote' && o.reviewStatus !== 'needed' && html` <span class="muted small nowrap">${formatMoney(o.priceCents)}</span>`}${o.paymentStatus === 'unpaid' && o.status !== 'cancelled' && html` <span class="badge amber">Unpaid</span>`}${o.balanceDueCents > 0 && html` <span class="badge amber">Balance due</span>`}${o.reviewStatus === 'needed' && html` <span class="badge amber">Needs price</span>`}</td>
                  <td data-label="Booked" class="muted small">${o.status === 'quote' ? `Saved ${formatDate(o.createdAt)}` : formatDate(o.bookedAt || o.createdAt)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>`}
    <//>`;
}

// ---------- New order ----------

const blankStop = (type) => ({ type, address: '', location: null, contactName: '', contactPhone: '', instructions: '' });

// Live quote from the server (same formula used when the order is booked).
function useQuote(stops, serviceLevel, scheduledAt, weightLbs, addOns, vehicleType) {
  const [quote, setQuote] = useState(null);
  const key = JSON.stringify([stops.map((s) => [s.address, s.location]), serviceLevel, scheduledAt, weightLbs, addOns, vehicleType]);
  useEffect(() => {
    if (stops.some((s) => !s.address.trim() && !s.location)) { setQuote(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = await api('/public/quote', { method: 'POST', body: {
          stops: stops.map((s) => ({ address: s.address, location: s.location || undefined })), serviceLevel,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          weightLbs: weightLbs === '' ? undefined : Number(weightLbs), addOns, vehicleType,
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
      ${q.vehicleFeeCents > 0 && html`<dt>${q.vehicleType}</dt><dd>+${formatMoney(q.vehicleFeeCents)}</dd>`}
      ${q.extraMileageCents > 0 && html`<dt>Distance fee (${q.extraMiles} mi × ${formatMoney(q.perMileCents)})</dt><dd>+${formatMoney(q.extraMileageCents)}</dd>`}
      ${q.rushFeeCents > 0 && html`<dt>Rush delivery</dt><dd>+${formatMoney(q.rushFeeCents)}</dd>`}
      ${q.weightFeeCents > 0 && html`<dt>Weight (${q.weightTier})</dt><dd>+${formatMoney(q.weightFeeCents)}</dd>`}
      ${q.extraStopsCents > 0 && html`<dt>Extra stops (${q.extraStops})</dt><dd>+${formatMoney(q.extraStopsCents)}</dd>`}
      ${(q.addOns || []).map((a) => html`<dt>${a.label}</dt><dd>+${formatMoney(a.cents)}</dd>`)}
      ${(q.surcharges || []).map((sc) => html`<dt>${sc.label}</dt><dd>+${formatMoney(sc.cents)}</dd>`)}
      <dt class="total">Total</dt><dd class="total">${formatMoney(q.totalCents)}</dd>
    </dl>`;
}

// What can be charged after booking, shown before the customer books (like Curri's accessorial policy).
export function ChargesNotice({ fees }) {
  return html`
    <section class="card notice">
      <h2>Good to know: possible extra charges</h2>
      <ul class="small">
        <li><strong>Wait time:</strong> the first ${fees.waitFreeMinutes} minutes at each stop are free. After that it's ${formatMoney(fees.waitBlockCents)}
          per ${fees.waitBlockMinutes} minutes, so please have the shipment and the receiver ready.</li>
        <li><strong>Weight:</strong> the price uses the weight you enter. If the shipment is heavier, the difference can be charged.</li>
        <li><strong>Loading help and stairs:</strong> if the driver has to load, unload or carry items inside and it wasn't
          booked, it can be added (${formatMoney(fees.addOns.loading_help?.cents)} / ${formatMoney(fees.addOns.inside_delivery?.cents)}).</li>
        <li><strong>Return trips and failed attempts:</strong> if no one is available, the location is closed, or items must go back to the pickup.</li>
      </ul>
      <p class="small muted">We email you the reason and amount with any additional charge.</p>
    </section>`;
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
    serviceLevel: 'standard', vehicleType: 'Car', weightLbs: '', numberOfPieces: '', description: '', trackingNumber: '',
    scheduledAt: '', organizationId: '', price: '', addOns: [],
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (name) => ({ value: v[name], onInput: (e) => setV({ ...v, [name]: e.target.value }) });
  const quote = useQuote(stops, v.serviceLevel, v.scheduledAt, v.weightLbs, v.addOns, v.vehicleType);
  const fees = pricing.data?.fees;
  const vehicles = fees ? Object.entries(fees.vehicles).filter(([, x]) => x.enabled) : [];
  const lbs = v.weightLbs === '' ? null : Number(v.weightLbs);
  const tooHeavyFor = (x) => lbs != null && lbs > x.maxLbs;
  const needsReview = quote?.needsReview;
  const toggleAddOn = (k) => setV({ ...v, addOns: v.addOns.includes(k) ? v.addOns.filter((x) => x !== k) : [...v.addOns, k] });
  const payments = useApi('/payments/config');
  const payByCard = !staff && payments.data?.enabled && user.organization?.billingMode !== 'invoice';

  // Books the order, or with saveAsQuote keeps it as a quote to book (and pay for) later.
  const submit = async (e, saveAsQuote = false) => {
    e.preventDefault();
    const form = e.target.closest('form');
    if (saveAsQuote && form && !form.reportValidity()) return;
    setError(null);
    if (stops[0].type !== 'pickup' || stops[stops.length - 1].type !== 'dropoff') {
      setError(new Error('The first stop must be a pickup and the last stop a drop-off.'));
      return;
    }
    setBusy(true);
    try {
      const body = {
        serviceLevel: v.serviceLevel, vehicleType: v.vehicleType, weight: v.weightLbs === '' ? '' : `${v.weightLbs} lbs`,
        addOns: v.addOns, numberOfPieces: v.numberOfPieces, description: v.description,
        trackingNumber: v.trackingNumber || undefined,
        scheduledAt: v.scheduledAt ? new Date(v.scheduledAt).toISOString() : undefined,
        stops,
        saveAsQuote,
      };
      if (staff) {
        if (v.organizationId) body.organizationId = v.organizationId;
        if (v.price !== '') body.priceCents = Math.round(Number(v.price) * 100);
      }
      const order = await api('/orders', { method: 'POST', body });
      if (!saveAsQuote && order.paymentStatus === 'unpaid') {
        // Card customers go straight to Stripe's secure payment page.
        try { await startCheckout(order.id); return; } catch { /* fall through to the order page's Pay button */ }
      }
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
          <div class="field">
            <span class="field-label">Vehicle</span>
            <div class="choice-grid" role="radiogroup" aria-label="Vehicle">
              ${vehicles.map(([name, x]) => html`
                <label class=${`choice ${v.vehicleType === name ? 'selected' : ''} ${tooHeavyFor(x) ? 'unfit' : ''}`}>
                  <input type="radio" name="vehicleType" value=${name} checked=${v.vehicleType === name}
                    onChange=${() => setV({ ...v, vehicleType: name })} />
                  <span><strong>${name}</strong>
                    <span class="muted small">${x.description} · up to ${x.maxLbs.toLocaleString()} lbs · ${formatMoney(x.perMileCents)}/mi after ${pricing.data.baseMiles} mi</span>
                    ${tooHeavyFor(x) && html`<span class="small warn-text">Too heavy for this vehicle</span>`}</span>
                  <span class="price push">${x.feeCents ? `+${formatMoney(x.feeCents)}` : 'Base'}</span>
                </label>`)}
            </div>
          </div>
          ${fees && html`
            <div class="field">
              <span class="field-label">Extras</span>
              <div class="choice-grid">
                ${Object.entries(fees.addOns).map(([k, a]) => html`
                  <label class=${`choice ${v.addOns.includes(k) ? 'selected' : ''}`}>
                    <input type="checkbox" checked=${v.addOns.includes(k)} onChange=${() => toggleAddOn(k)} />
                    <span><strong>${a.label}</strong><span class="muted small">${a.description}</span></span>
                    <span class="price push">+${formatMoney(a.cents)}</span>
                  </label>`)}
              </div>
            </div>`}
          <div class="estimate">
            <div class="estimate-head">
              <span><strong>Estimated price</strong>${quote?.distanceMiles != null ? html`<span class="muted"> · about ${quote.distanceMiles} miles</span>` : ''}</span>
              <span class="price">${needsReview ? 'Custom' : quote ? formatMoney(quote.totalCents) : '—'}</span>
            </div>
            ${needsReview ? html`<div class="alert warn" role="status"><strong>We'll price this one by hand:</strong>
                ${' '}${quote.reviewReasons.join('. ')}. ${vehicles.some(([, x]) => !tooHeavyFor(x)) && lbs != null && lbs <= Math.max(...vehicles.map(([, x]) => x.maxLbs))
                  ? 'Pick a bigger vehicle above, or send it for review.' : 'Send it to us and we\'ll email you a price, usually within a business hour. Nothing is charged until you accept it.'}</div>`
            : quote ? html`<${PriceBreakdown} q=${quote} />
              <p class="muted small">${quote.note}</p>`
              : html`<p class="muted small">Enter the addresses to see your price.</p>`}
            ${staff && html`<p class="muted small">Dispatch can set a custom price below.</p>`}
            ${payByCard && html`<p class="small"><strong>Payment:</strong> you'll pay by card on Stripe's secure page after booking. Drivers are notified once it's paid.</p>`}
            ${!needsReview && html`<p class="muted small">Not ready yet? <strong>Save quote</strong> keeps this order under Orders → Quotes so you can book${payByCard ? ' and pay' : ''} later.</p>`}
          </div>
        </section>
        <section class="card">
          <h2>Shipment</h2>
          <div class="grid-2">
            <${Field} label="Pickup time" hint="Leave empty for as soon as possible.">
              <input type="datetime-local" ...${bind('scheduledAt')} />
            <//>
            <${Field} label="Total weight (lbs)" hint=${fees ? `Priced by weight: ${fees.weightTiers.map((t) => `up to ${t.upToLbs.toLocaleString()} lbs ${t.cents ? `+${formatMoney(t.cents)}` : 'included'}`).join(', ')}; heavier gets a custom price.` : undefined}>
              <input type="number" min="1" step="1" required inputmode="numeric" placeholder="e.g. 120" ...${bind('weightLbs')} />
            <//>
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
        ${fees && html`<${ChargesNotice} fees=${fees} />`}
        <div class="form-actions">
          <a class="btn" href="#/orders">Cancel</a>
          ${!needsReview && html`<button type="button" class="btn" disabled=${busy} onClick=${(e) => submit(e, true)}
            title="Keep this price and book it later from Orders → Quotes">Save quote</button>`}
          <button class="btn primary" disabled=${busy}>${busy ? 'Sending…' : needsReview ? 'Request a price' : payByCard ? 'Book & pay' : 'Book delivery'}</button>
        </div>
      </form>
    <//>`;
}

// ---------- Order detail ----------

const EVENT_LABELS = {
  quoted: 'Quote saved',
  review_requested: 'Sent for a custom price',
  price_set: 'Price set by dispatch',
  charge_added: 'Additional charge added',
  charge_waived: 'Additional charge removed',
  charges_paid: 'Additional charges paid',
  repriced: 'Price updated',
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
      ${order.status !== 'quote' && html`<${Field} label="Driver">
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
      <//>`}
      <${Field} label="Price (USD)" hint=${order.reviewStatus === 'needed' ? 'Saving a price sends it to the customer to book.'
        : order.status === 'quote' ? 'A custom price is kept when the customer books this quote.' : undefined}>
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

// Payment status and actions: shippers pay by card; dispatch records cash/check or waives.
function PaymentPanel({ order, onChange, setError }) {
  const user = getUser();
  const staff = isStaff(user);
  const payments = useApi('/payments/config');
  const justPaid = location.hash.includes('paid=1');
  const st = PAYMENT_STATUS[order.paymentStatus] || { label: order.paymentStatus, tone: 'gray' };
  const record = (status, method) => async () =>
    onChange(await api(`/orders/${order.id}/payment`, { method: 'POST', body: { status, method } }));
  const cancelled = order.status === 'cancelled';
  return html`
    <section class="card">
      <h2>Payment <span class=${`badge ${st.tone}`}>${st.label}</span></h2>
      <dl class="facts">
        <dt>Price</dt><dd>${formatMoney(order.priceCents)}</dd>
        ${order.paidCents != null && html`<dt>Paid</dt><dd>${formatMoney(order.paidCents)}${order.paymentMethod ? ` · ${order.paymentMethod}` : ''}${order.paidAt ? ` · ${formatDate(order.paidAt)}` : ''}</dd>`}
        ${order.refundedCents != null && html`<dt>Refunded</dt><dd>${formatMoney(order.refundedCents)}</dd>`}
      </dl>
      ${order.paymentStatus === 'unpaid' && !cancelled && html`
        ${justPaid
          ? html`<p class="small">Thanks! We're confirming your payment with Stripe; this updates automatically.</p>`
          : html`<p class="small">Drivers are notified as soon as this order is paid.</p>`}
        ${payments.data?.enabled && !justPaid && html`
          <${ActionButton} class="btn primary block" onError=${setError} onClick=${() => startCheckout(order.id)}>
            Pay ${formatMoney(order.priceCents)} by card
          <//>`}`}
      ${staff && !cancelled && html`
        <div class="actions">
          ${order.paymentStatus !== 'paid' && html`
            <${ActionButton} class="btn small" onError=${setError} onClick=${record('paid', 'cash')}>Paid in cash<//>
            <${ActionButton} class="btn small" onError=${setError} onClick=${record('paid', 'check')}>Paid by check<//>`}
          ${order.paymentStatus !== 'invoice' && order.paymentMethod !== 'card' && html`
            <${ActionButton} class="btn small" onError=${setError} onClick=${record('invoice')}>Bill to account<//>`}
          ${order.paymentStatus !== 'waived' && order.paymentMethod !== 'card' && html`
            <${ActionButton} class="btn small" onError=${setError} confirmText="Deliver this order at no charge?" onClick=${record('waived')}>No charge<//>`}
        </div>
        ${order.paymentMethod === 'card' && html`<p class="muted small">Paid by card. Cancelling the order refunds the card automatically.</p>`}`}
    </section>`;
}

const ADD_ON_LABELS = { loading_help: 'Loading/unloading help', inside_delivery: 'Inside delivery / stairs' };
const CHARGE_STATUS = {
  due: { label: 'Due', tone: 'amber' }, paid: { label: 'Paid', tone: 'green' },
  invoice: { label: 'On account', tone: 'blue' }, waived: { label: 'Removed', tone: 'gray' },
};

// Same rule as the server: free minutes, then each started block is billed.
const waitCents = (minutes, fees) =>
  Math.ceil(Math.max(0, minutes - fees.waitFreeMinutes) / fees.waitBlockMinutes) * fees.waitBlockCents;

// Charges added after booking. Customers see why and can pay a balance by card; dispatch adds or removes
// charges, with one-click wait-time charges worked out from when the driver arrived and finished each stop.
function ChargesPanel({ order, onChange, setError }) {
  const user = getUser();
  const staff = isStaff(user);
  const pricing = useApi('/public/pricing');
  const payments = useApi('/payments/config');
  const [form, setForm] = useState({ kind: 'wait_time', minutes: '', amount: '', stopId: '', description: '' });
  const fees = pricing.data?.fees;
  const kinds = pricing.data?.chargeKinds || {};
  const charges = order.charges || [];
  if (!staff && !charges.length) return null;
  const add = (body) => async () => onChange(await api(`/orders/${order.id}/charges`, { method: 'POST', body }));
  const dwell = (s) => (s.arrivedAt && s.completedAt ? Math.round((new Date(s.completedAt) - new Date(s.arrivedAt)) / 60000) : null);
  const suggestions = !staff || !fees ? [] : order.stops
    .map((s, i) => ({ s, i, minutes: dwell(s) }))
    .filter(({ s, minutes }) => minutes != null && waitCents(minutes, fees) > 0
      && !charges.some((c) => c.kind === 'wait_time' && c.stopId === s.id && c.status !== 'waived'));
  const preview = form.kind === 'wait_time' && form.amount === '' && form.minutes !== '' && fees ? waitCents(Number(form.minutes), fees) : null;
  const submit = async (e) => {
    e.preventDefault();
    try {
      onChange(await api(`/orders/${order.id}/charges`, { method: 'POST', body: {
        kind: form.kind, minutes: form.minutes === '' ? undefined : Number(form.minutes),
        cents: form.amount === '' ? undefined : Math.round(Number(form.amount) * 100),
        stopId: form.stopId || undefined, description: form.description,
      } }));
      setForm({ ...form, minutes: '', amount: '', description: '' });
    } catch (err) { setError(err); }
  };
  const stopName = (id) => {
    const i = order.stops.findIndex((s) => s.id === id);
    return i < 0 ? '' : `${order.stops[i].type === 'pickup' ? 'Pickup' : 'Drop-off'} ${i + 1}`;
  };
  return html`
    <section class="card">
      <h2>Additional charges${order.balanceDueCents > 0 && html` <span class="badge amber">${formatMoney(order.balanceDueCents)} due</span>`}</h2>
      ${charges.length === 0 ? html`<p class="muted small">None.</p>` : html`
        <ul class="charges">
          ${charges.map((c) => {
            const st = CHARGE_STATUS[c.status] || { label: c.status, tone: 'gray' };
            return html`<li class=${c.status === 'waived' ? 'waived' : ''}>
              <div><strong>${kinds[c.kind] || c.kind}</strong>${c.minutes != null ? ` · ${c.minutes} min` : ''}${c.stopId ? ` · ${stopName(c.stopId)}` : ''}
                ${c.description && html`<div class="muted small">${c.description}</div>`}</div>
              <div class="push nowrap">${formatMoney(c.cents)} <span class=${`badge ${st.tone}`}>${st.label}</span>
                ${staff && ['due', 'invoice'].includes(c.status) && html` <${ActionButton} class="btn small" onError=${setError}
                  confirmText="Remove this charge?" onClick=${async () => onChange(await api(`/orders/${order.id}/charges/${c.id}/waive`, { method: 'POST' }))}>Remove<//>`}</div>
            </li>`;
          })}
        </ul>`}
      ${order.balanceDueCents > 0 && !staff && payments.data?.enabled && html`
        <${ActionButton} class="btn primary block" onError=${setError} onClick=${() => startCheckout(order.id)}>
          Pay ${formatMoney(order.balanceDueCents)} by card
        <//>`}
      ${staff && !['quote', 'cancelled'].includes(order.status) && html`
        ${suggestions.map(({ s, i, minutes }) => html`
          <${ActionButton} class="btn small block" onError=${setError}
            onClick=${add({ kind: 'wait_time', minutes, stopId: s.id, description: `Waited ${minutes} min at ${s.type === 'pickup' ? 'pickup' : 'drop-off'}` })}>
            + Wait time at ${s.type === 'pickup' ? 'pickup' : 'drop-off'} ${i + 1}: ${minutes} min → ${formatMoney(waitCents(minutes, fees))}
          <//>`)}
        <details class="add-charge">
          <summary>Add a charge</summary>
          <form class="stack" onSubmit=${submit}>
            <div class="grid-2">
              <${Field} label="Reason">
                <select value=${form.kind} onChange=${(e) => setForm({ ...form, kind: e.target.value })}>
                  ${Object.entries(kinds).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
                </select>
              <//>
              <${Field} label="Stop">
                <select value=${form.stopId} onChange=${(e) => setForm({ ...form, stopId: e.target.value })}>
                  <option value="">—</option>
                  ${order.stops.map((s, i) => html`<option value=${s.id}>${s.type === 'pickup' ? 'Pickup' : 'Drop-off'} ${i + 1}</option>`)}
                </select>
              <//>
              ${form.kind === 'wait_time' && html`<${Field} label="Minutes waited" hint=${preview != null ? `= ${formatMoney(preview)}` : fees ? `First ${fees.waitFreeMinutes} free, then ${formatMoney(fees.waitBlockCents)} per ${fees.waitBlockMinutes} min` : undefined}>
                <input type="number" min="0" step="1" value=${form.minutes} onInput=${(e) => setForm({ ...form, minutes: e.target.value })} /><//>`}
              <${Field} label="Amount ($)" hint=${form.kind === 'wait_time' ? 'Leave empty to use the wait-time rate.' : undefined}>
                <input type="number" min="0" step="0.01" value=${form.amount} onInput=${(e) => setForm({ ...form, amount: e.target.value })} /><//>
            </div>
            <${Field} label="Note for the customer"><input maxlength="300" placeholder="e.g. Receiver's office was closed until 2pm" value=${form.description}
              onInput=${(e) => setForm({ ...form, description: e.target.value })} /><//>
            <button class="btn">Add charge</button>
            <p class="muted small">The customer is emailed the reason and amount. Card customers pay it online; monthly accounts are billed.</p>
          </form>
        </details>`}
    </section>`;
}

// A saved quote: book it (card customers then pay) or delete it. The price is rechecked on booking;
// if it changed, the server updates the quote and asks the customer to confirm the new price.
function QuotePanel({ order, onChange, setError }) {
  const user = getUser();
  const payments = useApi('/payments/config');
  const payByCard = user.role === 'shipper' && payments.data?.enabled && user.organization?.billingMode !== 'invoice';
  const [notice, setNotice] = useState(null);
  const book = async () => {
    setNotice(null);
    try {
      const booked = await api(`/orders/${order.id}/book`, { method: 'POST', body: { expectedCents: order.priceCents } });
      if (booked.paymentStatus === 'unpaid') {
        try { await startCheckout(booked.id); return; } catch { /* the Pay button on the order page still works */ }
      }
      onChange(booked);
    } catch (err) {
      if (err.data?.priceChanged) { onChange(err.data.order); setNotice(err.message); return; }
      throw err;
    }
  };
  if (order.reviewStatus === 'needed') {
    const reasons = order.priceBreakdown?.reviewReasons || [];
    return html`
      <section class="card">
        <h2>Price request <span class="badge amber">Needs price</span></h2>
        <p class="small"><strong>Why:</strong> ${reasons.join('; ') || 'Needs a custom price'}.</p>
        ${isStaff(user)
          ? html`<p class="small muted">Set the price under <strong>Dispatch → Price</strong>. The customer is emailed and can then book${payByCard ? ' and pay' : ''}.</p>`
          : html`<p class="small muted">We're reviewing this shipment and will email you the price, usually within a business hour. Nothing is booked or charged until you accept it.</p>`}
      </section>`;
  }
  return html`
    <section class="card">
      <h2>${order.reviewStatus === 'done' ? 'Your price is ready' : 'Saved quote'}</h2>
      <dl class="facts">
        <dt>Quoted price</dt><dd><strong>${formatMoney(order.priceCents)}</strong></dd>
        <dt>Saved</dt><dd>${formatDate(order.createdAt)}</dd>
      </dl>
      ${notice ? html`<div class="alert warn" role="status">${notice}</div>`
        : html`<p class="small muted">Not booked yet, so no driver has been notified. The price is rechecked when you book (time of day, weekend, demand and weather can change it)${order.scheduledAt ? '; if the pickup time has passed, it\'s booked for as soon as possible' : ''}.</p>`}
      <${ActionButton} class="btn primary block" onError=${setError} onClick=${book}>
        ${notice ? `Book at ${formatMoney(order.priceCents)}` : payByCard ? `Book & pay ${formatMoney(order.priceCents)}` : `Book for ${formatMoney(order.priceCents)}`}
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

  const isQuote = order.status === 'quote';
  const awaitingPrice = order.reviewStatus === 'needed';
  const canCancel = !isQuote && (staff ? !['completed', 'cancelled'].includes(order.status) : order.status === 'pending');
  const link = order.trackingUrlToken && trackingUrl(order.trackingUrlToken);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copy this tracking link:', link); }
  };

  return html`
    <${Layout}>
      <a class="back" href="#/orders">← Orders</a>
      <${PageHeader}
        title=${html`${order.orderNumber} ${awaitingPrice ? html`<span class="badge amber">Waiting for price</span>` : html`<${StatusBadge} status=${order.status} />`}<${DemoBadge} on=${order.isDemo} />`}
        subtitle=${`${isQuote ? 'Quote saved' : 'Booked'} ${formatDate(isQuote ? order.createdAt : order.bookedAt || order.createdAt)}${order.organization ? ` · ${order.organization.name}` : ''}`}
        actions=${html`
          ${link && html`<button class="btn" onClick=${copyLink}>${copied ? 'Link copied ✓' : 'Copy tracking link'}</button>`}
          ${canCancel && html`<${ActionButton} class="btn danger" onError=${setError}
            confirmText="Cancel this order? The driver (if any) will be notified."
            onClick=${async () => setOverride(await api(`/orders/${order.id}/cancel`, { method: 'POST', body: {} }))}>Cancel order<//>`}
          ${isQuote && html`<${ActionButton} class="btn danger" onError=${setError} confirmText="Delete this saved quote?"
            onClick=${async () => { await api(`/orders/${order.id}`, { method: 'DELETE' }); navigate('/orders'); }}>${awaitingPrice ? 'Cancel request' : 'Delete quote'}<//>`}`} />
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
          ${isQuote ? html`<${QuotePanel} order=${order} onChange=${setOverride} setError=${setError} />`
            : html`<${PaymentPanel} order=${order} onChange=${setOverride} setError=${setError} />
              <${ChargesPanel} order=${order} onChange=${setOverride} setError=${setError} />`}
          ${!isQuote && html`<section class="card">
            <h2>Driver</h2>
            ${order.driver ? html`
              <p><strong>${order.driver.name || 'Driver'}</strong></p>
              ${order.driver.phoneNumber && html`<p><a href=${`tel:${order.driver.phoneNumber}`}>${order.driver.phoneNumber}</a></p>`}
              ${order.driver.location && html`<p class="small">Last location ${timeAgo(order.driver.locationUpdatedAt)}${' · '}<a href=${mapsLink(order.driver.location)} target="_blank" rel="noopener">open map</a></p>`}`
            : html`<p class="muted">${order.status === 'cancelled' ? 'No driver.' : 'Waiting for a driver to accept.'}</p>`}
          </section>`}
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
              <dt>Extras</dt><dd>${order.addOns.length ? order.addOns.map((k) => ADD_ON_LABELS[k] || k).join(', ') : '—'}</dd>
              <dt>Distance</dt><dd>${order.distanceMiles != null ? `about ${order.distanceMiles} mi` : '—'}</dd>
              <dt>Price</dt><dd>${awaitingPrice ? 'Waiting for our price' : `${formatMoney(order.priceCents)}${order.priceIsCustom ? ' (set by dispatch)' : ''}`}</dd>
            </dl>
            ${order.priceBreakdown && !order.priceIsCustom && !awaitingPrice && html`<${PriceBreakdown} q=${order.priceBreakdown} />`}
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
