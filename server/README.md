# Choice Delivery API

Backend for the Courier Empire Driver app. It replaces Firebase (Auth, Realtime Database,
Firestore) and the WordPress `wp-json` endpoints with a single Node/Express service
backed by Postgres, and it's set up to deploy on [Railway](https://railway.com).

## Deploy to Railway

1. **Create a project**: in Railway, pick *New Project → Deploy from GitHub repo* and choose this repo.
2. **Set the root directory**: open the service's *Settings → Source → Root Directory* and set it to `server`.
   Railway then picks up `server/railway.json` (runs `npm start`, health check on `/health`).
3. **Add Postgres**: *New → Database → PostgreSQL* in the same project.
4. **Set these variables** on the API service (*Variables* tab):
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `JWT_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `DISPATCH_API_KEY` | *(optional)* random string that lets your website/order form create pickups |
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
   Or, from a shell with `DATABASE_URL` set (for example via `railway run`): `npm run create-user -- driver@example.com <password> driver`
7. **Point the app at it**: set `EXPO_PUBLIC_API_URL=https://<your-domain>` (in a root `.env` for
   local dev, or as an EAS environment variable for builds), or replace `extra.apiUrl` in `app.json`. Then rebuild the app.

The database schema is created automatically every time the service starts.

## Moving data off Firebase

- **Pickups**: in the Firebase console, go to *Realtime Database → ⋮ → Export JSON*, then run
  `railway run npm run import-firebase -- ./export.json` from `server/`. Existing IDs are skipped, so it's safe to re-run.
  Imported jobs are not linked to the new driver accounts, because Firebase UIDs don't carry over.
- **Driver accounts**: Firebase password hashes can't be imported. Create each driver an account
  (step 6); they can use *Forgot password* to pick their own password.
- **Driver profiles** (phone number, vehicle type): drivers re-enter these on the Profile screen.

When everything is verified, you can shut down the Firebase project and the WordPress plugin endpoints.

## Creating pickups (replacing WordPress)

New jobs are created with `POST /pickups`. Authenticate with an admin token or `Authorization: Bearer $DISPATCH_API_KEY`:

```sh
curl -X POST https://<your-domain>/pickups \
  -H "Authorization: Bearer $DISPATCH_API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "contact_name": "Jane Doe", "contact_phone": "8035551234",
    "pickup_address": "123 Main St, Columbia, SC", "destination_address": "456 Oak Ave, Columbia, SC",
    "weight": "10 lbs", "number_of_pieces": "2", "vehicle_type": "Van",
    "tracking_number": "CD123456",
    "pickup_location": {"lat": 34.0007, "lng": -81.0348},
    "delivery_location": {"lat": 34.0100, "lng": -81.0200}
  }'
```

Each driver with push notifications enabled gets notified about new pending pickups.

## API

| Method & path | Who | Purpose |
|---|---|---|
| `GET /health` | anyone | Checks the service and the database |
| `POST /auth/login` | anyone | `{email, password}` → `{token, user}` |
| `GET /auth/me` | user | Returns the current user |
| `POST /auth/register` | first user / admin | Creates an account |
| `POST /auth/forgot-password` | anyone | Emails a reset link |
| `POST /auth/reset-password` | anyone | `{token, password}` |
| `GET /drivers/me`, `PUT /drivers/me` | user | Reads or updates the profile |
| `PUT /drivers/me/push-token` | user | Registers an Expo push token |
| `GET /drivers`, `DELETE /drivers/:id` | admin | Manages drivers |
| `GET /pickups?status=pending` | user | Pending jobs plus your own (admins see all) |
| `GET /pickups/mine?status=Completed` | user | Your jobs |
| `GET /pickups/:id` | user | One job |
| `POST /pickups/:id/accept` | driver | Claims a pending job (first driver wins) |
| `POST /pickups/:id/status` | driver | `{status: "picked up" \| "in transit" \| "delivered"}` |
| `POST /pickups/:id/confirm-pickup` | driver | `{signature?, image?}` → In Transit |
| `POST /pickups/:id/complete` | driver | `{signature?, image?, printedName}` → Completed |
| `POST /pickups/:id/notes` | driver | `{note}` |
| `POST /pickups/scan` | driver | `{barcode}` → marks the job with that tracking number picked up |
| `POST /pickups`, `PATCH /pickups/:id`, `DELETE /pickups/:id` | admin / dispatch key | Manages jobs |

## Local development

```sh
cd server
cp .env.example .env   # then edit DATABASE_URL / JWT_SECRET
npm install
node --env-file=.env src/index.js
```
