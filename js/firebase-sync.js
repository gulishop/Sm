/* firebase-sync.js — Fixed path (no /items) + push-first fullResync */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB6-PchPTJHh6SRszmXzxU94yF4EzK0zXU",
  authDomain: "sm-mobile-bb69d.firebaseapp.com",
  projectId: "sm-mobile-bb69d",
  storageBucket: "sm-mobile-bb69d.firebasestorage.app",
  messagingSenderId: "885711976863",
  appId: "1:885711976863:web:560648659980ca85a825aa"
};

const ROOT = "shops/sanaullah";
const SYNC_STORES = [
  "products", "customers", "sales", "repairs", "installments",
  "suppliers", "expenses", "staff", "purchaseOrders", "auditLogs",
  "attendance", "returns"
];

window.SMSync = {
  _ready: false,
  _db: null,
  _auth: null,
  _unsubs: [],
  _flushing: false,

  isReady() { return this._ready && !!this._db; },
  isConfigured() {
    return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
  },

  async init() {
    if (!this.isConfigured()) {
      console.info("[SMSync] Firebase not configured — offline-only.");
      return;
    }
    if (typeof firebase === "undefined") {
      console.warn("[SMSync] SDK not loaded");
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      this._auth = firebase.auth();
      try {
        await this._auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (e) {}
      this._db = firebase.firestore();
      try {
        await this._db.enablePersistence({ synchronizeTabs: true });
      } catch (e) {}
      this._ready = true;
      console.info("[SMSync] Firebase ready");

      this._auth.onAuthStateChanged(async (user) => {
        if (user) {
          console.info("[SMSync] Signed in", user.email || user.uid);
          await this.startListeners();
          await this.flushQueue();
          setTimeout(() => this.pullAll().catch(() => {}), 800);
        } else {
          this.stopListeners();
        }
      });
    } catch (err) {
      console.error("[SMSync] Init failed:", err);
      this._ready = false;
    }
  },

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

  async startListeners() {
    this.stopListeners();
    if (!this._db) return;
    for (const store of SYNC_STORES) {
      const col = this._db.collection(ROOT + "/" + store);
      const unsub = col.onSnapshot(
        async (snap) => {
          for (const change of snap.docChanges()) {
            const data = change.doc.data();
            if (!data || !data.id) continue;
            if (change.type === "removed") continue;
            const local = await DB.get(store, data.id);
            if (!local || (data.updatedAt || 0) >= (local.updatedAt || 0)) {
              await this._putLocalOnly(store, data);
            }
          }
          window.dispatchEvent(new CustomEvent("sm:synced"));
        },
        (err) => console.warn("[SMSync] Listener", store, err)
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

  _compact(data) {
    if (!data || typeof data !== "object") return {};
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.length > 15000) out[k] = v.slice(0, 15000);
      else if (k === "items" && Array.isArray(v)) {
        out[k] = v.slice(0, 150).map((it) => ({
          id: it.id,
          name: String(it.name || "").slice(0, 100),
          price: Number(it.price) || 0,
          cost: Number(it.cost) || 0,
          qty: Number(it.qty) || 0
        }));
      } else if (typeof v !== "function") out[k] = v;
    }
    return out;
  },

  async flushQueue() {
    if (!this.isReady() || this._flushing || !navigator.onLine) return;
    const user = this.currentUser();
    if (!user) return;

    this._flushing = true;
    try {
      const queue = await DB.getSyncQueue();
      const batch = queue.slice(0, 100);
      for (const item of batch) {
        try {
          if (!item.data || !item.data.id) {
            await DB.removeFromQueue(item.id);
            continue;
          }
          const ref = this._db
            .collection(ROOT + "/" + item.store)
            .doc(String(item.data.id));

          if (item.op === "delete") {
            await ref.delete();
          } else {
            const payload = this._compact(item.data);
            payload._syncedAt = Date.now();
            payload._by = user.uid;
            if (JSON.stringify(payload).length > 900000) {
              console.warn("[SMSync] skip oversized", item.store, item.data.id);
              await DB.removeFromQueue(item.id);
              continue;
            }
            await ref.set(payload, { merge: true });
          }
          await DB.removeFromQueue(item.id);
        } catch (err) {
          console.warn("[SMSync] item fail", item.id, err);
        }
      }
      window.dispatchEvent(new CustomEvent("sm:synced"));
    } finally {
      this._flushing = false;
    }
  },

  async clearPending() {
    await DB.clearSyncQueue();
    window.dispatchEvent(new CustomEvent("sm:synced"));
  },

  async pullAll() {
    if (!this.isReady() || !this.currentUser()) return;
    for (const store of SYNC_STORES) {
      try {
        const snap = await this._db.collection(ROOT + "/" + store).get();
        for (const doc of snap.docs) {
          const data = doc.data();
          if (data && data.id) await this._putLocalOnly(store, data);
        }
      } catch (e) {
        console.warn("[SMSync] pull", store, e);
      }
    }
    window.dispatchEvent(new CustomEvent("sm:synced"));
  },

  async pushAll() {
    if (!this.isReady() || !this.currentUser()) return 0;
    const user = this.currentUser();
    let n = 0;
    for (const store of SYNC_STORES) {
      const rows = await DB.getAll(store);
      for (const rec of rows) {
        if (!rec.id) continue;
        try {
          const payload = this._compact(rec);
          payload._syncedAt = Date.now();
          payload._by = user.uid;
          // ensure updatedAt so multi-device merge works
          if (!payload.updatedAt) payload.updatedAt = Date.now();
          await this._db
            .collection(ROOT + "/" + store)
            .doc(String(rec.id))
            .set(payload, { merge: true });
          n++;
        } catch (e) {
          console.warn("[SMSync] push fail", store, rec.id, e);
        }
      }
    }
    await this.clearPending();
    window.dispatchEvent(new CustomEvent("sm:synced"));
    return n;
  },

  /** Local pehle cloud pe, phir cloud se pull — client ka data safe rehta hai */
  async fullResync() {
    await this.clearPending();
    const n = await this.pushAll();
    await this.pullAll();
    return n;
  }
};

function openDBForSync() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sm-app-v2", 3);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => SMSync.init());
} else {
  SMSync.init();
}

window.addEventListener("online", () => {
  if (SMSync.isReady()) {
    SMSync.flushQueue().catch(console.warn);
    setTimeout(() => SMSync.pullAll().catch(() => {}), 500);
  }
});

setInterval(() => {
  if (navigator.onLine && window.SMSync && SMSync.isReady() && SMSync.currentUser()) {
    SMSync.flushQueue().catch(() => {});
  }
}, 400);
