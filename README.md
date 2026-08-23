# Sanaullah Mobile Communication — PWA App

An installable, offline-first Progressive Web App for the shop: POS/billing,
inventory, customers, repairs, installments, suppliers, expenses, and reports.

## What's included
- **PWA**: manifest.json + service-worker.js → installable, works offline, add-to-home-screen "Install App" prompt appears automatically in supported browsers.
- **Offline-first storage**: `js/db.js` uses IndexedDB. Every screen reads/writes here first, so the app is fully usable with no internet.
- **Firebase sync scaffold**: `js/firebase-sync.js` queues every offline change and pushes it to Firestore the moment you're back online — once you plug in your own Firebase config (see below). Until then the app runs offline-only with zero errors.
- **Dark/Light theme** toggle in Settings.
- **Modules**: Dashboard, POS/Billing (cart + stock deduction), Products (with IMEI/serial field + low-stock flag), Customers, Repairs (status pipeline), Installments (EMI tracking with remaining balance), Suppliers, Expenses, Reports (totals + CSV export), Settings.

## Run it locally
No build step needed — it's plain HTML/CSS/JS.
```
cd sm-app
python3 -m http.server 8080
# open http://localhost:8080
```
(Service workers require either `localhost` or HTTPS — this is why you can't just double-click index.html.)

## Enable Firebase sync (optional)
1. Create a project at https://console.firebase.google.com → enable **Firestore**.
2. Copy your web app config.
3. Paste it into `FIREBASE_CONFIG` in `js/firebase-sync.js`.
4. In `index.html`, uncomment the two `<script>` tags that load the Firebase SDK.
5. Deploy — the app will now sync every offline change to Firestore automatically, and listen for changes made from other devices.

## Push to GitHub + host on GitHub Pages
This build environment has no network access, so I can't push to GitHub for you —
do this from your own machine:
```
cd sm-app
git init
git add .
git commit -m "Initial PWA"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```
Then: repo **Settings → Pages → Deploy from branch → main → /(root)** → Save.
Your app will be live at `https://<your-username>.github.io/<repo-name>/`
(HTTPS is required for the install prompt and offline mode to work).

## What's scaffolded but needs you to finish
Given the size of the full feature checklist (100+ items — barcode/QR scanning,
WhatsApp/SMS integration, staff roles & permissions, PIN/fingerprint lock,
AI sales analytics, multi-branch, etc.), this build gives you a **working core**
covering the most-used daily flows plus the offline/sync/PWA foundation
everything else plugs into. The architecture (IndexedDB store list in `db.js`,
the `moduleListPage()` + `openForm()` helpers in `app.js`) is built so adding
each remaining module is mostly "copy an existing module's ~20-line config
block and change the fields" — happy to build out any specific one next.
