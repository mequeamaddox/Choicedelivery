import { html, useState, useEffect, api, login, signup, createOwner, navigate, useApi, formatDate, timeAgo, mapsLink } from './lib.js';
import { AuthShell, Alert, Field, Spinner, StatusBadge, StopTimeline, Logo, LiveMap } from './components.js';

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const bind = (name) => ({ value: values[name], onInput: (e) => setValues((v) => ({ ...v, [name]: e.target.value })) });
  return [values, bind];
}

function useSubmit(fn) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return { onSubmit, error, busy };
}

// Shown instead of the login form until the very first (owner/admin) account exists.
function OwnerSetup() {
  const [v, bind] = useForm({ name: '', email: '', password: '', confirm: '' });
  const { onSubmit, error, busy } = useSubmit(async () => {
    if (v.password !== v.confirm) throw new Error("The passwords don't match.");
    await createOwner({ name: v.name, email: v.email, password: v.password });
    navigate('/orders');
  });
  return html`
    <${AuthShell} title="Create the owner account" subtitle="One-time setup. This account gets full admin control.">
      <form onSubmit=${onSubmit} class="stack">
        <${Alert} error=${error} />
        <${Field} label="Your name"><input required autocomplete="name" ...${bind('name')} /><//>
        <${Field} label="Email"><input type="email" required autocomplete="email" ...${bind('email')} /><//>
        <${Field} label="Password" hint="At least 8 characters. Use one you don't use anywhere else."><input type="password" required minlength="8" autocomplete="new-password" ...${bind('password')} /><//>
        <${Field} label="Confirm password"><input type="password" required minlength="8" autocomplete="new-password" ...${bind('confirm')} /><//>
        <button class="btn primary block" disabled=${busy}>${busy ? 'Creating…' : 'Create owner account'}</button>
      </form>
    <//>`;
}

export function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => {
    api('/auth/setup-status').then((r) => setNeedsSetup(r.needsSetup)).catch(() => {});
  }, []);
  if (needsSetup) return html`<${OwnerSetup} />`;
  return html`<${LoginForm} />`;
}

function LoginForm() {
  const [v, bind] = useForm({ email: '', password: '' });
  const { onSubmit, error, busy } = useSubmit(async () => {
    await login(v.email, v.password);
    navigate('/orders');
  });
  return html`
    <${AuthShell} title="Log in" subtitle="For shippers, drivers and dispatch.">
      <form onSubmit=${onSubmit} class="stack">
        <${Alert} error=${error} />
        <${Field} label="Email"><input type="email" autocomplete="email" required ...${bind('email')} /><//>
        <${Field} label="Password"><input type="password" autocomplete="current-password" required ...${bind('password')} /><//>
        <button class="btn primary block" disabled=${busy}>${busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p class="auth-links"><a href="#/forgot">Forgot password?</a> · <a href="#/signup">Create a shipper account</a></p>
    <//>`;
}

export function SignupPage() {
  const [v, bind] = useForm({ companyName: '', name: '', phoneNumber: '', email: '', password: '' });
  const { onSubmit, error, busy } = useSubmit(async () => {
    await signup(v);
    navigate('/orders/new');
  });
  return html`
    <${AuthShell} title="Ship with Choice Delivery" subtitle="Create a company account to book and track deliveries.">
      <form onSubmit=${onSubmit} class="stack">
        <${Alert} error=${error} />
        <${Field} label="Company name"><input required autocomplete="organization" ...${bind('companyName')} /><//>
        <${Field} label="Your name"><input required autocomplete="name" ...${bind('name')} /><//>
        <${Field} label="Phone"><input type="tel" autocomplete="tel" ...${bind('phoneNumber')} /><//>
        <${Field} label="Work email"><input type="email" required autocomplete="email" ...${bind('email')} /><//>
        <${Field} label="Password" hint="At least 8 characters."><input type="password" required minlength="8" autocomplete="new-password" ...${bind('password')} /><//>
        <button class="btn primary block" disabled=${busy}>${busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p class="auth-links">Already have an account? <a href="#/login">Log in</a></p>
    <//>`;
}

export function ForgotPage() {
  const [v, bind] = useForm({ email: '' });
  const [sent, setSent] = useState(null);
  const { onSubmit, error, busy } = useSubmit(async () => {
    const r = await api('/auth/forgot-password', { method: 'POST', body: { email: v.email } });
    setSent(r.message);
  });
  return html`
    <${AuthShell} title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      ${sent ? html`<${Alert} tone="success">${sent}<//>` : html`
        <form onSubmit=${onSubmit} class="stack">
          <${Alert} error=${error} />
          <${Field} label="Email"><input type="email" required autocomplete="email" ...${bind('email')} /><//>
          <button class="btn primary block" disabled=${busy}>${busy ? 'Sending…' : 'Send reset link'}</button>
        </form>`}
      <p class="auth-links"><a href="#/login">Back to log in</a></p>
    <//>`;
}

// Opened from the password-reset email.
export function ResetPage({ token }) {
  const [v, bind] = useForm({ password: '', confirm: '' });
  const [done, setDone] = useState(null);
  const { onSubmit, error, busy } = useSubmit(async () => {
    if (v.password !== v.confirm) throw new Error("The passwords don't match.");
    const r = await api('/auth/reset-password', { method: 'POST', body: { token, password: v.password } });
    setDone(r.message);
  });
  return html`
    <${AuthShell} title="Choose a new password">
      ${done ? html`
        <${Alert} tone="success">${done}<//>
        <p class="auth-links"><a href="#/login">Log in with your new password</a></p>` : html`
        <form onSubmit=${onSubmit} class="stack">
          <${Alert} error=${error} />
          <${Field} label="New password" hint="At least 8 characters."><input type="password" required minlength="8" autocomplete="new-password" ...${bind('password')} /><//>
          <${Field} label="Confirm new password"><input type="password" required minlength="8" autocomplete="new-password" ...${bind('confirm')} /><//>
          <button class="btn primary block" disabled=${busy}>${busy ? 'Saving…' : 'Save password'}</button>
        </form>`}
    <//>`;
}

// Public tracking page for customers/recipients: no login.
export function TrackPage({ token }) {
  const { data, error, loading } = useApi(`/track/${encodeURIComponent(token)}`, { pollMs: 15000 });
  return html`
    <div class="track">
      <header class="track-header"><${Logo} /></header>
      <main class="page narrow">
        ${loading && html`<${Spinner} />`}
        ${error && html`<${Alert} error=${error} />`}
        ${data && html`
          <div class="card">
            <div class="card-head">
              <div><div class="muted small">Order</div><h1>${data.orderNumber}</h1></div>
              <${StatusBadge} status=${data.status} />
            </div>
            ${data.driver && html`<p>Your driver is <strong>${data.driver.name}</strong>.
              ${data.driver.location && html` Last seen ${timeAgo(data.driver.locationUpdatedAt)}${' · '}<a href=${mapsLink(data.driver.location)} target="_blank" rel="noopener">view on map</a>`}</p>`}
            ${data.completedAt && html`<p>Delivered ${formatDate(data.completedAt)}.</p>`}
            ${data.status !== 'cancelled' && html`<${LiveMap} stops=${data.stops} driver=${data.driver} />`}
            ${data.driver?.location && html`<p class="muted small">The map updates on its own while the driver is on the way.</p>`}
            <${StopTimeline} stops=${data.stops} />
          </div>`}
      </main>
    </div>`;
}
