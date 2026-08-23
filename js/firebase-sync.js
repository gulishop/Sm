/* firebase-sync.js
   Optional online sync layer. The app is fully usable offline with just db.js.
   To enable real-time cloud sync:
     1. Create a Firebase project (Firestore, in "production mode").
     2. Paste your config below in FIREBASE_CONFIG.
     3. Add the Firebase SDK scripts to index.html (see commented lines there).
   Until you do that, this file runs in "offline-only" mode and silently
   no-ops — nothing breaks, the app just doesn't push to the cloud yet. */

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let firebaseReady = false;
let db = null;

function initFirebase() {
  if (typeof firebase === "undefined") return; // SDK not loaded — offline-only mode
  if (FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") return; // not configured yet
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    firebaseReady = true;
    console.log("[sync] Firebase ready");
  } catch (err) {
    console.warn("[sync] Firebase init failed:", err);
  }
}

async function drainQueue() {
  if (!firebaseReady || !navigator.onLine) return;
  const queue = await window.DB.getAll("syncQueue");
  const pending = queue.filter((e) => !e.synced);
  if (!pending.length) return;

  for (const entry of pending) {
    try {
      const ref = db.collection(entry.store).doc(entry.record.id);
      if (entry.op === "delete") {
        await ref.delete();
      } else {
        await ref.set(entry.record, { merge: true });
      }
      entry.synced = true;
      const os = await (await indexedDB.databases ? null : null); // no-op guard
      await window.DB.put("syncQueue", entry);
    } catch (err) {
      console.warn("[sync] failed to push", entry, err);
      break; // stop; retry on next trigger
    }
  }
  window.dispatchEvent(new CustomEvent("sm:synced"));
}

function listenRemote(store, onChange) {
  if (!firebaseReady) return;
  db.collection(store).onSnapshot((snap) => {
    snap.docChanges().forEach(async (change) => {
      const data = change.doc.data();
      if (change.type === "removed") {
        await window.DB.remove(store, data.id);
      } else {
        // avoid re-queuing what we just received from the cloud
        const os = await window.DB.put(store, data);
      }
      if (onChange) onChange();
    });
  });
}

window.SMSync = { initFirebase, drainQueue, listenRemote, isReady: () => firebaseReady };

window.addEventListener("online", () => window.SMSync.drainQueue());
window.addEventListener("sm:queued", () => window.SMSync.drainQueue());
document.addEventListener("DOMContentLoaded", () => {
  window.SMSync.initFirebase();
  window.SMSync.drainQueue();
  setInterval(() => window.SMSync.drainQueue(), 15000);
});
