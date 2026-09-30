import { html, render, useState, useEffect, useRoute, match, navigate, getUser, isStaff, onSessionChange, restoreSession } from './lib.js';
import { Spinner } from './components.js';
import { LoginPage, SignupPage, ForgotPage, ResetPage, TrackPage } from './pages-public.js';
import { OrdersPage, NewOrderPage, OrderPage } from './pages-orders.js';
import { PeoplePage, CompaniesPage, TeamPage, AccountPage } from './pages-admin.js';

const PUBLIC = { '/login': LoginPage, '/signup': SignupPage, '/forgot': ForgotPage };

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
  if (!ready) return html`<div class="page"><${Spinner} /></div>`;

  if (!user) {
    const Page = PUBLIC[path];
    if (Page) return html`<${Page} />`;
    navigate('/login');
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
  if (path === '/companies' && isStaff(getUser())) return html`<${CompaniesPage} />`;
  navigate('/orders');
  return null;
}

render(html`<${App} />`, document.getElementById('app'));
