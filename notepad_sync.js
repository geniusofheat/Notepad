// notepad-sync.js
// Cross-device sync for the Notepad PWA using Firebase (Firestore + anonymous auth).
// No login screen — devices are linked by a short "sync code" instead of an account.

// ---- 1. CONFIG ----
// Replace with your Firebase project config (Project Settings > General > Your apps > SDK setup).
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

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
  if (!code) return; // no sync set up yet, skip silently

  await ensureSignedIn();

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
  if (!code) return;

  await ensureSignedIn();

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
  if (!code) return null;

  await ensureSignedIn();

  const doc = await db.collection("notepads").doc(code).get();
  return doc.exists ? doc.data().notes : null;
}
