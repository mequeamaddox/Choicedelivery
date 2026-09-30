import { html, useState, getUser, logout, isStaff, STATUS, formatDate, mapsLink, ROLE_LABELS, currentPath } from './lib.js';

export function Logo() {
  return html`<a class="logo" href="#/orders"><img src="/static/logo.png" alt="Choice Delivery SC" width="480" height="174" /></a>`;
}

export function Layout({ children }) {
  const user = getUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const path = currentPath();
  const links = [
    { href: '/orders', label: 'Orders' },
    { href: '/orders/new', label: 'New order' },
    ...(isStaff(user) ? [{ href: '/people', label: 'People' }, { href: '/companies', label: 'Companies' }] : []),
    ...(user?.role === 'shipper' ? [{ href: '/team', label: 'Team' }] : []),
    { href: '/account', label: 'Account' },
  ];
  const active = (href) => (href === '/orders'
    ? path === '/orders' || (path.startsWith('/orders/') && path !== '/orders/new')
    : path === href || path.startsWith(`${href}/`));
  return html`
    <header class="topbar">
      <div class="topbar-inner">
        <${Logo} />
        <button class="menu-btn" aria-label="Menu" aria-expanded=${menuOpen} onClick=${() => setMenuOpen(!menuOpen)}>☰</button>
        <nav class=${`nav ${menuOpen ? 'open' : ''}`} onClick=${() => setMenuOpen(false)}>
          ${links.map((l) => html`<a href=${`#${l.href}`} class=${active(l.href) ? 'active' : ''}>${l.label}</a>`)}
          <span class="nav-user">
            ${user?.organization?.name || ROLE_LABELS[user?.role]}
            <button class="link" onClick=${logout}>Log out</button>
          </span>
        </nav>
      </div>
    </header>
    <main class="page">${children}</main>`;
}

export function AuthShell({ title, subtitle, children }) {
  return html`
    <div class="auth">
      <div class="auth-card">
        <${Logo} />
        <h1>${title}</h1>
        ${subtitle && html`<p class="muted">${subtitle}</p>`}
        ${children}
      </div>
    </div>`;
}

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'gray' };
  return html`<span class=${`badge ${s.tone}`}>${s.label}</span>`;
}

export function Alert({ error, tone = 'error', children }) {
  const text = children || error?.message;
  if (!text) return null;
  return html`<div class=${`alert ${tone}`} role=${tone === 'error' ? 'alert' : 'status'}>${text}</div>`;
}

export function Spinner({ label = 'Loading…' }) {
  return html`<div class="spinner" role="status"><span class="dot"></span>${label}</div>`;
}

export function Empty({ title, children }) {
  return html`<div class="empty"><strong>${title}</strong>${children && html`<p class="muted">${children}</p>`}</div>`;
}

export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<span class="hint">${hint}</span>`}</label>`;
}

// A button that runs an async action, disables itself meanwhile and reports errors via onError.
export function ActionButton({ onClick, class: cls = 'btn', children, confirmText, onError, disabled }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try { await onClick(); } catch (e) { onError ? onError(e) : window.alert(e.message); } finally { setBusy(false); }
  };
  return html`<button type="button" class=${cls} disabled=${busy || disabled} onClick=${run}>${busy ? 'Working…' : children}</button>`;
}

export function PageHeader({ title, subtitle, actions }) {
  return html`
    <div class="page-header">
      <div><h1>${title}</h1>${subtitle && html`<p class="muted">${subtitle}</p>`}</div>
      ${actions && html`<div class="actions">${actions}</div>`}
    </div>`;
}

// Vertical route: pickups and drop-offs in order, with progress and proof.
export function StopTimeline({ stops, showProof = false }) {
  return html`
    <ol class="route">
      ${stops.map((s) => html`
        <li class=${`stop ${s.status}`}>
          <span class="stop-dot" aria-hidden="true"></span>
          <div class="stop-body">
            <div class="stop-head">
              <span class="stop-type">${s.type === 'pickup' ? 'Pickup' : 'Drop-off'}</span>
              <span class="muted small">${s.status === 'completed' ? `Done ${formatDate(s.completedAt)}`
                : s.status === 'arrived' ? `Driver arrived ${formatDate(s.arrivedAt)}` : 'Not started'}</span>
            </div>
            <a class="stop-address" href=${mapsLink(s.location, s.address)} target="_blank" rel="noopener">${s.address}</a>
            ${(s.contactName || s.contactPhone) && html`<div class="small">${s.contactName}${s.contactName && s.contactPhone ? ' · ' : ''}${s.contactPhone && html`<a href=${`tel:${s.contactPhone}`}>${s.contactPhone}</a>`}</div>`}
            ${s.instructions && html`<div class="small muted">“${s.instructions}”</div>`}
            ${showProof && (s.signature || s.photo || s.printedName || s.barcode) && html`
              <div class="proof">
                ${s.printedName && html`<div class="small">Signed by <strong>${s.printedName}</strong></div>`}
                ${s.barcode && html`<div class="small">Scanned barcode <code>${s.barcode}</code></div>`}
                <div class="proof-images">
                  ${s.signature && html`<figure><img src=${s.signature} alt="Signature" /><figcaption>Signature</figcaption></figure>`}
                  ${s.photo && html`<figure><img src=${s.photo} alt="Proof photo" /><figcaption>Photo</figcaption></figure>`}
                </div>
              </div>`}
          </div>
        </li>`)}
    </ol>`;
}

export function RouteSummary({ stops }) {
  const first = stops[0];
  const last = stops[stops.length - 1];
  const extra = stops.length - 2;
  return html`
    <div class="route-summary">
      <span class="truncate">${first?.address}</span>
      <span class="arrow" aria-hidden="true">→</span>
      <span class="truncate">${last?.address}</span>
      ${extra > 0 && html`<span class="muted small"> +${extra} stop${extra > 1 ? 's' : ''}</span>`}
    </div>`;
}
