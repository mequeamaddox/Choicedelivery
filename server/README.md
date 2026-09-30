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
   | `RESEND_API_KEY`, `MAIL_FROM` | *(optional)* for password-reset emails via Resend; without them reset links are only written to the logs |
5. **Get a public URL**: *Settings → Networking → Generate Domain*. You'll get something like `https://choicedelivery-api.up.railway.app`.
6. **Create the first admin**. The first account can register without logging in:
   ```sh
   curl -X POST https://<your-domain>/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@choicedeliverysc.com","password":"<8+ chars>"}'
   ```
   The response includes a `token`. Use it to add drivers:
   ```sh
   curl -X POST https://<your-domain>/auth/register \
     -H "Authorization: Bearer <admin token>" -H 'Content-Type: application/json' \
     -d '{"email":"driver@example.com","password":"<8+ chars>"}'
   ```
   `role` can be `driver` (default), `dispatcher`, `admin` or `shipper` (shippers also need `organizationId`).
   Or, from a shell with `DATABASE_URL` set (for example via `railway run`): `npm run create-user -- driver@example.com <password> driver "Driver Name"`
7. **Point the app at it**: set `EXPO_PUBLIC_API_URL=https://<your-domain>` (in a root `.env` for
   local dev, or as an EAS environment variable for builds), or replace `extra.apiUrl` in `app.json`. Then rebuild the app.

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

Shippers and dispatch see the driver's live location while an order is underway. Anyone with
an order's tracking link (`GET /track/<trackingUrlToken>`) sees its status without logging in.

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
| `POST /orders/:id/stops/:stopId/complete` | driver | `{signature?, photo?, printedName?}` |
| `POST /orders/:id/notes` | involved users | `{note}` |
| `POST /orders/scan` | driver | `{barcode}`: picks up the order with that tracking number |
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
