/* db.js — IndexedDB offline-first layer for Sanaullah Mobile Communication
   Stores: products, customers, sales, repairs, installments, suppliers,
           expenses, staff, settings, purchaseOrders, auditLogs, attendance
   + _syncQueue for offline pending writes
*/

const DB_NAME = "sm-app-v2";
const DB_VERSION = 3;
const STORES = [
  "products", "customers", "sales", "repairs", "installments",
  "suppliers", "expenses", "staff", "settings", "purchaseOrders",
  "auditLogs", "attendance", "returns", "_syncQueue"
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          if (name !== "settings" && name !== "_syncQueue") {
            store.createIndex("updatedAt", "updatedAt", { unique: false });
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    if (result && typeof result.then === "function") {
      // already a promise from request wrapper
    }
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async get(storeName, id) {
    if (id == null) return null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async put(storeName, record) {
    if (!record || typeof record !== "object") throw new Error("Invalid record");
    const rec = { ...record };
    if (!rec.id) rec.id = uid();
    rec.updatedAt = Date.now();
    if (!rec.createdAt) rec.createdAt = rec.updatedAt;

    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Queue for cloud sync — skip session + pure local noise
    if (storeName !== "_syncQueue" && !(storeName === "settings" && rec.id === "session")) {
      await this._enqueue("put", storeName, rec);
    }
    return rec;
  },

  async remove(storeName, id) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    if (storeName !== "_syncQueue") {
      await this._enqueue("delete", storeName, { id });
    }
  },

  async _enqueue(op, storeName, data) {
    const item = {
      id: uid(),
      op,
      store: storeName,
      data,
      ts: Date.now()
    };
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("_syncQueue", "readwrite");
      tx.objectStore("_syncQueue").put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    window.dispatchEvent(new CustomEvent("sm:queued"));
    // Fast sync: immediate + short retry
    if (navigator.onLine && window.SMSync && window.SMSync.isReady()) {
      window.SMSync.flushQueue().catch(console.warn);
      setTimeout(() => {
        if (window.SMSync && window.SMSync.isReady())
          window.SMSync.flushQueue().catch(() => {});
      }, 400);
    }
  },

  async pendingSyncCount() {
    const items = await this.getAll("_syncQueue");
    return items.length;
  },

  async clearSyncQueue() {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("_syncQueue", "readwrite");
      tx.objectStore("_syncQueue").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getSyncQueue() {
    return this.getAll("_syncQueue");
  },

  async removeFromQueue(id) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("_syncQueue", "readwrite");
      tx.objectStore("_syncQueue").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};

window.DB = DB;
