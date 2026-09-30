import { html, useState, api, getUser, refreshUser, useApi, timeAgo, formatDate, mapsLink, ROLE_LABELS } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, Field, ActionButton } from './components.js';

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
                  <td data-label="Name"><strong>${u.name || '—'}</strong>${!u.isActive && html` <span class="badge gray">Disabled</span>`}</td>
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
            <thead><tr><th>Company</th><th>Phone</th><th>Billing email</th><th>Since</th></tr></thead>
            <tbody>${data.map((c) => html`
              <tr>
                <td data-label="Company"><strong>${c.name}</strong>${c.address && html`<div class="muted small">${c.address}</div>`}</td>
                <td data-label="Phone">${c.phone || '—'}</td>
                <td data-label="Billing email">${c.billingEmail || '—'}</td>
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

export function AccountPage() {
  const me = getUser();
  const [v, setV] = useState({ name: me.name || '', email: me.email, phoneNumber: me.phoneNumber || '' });
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
                  <h2>${l.type === 'contract' ? `${l.planName} request` : 'Website message'}</h2>
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
