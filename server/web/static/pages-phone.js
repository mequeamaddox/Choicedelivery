// The home-screen app: "Choice Dispatch" for the owner and dispatch (with phone alerts), "Choice Delivery"
// for customers. setupHomeScreenApp picks the right app name and icon and starts the service worker;
// PhoneAppPage (#/phone-app) installs it and turns alerts on.
import { html, useState, useEffect, api, useApi, isStaff } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, ActionButton } from './components.js';

let installPrompt = null; // Android/Chrome's "Install app" offer, saved until the button is tapped
const installListeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  installListeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => { installPrompt = null; installListeners.forEach((fn) => fn()); });

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function setupHomeScreenApp(user) {
  const staff = !!user && isStaff(user);
  const driver = user?.role === 'driver';
  const link = document.getElementById('app-manifest');
  const want = staff ? '/manifest-dispatch.webmanifest' : driver ? '/manifest-driver.webmanifest' : '/manifest.webmanifest';
  if (link && link.getAttribute('href') !== want) link.setAttribute('href', want);
  const title = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (title) title.setAttribute('content', staff ? 'Choice Dispatch' : driver ? 'Choice Driver' : 'Choice Delivery');
  const icon = document.querySelector('link[rel="apple-touch-icon"]');
  if (icon) icon.setAttribute('href', staff ? '/static/dispatch-icon-192.png' : '/static/app-icon-192.png');
  if ((staff || driver) && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

// For the driver portal: job alerts are on for this phone/browser (undefined while checking).
export function useJobAlertsOn() {
  const [on, setOn] = useState(undefined);
  useEffect(() => { currentSubscription().then((s) => setOn(!!s)).catch(() => setOn(false)); }, []);
  return on;
}

// The browser wants the key as bytes.
function keyBytes(base64url) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

function InstallCard({ driver = false }) {
  const app = driver ? 'Choice Driver' : 'Choice Dispatch';
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    installListeners.add(fn);
    return () => installListeners.delete(fn);
  }, []);
  if (standalone()) {
    return html`<section class="card"><h2>1. App installed ✓</h2><p class="small muted">You're using ${app} from your home screen.</p></section>`;
  }
  return html`
    <section class="card stack">
      <h2>1. Put ${app} on your home screen</h2>
      ${installPrompt ? html`
        <p class="small">It opens full screen with its own icon, and you stay logged in.</p>
        <div><button class="btn primary" onClick=${async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); installPrompt = null; rerender((n) => n + 1); }}>
          Install ${app}</button></div>`
      : isIos() ? html`
        <ol class="small">
          <li>Open this page in <strong>Safari</strong>.</li>
          <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
          <li>Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open <strong>${app}</strong> from your home screen, log in, and come back to this page to turn on alerts.</li>
        </ol>
        <p class="small"><strong>iPhone:</strong> job alerts only work from the home screen icon, not from Safari itself (iOS 16.4 or newer).</p>`
      : html`
        <ol class="small">
          <li>Open this page in <strong>Chrome</strong> on your phone.</li>
          <li>Tap the <strong>⋮</strong> menu at the top right.</li>
          <li>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>), then <strong>Install</strong>.</li>
          <li>Open <strong>${app}</strong> from your home screen and come back to this page to turn on alerts.</li>
        </ol>`}
      ${!driver && html`<p class="small muted">Log in here with your owner login. Your Choice Driver app stays logged in to your driver account; they're separate apps.</p>`}
    </section>`;
}

function AlertsCard({ driver = false }) {
  const app = driver ? 'Choice Driver' : 'Choice Dispatch';
  const r = useApi('/push');
  const [sub, setSub] = useState(undefined);
  const [error, setError] = useState(null);
  const [tested, setTested] = useState(false);
  useEffect(() => { currentSubscription().then(setSub).catch(() => setSub(null)); }, []);
  const cfg = r.data;
  if (!pushSupported()) {
    return html`<section class="card"><h2>2. Phone alerts</h2>
      <p class="small">${isIos() ? `On iPhone, alerts work once ${app} is on your home screen. Open it from there and come back to this page.`
        : "This browser can't show alerts. Open this page in Chrome."}</p></section>`;
  }
  const blocked = Notification.permission === 'denied';
  const turnOn = async () => {
    setError(null);
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Alerts are blocked for this app. Allow notifications in your phone settings, then try again.');
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey) });
    await api('/push/subscribe', { method: 'POST', body: { subscription: s.toJSON(), device: navigator.userAgent.slice(0, 120) } });
    setSub(s);
    r.reload();
  };
  const turnOff = async () => {
    setError(null);
    if (sub) {
      await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe().catch(() => {});
    }
    setSub(null);
    r.reload();
  };
  return html`
    <section class="card stack">
      <h2>2. Phone alerts</h2>
      <${Alert} error=${error || r.error} />
      ${!cfg || sub === undefined ? html`<${Spinner} />` : html`
        ${sub
          ? html`<p class="small"><strong>Alerts are on for this phone.</strong> You'll get them even when the app is closed. Tap one to open it.</p>
            ${tested && html`<${Alert} tone="success">Test sent. It should show up in a few seconds.<//>`}
            <div class="inline">
              <${ActionButton} class="btn" onError=${setError} onClick=${async () => { setTested(false); await api('/push/test', { method: 'POST' }); setTested(true); }}>Send a test alert<//>
              <${ActionButton} class="btn" onError=${setError} onClick=${turnOff}>Turn off on this phone<//>
            </div>`
          : blocked
          ? html`<p class="small">Alerts are blocked for this app. In your phone's <strong>Settings → ${isIos() ? 'Notifications' : 'Apps → Chrome'} → ${app}</strong>, allow them, then reload this page.</p>`
          : html`<p class="small">${driver ? 'Get an alert on this phone when a new job comes in, even when the app is closed.' : 'Get an alert on this phone for new orders, quotes waiting on you and more.'} Your phone will ask to allow notifications: tap <strong>Allow</strong>.</p>
            <div><${ActionButton} class="btn primary" onError=${setError} onClick=${turnOn}>Turn on alerts<//></div>`}
        ${!driver && html`<h3>What to alert me about</h3>`}
        <ul class="plain-list">${cfg.kinds.map((k) => html`<li key=${k.key}>
          <label class="inline"><input type="checkbox" checked=${k.on}
            onChange=${async (e) => { try { await api('/push/prefs', { method: 'PATCH', body: { [k.key]: e.target.checked } }); r.reload(); } catch (err) { setError(err); } }} />
            ${k.label}</label></li>`)}</ul>
        <p class="small muted">${driver ? 'Go online on the Jobs page to get alerts for open jobs.' : 'These are for you only. Your email alerts keep coming too.'}${cfg.devices > 1 ? ` Alerts are on for ${cfg.devices} phones or browsers.` : ''}</p>`}
    </section>`;
}

// Drivers using the website (e.g. on iPhone): put it on the home screen and turn on job alerts.
export function DriverAlertsPage() {
  return html`
    <${Layout}>
      <${PageHeader} title="Job alerts" subtitle="Get new jobs on this phone, like the Android driver app." />
      <${InstallCard} driver=${true} />
      <${AlertsCard} driver=${true} />
    <//>`;
}

export function PhoneAppPage() {
  return html`
    <${Layout}>
      <${PageHeader} title="Phone app & alerts" subtitle="Choice Dispatch: your dispatch tools as an app on your phone." />
      <${InstallCard} />
      <${AlertsCard} />
    <//>`;
}
