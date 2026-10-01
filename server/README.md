# Choice Delivery API

The central backend for Choice Delivery: one API and one Postgres database shared by the driver app,
shippers, dispatch and any future apps. It replaces Firebase and the WordPress `wp-json` endpoints,
and it's set up to deploy on [Railway](https://railway.com) with Postgres on Railway or [Neon](https://neon.tech).

## Deploy to Railway

1. **Create a project**: in Railway, pick *New Project → Deploy from GitHub repo* and choose this repo.
2. **Set the root directory**: open the service's *Settings → Source → Root Directory* and set it to `server`.
   Railway then picks up `server/railway.json` (runs `npm start`, health check on `/health`).
3. **Add Postgres**: *New → Database → PostgreSQL* in the same project, or create a Neon project instead.
4. **Set these variables** on the API service (*Variables* tab):
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` for Railway Postgres, or your Neon connection string |
   | `JWT_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `DISPATCH_API_KEY` | *(optional)* random string that lets your website or order form create orders |
   | `PUBLIC_URL` | `https://app.choicedeliverysc.com` (password-reset links open the web app) |
   | `LEADS_EMAIL` | *(optional)* where website messages go; default `info@choicedeliverysc.com` |
   | `ORDER_ALERTS_EMAIL` | *(optional)* where "New order" alerts go when a customer's order is booked (after card payment clears); defaults to `LEADS_EMAIL` |
   | `SUPPORT_EMAIL` | *(optional)* the address drivers are told to email (and that driver emails reply to); default `info@choicedeliverysc.com` |
   | `SHOW_BUSINESS_PLANS` | *(optional)* `true` shows the monthly business plans on the website and accepts plan requests; hidden otherwise |
   | `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO` | *(optional)* emails via Resend (shipper order updates, driver applications/approvals/invites, password resets, website messages); without them emails are only written to the logs. Check with Account → Email → Send test email. `MAIL_REPLY_TO` (e.g. `info@choicedeliverysc.com`) is where replies go; `LEADS_EMAIL` is where staff notifications go |
5. **Give it domains** (*Settings → Networking → Custom Domain*): add `choicedeliverysc.com` and
   `app.choicedeliverysc.com`, then add the CNAME records Railway shows in Cloudflare DNS. `www` is
   redirected to the bare domain by a Cloudflare redirect rule, so it doesn't use a Railway domain slot.
6. **Create the first admin**. The first account can register without logging in:
   ```sh
   curl -X POST https://app.choicedeliverysc.com/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@choicedeliverysc.com","password":"<8+ chars>"}'
   ```
   The response includes a `token`. Use it to add drivers:
   ```sh
   curl -X POST https://app.choicedeliverysc.com/auth/register \
     -H "Authorization: Bearer <admin token>" -H 'Content-Type: application/json' \
     -d '{"email":"driver@example.com","password":"<8+ chars>"}'
   ```
   `role` can be `driver` (default), `dispatcher`, `admin` or `shipper` (shippers also need `organizationId`).
   Or, from a shell with `DATABASE_URL` set (for example via `railway run`): `npm run create-user -- driver@example.com <password> driver "Driver Name"`
7. **The driver app** (`driver-app/` in this repo) talks to `https://app.choicedeliverysc.com` (`extra.apiUrl` in
   `driver-app/app.json`). See `driver-app/README.md` to build and install it.

Database changes in `migrations/` are applied automatically when the service starts.

## Moving data off Firebase

- **Pickups**: in the Firebase console, go to *Realtime Database → ⋮ → Export JSON*, then run
  `DATABASE_URL=<connection string> npm run import-firebase -- ./export.json` from `server/`. Each pickup becomes an order;
  already-imported ones are skipped, so it's safe to re-run. Unfinished jobs go back to the open pool, because Firebase
  driver IDs don't carry over.
- **Driver accounts**: Firebase password hashes can't be imported. Create each driver an account
  (step 6); they can use *Forgot password* to pick their own password.
- **Driver profiles** (phone number, vehicle type): drivers re-enter these on the Profile screen.

When everything is verified, you can shut down the Firebase project and the WordPress plugin endpoints.

## Web app (shippers + dispatch)

The same service also serves the website in `web/` at `/` (and the landing page in `landing/` for the www host). It's plain JavaScript (Preact + htm, vendored in
`web/static/vendor/`), so there's no build step. Point both domains at this one Railway service:

