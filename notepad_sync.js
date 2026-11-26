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

// ---- 3. SIGNED-IN CHECK ----
// Notes are only read and written for a user signed in with Google (login.html).
function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    if (!sync_available()) { reject(new Error('offline')); return; }
    const stop = auth.onAuthStateChanged(user => {
      stop();
      if (user && !user.isAnonymous) resolve(user);
      else reject(new Error('not signed in'));
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

// ---- 7. SIGN-IN GATE + PER-ACCOUNT NOTES ----
// login.html signs the user in with Google. Here the account's id becomes this device's
// sync code, so every device signed in to the same account sees the same notes, and each
// person's notes stay separate in Firestore.
const SIGNED_IN_KEY = "notepad_signed_in";
const go_to_login = () => location.replace('index.html');   // the features page, which has the Sign in button on its top row

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
}

if (sync_available()) {
  let started = false;
  auth.onAuthStateChanged(user => {
    if (user && !user.isAnonymous) {
      try { localStorage.setItem(SIGNED_IN_KEY, "1"); } catch (e) {}
      if (!started) { started = true; sync_after_google_sign_in(user); }
    } else {
      try { localStorage.removeItem(SIGNED_IN_KEY); } catch (e) {}
      go_to_login();
    }
  });
} else if (!localStorage.getItem(SIGNED_IN_KEY)) {
  go_to_login();   // offline on a first visit: nothing to show until the user has signed in once
}
