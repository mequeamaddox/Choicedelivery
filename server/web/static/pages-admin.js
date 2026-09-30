import { html, useState, api, getUser, refreshUser, useApi, timeAgo, formatDate, mapsLink, ROLE_LABELS, VEHICLE_TYPES } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, Field, ActionButton, DemoBadge } from './components.js';

function AddAccountForm({ roles, companies, fixedCompanyId, onCreated, submitPath }) {
  const [v, setV] = useState({ name: '', email: '', phoneNumber: '', password: '', role: roles[0], organizationId: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k], onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    try {
      const body = { name: v.name, email: v.email, phoneNumber: v.phoneNumber, password: v.password };
      if (!fixedCompanyId) {
        body.role = v.role;
        if (v.role === 'shipper') body.organizationId = v.organizationId;
      }
      await api(submitPath, { method: 'POST', body });
      setDone(`Account created for ${v.email}. Share the password with them securely; they can change it under Account.`);
      setV({ ...v, name: '', email: '', phoneNumber: '', password: '' });
      onCreated();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return html`
    <form class="card stack" onSubmit=${submit}>
      <h2>Add an account</h2>
      <${Alert} error=${error} />
      ${done && html`<${Alert} tone="success">${done}<//>`}
      <div class="grid-2">
        ${!fixedCompanyId && html`
          <${Field} label="Type">
            <select value=${v.role} onChange=${(e) => setV({ ...v, role: e.target.value })}>
              ${roles.map((r) => html`<option value=${r}>${ROLE_LABELS[r]}</option>`)}
            </select>
          <//>`}
        ${!fixedCompanyId && v.role === 'shipper' && html`
          <${Field} label="Company">
            <select required value=${v.organizationId} onChange=${(e) => setV({ ...v, organizationId: e.target.value })}>
              <option value="">Choose a company…</option>
              ${(companies || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
            </select>
          <//>`}
        <${Field} label="Name"><input required ...${bind('name')} /><//>
        <${Field} label="Phone"><input type="tel" ...${bind('phoneNumber')} /><//>
        <${Field} label="Email"><input type="email" required ...${bind('email')} /><//>
        <${Field} label="Temporary password" hint="At least 8 characters."><input type="text" required minlength="8" autocomplete="off" ...${bind('password')} /><//>
      </div>
      <div><button class="btn primary" disabled=${busy}>${busy ? 'Creating…' : 'Create account'}</button></div>
    </form>`;
}

const PEOPLE_TABS = [
  { key: 'driver', label: 'Drivers' },
  { key: 'dispatcher', label: 'Dispatch' },
  { key: 'shipper', label: 'Shippers' },
  { key: 'admin', label: 'Admins' },
];

export function PeoplePage() {
  const me = getUser();
  const [tab, setTab] = useState('driver');
  const { data, error, loading, reload } = useApi(`/users?role=${tab}`, { pollMs: tab === 'driver' ? 30000 : 0 });
  const companies = useApi('/organizations');
  const [actionError, setActionError] = useState(null);
  const roles = me.role === 'admin' ? ['driver', 'dispatcher', 'shipper', 'admin'] : ['driver', 'shipper'];
  const canManage = (u) => u.id !== me.id && (me.role === 'admin' || ['driver', 'shipper'].includes(u.role));

  return html`
    <${Layout}>
      <${PageHeader} title="People" subtitle="Drivers, dispatch and shipper accounts." />
      <div class="tabs" role="tablist">
        ${PEOPLE_TABS.map((t) => html`<button role="tab" aria-selected=${tab === t.key}
          class=${tab === t.key ? 'tab active' : 'tab'} onClick=${() => setTab(t.key)}>${t.label}</button>`)}
      </div>
      <${Alert} error=${error || actionError} />
      ${loading ? html`<${Spinner} />` : !data?.length ? html`<${Empty} title=${`No ${PEOPLE_TABS.find((t) => t.key === tab).label.toLowerCase()} yet`}>Add one below.<//>` : html`
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Name</th><th>Contact</th>
              ${tab === 'driver' && html`<th>Vehicle</th><th>Status</th>`}
              ${tab === 'shipper' && html`<th>Company</th>`}
              <th></th>
            </tr></thead>
            <tbody>
              ${data.map((u) => html`
                <tr class=${u.isActive ? '' : 'inactive'}>
                  <td data-label="Name"><strong>${u.name || '—'}</strong><${DemoBadge} on=${u.isDemo} />${!u.isActive && html` <span class="badge gray">Disabled</span>`}</td>
                  <td data-label="Contact"><div>${u.email}</div>${u.phoneNumber && html`<a class="small" href=${`tel:${u.phoneNumber}`}>${u.phoneNumber}</a>`}</td>
                  ${tab === 'driver' && html`
                    <td data-label="Vehicle">${u.vehicleType || html`<span class="muted">—</span>`}</td>
                    <td data-label="Status">
                      <span class=${`badge ${u.isOnline ? 'green' : 'gray'}`}>${u.isOnline ? 'Online' : 'Offline'}</span>
                      ${u.lastLocation && html`<div class="small"><a href=${mapsLink(u.lastLocation)} target="_blank" rel="noopener">Seen ${timeAgo(u.locationUpdatedAt)}</a></div>`}
                    </td>`}
                  ${tab === 'shipper' && html`<td data-label="Company">${u.organization?.name || '—'}</td>`}
                  <td class="row-actions">
                    ${canManage(u) && html`<${ActionButton} class="btn small" onError=${setActionError}
                      confirmText=${u.isActive ? `Disable ${u.email}? They will be signed out and can't log in.` : null}
                      onClick=${async () => { await api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }); reload(); }}>
                      ${u.isActive ? 'Disable' : 'Enable'}
                    <//>`}
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>`}
      <${AddAccountForm} roles=${roles} companies=${companies.data} submitPath="/auth/register" onCreated=${reload} />
    <//>`;
}

export function CompaniesPage() {
  const { data, error, loading, reload } = useApi('/organizations');
  const [v, setV] = useState({ name: '', phone: '', billingEmail: '', address: '' });
  const [formError, setFormError] = useState(null);
  const bind = (k) => ({ value: v[k], onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    try {
      await api('/organizations', { method: 'POST', body: v });
      setV({ name: '', phone: '', billingEmail: '', address: '' });
      reload();
    } catch (err) { setFormError(err); }
  };
  return html`
    <${Layout}>
      <${PageHeader} title="Companies" subtitle="Your shipping customers. Companies can also sign themselves up." />
      <${Alert} error=${error} />
      ${loading ? html`<${Spinner} />` : !data?.length ? html`<${Empty} title="No companies yet" />` : html`
        <div class="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Phone</th><th>Billing email</th><th>Billing</th><th>Since</th></tr></thead>
            <tbody>${data.map((c) => html`
              <tr>
                <td data-label="Company"><strong>${c.name}</strong><${DemoBadge} on=${c.isDemo} />${c.address && html`<div class="muted small">${c.address}</div>`}</td>
                <td data-label="Phone">${c.phone || '—'}</td>
                <td data-label="Billing email">${c.billingEmail || '—'}</td>
                <td data-label="Billing">
                  <select aria-label=${`How ${c.name} pays`} value=${c.billingMode}
                    onChange=${async (e) => { await api(`/organizations/${c.id}`, { method: 'PATCH', body: { billingMode: e.target.value } }); reload(); }}>
                    <option value="card">Card per order</option>
                    <option value="invoice">Monthly account (invoice)</option>
                  </select>
                </td>
                <td data-label="Since" class="muted small">${new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>`)}</tbody>
          </table>
        </div>`}
      <form class="card stack" onSubmit=${submit}>
        <h2>Add a company</h2>
        <${Alert} error=${formError} />
        <div class="grid-2">
          <${Field} label="Company name"><input required ...${bind('name')} /><//>
          <${Field} label="Phone"><input type="tel" ...${bind('phone')} /><//>
          <${Field} label="Billing email"><input type="email" ...${bind('billingEmail')} /><//>
          <${Field} label="Address"><input ...${bind('address')} /><//>
        </div>
        <div><button class="btn primary">Add company</button></div>
      </form>
    <//>`;
}

export function TeamPage() {
  const me = getUser();
  const orgId = me.organization.id;
  const { data, error, loading, reload } = useApi(`/organizations/${orgId}/users`);
  return html`
    <${Layout}>
      <${PageHeader} title="Team" subtitle=${`People at ${me.organization.name} who can book and track deliveries.`} />
      <${Alert} error=${error} />
      ${loading ? html`<${Spinner} />` : html`
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead>
            <tbody>${(data || []).map((u) => html`
              <tr><td data-label="Name"><strong>${u.name || '—'}</strong>${u.id === me.id && html` <span class="muted small">(you)</span>`}</td>
                <td data-label="Email">${u.email}</td><td data-label="Phone">${u.phoneNumber || '—'}</td></tr>`)}</tbody>
          </table>
        </div>`}
      <${AddAccountForm} roles=${['shipper']} fixedCompanyId=${orgId} submitPath=${`/organizations/${orgId}/users`} onCreated=${reload} />
    <//>`;
}

// Admin-only: shows whether online payments are connected.
function PaymentsStatus() {
  const cfg = useApi('/payments/config');
  if (!cfg.data) return null;
  const { enabled, mode, webhookReady } = cfg.data;
  return html`
    <section class="card stack">
      <h2>Online payments</h2>
      ${!enabled ? html`<p class="muted">Not connected. Add <code>STRIPE_SECRET_KEY</code> in Railway → Variables to turn on card payments.</p>`
        : html`<p><span class=${`badge ${webhookReady ? 'green' : 'amber'}`}>${webhookReady ? 'Connected' : 'Finishing setup'}</span>
            ${' '}<span class=${`badge ${mode === 'live' ? 'blue' : 'gray'}`}>${mode === 'live' ? 'Live mode' : 'Test mode'}</span></p>
          <p class="muted small">${webhookReady
            ? (mode === 'live' ? 'Customers are charged real money.' : 'Test mode: use card 4242 4242 4242 4242. Switch to your live key when ready.')
            : 'The server is registering itself with Stripe. Refresh in a minute; if this stays, check Railway deploy logs for "Stripe webhook".'}</p>`}
    </section>`;
}

// Owner-only: amounts for weight tiers, extra stops, add-ons and wait time. Dollars in the form, cents in the API.
function FeesEditor() {
  const loaded = useApi('/settings/fees');
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState({});
  if (!loaded.data) return null;
  const fees = f || loaded.data.fees;
  const dollars = (c) => (c / 100).toFixed(2);
  const cents = (v) => Math.round(Number(v || 0) * 100);
  const set = (patch) => { setF({ ...fees, ...patch }); setMsg({}); };
  const setTier = (i, patch) => set({ weightTiers: fees.weightTiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const save = async (e) => {
    e.preventDefault();
    try { const r = await api('/settings/fees', { method: 'PUT', body: fees }); setF(r.fees); setMsg({ ok: 'Saved. New quotes and orders use these amounts.' }); }
    catch (err) { setMsg({ error: err }); }
  };
  const tiers = fees.weightTiers;
  return html`
    <form class="card stack" onSubmit=${save}>
      <h2>Fees & extra charges</h2>
      <p class="muted small">Added on top of the base price ($25 for the first 5 miles). Customers see these when they book.</p>
      <${Alert} error=${msg.error} /><${Alert} tone="success">${msg.ok}<//>
      <h3>Weight</h3>
      ${tiers.map((t, i) => html`
        <div class="grid-2">
          <${Field} label="Up to (lbs)">
            <input type="number" min="1" step="1" value=${t.upToLbs} onInput=${(e) => setTier(i, { upToLbs: Number(e.target.value) })} />
          <//>
          <${Field} label="Fee ($)">
            <div class="inline">
              <input type="number" min="0" step="0.01" value=${dollars(t.cents)} onInput=${(e) => setTier(i, { cents: cents(e.target.value) })} />
              <button type="button" class="icon-btn" disabled=${tiers.length <= 1} aria-label="Remove tier"
                onClick=${() => set({ weightTiers: tiers.filter((_, j) => j !== i) })}>✕</button>
            </div>
          <//>
        </div>`)}
      <button type="button" class="btn small" onClick=${() => set({ weightTiers: [...tiers, { upToLbs: (tiers[tiers.length - 1]?.upToLbs || 0) + 500, cents: (tiers[tiers.length - 1]?.cents || 0) + 2500 }] })}>+ Add weight tier</button>
      <p class="muted small">Heavier than ${(tiers[tiers.length - 1]?.upToLbs || 0).toLocaleString()} lbs: sent to you for a custom price.</p>
      <h3>Vehicles</h3>
      <p class="muted small">Flat fee on top of the base, the per-mile rate after the first 5 miles, and the most each carries (heavier goes to a bigger vehicle or a custom price).</p>
      ${Object.entries(fees.vehicles).map(([name, x]) => html`
        <fieldset class="vehicle-fees">
          <legend><label class="inline-check"><input type="checkbox" checked=${x.enabled}
            onChange=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, enabled: e.target.checked } } })} /> ${name}</label></legend>
          <div class="grid-3">
            <${Field} label="Fee ($)"><input type="number" min="0" step="0.01" value=${dollars(x.feeCents)} disabled=${!x.enabled}
              onInput=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, feeCents: cents(e.target.value) } } })} /><//>
            <${Field} label="Per mile ($)"><input type="number" min="0" step="0.01" value=${dollars(x.perMileCents)} disabled=${!x.enabled}
              onInput=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, perMileCents: cents(e.target.value) } } })} /><//>
            <${Field} label="Max lbs"><input type="number" min="1" step="1" value=${x.maxLbs} disabled=${!x.enabled}
              onInput=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, maxLbs: Number(e.target.value) } } })} /><//>
          </div>
        </fieldset>`)}
      <h3>Stops & add-ons</h3>
      <div class="grid-2">
        <${Field} label="Each extra stop ($)" hint="Beyond one pickup and one drop-off.">
          <input type="number" min="0" step="0.01" value=${dollars(fees.extraStopCents)} onInput=${(e) => set({ extraStopCents: cents(e.target.value) })} />
        <//>
        ${Object.entries(fees.addOns).map(([k, a]) => html`
          <${Field} label=${`${a.label} ($)`} hint=${a.description}>
            <input type="number" min="0" step="0.01" value=${dollars(a.cents)}
              onInput=${(e) => set({ addOns: { ...fees.addOns, [k]: { ...a, cents: cents(e.target.value) } } })} />
          <//>`)}
      </div>
      <h3>Wait time</h3>
      <div class="grid-2">
        <${Field} label="Free minutes per stop"><input type="number" min="0" step="1" value=${fees.waitFreeMinutes} onInput=${(e) => set({ waitFreeMinutes: Number(e.target.value) })} /><//>
        <${Field} label="Then charge ($)"><input type="number" min="0" step="0.01" value=${dollars(fees.waitBlockCents)} onInput=${(e) => set({ waitBlockCents: cents(e.target.value) })} /><//>
        <${Field} label="Per how many minutes"><input type="number" min="1" step="1" value=${fees.waitBlockMinutes} onInput=${(e) => set({ waitBlockMinutes: Number(e.target.value) })} /><//>
      </div>
      <div class="actions">
        <button class="btn primary">Save fees</button>
        <button type="button" class="btn" onClick=${() => set(loaded.data.defaults)}>Reset to defaults</button>
      </div>
    </form>`;
}

export function AccountPage() {
  const me = getUser();
  const [v, setV] = useState({ name: me.name || '', email: me.email, phoneNumber: me.phoneNumber || '',
    ...(me.role === 'driver' ? { vehicleType: me.vehicleType || 'Car' } : {}),
    ...(me.role === 'shipper' ? { emailUpdates: me.emailUpdates !== false } : {}) });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState({});
  const bind = (k) => ({ value: v[k], onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const saveProfile = async (e) => {
    e.preventDefault();
    try { refreshUser(await api('/users/me', { method: 'PUT', body: v })); setMsg({ profile: 'Saved.' }); }
    catch (err) { setMsg({ profileError: err }); }
  };
  const changePassword = async (e) => {
    e.preventDefault();
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      setPw({ currentPassword: '', newPassword: '' });
      setMsg({ password: 'Password changed.' });
    } catch (err) { setMsg({ passwordError: err }); }
  };
  return html`
    <${Layout}>
      <${PageHeader} title="Account" subtitle=${`${ROLE_LABELS[me.role]}${me.organization ? ` at ${me.organization.name}` : ''}`} />
      <div class="grid-2 align-start">
        <form class="card stack" onSubmit=${saveProfile}>
          <h2>Profile</h2>
          <${Alert} error=${msg.profileError} />
          ${msg.profile && html`<${Alert} tone="success">${msg.profile}<//>`}
          <${Field} label="Name"><input ...${bind('name')} /><//>
          <${Field} label="Email"><input type="email" required ...${bind('email')} /><//>
          <${Field} label="Phone"><input type="tel" ...${bind('phoneNumber')} /><//>
          ${me.role === 'shipper' && html`<label class="check-row">
            <input type="checkbox" checked=${v.emailUpdates} onChange=${(e) => setV({ ...v, emailUpdates: e.target.checked })} />
            <span><strong>Email updates</strong><br /><span class="muted small">Get an email when your orders are booked, picked up and delivered.</span></span>
          </label>`}
          ${me.role === 'driver' && html`<${Field} label="Vehicle">
            <select value=${v.vehicleType} onChange=${(e) => setV({ ...v, vehicleType: e.target.value })}>
              ${VEHICLE_TYPES.map((t) => html`<option>${t}</option>`)}
            </select><//>`}
          <div><button class="btn primary">Save</button></div>
        </form>
        <form class="card stack" onSubmit=${changePassword}>
          <h2>Change password</h2>
          <${Alert} error=${msg.passwordError} />
          ${msg.password && html`<${Alert} tone="success">${msg.password}<//>`}
          <${Field} label="Current password"><input type="password" required autocomplete="current-password" value=${pw.currentPassword}
            onInput=${(e) => setPw({ ...pw, currentPassword: e.target.value })} /><//>
          <${Field} label="New password" hint="At least 8 characters."><input type="password" required minlength="8" autocomplete="new-password"
            value=${pw.newPassword} onInput=${(e) => setPw({ ...pw, newPassword: e.target.value })} /><//>
          <div><button class="btn primary">Change password</button></div>
        </form>
      </div>
      ${me.role === 'admin' && html`<div class="account-extra stack"><${PaymentsStatus} /><${FeesEditor} /></div>`}
    <//>`;
}

