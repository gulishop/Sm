# Sanaullah Mobile Communication — PWA

Offline-first shop POS: sales, stock, repairs, installments, Firebase Auth + sync, thermal print.

## Login
- **Firebase email + password only** (Console → Authentication → Users → Add user)
- Offline: previous session restores automatically after first online login

## Features
- POS / Billing (manual customer name + phone, auto-add product to cart)
- Products, customers, repairs, installments, suppliers, expenses
- Staff roles, purchase orders, cash book, audit logs
- Barcode scan / labels, WhatsApp invoice, thermal ESC/POS (BT/USB)
- Backup / restore JSON, CSV product import
- Firebase Auth + Firestore sync (~3s flush + realtime listeners)

## Setup
1. Firebase: Email/Password Auth ON + Firestore created
2. Rules (short):
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
3. Host static files (GitHub Pages / Netlify / Firebase Hosting)
4. Login with a user created in Firebase Console

## Author
Fazal Khan Chandio · 03333909816
