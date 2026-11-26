// Features page: someone who is signed in goes straight to their notes.
// (notepad_sync.js on notepad.html clears this flag if the sign-in has really ended.)
try { if (localStorage.getItem('notepad_signed_in')) location.replace('notepad.html'); } catch (e) {}