const LEAD_TABS = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'won,closed', label: 'Done' },
  { key: '', label: 'All' },
];
const LEAD_STATUS = { new: 'New', contacted: 'Contacted', won: 'Won', closed: 'Closed' };

// Messages and business-plan requests from www.choicedeliverysc.com.
export function LeadsPage() {
  const [tab, setTab] = useState('new');
  const { data, error, loading, reload } = useApi(`/leads${tab ? `?status=${tab}` : ''}`, { pollMs: 60000 });
  const [actionError, setActionError] = useState(null);
  const setStatus = async (id, status) => { await api(`/leads/${id}`, { method: 'PATCH', body: { status } }); reload(); };
  return html`
    <${Layout}>
      <${PageHeader} title="Leads" subtitle="Contact messages and business plan requests from the website." />
      <div class="tabs" role="tablist">
        ${LEAD_TABS.map((t) => html`<button role="tab" aria-selected=${tab === t.key}
          class=${tab === t.key ? 'tab active' : 'tab'} onClick=${() => setTab(t.key)}>${t.label}</button>`)}
      </div>
      <${Alert} error=${error || actionError} />
      ${loading ? html`<${Spinner} />` : !data?.length ? html`
        <${Empty} title=${tab === 'new' ? 'No new leads' : 'Nothing here'}>New website messages and plan requests show up here.<//>` : html`
        <div class="stack">
          ${data.map((l) => html`
            <article class="card">
              <div class="card-head">
                <div>
                  <h2>${l.type === 'contract' ? `${l.planName} request` : 'Website message'}<${DemoBadge} on=${l.isDemo} /></h2>
                  <div class="muted small">${formatDate(l.createdAt)}${l.company ? ` · ${l.company}` : ''}</div>
                </div>
                <span class=${`badge ${l.status === 'new' ? 'amber' : l.status === 'won' ? 'green' : l.status === 'contacted' ? 'blue' : 'gray'}`}>${LEAD_STATUS[l.status]}</span>
              </div>
              <p><strong>${l.name}</strong>${' · '}<a href=${`mailto:${l.email}`}>${l.email}</a>${l.phone && html`${' · '}<a href=${`tel:${l.phone}`}>${l.phone}</a>`}</p>
              ${l.message && html`<p class="lead-message">${l.message}</p>`}
              <div class="actions">
                ${l.status !== 'contacted' && html`<${ActionButton} class="btn small" onError=${setActionError} onClick=${() => setStatus(l.id, 'contacted')}>Mark contacted<//>`}
                ${l.status !== 'won' && html`<${ActionButton} class="btn small" onError=${setActionError} onClick=${() => setStatus(l.id, 'won')}>Won<//>`}
                ${l.status !== 'closed' && html`<${ActionButton} class="btn small" onError=${setActionError} onClick=${() => setStatus(l.id, 'closed')}>Close<//>`}
                ${l.status !== 'new' && html`<${ActionButton} class="btn small" onError=${setActionError} onClick=${() => setStatus(l.id, 'new')}>Reopen<//>`}
              </div>
            </article>`)}
        </div>`}
    <//>`;
}
