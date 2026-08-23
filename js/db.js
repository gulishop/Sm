/* db.js — Offline-first IndexedDB layer.
   Every store also gets a "syncQueue" entry on write, which firebase-sync.js
   drains whenever the app is online. This is how offline-first + online sync
   both work: writes ALWAYS go to IndexedDB first (instant, works offline),
   then get pushed to Firebase in the background when connectivity exists. */

const DB_NAME = "sm_app_db";
const DB_VERSION = 1;
const STORES = [
  "products", "customers", "sales", "repairs", "installments",
  "suppliers", "expenses", "staff", "settings", "syncQueue",
  "purchaseOrders", "auditLogs", "attendance"
];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, { keyPath: "id" });
          if (store !== "syncQueue" && store !== "settings") {
            os.createIndex("updatedAt", "updatedAt", { unique: false });
          }
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function tx(store, mode = "readonly") {
  const db = await openDB();
  return db.transaction(store, mode).objectStore(store);
}

const DB = {
  uid,

  async getAll(store) {
    const os = await tx(store);
    return new Promise((resolve, reject) => {
      const req = os.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async get(store, id) {
    const os = await tx(store);
    return new Promise((resolve, reject) => {
      const req = os.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  // put() = create or update. Always queues a sync op so Firebase catches up.
  async put(store, record) {
    if (!record.id) record.id = uid();
    record.updatedAt = Date.now();
    const os = await tx(store, "readwrite");
    return new Promise((resolve, reject) => {
      const req = os.put(record);
      req.onsuccess = async () => {
        if (store !== "syncQueue") {
          await DB.queueSync(store, "upsert", record);
        }
        resolve(record);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async remove(store, id) {
    const os = await tx(store, "readwrite");
    return new Promise((resolve, reject) => {
      const req = os.delete(id);
      req.onsuccess = async () => {
        await DB.queueSync(store, "delete", { id });
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async queueSync(store, op, record) {
    const os = await tx("syncQueue", "readwrite");
    const entry = { id: uid(), store, op, record, ts: Date.now(), synced: false };
    return new Promise((resolve, reject) => {
      const req = os.put(entry);
      req.onsuccess = () => {
        resolve(entry);
        window.dispatchEvent(new CustomEvent("sm:queued"));
      };
      req.onerror = () => reject(req.error);
    });
  },

  async pendingSyncCount() {
    const all = await DB.getAll("syncQueue");
    return all.filter((e) => !e.synced).length;
  }
};

window.DB = DB;
