// Gig routes (#/gig): import the stops of a gig-app route (Amazon Flex, Spark, DoorDash...) from screenshots or
// pasted text, work through them on a map next to Choice Delivery jobs, and log each shift's pay and miles.
// The gig app stays in charge of the delivery itself (scans, photos, completion).
import { html, useState, useEffect, useRef, api, useApi, formatMoney } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Field, ActionButton } from './components.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const navUrl = (address) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
// Google Maps takes up to 9 stops on the way to the destination.
function multiStopUrl(stops) {
  const next = stops.slice(0, 10);
  if (!next.length) return null;
  const dest = next[next.length - 1].address;
  const via = next.slice(0, -1).map((s) => s.address).join('|');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}${via ? `&waypoints=${encodeURIComponent(via)}` : ''}&travelmode=driving`;
}

// Screenshots are shrunk on the phone so they upload quickly; tall ones stay readable.
function readScreenshot(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Pick screenshots (photos), not other files'));
      img.onload = () => {
        const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const here = () => new Promise((resolve) => {
  if (!navigator.geolocation) { resolve(null); return; }
  navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
});

// Gig stops (numbered, gray when done) and Choice Delivery jobs (orange) on one map.
function GigMap({ stops, jobs }) {
  const el = useRef(null);
  const m = useRef({});
  const draw = () => {
    const { L, map, layer } = m.current;
    if (!L) return;
    layer.clearLayers();
    const pts = [];
    stops.forEach((s, i) => {
      if (!s.location) return;
      L.marker([s.location.lat, s.location.lng], {
        title: s.address,
        icon: L.divIcon({ className: `map-pin gig ${s.doneAt ? 'done' : ''}`, html: String(i + 1), iconSize: [28, 28] }),
      }).addTo(layer);
      pts.push([s.location.lat, s.location.lng]);
    });
    for (const j of jobs) {
      L.marker([j.location.lat, j.location.lng], {
        title: `${j.orderNumber} ${j.type === 'pickup' ? 'pickup' : 'drop-off'}: ${j.address}`,
        icon: L.divIcon({ className: `map-pin choice ${j.mine ? 'mine' : ''}`, html: 'C', iconSize: [28, 28] }),
      }).addTo(layer);
      pts.push([j.location.lat, j.location.lng]);
    }
    const key = pts.length;
    if (pts.length && m.current.fitted !== key) {
      m.current.fitted = key;
      if (pts.length === 1) map.setView(pts[0], 14); else map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    }
  };
  useEffect(() => {
    let alive = true;
    import('./vendor/leaflet.js').then((L) => {
      if (!alive || !el.current) return;
      const map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      m.current = { L, map, layer: L.layerGroup().addTo(map) };
      draw();
    }).catch(() => {});
    return () => { alive = false; m.current.map?.remove(); m.current = {}; };
  }, []);
  useEffect(draw, [JSON.stringify(stops.map((s) => [s.location, s.doneAt])), jobs.length]);
  return html`<div class="live-map gig-map" ref=${el} role="img" aria-label="Map of the gig stops and Choice Delivery jobs"></div>`;
}

function ImportRoute({ apps, aiEnabled, onCreated }) {
  const [app, setApp] = useState(apps[0]);
  const [shots, setShots] = useState([]);
  const [text, setText] = useState('');
  const [stops, setStops] = useState(null); // read, waiting to be checked
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const pick = async (e) => {
    setError(null);
    try { setShots([...shots, ...(await Promise.all([...e.target.files].slice(0, 10 - shots.length).map(readScreenshot)))]); } catch (err) { setError(err); }
    setFileKey(fileKey + 1);
  };
  const read = async () => {
    setError(null); setBusy(true);
    try {
      const r = await api('/gig/extract', { method: 'POST', body: { images: shots, text } });
      if (r.app) setApp(r.app);
      setStops(r.stops.length ? r.stops : [{ address: '', note: '' }]);
      if (!r.stops.length) setError(new Error("No addresses found. Try a clearer screenshot of the stop list, or type them in."));
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const start = async () => {
    setError(null); setBusy(true);
    try {
      await api('/gig/routes', { method: 'POST', body: { app, stops: stops.filter((s) => s.address.trim()) } });
      setShots([]); setText(''); setStops(null); onCreated();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const edit = (i, patch) => setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return html`
    <section class="card stack">
      <h2>Import a route</h2>
      <${Alert} error=${error} />
      ${!stops ? html`
        <p class="small muted">Screenshot the stop list in your gig app (scroll and take more if it's long), then pick them here.${' '}
          ${aiEnabled ? '' : 'Reading screenshots isn\'t switched on yet, so paste or type the addresses for now.'}</p>
        <${Field} label="App"><select value=${app} onChange=${(e) => setApp(e.target.value)}>${apps.map((a) => html`<option>${a}</option>`)}</select><//>
        ${aiEnabled && html`<${Field} label="Screenshots" hint=${shots.length ? `${shots.length} added` : 'Up to 10.'}>
          <input key=${fileKey} type="file" accept="image/*" multiple onChange=${pick} /><//>
          ${shots.length > 0 && html`<div class="shot-row">${shots.map((s, i) => html`<button type="button" class="shot" title="Remove"
            onClick=${() => setShots(shots.filter((_, j) => j !== i))}><img src=${s} alt=${`Screenshot ${i + 1}`} /><span>✕</span></button>`)}</div>`}`}
        <${Field} label=${aiEnabled ? 'Or paste the stops (optional)' : 'Addresses, one per line'}>
          <textarea rows="4" placeholder=${'123 Main St, Columbia SC 29201\n456 Oak Ave, Lexington SC 29072'} value=${text} onInput=${(e) => setText(e.target.value)}></textarea><//>
        <div><button type="button" class="btn primary" disabled=${busy || (!shots.length && !text.trim())} onClick=${read}>${busy ? 'Reading…' : 'Read stops'}</button></div>`
      : html`
        <p class="small">Check the stops (fix any address that looks off), then start the route.</p>
        <ol class="gig-edit">${stops.map((s, i) => html`<li key=${i}>
          <input aria-label=${`Stop ${i + 1} address`} value=${s.address} onInput=${(e) => edit(i, { address: e.target.value })} />
          ${s.note && html`<span class="muted small">${s.note}</span>`}
          <button type="button" class="icon-btn" aria-label="Remove stop" onClick=${() => setStops(stops.filter((_, j) => j !== i))}>✕</button>
        </li>`)}</ol>
        <div class="inline">
          <button type="button" class="btn" onClick=${() => setStops([...stops, { address: '', note: '' }])}>+ Add a stop</button>
          <button type="button" class="btn" onClick=${() => setStops(null)}>Start over</button>
          <button type="button" class="btn primary push" disabled=${busy || !stops.some((s) => s.address.trim())} onClick=${start}>
            ${busy ? 'Saving…' : `Start route (${stops.filter((s) => s.address.trim()).length} stops)`}</button>
        </div>`}
    </section>`;
}

function ShiftForm({ apps, preset, onSaved }) {
  const blank = { day: today(), app: apps[0], hours: '', pay: '', tips: '', miles: '', stops: '', note: '' };
  const [v, setV] = useState({ ...blank, ...preset });
  useEffect(() => { if (preset) setV({ ...blank, ...preset }); }, [JSON.stringify(preset)]);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const bind = (k) => ({ value: v[k], onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault();
    setError(null); setSaved(false);
    try {
      await api('/gig/shifts', { method: 'POST', body: {
        day: v.day, app: v.app, hours: v.hours, miles: v.miles, stops: v.stops, note: v.note,
        payCents: Math.round(Number(v.pay || 0) * 100), tipsCents: Math.round(Number(v.tips || 0) * 100),
      } });
      setV(blank); setSaved(true); onSaved();
    } catch (err) { setError(err); }
  };
  return html`
    <form class="card stack" onSubmit=${submit} id="shift-form">
      <h2>Log a shift</h2>
      <p class="small muted">From the earnings screen in the app. It goes on your Expenses page as gig income.</p>
      <${Alert} error=${error} />
      ${saved && html`<${Alert} tone="success">Shift saved.<//>`}
      <div class="grid-2">
        <${Field} label="Date"><input type="date" required max=${today()} ...${bind('day')} /><//>
        <${Field} label="App"><select value=${v.app} onChange=${(e) => setV({ ...v, app: e.target.value })}>${apps.map((a) => html`<option>${a}</option>`)}</select><//>
        <${Field} label="Pay ($)"><input type="number" min="0" step="0.01" inputmode="decimal" required ...${bind('pay')} /><//>
        <${Field} label="Tips ($)"><input type="number" min="0" step="0.01" inputmode="decimal" ...${bind('tips')} /><//>
        <${Field} label="Hours"><input type="number" min="0" max="24" step="0.25" inputmode="decimal" ...${bind('hours')} /><//>
        <${Field} label="Miles" hint="Filled in from the route; check your odometer or mileage log."><input type="number" min="0" step="0.1" inputmode="decimal" ...${bind('miles')} /><//>
        <${Field} label="Stops"><input type="number" min="0" step="1" inputmode="numeric" ...${bind('stops')} /><//>
        <${Field} label="Note (optional)"><input maxlength="300" ...${bind('note')} /><//>
      </div>
      <div><button class="btn primary">Save shift</button></div>
    </form>`;
}

function ShiftLog({ reloadKey }) {
  const year = Number(today().slice(0, 4));
  const r = useApi(`/gig/shifts?year=${year}&k=${reloadKey}`);
  const [error, setError] = useState(null);
  const shifts = r.data?.shifts || [];
  const byApp = {};
  for (const s of shifts) {
    const a = (byApp[s.app] ||= { cents: 0, hours: 0, miles: 0 });
    a.cents += s.payCents + s.tipsCents; a.hours += s.hours || 0; a.miles += s.miles || 0;
  }
  return html`
    <section class="card">
      <h2>Shifts in ${year}</h2>
      <${Alert} error=${error || r.error} />
      ${!r.data ? html`<${Spinner} />` : !shifts.length ? html`<p class="small muted">No shifts logged yet.</p>` : html`
        <dl class="facts">${Object.entries(byApp).map(([app, a]) => html`<dt>${app}</dt><dd><strong>${formatMoney(a.cents)}</strong>
          <span class="muted small">${a.hours ? ` · ${a.hours} h · ${formatMoney(Math.round(a.cents / a.hours))}/h` : ''}${a.miles ? ` · ${Math.round(a.miles)} mi` : ''}</span></dd>`)}</dl>
        <ul class="plain-list">${shifts.map((s) => html`<li key=${s.id}>
          <span><strong>${formatMoney(s.payCents + s.tipsCents)}</strong> · ${s.app}
            <span class="muted small"> · ${new Date(`${s.day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${s.hours ? ` · ${s.hours} h` : ''}${s.miles ? ` · ${s.miles} mi` : ''}${s.tipsCents ? ` · ${formatMoney(s.tipsCents)} tips` : ''}</span></span>
          <${ActionButton} class="btn small" onError=${setError} confirmText="Delete this shift?"
            onClick=${async () => { await api(`/gig/shifts/${s.id}`, { method: 'DELETE' }); r.reload(); }}>Delete<//>
        </li>`)}</ul>`}
    </section>`;
}

