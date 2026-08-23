/* firebase-sync.js — Firebase Auth + Firestore real-time sync
   -------------------------------------------------------------
   1. Create a Firebase project at https://console.firebase.google.com
   2. Enable Authentication → Email/Password
   3. Create a Firestore Database (start in test mode, then lock rules)
   4. Project settings → General → Your apps → Web app → copy config
   5. Paste the config object below into FIREBASE_CONFIG
   6. Uncomment the two Firebase <script> tags in index.html
   7. Reload the app. Login with demo admin or create a Firebase user.
*/

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB6-PchPTJHh6SRszmXzxU94yF4EzK0zXU",
  authDomain: "sm-mobile-bb69d.firebaseapp.com",
  projectId: "sm-mobile-bb69d",
  storageBucket: "sm-mobile-bb69d.firebasestorage.app",
  messagingSenderId: "885711976863",
  appId: "1:885711976863:web:560648659980ca85a825aa"
};

// Collection root for this shop (change if multi-tenant later)
const ROOT = "shops/sanaullah";

const SYNC_STORES = [
  "products", "customers", "sales", "repairs", "installments",
  "suppliers", "expenses", "staff", "purchaseOrders", "auditLogs", "attendance"
];

window.SMSync = {
  _ready: false,
  _db: null,
  _auth: null,
  _unsubs: [],
  _flushing: false,

  isReady() {
    return this._ready && !!this._db;
  },

  isConfigured() {
    return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
  },

  async init() {
    if (!this.isConfigured()) {
      console.info("[SMSync] Firebase not configured — offline-only mode.");
      return;
    }
    if (typeof firebase === "undefined") {
      console.warn("[SMSync] Firebase SDK not loaded. Uncomment scripts in index.html.");
      return;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      this._auth = firebase.auth();
      this._db = firebase.firestore();
      // Optional: enable offline persistence for Firestore itself
      try {
        await this._db.enablePersistence({ synchronizeTabs: true });
      } catch (e) {
        // ignore multi-tab or private mode errors
      }
      this._ready = true;
      console.info("[SMSync] Firebase ready");

      // Auth state listener
      this._auth.onAuthStateChanged(async (user) => {
        if (user) {
          console.info("[SMSync] Signed in as", user.email || user.uid);
          await this.startListeners();
          await this.flushQueue();
        } else {
          this.stopListeners();
        }
      });
    } catch (err) {
      console.error("[SMSync] Init failed:", err);
      this._ready = false;
    }
  },

  // ---------- Auth helpers ----------
  async signIn(email, password) {
    if (!this._auth) throw new Error("Firebase not ready");
    const cred = await this._auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },

  async signUp(email, password) {
    if (!this._auth) throw new Error("Firebase not ready");
    const cred = await this._auth.createUserWithEmailAndPassword(email, password);
    return cred.user;
  },

  async signOut() {
    if (this._auth) await this._auth.signOut();
  },

  currentUser() {
    return this._auth ? this._auth.currentUser : null;
  },

  // ---------- Realtime listeners (cloud → local) ----------
  async startListeners() {
    this.stopListeners();
    if (!this._db) return;

    for (const store of SYNC_STORES) {
      const col = this._db.collection(`${ROOT}/${store}/items`);
      const unsub = col.onSnapshot(
        async (snap) => {
          for (const change of snap.docChanges()) {
            const data = change.doc.data();
            if (!data || !data.id) continue;
            if (change.type === "removed") {
              // Only remove if we don't have a newer local version pending
              const local = await DB.get(store, data.id);
              if (local && local.updatedAt > (data.updatedAt || 0)) continue;
              // Soft: skip hard delete from remote to avoid data loss on conflicts
              // await DB.remove(store, data.id);  // uncomment if you want remote deletes
            } else {
              const local = await DB.get(store, data.id);
              // Last-write-wins by updatedAt
              if (!local || (data.updatedAt || 0) >= (local.updatedAt || 0)) {
                // Write without re-queueing to avoid loop
                await this._putLocalOnly(store, data);
              }
            }
          }
          window.dispatchEvent(new CustomEvent("sm:synced"));
        },
        (err) => console.warn("[SMSync] Listener error on", store, err)
      );
      this._unsubs.push(unsub);
    }
  },

  stopListeners() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
  },

  async _putLocalOnly(storeName, record) {
    const db = await openDBForSync();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ---------- Push local queue → cloud ----------
  async flushQueue() {
    if (!this.isReady() || this._flushing || !navigator.onLine) return;
    const user = this.currentUser();
    if (!user) return; // only sync when authenticated

    this._flushing = true;
    try {
      const queue = await DB.getSyncQueue();
      for (const item of queue) {
        try {
          const ref = this._db
            .collection(`${ROOT}/${item.store}/items`)
            .doc(String(item.data.id));

          if (item.op === "delete") {
            await ref.delete();
          } else {
            // put / update
            const payload = { ...item.data, _syncedAt: Date.now(), _by: user.uid };
            await ref.set(payload, { merge: true });
          }
          await DB.removeFromQueue(item.id);
        } catch (err) {
          console.warn("[SMSync] Failed to sync item", item.id, err);
          // leave in queue for retry
        }
      }
      window.dispatchEvent(new CustomEvent("sm:synced"));
    } finally {
      this._flushing = false;
    }
  },

  // Full pull (optional, on first login)
  async pullAll() {
    if (!this.isReady()) return;
    for (const store of SYNC_STORES) {
      const snap = await this._db.collection(`${ROOT}/${store}/items`).get();
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data && data.id) {
          await this._putLocalOnly(store, data);
        }
      }
    }
    window.dispatchEvent(new CustomEvent("sm:synced"));
  }
};

// Helper used by _putLocalOnly (avoids circular dependency on window.DB internals)
function openDBForSync() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sm-app-v2", 2);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Auto-init when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => SMSync.init());
} else {
  SMSync.init();
}

// Retry flush when back online
window.addEventListener("online", () => {
  if (SMSync.isReady()) SMSync.flushQueue().catch(console.warn);
});
