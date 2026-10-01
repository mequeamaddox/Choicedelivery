import { html, useState, useEffect, api, login, signup, driverSignup, createOwner, navigate, useApi, formatDate, timeAgo, mapsLink, VEHICLE_TYPES } from './lib.js';
import { AuthShell, Alert, Field, Spinner, StatusBadge, StopTimeline, Logo, LiveMap, LegalLinks } from './components.js';

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
    // No navigate here: once signed in, the app sends them on from the login page (back to where they
    // were headed, or their orders).
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
      <p class="auth-links">Want to drive for us? <a href="#/drive">Apply to drive</a></p>
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
        <p class="small muted">By creating an account you agree to our <${LegalLinks} />.</p>
        <button class="btn primary block" disabled=${busy}>${busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p class="auth-links">Already have an account? <a href="#/login">Log in</a></p>
    <//>`;
}

// Public "Apply to drive" form. The account starts as an application; staff approve it.
export function DriverSignupPage() {
  const [v, bind] = useForm({ name: '', email: '', phoneNumber: '', password: '', city: '', zip: '',
    type: 'Car', make: '', model: '', year: '', color: '', plate: '' });
  const [agreed, setAgreed] = useState(false);
  const { onSubmit, error, busy } = useSubmit(async () => {
    await driverSignup({
      name: v.name, email: v.email, phoneNumber: v.phoneNumber, password: v.password, city: v.city, zip: v.zip, agreed,
      vehicle: { type: v.type, make: v.make, model: v.model, year: v.year, color: v.color, plate: v.plate },
    });
    navigate('/driver-app?applied=1');
  });
  return html`
    <${AuthShell} title="Drive with Choice Delivery" subtitle="Deliver in and around Columbia on your schedule. Apply in 2 minutes; we'll review it and email you.">
      <form onSubmit=${onSubmit} class="stack">
        <${Alert} error=${error} />
        <h3>About you</h3>
        <${Field} label="Full name"><input required autocomplete="name" ...${bind('name')} /><//>
        <div class="grid-2 tight">
          <${Field} label="Mobile phone"><input type="tel" required autocomplete="tel" ...${bind('phoneNumber')} /><//>
          <${Field} label="ZIP code"><input inputmode="numeric" required maxlength="10" autocomplete="postal-code" ...${bind('zip')} /><//>
        </div>
        <${Field} label="City"><input required autocomplete="address-level2" ...${bind('city')} /><//>
        <${Field} label="Email"><input type="email" required autocomplete="email" ...${bind('email')} /><//>
        <${Field} label="Password" hint="At least 8 characters. You'll use it to sign in to the driver app."><input type="password" required minlength="8" autocomplete="new-password" ...${bind('password')} /><//>
        <h3>Your vehicle</h3>
        <${Field} label="Type">
          <select value=${v.type} onChange=${(e) => bind('type').onInput(e)}>${VEHICLE_TYPES.map((t) => html`<option>${t}</option>`)}</select>
        <//>
        <div class="grid-2 tight">
          <${Field} label="Make"><input required placeholder="Honda" ...${bind('make')} /><//>
          <${Field} label="Model"><input required placeholder="Civic" ...${bind('model')} /><//>
          <${Field} label="Year"><input required inputmode="numeric" maxlength="4" placeholder="2019" ...${bind('year')} /><//>
          <${Field} label="Color"><input required placeholder="White" ...${bind('color')} /><//>
        </div>
        <${Field} label="License plate"><input required maxlength="12" ...${bind('plate')} /><//>
        <label class="check-row">
          <input type="checkbox" checked=${agreed} onChange=${(e) => setAgreed(e.target.checked)} />
          <span class="small">I'm 21 or older with a valid driver's license and auto insurance, I agree to work as an independent
            contractor, I consent to a background and driving-record check, and I agree to the <${LegalLinks} />.</span>
        </label>
        <button class="btn primary block" disabled=${busy || !agreed}>${busy ? 'Sending…' : 'Apply to drive'}</button>
      </form>
      <p class="auth-links">Already a driver? <a href="#/driver-app">Get the driver app</a> · <a href="#/login">Log in</a></p>
    <//>`;
}

// Where drivers get the phone app (the install link is set by the owner under Account).
export function DriverAppPage() {
  const { data } = useApi('/public/driver-app');
  const applied = location.hash.includes('applied=1');
  return html`
    <${AuthShell} title=${applied ? 'Application received!' : 'Choice Delivery Driver app'}
      subtitle=${applied ? "We'll review it and email you, usually within 1–2 business days." : 'For Choice Delivery drivers.'}>
      <div class="stack">
        ${applied && html`<${Alert} tone="success">Next: install the app and sign in with the email and password you just chose to
          add your profile photo, driver's license, insurance and vehicle photo. Complete profiles get approved faster.<//>`}
        ${data?.url ? html`
          <a class="btn primary block big" href=${data.url} rel="noopener">Download for Android</a>
          <p class="small muted">Open this page on your phone. After downloading, tap the file and allow installing from your browser if asked.
            iPhone version coming soon.</p>` : html`
          <p class="muted">The app download link will be here soon. Until then you can sign in on this website from your phone's browser.</p>`}
        <a class="btn block" href="#/login">Sign in on the website instead</a>
      </div>
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
        <p class="auth-links"><a href="#/login">Log in with your new password</a></p>
        <p class="auth-links">Driver? <a href="#/driver-app">Get the driver app</a> and sign in there.</p>` : html`
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
            ${data.driver && html`<div class="driver-head">${data.driver.photoUrl && html`<img class="avatar big" src=${data.driver.photoUrl} alt="" />`}
              <div><p>Your driver is <strong>${data.driver.name}</strong>${data.driver.vehicle ? html`, driving a <strong>${data.driver.vehicle}</strong>` : ''}.</p></div></div>
              <p>
              ${data.driver.location && html` Last seen ${timeAgo(data.driver.locationUpdatedAt)}${' · '}<a href=${mapsLink(data.driver.location)} target="_blank" rel="noopener">view on map</a>`}</p>`}
            ${data.completedAt && html`<p>Delivered ${formatDate(data.completedAt)}.</p>`}
            ${data.status !== 'cancelled' && html`<${LiveMap} stops=${data.stops} driver=${data.driver} />`}
            ${data.driver?.location && html`<p class="muted small">The map updates on its own while the driver is on the way.</p>`}
            <${StopTimeline} stops=${data.stops} />
          </div>`}
      </main>
    </div>`;
}
