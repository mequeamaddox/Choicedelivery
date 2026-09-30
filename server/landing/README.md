# Choice Delivery SC — public website (www.choicedeliverysc.com)

The public landing site. Marketing pages live in their own files so they can change without touching the booking system.

| File | Purpose |
|---|---|
| `index.html` | Landing page |
| `privacy.html` | Privacy policy |
| `logo.png`, `favicon.png` | Brand images (no longer loaded from the old WordPress site) |

## What connects to the backend (same server)

- **Quick Quote Calculator** → `POST /public/quote`: the same formula orders are priced with
  ($25 for the first 5 miles, $1.50 per extra mile, +$50 rush, plus weekend/lunch/high-demand/weather
  surcharges), using approximate driving distance, plus a 200-mile service-area check.
- **Request This Plan** buttons → a short form → `POST /public/contract-request`
- **Contact form** → `POST /public/contact`

Plan requests and messages appear under **Leads** at `app.choicedeliverysc.com` (admins and dispatch),
and are emailed to `LEADS_EMAIL` (default `info@choicedeliverysc.com`) once `RESEND_API_KEY` is set on Railway.
Both forms include a hidden spam trap and are rate limited.

"Launch App", "Create Account" and "Log In" go to `https://app.choicedeliverysc.com`.

## Hosting

Served by the same Railway service as the app and API (see `src/app.js`): requests for
`www.choicedeliverysc.com` get these files, and `choicedeliverysc.com` redirects to `www`.
To change the page, edit the files here and push; Railway redeploys automatically.
The host names can be changed with the `LANDING_HOSTS` variable.