function ActiveRoute({ route: initial, jobs, onChange, onFinish }) {
  const [route, setRoute] = useState(initial);
  const [error, setError] = useState(null);
  useEffect(() => setRoute(initial), [initial]);
  // Addresses are placed on the map in the background; check back until they're all done.
  useEffect(() => {
    if (!route.locating) return undefined;
    const t = setTimeout(async () => { try { setRoute(await api(`/gig/routes/${route.id}`)); } catch { /* next time */ } }, 3000);
    return () => clearTimeout(t);
  }, [route]);
  const todo = route.stops.filter((s) => !s.doneAt);
  const act = (fn) => async () => { setError(null); try { setRoute(await fn()); } catch (err) { setError(err); } };
  const finish = async () => {
    await api(`/gig/routes/${route.id}/finish`, { method: 'POST' });
    onFinish({ app: route.app, miles: route.estimatedMiles ? String(route.estimatedMiles) : '', stops: String(route.stops.filter((s) => s.doneAt).length || route.stops.length) });
    onChange();
  };
  const near = jobs.filter((j) => !j.mine).length;
  return html`
    <section class="card stack">
      <div class="inline"><h2>${route.app || 'Gig'} route</h2>
        <span class="muted small push">${route.stops.length - todo.length} of ${route.stops.length} done${route.estimatedMiles ? ` · about ${route.estimatedMiles} mi` : ''}</span></div>
      <${Alert} error=${error} />
      ${route.locating && html`<p class="small muted">Placing stops on the map…</p>`}
      ${(route.stops.some((s) => s.location) || jobs.length > 0) && html`<${GigMap} stops=${route.stops} jobs=${jobs} />`}
      ${jobs.length > 0 && html`<p class="small"><span class="legend choice">C</span> ${jobs.filter((j) => j.mine).length ? 'Your Choice Delivery jobs' : ''}${jobs.some((j) => j.mine) && near ? ' and ' : ''}${near ? `${near} open Choice Delivery stop${near === 1 ? '' : 's'} waiting for a driver` : ''}. <a href="#/orders">See orders</a></p>`}
      <div class="inline wrap">
        <${ActionButton} class="btn" onError=${setError} onClick=${act(async () => api(`/gig/routes/${route.id}/optimize`, { method: 'POST', body: { from: await here() } }))}>Shortest order from here<//>
        ${todo.length > 0 && html`<a class="btn" href=${multiStopUrl(todo)} target="_blank" rel="noopener">Open next ${Math.min(todo.length, 10)} in Google Maps</a>`}
      </div>
      <ol class="gig-stops">${route.stops.map((s, i) => html`<li key=${s.id} class=${s.doneAt ? 'done' : ''}>
        <span class="gig-num">${i + 1}</span>
        <span class="gig-addr"><strong>${s.address}</strong>${s.note && html`<span class="muted small"> · ${s.note}</span>`}
          ${s.located && !s.location && html`<span class="small error-text"> · not found on the map</span>`}</span>
        <span class="gig-actions">
          ${!s.doneAt && html`<a class="btn small" href=${navUrl(s.address)} target="_blank" rel="noopener">Navigate</a>`}
          <${ActionButton} class=${`btn small ${s.doneAt ? '' : 'primary'}`} onError=${setError}
            onClick=${act(() => api(`/gig/stops/${s.id}`, { method: 'PATCH', body: { done: !s.doneAt } }))}>${s.doneAt ? 'Undo' : 'Done'}<//>
          <${ActionButton} class="btn small" onError=${setError} confirmText="Remove this stop?"
            onClick=${act(() => api(`/gig/stops/${s.id}`, { method: 'DELETE' }))} aria-label="Remove stop">✕<//>
        </span>
      </li>`)}</ol>
      <div class="inline">
        <${ActionButton} class="btn primary" onError=${setError} confirmText="Finish this route? Its addresses are deleted a day from now." onClick=${finish}>Finish route & log the shift<//>
        <${ActionButton} class="btn danger push" onError=${setError} confirmText="Delete this route and its addresses now?"
          onClick=${async () => { await api(`/gig/routes/${route.id}`, { method: 'DELETE' }); onChange(); }}>Delete route<//>
      </div>
    </section>`;
}

