// notepad-sync.js
// Cross-device sync for the Notepad PWA using Firebase (Firestore + anonymous auth).
// No login screen — devices are linked by a short "sync code" instead of an account.

// ---- 1. CONFIG ----
// Replace with your Firebase project config (Project Settings > General > Your apps > SDK setup).
  const firebaseConfig = {
  apiKey: "AIzaSyCGvpWKfkSQapFEwx6lMr6kAMFQ7Ir-sNQ",
  authDomain: "notepad-fba.firebaseapp.com",
  projectId: "notepad-fba",
  storageBucket: "notepad-fba.firebasestorage.app",
  messagingSenderId: "570988410605",
  appId: "1:570988410605:web:a70688966f8c6035cc3ee4"
};

// Offline, the Firebase libraries may not have loaded: the notes still work from this phone's
// own storage, and syncing simply waits until the internet is back.
const firebase_ready = typeof firebase !== 'undefined';
let db = null, auth = null;
if (firebase_ready) {
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
  } catch (err) { console.error('Sync could not start:', err); }
}
const sync_available = () => !!(db && auth);

// ---- 2. SYNC CODE HANDLING ----
const SYNC_CODE_KEY = "notepad_sync_code";

function generateSyncCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars (0/o, 1/l, i)
  let code = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getSyncCode() {
  return localStorage.getItem(SYNC_CODE_KEY);
}

function setSyncCode(code) {
  localStorage.setItem(SYNC_CODE_KEY, code);
}

// Call this once when the app has no sync code yet (fresh install).
// Returns the newly generated code so you can display it to the user.
function createNewSyncCode() {
  const code = generateSyncCode();
  setSyncCode(code);
  return code;
}

// Call this when the user types in an existing code from another device.
function linkExistingSyncCode(code) {
  setSyncCode(code.trim().toLowerCase());
}

// ---- 3. ANONYMOUS AUTH ----
// Runs silently in the background, no UI needed.
function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    if (!sync_available()) { reject(new Error('offline')); return; }
    auth.onAuthStateChanged(user => {
      if (user) {
        resolve(user);
      } else {
        auth.signInAnonymously().catch(reject);
      }
    });
  });
}

// ---- 4. SAVE NOTES TO CLOUD ----
// Call this with your full notes data (whatever object/array you already save to localStorage)
// every time notes change, right after your existing localStorage save.
async function saveNotesToCloud(notesData) {
  const code = getSyncCode();
  if (!code || !sync_available()) return; // no sync set up yet, or no internet libraries: skip silently

  try { await ensureSignedIn(); } catch (err) { return; }

  await db.collection("notepads").doc(code).set({
    notes: notesData,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ---- 5. LISTEN FOR CHANGES FROM OTHER DEVICES ----
// Call this once on app startup. onNotesChanged is your callback that
// receives the latest notesData whenever it changes on ANY linked device.
let unsubscribeListener = null;

async function subscribeToNotes(onNotesChanged) {
  const code = getSyncCode();
  if (!code || !sync_available()) return;

  try { await ensureSignedIn(); } catch (err) { return; }

  if (unsubscribeListener) unsubscribeListener(); // avoid duplicate listeners

  unsubscribeListener = db.collection("notepads").doc(code)
    .onSnapshot(doc => {
      if (doc.exists) {
        const data = doc.data();
        onNotesChanged(data.notes);
      }
    }, err => {
      console.error("Notepad sync listener error:", err);
    });
}

// ---- 6. ONE-TIME PULL (useful right after linking a new device) ----
async function pullNotesOnce() {
  const code = getSyncCode();
  if (!code || !sync_available()) return null;

  try { await ensureSignedIn(); } catch (err) { return null; }

  const doc = await db.collection("notepads").doc(code).get();
  return doc.exists ? doc.data().notes : null;
}

// ---- 7. GOOGLE SIGN-IN ----
// Signing in with the same Google account on every device is the whole link between them:
// the account's id becomes the sync code, so there is no code to type and no pop-up message.
// The sync button itself shows what is happening.
const sync_btn = () => document.getElementById('syncBtn');
let sync_label_timer = null;

function sync_label(text, back_after) {
  const btn = sync_btn();
  if (!btn) return;
  btn.textContent = text;
  if (sync_label_timer) clearTimeout(sync_label_timer);
  if (back_after) sync_label_timer = setTimeout(sync_label_refresh, back_after);
}

// "synced" when this device is signed in with Google, "sign in" when it is not.
function sync_label_refresh() {
  const user = sync_available() ? auth.currentUser : null;
  sync_label(user && !user.isAnonymous ? 'synced' : 'sign in');
}

// Makes the Google account's id this device's sync code and brings the notes together.
async function sync_after_google_sign_in(user) {
  const new_code = "g-" + user.uid;
  const old_code = getSyncCode();
  setSyncCode(new_code);

  // Notes already on this account, and notes from the old sync code of this device, are kept.
  let merged = notes;
  try {
    const mine = await db.collection("notepads").doc(new_code).get();
    if (mine.exists) merged = merge_cloud_notes(merged, mine.data().notes);
    if (old_code && old_code !== new_code) {
      const old = await db.collection("notepads").doc(old_code).get();
      if (old.exists) merged = merge_cloud_notes(merged, old.data().notes);
    }
  } catch (err) { console.error("Could not read the account's notes:", err); }

  notes = merged;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); } catch (err) { console.error(err); }
  redraw_list();
  await saveNotesToCloud(notes).catch(() => {});
  subscribeToNotes(on_cloud_notes);
  sync_label_refresh();
}

async function handle_sync_click() {
  if (!sync_available()) { sync_label("offline", 2500); return; }

  const user = auth.currentUser;
  if (user && !user.isAnonymous) {          // already signed in: send and fetch now
    sync_label("syncing...");
    try {
      await saveNotesToCloud(notes);
      sync_label("synced", 0);
    } catch (err) { sync_label("offline", 2500); }
    return;
  }

  sync_label("signing in...");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const result = await auth.signInWithPopup(provider);
    await sync_after_google_sign_in(result.user);
  } catch (err) {
    const code = err && err.code;
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      try { await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); return; } catch (e) { /* fall through */ }
    }
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") sync_label_refresh();
    else sync_label(code === "auth/network-request-failed" ? "offline" : "sign-in failed", 3000);
  }
}
window.handle_sync_click = handle_sync_click;

// Keep the button label right, and finish a sign-in that came back from a redirect.
if (sync_available() && typeof auth.getRedirectResult === 'function') {
  auth.getRedirectResult().then((result) => {
    if (result && result.user && !result.user.isAnonymous) return sync_after_google_sign_in(result.user);
  }).catch(() => {});
  if (typeof auth.onAuthStateChanged === 'function') auth.onAuthStateChanged(() => sync_label_refresh());
}
sync_label_refresh();
