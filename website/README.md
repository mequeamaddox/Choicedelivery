# Choice Delivery SC — public website (www.choicedeliverysc.com)

Static landing site hosted on Hostinger. It stays separate from the app on purpose: marketing pages
can change without touching the booking system.

| File | Purpose |
|---|---|
| `index.html` | Landing page |
| `privacy.html` | Privacy policy |
| `logo.png`, `favicon.png` | Brand images (no longer loaded from the old WordPress site) |

## What connects to the backend (`https://api.choicedeliverysc.com`)

- **Quick Quote Calculator** → `POST /public/quote`: published rate ($25 standard, $50 same-day),
  approximate distance and a 200-mile service-area check.
- **Request This Plan** buttons → a short form → `POST /public/contract-request`
- **Contact form** → `POST /public/contact`

Plan requests and messages appear under **Leads** at `app.choicedeliverysc.com` (admins and dispatch),
and are emailed to `LEADS_EMAIL` (default `info@choicedeliverysc.com`) once `RESEND_API_KEY` is set on Railway.
Both forms include a hidden spam trap and are rate limited.

"Launch App", "Create Account" and "Log In" go to `https://app.choicedeliverysc.com`.

## Publishing to Hostinger

1. hPanel → **Websites → File Manager** → `public_html`.
2. Upload `index.html`, `privacy.html`, `logo.png` and `favicon.png`, replacing the old files.
3. If WordPress is still installed in `public_html`, its `index.php` can take priority over `index.html`.
   Rename or remove WordPress files only after backing them up.