export function GigPage() {
  const r = useApi('/gig');
  const [preset, setPreset] = useState(null);
  const [shiftKey, setShiftKey] = useState(0);
  const d = r.data;
  return html`
    <${Layout}>
      <${PageHeader} title="Gig routes" subtitle="Flex, Spark, DoorDash and more: import the stops, drive them next to Choice jobs, log the pay." />
      <${Alert} error=${r.error} />
      ${!d ? html`<${Spinner} />` : html`
        ${d.routes.map((route) => html`<${ActiveRoute} key=${route.id} route=${route} jobs=${d.jobs} onChange=${r.reload}
          onFinish=${(p) => { setPreset(p); setTimeout(() => document.getElementById('shift-form')?.scrollIntoView({ behavior: 'smooth' }), 100); }} />`)}
        <${ImportRoute} apps=${d.apps} aiEnabled=${d.aiEnabled} onCreated=${r.reload} />
        <${ShiftForm} apps=${d.apps} preset=${preset} onSaved=${() => setShiftKey(shiftKey + 1)} />
        <${ShiftLog} reloadKey=${shiftKey} />
        <p class="small muted">Keep using the gig app to scan, photograph and complete each delivery; this page is only your
          organizer. Gig customers' addresses are deleted automatically a day after you finish the route (two days at most).
          Your shift log keeps no addresses.</p>`}
    <//>`;
}
