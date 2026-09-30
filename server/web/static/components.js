import { html, useState, useRef, getUser, logout, isStaff, STATUS, formatDate, mapsLink, ROLE_LABELS, currentPath } from './lib.js';

export function Logo() {
  return html`<a class="logo" href="#/orders"><img src="/static/logo.png" alt="Choice Delivery SC" width="480" height="174" /></a>`;
}

export function Layout({ children }) {
  const user = getUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const path = currentPath();
  const links = [
    { href: '/orders', label: 'Orders', icon: 'list', tab: true },
    { href: '/orders/new', label: 'New order', icon: 'plus', tab: true },
    ...(isStaff(user) ? [
      { href: '/leads', label: 'Leads', icon: 'inbox', tab: true },
      { href: '/people', label: 'People', icon: 'users', tab: true },
      { href: '/companies', label: 'Companies', icon: 'building' },
    ] : []),
    ...(user?.role === 'shipper' ? [{ href: '/team', label: 'Team', icon: 'users', tab: true }] : []),
    { href: '/account', label: 'Account', icon: 'user', tab: true },
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
    <main class="page with-tabbar">${children}</main>
    <nav class="tabbar" aria-label="Main">
      ${links.filter((l) => l.tab).map((l) => html`
        <a href=${`#${l.href}`} class=${active(l.href) ? 'active' : ''} aria-current=${active(l.href) ? 'page' : undefined}>
          <${Icon} name=${l.icon} /><span>${l.label}</span>
        </a>`)}
    </nav>`;
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

// Address input with suggestions (SC/NC/GA). Picking a suggestion also records map coordinates,
// which the driver app uses for map pins and the booking form uses for distance.
export function AddressInput({ value, onChange, placeholder, required }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);
  const listId = useRef(`addr-${Math.random().toString(36).slice(2)}`).current;

  const search = (q) => {
    clearTimeout(timer.current);
    if (q.trim().length < 4) { setItems([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const res = await fetch(`/public/geocode?q=${encodeURIComponent(q)}`);
        const data = res.ok ? await res.json() : [];
        if (mine === seq.current) { setItems(data); setOpen(data.length > 0); setActive(-1); }
      } catch { /* suggestions are optional */ } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 450);
  };

  const pick = (item) => {
    onChange({ address: item.label, location: item.location });
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return html`
    <div class="address-input">
      <input value=${value} placeholder=${placeholder} required=${required} autocomplete="off"
        role="combobox" aria-expanded=${open} aria-controls=${listId} aria-autocomplete="list"
        aria-activedescendant=${active >= 0 ? `${listId}-${active}` : undefined}
        onInput=${(e) => { onChange({ address: e.target.value, location: null }); search(e.target.value); }}
        onKeyDown=${onKeyDown} onBlur=${() => setTimeout(() => setOpen(false), 150)}
        onFocus=${() => items.length && setOpen(true)} />
      ${loading && html`<span class="address-spinner" aria-hidden="true"></span>`}
      ${open && html`
        <ul class="suggestions" id=${listId} role="listbox">
          ${items.map((it, i) => html`
            <li id=${`${listId}-${i}`} role="option" aria-selected=${i === active} class=${i === active ? 'active' : ''}
              onMouseDown=${(e) => { e.preventDefault(); pick(it); }}>
              <span class="pin" aria-hidden="true">${Icon({ name: 'pin' })}</span>${it.label}
            </li>`)}
        </ul>`}
    </div>`;
}

const ICONS = {
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  plus: 'M12 5v14M5 12h14',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  building: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18zM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

export function Icon({ name }) {
  return html`<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;
}
