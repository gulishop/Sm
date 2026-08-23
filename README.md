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

## Login (demo — change before going live)
- **Username:** `admin` **Password:** `admin123`
- This is a local check in `js/app.js` (`DEMO_ADMIN`), not real authentication.
  Good enough for testing/demo; swap in Firebase Authentication later (scaffold
  is already wired for Firebase in `firebase-sync.js` — add Auth the same way).
- **Staff logins**: add staff in Settings → Staff & Roles. They log in with
  their phone number as username and their PIN as password. Roles:
  - `admin` — full access
  - `cashier` — Dashboard, POS, Products, Customers, Installments, Reports
  - `technician` — Dashboard, Repairs only

## Newly added in this pass
- Demo login + staff PIN login + role-based navigation
- **Barcode/QR camera scanner** (POS, Products, Product form for IMEI) — uses `html5-qrcode` via CDN, needs camera permission + internet on first load
- **Barcode label printing** for products — uses `JsBarcode` via CDN
- **Printable invoice** + **WhatsApp invoice sharing** (`wa.me` link) after checkout
- **Discount field + payment method** (Cash/Card/Bank/Installment) on checkout
- **Loyalty points** (auto: 1 point per Rs 1,000 spent) + **Customer Ledger** view
- **Staff & Roles** module with PIN login + **Attendance** marking
- **Purchase Orders** module for suppliers
- **Cash Book / Daily Closing** report
- **Audit Logs** — every create/update/delete/login is recorded
- **CSV import** for products (Settings → Import Products) + existing CSV export for sales
- **Voice search** (mic icon on list pages, browser Web Speech API)
- Shop branch name field (Settings) — first step toward multi-branch

## Still not included (need external/paid services or a backend server)
A static PWA genuinely can't do these without a server component:
- **Real SMS sending** — needs a paid SMS gateway (Twilio, etc.) with a backend
- **Real push notifications** — needs a push server (Firebase Cloud Messaging functions)
- **Fingerprint login** — possible via WebAuthn but needs HTTPS + device support testing
- **True multi-branch with separate logins/data isolation** — needs backend rules (Firestore security rules once Firebase Auth is added)
- **AI Sales Analytics** — can be added as a simple trends/forecast view once you have a few weeks of real sales data logged
Everything else from your original list is now implemented.
