# Choice Delivery Driver (Android & iPhone)

The drivers' phone app. It uses the same server and database as the website
(`https://app.choicedeliverysc.com`), so jobs, tracking and proof of delivery show up for
dispatch and customers right away.

## What drivers can do

- **Apply to drive** right in the app (or at app.choicedeliverysc.com/#/drive). New drivers can sign in and
  finish their profile, but see no jobs until you approve them on the People page. Or invite a driver from the
  People page and they get an email to choose their password.
- **Profile**: photo, contact and emergency contact, vehicle details, driver's license and insurance with
  expiration dates, and photos of the license, insurance card, vehicle and registration. Expired documents pause
  the account until updated. **Change password** is under Account.
- **Go online / offline.** While online, the phone shares its location (every ~30 seconds while driving) so
  the order page and the customer's tracking link show the driver on the map, **even with the screen off**
  when the driver allows location "All the time". Android shows a small "You're online" notification while it runs.
- **Job alerts**: a notification when a new job becomes available (works out of the box, no push service to set up).
- **Accept jobs**, then work through each stop in order: **Navigate** (Google/Apple Maps), **Call** the contact,
  **I've arrived** (starts a wait timer showing the free minutes from your rate card), then confirm with a
  finger **signature** and/or a **photo** plus the printed name.
- **Scan** a package barcode at pickup to claim and pick up that shipment in one step.
- See booked extras (loading help, inside delivery), piece count and heaviest piece, and add **notes** for dispatch.
- **History** of completed deliveries, and **Account** for name, phone and vehicle.

## Getting it onto phones (no computer needed)

One-time setup, about 10 minutes:

1. Create a free account at **expo.dev** (Expo builds the app on their servers).
2. On expo.dev: your avatar → **Account settings → Access tokens → Create token**. Copy it.
3. On GitHub, in this repository: **Settings → Secrets and variables → Actions → New repository secret**.
   Name: `EXPO_TOKEN`, value: the token. Don't paste it anywhere else.

Every build after that:

1. On GitHub: **Actions → Build driver app → Run workflow** (platform `android`, profile `preview`).
2. It takes about 15–20 minutes. Open the finished run: the summary has an **Install / download** link.
3. Send that link to your drivers. On Android they open it, allow installing from their browser, and install.

The first build creates the Expo project and the Android signing key automatically (kept safely on Expo's
servers; every later build uses the same key, so updates install over the old version).

## Google Play and the App Store (later)

- **Google Play** ($25 one-time developer account): run the workflow with profile `production`, then upload the
  `.aab` from the build page in the Play Console. Because the app uses background location, Google asks for a
  short video and explanation of why (drivers sharing location with customers while online).
- **iPhone** needs an Apple Developer account ($99/year). The first iOS build must connect that account to Expo
  (Expo asks for your Apple login once), then TestFlight/App Store builds can run from the same workflow with
  platform `ios`.

## For developers

```sh
cd driver-app
npm ci
npx expo start                      # needs a development build or Expo Go on a phone
EXPO_PUBLIC_API_URL=http://<your-computer>:3000 npx expo start   # point at a local server
TEST_DATABASE_URL=postgres://... npm test   # runs the app's API client against ../server (database is wiped)
```

Code: `src/app/` (screens, Expo Router), `src/lib/api.js` (server calls, plain JS so tests can use it),
`src/lib/tracking.js` (background location + job alerts), `src/lib/notifications.js`, `src/components/`.
Native permissions and the app id `com.choicedeliverysc.driver` are in `app.json`; build profiles in `eas.json`.