| Address | Who uses it |
|---|---|
| `choicedeliverysc.com` | Public landing page from `landing/` (`www.` redirects here via Cloudflare) |
| `app.choicedeliverysc.com` | Shippers and dispatch in the browser, **and** the driver app's API address |
| `app.choicedeliverysc.com/#/track/<token>` | Public tracking page you can send to recipients |

Only these two custom domains are needed on Railway (the Hobby plan allows two per service).

Drivers who try to log in on the website are pointed to the phone app.

## Public website hooks

The landing page at `choicedeliverysc.com` (source in `landing/`) calls these no-login endpoints:
`GET /public/pricing`, `POST /public/quote`, `POST /public/contact`, `POST /public/contract-request`,
plus `GET /public/geocode?q=` for address suggestions (OpenStreetMap, SC/NC/GA only, cached and throttled
to their one-request-per-second limit). Messages and plan requests are stored as **leads** (`GET/PATCH /leads`,
staff only) and emailed to `LEADS_EMAIL` when email is configured.

**Pricing** (`src/pricing.js`; every amount is editable by the owner under Account → Fees & extra charges):
by vehicle, each base covering the first 10 miles: Car $25 then $1.50/mile, Minivan $35 then $2.00/mile,
Pickup Truck (half-ton) $45 then $2.50/mile (Cargo Van exists but is off). Rush (2 hours or less) +$50.
Surcharges: holiday +$25 (New Year's Day, Memorial Day, July 4th, Labor Day, Thanksgiving and the day after,
Christmas Eve/Day, New Year's Eve by default; replaces the weekend charge), weekend +$15, and from the original app
high demand (3+ open orders) +$15, bad weather +$15 (dispatch switch); lunch rush 11:30am–1:30pm +$5 is off; each can be
switched off. Times are Columbia local time; scheduled pickups use the pickup time. Distance is straight-line x 1.2
between stops with map coordinates. Orders are priced on the server when booked; demand/weather are locked in at
booking. Dispatch can set a custom price, and clearing it returns to the formula.

**Extras** (modeled on Curri's accessorial charges; amounts editable by the owner under Account → Fees & extra
charges, stored in the `fees` setting):
- Vehicle weight limits (the biggest is a half-ton pickup; no box trucks or liftgates): Car 150 lbs,
  Minivan 500 lbs, Pickup Truck 1,000 lbs.
- **No single piece over 75 lbs** (editable): shippers must enter the heaviest piece; orders with a heavier piece,
  or a total weight that can't be split into the stated number of pieces under the limit, are refused on booking,
  on edits and when a quote is booked (dispatch included).
- Weight tiers on the declared weight: up to 50 lbs included, 51–150 +$15, 151–500 +$35, 501–1000 +$75.
- **Manual review**: heavier than the top tier, or heavier than the chosen vehicle carries, isn't priced by the
  formula. The order is held as a quote marked "Needs price" (drivers never see it), dispatch is emailed at
  `LEADS_EMAIL`, and the customer is told why. When dispatch saves a price on the order, the customer is emailed
  "Your price is ready" and can book (and pay).
- $10 per stop beyond one pickup and one drop-off.
- Optional add-ons at booking: loading/unloading help +$25, inside delivery / stairs +$20.
- Charges added after booking by dispatch (`POST /orders/:id/charges`): wait time (first 15 min per stop free,
  then $10 per 15 min; the order page suggests it from when the driver arrived and finished each stop), heavier
  than declared, loading help, return trip, failed attempt, other. The shipper is emailed the reason and amount.
  Card customers pay the balance online (`POST /orders/:id/checkout`); monthly accounts are billed. Unpaid charges
  can be removed (`POST /orders/:id/charges/:chargeId/waive`).
The booking page, booking email and the website's quote calculator tell customers about these charges up front.

## Payments (Stripe)

Off until `STRIPE_SECRET_KEY` is set; until then every order is treated as billed to account.

- **Card customers** (companies with billing = "Card per order", the default) are sent to Stripe Checkout
  right after booking. Drivers don't see the job until Stripe confirms payment.
- **Monthly accounts**: set a company to "Monthly account (invoice)" on the Companies page; their jobs
  dispatch immediately and are billed outside the app. Orders dispatch creates are also billed to account.
- Dispatch can record **cash/check**, **bill to account** or **no charge** on any order.
- **Cancelling a card-paid order refunds it in full** automatically.

Setup: in the Stripe dashboard → Developers → API keys, copy the secret key into Railway as
`STRIPE_SECRET_KEY` (and make sure `PUBLIC_URL` is `https://app.choicedeliverysc.com`). On startup the
server registers its own webhook with Stripe and stores the signing secret, so no other variable is needed
(setting `STRIPE_WEBHOOK_SECRET` manually still works and takes precedence). Switching to a live key
(`sk_live_...`) registers a live webhook automatically. Admins see the status under Account → Online payments.

## Saved quotes

On the new-order page, **Save quote** keeps the order (route, details, price) without booking it. Quotes
are listed under Orders → Quotes; drivers never see them, they don't count toward high-demand pricing and
they have no tracking link. Opening one shows **Book & pay** (card customers) or **Book**. The price is
rechecked at booking (time of day, weekend, demand, weather); if it changed, nothing is booked or charged
and the customer sees the new price to confirm. A pickup time that has passed is booked as ASAP. A custom
price dispatch sets on a quote is kept. Quotes can be deleted. API: `POST /orders` with
`"saveAsQuote": true`, `POST /orders/:id/book {expectedCents}`, `DELETE /orders/:id` (quotes only).

## Drivers: applying, profiles and approval

- **Apply to drive**: `app.choicedeliverysc.com/#/drive` (linked from the website as "Drive with us") or "Apply to drive"
  in the driver app. The account starts as an **application**: the driver can sign in and finish their profile, but
  sees no jobs, can't go online and can't be assigned until approved.
- **Profile** (in the driver app): photo, phone, city/ZIP, emergency contact, vehicle (type, make, model, year,
  color, plate), driver's license (number, state, expiration), insurance (company, policy, expiration) and document
  photos (license front/back, insurance card, vehicle, registration). Required: photo, license front, insurance card,
  vehicle photo and the license/insurance details.
- **Review** (People → click a driver): see everything, open the document photos, then **Approve**, **Reject** or
  **Put on hold** (with an optional note). An **expired license or insurance** pauses an approved driver
  (no accepting, scanning, going online or being assigned) until they enter the new date.
- **Invite a driver** (People → Add an account → Driver, "Email them an invite"): approved right away; the email
  has a link to choose their password (valid 7 days) and to get the app.
- **Emails to drivers** (through Resend, like the shipper emails): application received, approved, not approved,
  on hold, and invites. Dispatch (`LEADS_EMAIL`) is emailed about each new application.
- **App download link**: set it under Account → Driver app download link (e.g. the Install link from the latest
  "Build driver app" run). It's shown at `/#/driver-app` and in approval and invite emails.
- Customers see the driver's photo and car ("White Honda Civic") on the tracking page; dispatch and the shipper
  also see the plate on the order page.

## Driver portal

Drivers log in at `app.choicedeliverysc.com` from their phone's browser (no app install): go online
(shares location every ~30s while the page is open), accept open jobs, navigate/call, mark arrival and
complete each stop with a finger-drawn signature and/or camera photo, and see their history.

## How the data fits together

One Postgres database is the single source of truth for every app (driver app, future shipper
app/portal, dispatch dashboard, website integrations). Apps only talk to this API, never to the database.

| Table | What it holds |
|---|---|
| `organizations` | Shipper companies (customers) |
| `users` | Everyone who logs in: `admin`, `dispatcher`, `driver`, `shipper` (shippers belong to an organization). Drivers also have online status and last location |
| `vehicles` | Drivers' vehicles |
| `orders` | A delivery job: company, driver, status, vehicle type, weight, price, human-readable `CD-100001` number, shareable tracking token |
| `stops` | Pickups and drop-offs of an order, in route order, each with its own proof (signature, photo, printed name, barcode) |
| `order_events` | Timeline of everything that happened to an order |

Order status moves automatically as the driver works through the stops:
`pending → accepted → at_pickup → in_transit → at_dropoff → completed` (or `cancelled`).
Stops must be done in order. An order can have several pickups and drop-offs; today's driver app
handles one of each.

Database changes live in `migrations/` as numbered SQL files. Each file runs once, on server
start. To change the database, add a new file (e.g. `003_add_invoices.sql`) and never edit old ones.

## Who can do what

| | Shipper | Driver | Dispatcher | Admin |
|---|---|---|---|---|
| Create orders | own company | – | any | any |
| See orders | own company | open jobs + own | all | all |
| Accept / work stops | – | ✓ | – | – |
| Assign drivers, set prices | – | – | ✓ | ✓ |
| Cancel | while pending | – | ✓ | ✓ |
| Create accounts | coworkers | – | drivers, shippers | anyone |

Shippers and dispatch see the driver's live location while an order is underway, on a map (Leaflet,
vendored in `web/static/vendor/`, with OpenStreetMap tiles) on the order page. **Track driver** opens the public
tracking page; **Share link** uses the phone's share sheet or copies it. Anyone with an order's tracking link
(`GET /track/<trackingUrlToken>`) sees its status, the route and the driver on a map (refreshing every 15s)
without logging in. Drivers' locations come from the driver portal while it's open and they're online.

