import { html, render, useState, useEffect, useRoute, match, navigate, getUser, isStaff, onSessionChange, restoreSession, bookingDraft } from './lib.js';
import { Spinner } from './components.js';
import { LoginPage, SignupPage, ForgotPage, ResetPage, TrackPage, DriverSignupPage, DriverAppPage } from './pages-public.js';
import { OrdersPage, NewOrderPage, OrderPage } from './pages-orders.js';
import { PeoplePage, CompaniesPage, TeamPage, AccountPage, LeadsPage, DriverDetailPage, PayoutsPage } from './pages-admin.js';
import { DriverJobsPage, DriverJobPage, DriverHistoryPage, PayoutMethodPage } from './pages-driver.js';
import { DriverMileagePage } from './pages-mileage.js';
import { ShippingFormPage, ShippingLabelPage } from './pages-shipping.js';
import { CustodyPage } from './pages-custody.js';
import { InvoicesPage, InvoicePage, BillingPage } from './pages-invoices.js';
import { ExpensesPage } from './pages-expenses.js';
import { GigPage } from './pages-gig.js';
import { PhoneAppPage, DriverAlertsPage, setupHomeScreenApp } from './pages-phone.js';
import { StoreKitPage } from './pages-store.js';
import { DriverAgreementPage, SignedAgreementPage } from './pages-agreement.js';

const MedicalSignupPage = () => html`<${SignupPage} medical=${true} />`;
const PUBLIC = { '/login': LoginPage, '/signup': SignupPage, '/signup/medical': MedicalSignupPage, '/forgot': ForgotPage, '/drive': DriverSignupPage };

function App() {
  const path = useRoute();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const off = onSessionChange((u) => { setUser(u); setupHomeScreenApp(u); });
    restoreSession().then((u) => { setUser(u); setupHomeScreenApp(u); setReady(true); });
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

  // A store's counter QR code: its customers book the delivery of their purchase (always as a guest, so
  // a cashier signed in to the store's account on the tablet still books for the customer).
  const storeLink = match('/store/:code', path);
  if (storeLink) return html`<${NewOrderPage} key=${storeLink.code} guest=${true} storeCode=${storeLink.code} />`;

  // Guest checkout from the website's "Book This Delivery"; signed-in customers get the normal form.
  if (path.split('?')[0] === '/book') {
    if (!user) return html`<${NewOrderPage} guest=${true} />`;
    navigate('/orders/new');
    return null;
  }
  if (!user) {
    const Page = PUBLIC[path];
    if (Page) return html`<${Page} />`;
    // Come back here after logging in (e.g. the website footer's "Shipping form" link).
    if (path && path !== '/') { try { sessionStorage.setItem('afterLogin', path); } catch { /* private mode */ } }
    navigate('/login');
    return null;
  }
  // Drivers get the driver portal.
  if (user.role === 'driver') {
    const job = match('/driver/job/:id', path);
    if (path === '/driver') return html`<${DriverJobsPage} />`;
    if (job) return html`<${DriverJobPage} key=${job.id} id=${job.id} />`;
    if (path === '/driver/history') return html`<${DriverHistoryPage} />`;
    if (path === '/driver/mileage') return html`<${DriverMileagePage} />`;
    if (path === '/driver/agreement') return html`<${DriverAgreementPage} />`;
    if (path === '/driver/alerts') return html`<${DriverAlertsPage} />`;
    if (path === '/account') return html`<${AccountPage} />`;
    navigate('/driver');
    return null;
  }

  // "Drive with us" from the footer: the driver application, even while signed in as a shipper.
  if (path === '/drive') return html`<${DriverSignupPage} />`;
  if (PUBLIC[path] || path === '/') {
    let next = null;
    try { next = sessionStorage.getItem('afterLogin'); sessionStorage.removeItem('afterLogin'); } catch { /* private mode */ }
    // Came from "Book This Delivery" on the website: straight to the new order, filled in.
    if (bookingDraft()) next = '/orders/new';
    navigate(next && !PUBLIC[next] ? next : '/orders');
    return null;
  }

  const order = match('/orders/:id', path);
  if (path === '/orders') return html`<${OrdersPage} />`;
  if (path.split('?')[0] === '/orders/new') return html`<${NewOrderPage} key=${path} />`;
  if (path === '/shipping-form') return html`<${ShippingFormPage} />`;
  const label = match('/shipping-forms/:code', path);
  if (label) return html`<${ShippingLabelPage} key=${label.code} code=${label.code} />`;
  if (path === '/invoices') return html`<${InvoicesPage} />`;
  if (path === '/expenses' && user.role === 'admin') return html`<${ExpensesPage} />`;
  if (path === '/gig' && isStaff(user)) return html`<${GigPage} />`;
  if (path === '/phone-app' && isStaff(user)) return html`<${PhoneAppPage} />`;
  const storeKit = match('/store-kit/:id', path);
  if (storeKit) return html`<${StoreKitPage} key=${storeKit.id} orgId=${storeKit.id} />`;
  if (path === '/store-kit' && user.role === 'shipper') return html`<${StoreKitPage} />`;
  if (path === '/billing' && user.role === 'shipper') return html`<${BillingPage} />`;
  const invoice = match('/invoices/:id', path);
  if (invoice) return html`<${InvoicePage} key=${invoice.id} id=${invoice.id} />`;
  const custody = user.role !== 'driver' && match('/orders/:id/custody', path);
  if (custody) return html`<${CustodyPage} key=${custody.id} id=${custody.id} />`;
  if (order) return html`<${OrderPage} key=${order.id} id=${order.id} />`;
  if (path === '/account') return html`<${AccountPage} />`;
  if (path === '/team' && user.role === 'shipper') return html`<${TeamPage} />`;
  if (path === '/people' && isStaff(getUser())) return html`<${PeoplePage} />`;
  const signedAgreement = isStaff(user) && match('/people/:id/agreement', path);
  if (signedAgreement) return html`<${SignedAgreementPage} key=${signedAgreement.id} userId=${signedAgreement.id} />`;
  const person = match('/people/:id', path);
  if (person && isStaff(getUser())) return html`<${DriverDetailPage} key=${person.id} id=${person.id} />`;
  if (path === '/leads' && isStaff(getUser())) return html`<${LeadsPage} />`;
  if (path === '/companies' && isStaff(getUser())) return html`<${CompaniesPage} />`;
  if (path === '/payouts' && isStaff(getUser())) return html`<${PayoutsPage} />`;
  navigate('/orders');
  return null;
}

render(html`<${App} />`, document.getElementById('app'));
