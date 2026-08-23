# Sanaullah Mobile Communication — PWA

Offline-first POS / inventory / repairs app for mobile shops.

## Features
- POS billing, products, customers, repairs, installments
- Staff roles (admin / cashier / technician)
- Barcode scan & label print, WhatsApp invoice, thermal print
- Backup / restore, CSV import, cash book, audit logs
- **Firebase Auth + Firestore real-time sync** (optional)

## Quick start
1. Open `index.html` in a browser (or host on any static server / GitHub Pages).
2. Login: **admin** / **admin123**

## Enable Firebase Cloud Sync + Auth

1. Go to [Firebase Console](https://console.firebase.google.com) → Create project.
2. Enable **Authentication** → Sign-in method → **Email/Password**.
3. Create **Firestore Database** (start in test mode for development).
4. Project settings → Your apps → Web → copy the config object.
5. Open `js/firebase-sync.js` and replace `FIREBASE_CONFIG` values.
6. In `index.html` **uncomment** the three Firebase `<script>` tags (app, auth, firestore).
7. Reload. Use your email to **Create Firebase Account** or login.
8. Recommended Firestore rules (production):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /shops/{shopId}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Demo credentials
- Username: `admin`
- Password: `admin123`

Staff can also login with their **phone + PIN** (created under Settings → Staff).

## Author
Software by Fazal Khan Chandio · 03333909816