## Creating orders from your website

Use an admin/dispatcher/shipper token, or `Authorization: Bearer $DISPATCH_API_KEY` for server-to-server:

```sh
curl -X POST https://<your-domain>/orders \
  -H "Authorization: Bearer $DISPATCH_API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "organizationId": "<optional company id>",
    "vehicleType": "Van", "weight": "10 lbs", "numberOfPieces": "2",
    "trackingNumber": "CD123456", "priceCents": 4500,
    "stops": [
      {"type": "pickup",  "address": "123 Main St, Columbia, SC", "contactName": "Warehouse",
       "contactPhone": "8035551234", "location": {"lat": 34.0007, "lng": -81.0348}},
      {"type": "dropoff", "address": "456 Oak Ave, Columbia, SC", "contactName": "Jane Doe",
       "contactPhone": "8035555678", "instructions": "Leave at front desk"}
    ]
  }'
```

New open orders send a push notification to online drivers (or all drivers, if none are online).

## API

| Method & path | Who | Purpose |
|---|---|---|
| `GET /health` | anyone | Checks the service and the database |
| `POST /auth/login` | anyone | `{email, password}` → `{token, user}` |
| `POST /auth/signup` | anyone | Shipper self-signup: `{companyName, name, email, password}` |
| `POST /auth/register` | first user / staff | Creates an account `{email, password, role, name, organizationId}` |
| `GET /auth/me` | user | Current user |
| `POST /auth/forgot-password`, `/auth/reset-password` | anyone | Password reset by email |
| `GET/PUT /users/me` | user | Profile (drivers can set `vehicleType`) |
| `PUT /users/me/push-token` | user | Expo push token |
| `PUT /users/me/location`, `/users/me/availability` | driver | `{lat, lng}` / `{online}` |
| `GET /users?role=driver&online=true`, `GET/PATCH /users/:id` | staff | Manage people (`isActive: false` disables) |
| `GET/POST /organizations`, `GET/PATCH /organizations/:id` | staff / own company | Companies |
| `GET/POST /organizations/:id/users` | staff / own company | Company members |
| `GET /orders?status=a,b&mine=true&organizationId=&driverId=&limit=&before=` | user | List (scoped by role) |
| `POST /orders` | shipper / staff | Create |
| `GET /orders/:id` | user | Details with stops, proof and timeline |
| `PATCH /orders/:id` | shipper (pending) / staff | Edit (including stops before work starts) |
| `POST /orders/:id/cancel` | shipper (pending) / staff | Cancel |
| `POST /orders/:id/assign` | staff | `{driverId}` (or `null` to unassign) |
| `POST /orders/:id/accept` | driver | Claim an open job (first driver wins) |
| `POST /orders/:id/stops/:stopId/arrive` | driver | Arrived at the next stop |
| `POST /orders/:id/stops/:stopId/complete` | driver | `{signature?, photo?, printedName?}`: a signature or photo is required |
| `POST /orders/:id/notes` | involved users | `{note}` |
| `POST /orders/scan` | driver | `{barcode}`: optional check; finds the job with that reference number and records the barcode on your next pickup (never completes it) |
| `GET /track/:token` | anyone | Public tracking |

## Local development

```sh
cd server
cp .env.example .env   # then edit DATABASE_URL / JWT_SECRET
npm install
node --env-file=.env src/index.js
```

Tests need a throwaway database (it gets wiped):

```sh
TEST_DATABASE_URL=postgres://localhost/choicedelivery_test npm test
```
