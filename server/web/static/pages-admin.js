import { html, useState, api, getUser, refreshUser, useApi, timeAgo, formatDate, mapsLink, ROLE_LABELS, VEHICLE_TYPES, navigate } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, Field, ActionButton, DemoBadge } from './components.js';

function AddAccountForm({ roles, companies, fixedCompanyId, onCreated, submitPath }) {
  const [v, setV] = useState({ name: '', email: '', phoneNumber: '', password: '', role: roles[0], organizationId: '', invite: true });
  const inviting = !fixedCompanyId && v.role === 'driver' && v.invite;
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k], onInput: (e) => setV({ ...v, [k]: e.target.value }) });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    try {
      if (inviting) {
        await api('/users/invite', { method: 'POST', body: { name: v.name, email: v.email, phoneNumber: v.phoneNumber } });
        setDone(`Invite sent to ${v.email}. They choose their password from the email, then sign in to the driver app.`);
        setV({ ...v, name: '', email: '', phoneNumber: '' });
        onCreated();
        return;
      }
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
        ${!inviting && html`<${Field} label="Temporary password" hint="At least 8 characters."><input type="text" required minlength="8" autocomplete="off" ...${bind('password')} /><//>`}
      </div>
      ${!fixedCompanyId && v.role === 'driver' && html`
        <label class="check-row"><input type="checkbox" checked=${v.invite} onChange=${(e) => setV({ ...v, invite: e.target.checked })} />
          <span class="small">Email them an invite to choose their own password and get the app (recommended)</span></label>`}
      <div><button class="btn primary" disabled=${busy}>${busy ? 'Creating…' : inviting ? 'Send invite' : 'Create account'}</button></div>
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
  const applicants = tab === 'driver' ? (data || []).filter((u) => u.driverStatus === 'applied').length : 0;
  // Applications first, so they're easy to find.
  const rows = tab === 'driver' && data ? [...data].sort((a, b) => Number(b.driverStatus === 'applied') - Number(a.driverStatus === 'applied')) : data;

  return html`
    <${Layout}>
      <${PageHeader} title="People" subtitle="Drivers, dispatch and shipper accounts." />
      ${tab === 'driver' && applicants > 0 && html`<${Alert} tone="warn">${applicants} driver application${applicants === 1 ? '' : 's'} waiting for review. Click a name to review.<//>`}
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
              ${tab === 'driver' && html`<th>Vehicle</th><th>Approval</th><th>Status</th>`}
              ${tab === 'shipper' && html`<th>Company</th>`}
              <th></th>
            </tr></thead>
            <tbody>
              ${rows.map((u) => html`
                <tr class=${u.isActive ? '' : 'inactive'}>
                  <td data-label="Name">${u.role === 'driver' ? html`<a href=${`#/people/${u.id}`}><strong>${u.name || u.email}</strong></a>` : html`<strong>${u.name || '—'}</strong>`}<${DemoBadge} on=${u.isDemo} />${!u.isActive && html` <span class="badge gray">Disabled</span>`}</td>
                  <td data-label="Contact"><div>${u.email}</div>${u.phoneNumber && html`<a class="small" href=${`tel:${u.phoneNumber}`}>${u.phoneNumber}</a>`}</td>
                  ${tab === 'driver' && html`
                    <td data-label="Vehicle">${u.vehicleType || html`<span class="muted">—</span>`}${u.vehicle?.make ? html`<div class="small muted">${[u.vehicle.color, u.vehicle.make, u.vehicle.model].filter(Boolean).join(' ')}</div>` : ''}</td>
                    <td data-label="Approval"><${DriverStatusBadge} user=${u} /></td>
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

const DRIVER_STATUS = {
  applied: ['Application', 'amber'], approved: ['Approved', 'green'], rejected: ['Not approved', 'gray'], suspended: ['On hold', 'red'],
};
function DriverStatusBadge({ user }) {
  const [label, tone] = DRIVER_STATUS[user.driverStatus] || ['—', 'gray'];
  const warn = user.driverStatus === 'approved' && (user.checklist?.expired?.length || !user.checklist?.complete);
  return html`<span class=${`badge ${tone}`}>${label}</span>${warn ? html` <span class="badge amber" title=${[...(user.checklist?.expired || []), ...(user.checklist?.missing || [])].join('; ')}>${user.checklist?.expired?.length ? 'Expired docs' : 'Profile incomplete'}</span>` : ''}`;
}

const DOC_LABELS = {
  photo: 'Profile photo', license_front: "License (front)", license_back: 'License (back)',
  insurance: 'Insurance card', vehicle: 'Vehicle photo', registration: 'Registration',
};

function DocumentThumb({ userId, kind, has }) {
  const doc = useApi(has ? `/users/${userId}/documents/${kind}` : null);
  if (!has) return html`<div class="doc missing"><span>${DOC_LABELS[kind]}</span><span class="small muted">Not uploaded</span></div>`;
  return html`
    <a class="doc" href=${doc.data?.data || '#'} target="_blank" rel="noopener" onClick=${(e) => {
      // Data URLs can't open in a new tab in most browsers; show it full size in place instead.
      e.preventDefault(); const w = window.open(''); if (w && doc.data) w.document.write(`<img src="${doc.data.data}" style="max-width:100%">`);
    }}>
      ${doc.data ? html`<img src=${doc.data.data} alt=${DOC_LABELS[kind]} />` : html`<span class="small muted">Loading…</span>`}
      <span>${DOC_LABELS[kind]}</span>
      ${doc.data && html`<span class="small muted">Updated ${formatDate(doc.data.updatedAt)}</span>`}
    </a>`;
}

// Staff: one driver's application/profile, documents, and approve / reject / hold.
export function DriverDetailPage({ id }) {
  const { data: u, error, loading, reload } = useApi(`/users/${encodeURIComponent(id)}`);
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState(null);
  if (loading && !u) return html`<${Layout}><${Spinner} /><//>`;
  if (!u) return html`<${Layout}><${Alert} error=${error} /><a href="#/people">Back to people</a><//>`;
  const p = u.driverProfile || {};
  const review = (status, confirmText) => html`<${ActionButton} class=${`btn ${status === 'approved' ? 'primary' : status === 'suspended' ? 'danger' : ''}`}
    onError=${setActionError} confirmText=${confirmText}
    onClick=${async () => { await api(`/users/${u.id}/review`, { method: 'POST', body: { status, note } }); setNote(''); reload(); }}>
    ${{ approved: u.driverStatus === 'suspended' ? 'Reinstate' : 'Approve', rejected: 'Reject', suspended: 'Put on hold' }[status]}
  <//>`;
  const expired = (d) => d && d < new Date().toISOString().slice(0, 10);
  return html`
    <${Layout}>
      <a class="back" href="#/people">← People</a>
      <${PageHeader} title=${html`${u.name || u.email} <${DriverStatusBadge} user=${u} />`}
        subtitle=${u.appliedAt ? `Applied ${formatDate(u.appliedAt)}` : 'Driver'} />
      <${Alert} error=${actionError} />
      <div class="detail-grid">
        <div class="stack">
          <section class="card">
            <div class="driver-head">
              ${u.photoUrl ? html`<img class="avatar big" src=${u.photoUrl} alt="" />` : html`<div class="avatar big empty">${(u.name || '?')[0]}</div>`}
              <div>
                <p><strong>${u.name}</strong></p>
                <p class="small"><a href=${`mailto:${u.email}`}>${u.email}</a>${u.phoneNumber && html` · <a href=${`tel:${u.phoneNumber}`}>${u.phoneNumber}</a>`}</p>
                <p class="small muted">${[p.city, p.zip].filter(Boolean).join(' ')}</p>
              </div>
            </div>
            ${u.checklist?.expired?.length > 0 && html`<${Alert}>${u.checklist.expired.join('. ')}. They can't take jobs until they upload new ones.<//>`}
            ${u.checklist?.missing?.length > 0 && html`<div class="small"><strong>Still missing:</strong> ${u.checklist.missing.join(', ')}.</div>`}
            ${u.checklist?.complete && !u.checklist?.expired?.length && html`<p class="small">✓ Profile complete</p>`}
          </section>
          <section class="card">
            <h2>Documents</h2>
            <div class="doc-grid">
              ${Object.keys(DOC_LABELS).map((k) => html`<${DocumentThumb} key=${k} userId=${u.id} kind=${k} has=${(u.documents || []).includes(k)} />`)}
            </div>
          </section>
        </div>
        <div class="stack">
          <section class="card">
            <h2>Review</h2>
            ${u.reviewNote && html`<p class="small muted">Last note: ${u.reviewNote}${u.reviewedAt ? ` (${formatDate(u.reviewedAt)})` : ''}</p>`}
            <${Field} label="Note to the driver (optional)" hint="Included in the email for a rejection or hold.">
              <input value=${note} onInput=${(e) => setNote(e.target.value)} maxlength="500" />
            <//>
            <div class="actions">
              ${u.driverStatus !== 'approved' && review('approved', null)}
              ${u.driverStatus === 'applied' && review('rejected', 'Reject this application? They will be emailed.')}
              ${u.driverStatus === 'approved' && review('suspended', 'Put this driver on hold? They go offline and stop getting jobs until reinstated.')}
            </div>
            <p class="small muted">The driver is emailed when you approve, reject or put them on hold.</p>
          </section>
          <section class="card">
            <h2>Vehicle</h2>
            <dl class="facts">
              <dt>Type</dt><dd>${u.vehicle?.type || '—'}</dd>
              <dt>Vehicle</dt><dd>${[u.vehicle?.year, u.vehicle?.color, u.vehicle?.make, u.vehicle?.model].filter(Boolean).join(' ') || '—'}</dd>
              <dt>Plate</dt><dd>${u.vehicle?.plate || '—'}</dd>
            </dl>
          </section>
          <section class="card">
            <h2>License & insurance</h2>
            <dl class="facts">
              <dt>License</dt><dd>${p.license?.number ? `${p.license.number}${p.license.state ? ` (${p.license.state})` : ''}` : '—'}</dd>
              <dt>Expires</dt><dd class=${expired(p.license?.expires) ? 'danger-text' : ''}>${p.license?.expires || '—'}</dd>
              <dt>Insurance</dt><dd>${p.insurance?.company ? `${p.insurance.company}${p.insurance.policyNumber ? ` · ${p.insurance.policyNumber}` : ''}` : '—'}</dd>
              <dt>Expires</dt><dd class=${expired(p.insurance?.expires) ? 'danger-text' : ''}>${p.insurance?.expires || '—'}</dd>
              <dt>Emergency</dt><dd>${p.emergencyContact?.name ? `${p.emergencyContact.name} ${p.emergencyContact.phone || ''}` : '—'}</dd>
              <dt>Agreed to terms</dt><dd>${p.agreedAt ? formatDate(p.agreedAt) : '—'}</dd>
            </dl>
          </section>
        </div>
      </div>
    <//>`;
}

// Owner: is email (Resend) set up, and a test send.
function EmailStatus() {
  const cfg = useApi('/settings/email');
  const log = useApi('/settings/email/log', { pollMs: 30000 });
  const [msg, setMsg] = useState({});
  if (!cfg.data) return null;
  return html`
    <section class="card stack">
      <h2>Email</h2>
      ${cfg.data.configured
        ? html`<p><span class="badge green">Connected</span> <span class="small muted">Sending as ${cfg.data.from}</span></p>`
        : html`<p class="muted">Not connected. Add <code>RESEND_API_KEY</code> (and <code>MAIL_FROM</code>) in Railway → Variables. Until then emails are only written to the server log.</p>`}
      <${Alert} error=${msg.error} /><${Alert} tone="success">${msg.ok}<//>
      ${cfg.data.configured && html`<div><${ActionButton} class="btn" onError=${(e) => setMsg({ error: e })}
        onClick=${async () => { setMsg({}); try { const r = await api('/settings/email/test', { method: 'POST' }); setMsg({ ok: r.message }); } finally { log.reload(); } }}>Send test email<//></div>`}
      <h3>Recent emails</h3>
      ${!log.data?.length ? html`<p class="small muted">None yet.</p>` : html`
        <ul class="email-log">
          ${log.data.map((m) => html`<li>
            <span class=${`badge ${m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : 'gray'}`}>${{ sent: 'Sent', failed: 'Failed', not_configured: 'Not sent' }[m.status]}</span>
            <span><strong>${m.subject}</strong><span class="small muted"> → ${m.to} · ${timeAgo(m.at)}</span>
              ${m.error && html`<span class="small danger-text block">${m.error}</span>`}
              ${m.status === 'not_configured' && html`<span class="small muted block">RESEND_API_KEY wasn't set</span>`}</span>
          </li>`)}
        </ul>`}
    </section>`;
}

// Owner: where the "Get the driver app" page and driver emails send people.
function DriverAppLink() {
  const current = useApi('/public/driver-app');
  const [url, setUrl] = useState(null);
  const [msg, setMsg] = useState({});
  const value = url ?? current.data?.url ?? '';
  return html`
    <form class="card stack" onSubmit=${async (e) => {
      e.preventDefault();
      try { await api('/settings/driver-app', { method: 'PUT', body: { url: value } }); setMsg({ ok: 'Saved.' }); } catch (err) { setMsg({ error: err }); }
    }}>
      <h2>Driver app download link</h2>
      <p class="muted small">Paste the Install link from your latest "Build driver app" run (or your Play Store page). Drivers get it at
        <a href="#/driver-app">app.choicedeliverysc.com/#/driver-app</a> and in their approval and invite emails.</p>
      <${Alert} error=${msg.error} /><${Alert} tone="success">${msg.ok}<//>
      <${Field} label="Link"><input type="url" placeholder="https://expo.dev/artifacts/eas/…apk" value=${value} onInput=${(e) => { setUrl(e.target.value); setMsg({}); }} /><//>
      <div><button class="btn primary">Save link</button></div>
    </form>`;
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

const SURCHARGE_LABELS = {
  holiday: 'Holiday', weekend: 'Weekend', weather: 'Bad weather (dispatch switch)',
  lunch: 'Lunch rush (11:30am–1:30pm)', demand: 'High demand (3+ open orders)',
};
const HOLIDAY_LABELS = {
  new_years_day: "New Year's Day", mlk_day: 'MLK Jr. Day', presidents_day: "Presidents' Day", memorial_day: 'Memorial Day',
  juneteenth: 'Juneteenth', independence_day: 'Independence Day', labor_day: 'Labor Day', columbus_day: 'Columbus Day',
  veterans_day: 'Veterans Day', thanksgiving: 'Thanksgiving', day_after_thanksgiving: 'Day after Thanksgiving',
  christmas_eve: 'Christmas Eve', christmas: 'Christmas Day', new_years_eve: "New Year's Eve",
};

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
      <p class="muted small">Your rate card. Customers see these prices when they book; saved changes apply to new quotes and orders.</p>
      <${Alert} error=${msg.error} /><${Alert} tone="success">${msg.ok}<//>
      <h3>Weight</h3>
      <${Field} label="Heaviest single piece allowed (lbs)" hint="Orders with any piece heavier than this can't be booked.">
        <input type="number" min="1" step="1" value=${fees.maxPieceLbs} onInput=${(e) => set({ maxPieceLbs: Number(e.target.value) })} />
      <//>
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
      <p class="muted small">Base price covering the first miles, the per-mile rate after that, and the most each carries (heavier goes to a bigger vehicle or a custom price). Uncheck a vehicle you don't run.</p>
      ${Object.entries(fees.vehicles).map(([name, x]) => html`
        <fieldset class="vehicle-fees">
          <legend><label class="inline-check"><input type="checkbox" checked=${x.enabled}
            onChange=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, enabled: e.target.checked } } })} /> ${name}</label></legend>
          <div class="grid-4">
            <${Field} label="Base ($)"><input type="number" min="0" step="0.01" value=${dollars(x.baseCents)} disabled=${!x.enabled}
              onInput=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, baseCents: cents(e.target.value) } } })} /><//>
            <${Field} label="Miles included"><input type="number" min="0" step="1" value=${x.includedMiles} disabled=${!x.enabled}
              onInput=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, includedMiles: Number(e.target.value) } } })} /><//>
            <${Field} label="Per mile ($)"><input type="number" min="0" step="0.01" value=${dollars(x.perMileCents)} disabled=${!x.enabled}
              onInput=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, perMileCents: cents(e.target.value) } } })} /><//>
            <${Field} label="Max lbs"><input type="number" min="1" step="1" value=${x.maxLbs} disabled=${!x.enabled}
              onInput=${(e) => set({ vehicles: { ...fees.vehicles, [name]: { ...x, maxLbs: Number(e.target.value) } } })} /><//>
          </div>
        </fieldset>`)}
      <h3>Rush & surcharges</h3>
      <div class="grid-2">
        <${Field} label="Rush / expedited ($)" hint="2 hours or less.">
          <input type="number" min="0" step="0.01" value=${dollars(fees.rushCents)} onInput=${(e) => set({ rushCents: cents(e.target.value) })} />
        <//>
      </div>
      ${Object.entries(SURCHARGE_LABELS).map(([k, label]) => html`
        <div class="inline surcharge-row">
          <label class="inline-check"><input type="checkbox" checked=${fees.surcharges[k].enabled}
            onChange=${(e) => set({ surcharges: { ...fees.surcharges, [k]: { ...fees.surcharges[k], enabled: e.target.checked } } })} /> ${label}</label>
          <input type="number" min="0" step="0.01" aria-label=${`${label} ($)`} value=${dollars(fees.surcharges[k].cents)} disabled=${!fees.surcharges[k].enabled}
            onInput=${(e) => set({ surcharges: { ...fees.surcharges, [k]: { ...fees.surcharges[k], cents: cents(e.target.value) } } })} />
        </div>`)}
      <h3>Holidays</h3>
      <p class="muted small">The holiday surcharge applies on these days (Columbia time), instead of the weekend charge.</p>
      <div class="holiday-grid">
        ${Object.entries(HOLIDAY_LABELS).map(([k, label]) => html`
          <label class="inline-check"><input type="checkbox" checked=${fees.holidays[k]}
            onChange=${(e) => set({ holidays: { ...fees.holidays, [k]: e.target.checked } })} /> ${label}</label>`)}
      </div>
      <${Field} label="Other holiday dates" hint="Extra days to charge as holidays, e.g. 2026-12-26, 2027-01-02">
        <input value=${fees.extraHolidayDates.join(', ')} placeholder="YYYY-MM-DD, YYYY-MM-DD"
          onChange=${(e) => set({ extraHolidayDates: e.target.value.split(/[\s,]+/).filter(Boolean) })} />
      <//>
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
      ${me.role === 'admin' && html`<div class="account-extra stack"><${PaymentsStatus} /><${EmailStatus} /><${DriverAppLink} /><${FeesEditor} /></div>`}
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
