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
      // Keep login across reloads / offline (LOCAL = IndexedDB)
      try {
        await this._auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (e) { /* older browsers */ }
      this._db = firebase.firestore();
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
      // process max 25 per tick to stay under write limits
      const batch = queue.slice(0, 25);
      for (const item of batch) {
        try {
          const ref = this._db
            .collection(`${ROOT}/${item.store}/items`)
            .doc(String(item.data.id));

          if (item.op === "delete") {
            await ref.delete();
          } else {
            // Compact payload — drop undefined, cap string sizes, avoid 1MB limit
            const payload = this._compact(item.data);
            payload._syncedAt = Date.now();
            payload._by = user.uid;
            const approx = JSON.stringify(payload).length;
            if (approx > 900000) {
              console.warn("[SMSync] Skip oversized doc", item.store, item.data.id, approx);
              await DB.removeFromQueue(item.id); // drop rather than block queue
              continue;
            }
            await ref.set(payload, { merge: true });
          }
          await DB.removeFromQueue(item.id);
        } catch (err) {
          console.warn("[SMSync] Failed to sync item", item.id, err);
        }
      }
      window.dispatchEvent(new CustomEvent("sm:synced"));
    } finally {
      this._flushing = false;
    }
  },

  _compact(data) {
    if (!data || typeof data !== "object") return {};
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.length > 20000) {
        out[k] = v.slice(0, 20000); // hard cap long text
      } else if (k === "items" && Array.isArray(v)) {
        // sale line items — keep only needed fields
        out[k] = v.slice(0, 200).map((it) => ({
          id: it.id, name: String(it.name || "").slice(0, 120),
          price: Number(it.price) || 0, cost: Number(it.cost) || 0, qty: Number(it.qty) || 0
        }));
      } else if (typeof v !== "function") {
        out[k] = v;
      }
    }
    return out;
  },

  // Full pull (optional, on first login)
  async clearPending() {
    await DB.clearSyncQueue();
    window.dispatchEvent(new CustomEvent("sm:synced"));
  },

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

// Fast sync: flush pending writes every 3 seconds when online + logged in
setInterval(() => {
  if (navigator.onLine && window.SMSync && SMSync.isReady() && SMSync.currentUser()) {
    SMSync.flushQueue().catch(() => {});
  }
}, 3000);
