import { html, render, useState, useEffect, useRoute, match, navigate, getUser, isStaff, onSessionChange, restoreSession } from './lib.js';
import { Spinner } from './components.js';
import { LoginPage, SignupPage, ForgotPage, ResetPage, TrackPage, DriverSignupPage, DriverAppPage } from './pages-public.js';
import { OrdersPage, NewOrderPage, OrderPage } from './pages-orders.js';
import { PeoplePage, CompaniesPage, TeamPage, AccountPage, LeadsPage, DriverDetailPage, PayoutsPage } from './pages-admin.js';
import { DriverJobsPage, DriverJobPage, DriverHistoryPage, PayoutMethodPage } from './pages-driver.js';

const PUBLIC = { '/login': LoginPage, '/signup': SignupPage, '/forgot': ForgotPage, '/drive': DriverSignupPage };

function App() {
  const path = useRoute();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const off = onSessionChange(setUser);
    restoreSession().then((u) => { setUser(u); setReady(true); });
    return off;
  }, []);

  // Pages that work whether or not someone is logged in.
  const track = match('/track/:token', path);
  if (track) return html`<${TrackPage} token=${track.token} />`;
  const reset = match('/reset/:token', path);
  if (reset) return html`<${ResetPage} token=${reset.token} />`;
  if (path.split('?')[0] === '/driver-app') return html`<${DriverAppPage} />`;
  // Opened from the driver app with its own short-lived link, so it works without a website login.
  if (path.split('?')[0] === '/driver/payout-method' && (path.includes('t=') || (ready && user?.role === 'driver'))) {
    return html`<${PayoutMethodPage} />`;
  }
  if (!ready) return html`<div class="page"><${Spinner} /></div>`;

  if (!user) {
    const Page = PUBLIC[path];
    if (Page) return html`<${Page} />`;
    navigate('/login');
    return null;
  }
  // Drivers get the driver portal.
  if (user.role === 'driver') {
    const job = match('/driver/job/:id', path);
    if (path === '/driver') return html`<${DriverJobsPage} />`;
    if (job) return html`<${DriverJobPage} key=${job.id} id=${job.id} />`;
    if (path === '/driver/history') return html`<${DriverHistoryPage} />`;
    if (path === '/account') return html`<${AccountPage} />`;
    navigate('/driver');
    return null;
  }

  if (PUBLIC[path] || path === '/') {
    navigate('/orders');
    return null;
  }

  const order = match('/orders/:id', path);
  if (path === '/orders') return html`<${OrdersPage} />`;
  if (path === '/orders/new') return html`<${NewOrderPage} />`;
  if (order) return html`<${OrderPage} key=${order.id} id=${order.id} />`;
  if (path === '/account') return html`<${AccountPage} />`;
  if (path === '/team' && user.role === 'shipper') return html`<${TeamPage} />`;
  if (path === '/people' && isStaff(getUser())) return html`<${PeoplePage} />`;
  const person = match('/people/:id', path);
  if (person && isStaff(getUser())) return html`<${DriverDetailPage} key=${person.id} id=${person.id} />`;
  if (path === '/leads' && isStaff(getUser())) return html`<${LeadsPage} />`;
  if (path === '/companies' && isStaff(getUser())) return html`<${CompaniesPage} />`;
  if (path === '/payouts' && isStaff(getUser())) return html`<${PayoutsPage} />`;
  navigate('/orders');
  return null;
}

render(html`<${App} />`, document.getElementById('app'));
