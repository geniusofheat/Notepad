// ── NOTEPAD.JS ──────────────────────────────────────────────────────────────


// ── SECTION 1: STATE ────────────────────────────────────────────────────────

const STORAGE_KEY = 'notepad_notes';
let notes = [];
let current_note_id = null;
let auto_save_timer = null;


// ── SECTION 2: INIT ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  set_date_display();
  load_notes();
  render_notes_list();

  // Enter key on new note input creates the note
  document.getElementById('newNoteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create_note_from_input();
  });

  // Auto-save while typing in editor
  document.getElementById('note-textarea').addEventListener('input', () => {
    clearTimeout(auto_save_timer);
    auto_save_timer = setTimeout(auto_save_current_note, 800);
  });
});

function set_date_display() {
  const el = document.getElementById('dateDisplay');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });
}


// ── SECTION 3: STORAGE ──────────────────────────────────────────────────────

function load_notes() {
  const raw = localStorage.getItem(STORAGE_KEY);
  notes = raw ? JSON.parse(raw) : [];
}

function save_notes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}


// ── SECTION 4: RENDER NOTES LIST ────────────────────────────────────────────

function render_notes_list() {
  const list = document.getElementById('notes-list');
  const blank_count = Math.max(0, 6 - notes.length);
  const blanks = Array(blank_count)
    .fill('<div class="notepad-row blank"></div>')
    .join('');

  if (notes.length === 0) {
    list.innerHTML = '<div class="note-empty">No notes yet. Type the title of the new note in the box below and press the plus(＋) button to add it to the list.</div>' + blanks;
    return;
  }

  list.innerHTML = notes.map(note => {
    const preview = note.content
      ? note.content.substring(0, 70).replace(/\n/g, ' ') + (note.content.length > 70 ? '…' : '')
      : 'Empty note';
    return `
      <div class="note-card">
        <div class="note-card-content" onclick="open_note('${note.id}')">
          <div class="note-card-title">${note.title}</div>
          <div class="note-card-preview">${preview}</div>
        </div>
        <button class="note-delete-btn" onclick="deleteNote('${note.id}')">✕</button>
      </div>
    `;
  }).join('') + blanks;
}


// ── SECTION 5: ADD NOTE ─────────────────────────────────────────────────────

function handleAddNoteBtn() {
  create_note_from_input();
}
window.handleAddNoteBtn = handleAddNoteBtn;

function create_note_from_input() {
  const input = document.getElementById('newNoteInput');
  const title = input.value.trim();

  if (!title) {
    input.focus();
    return;
  }

  const note = {
    id: Date.now().toString(),
    title: title,
    content: '',
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  };

  notes.unshift(note);
  save_notes();

  input.value = '';
  open_note(note.id);
}
window.create_note_from_input = create_note_from_input;

function voiceInput() {
  const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = 'en-US';
  recognition.start();

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    const input = document.getElementById('newNoteInput');
    input.style.display = 'block';
    input.value = transcript;
    input.focus();
  };

  recognition.onerror = function(event) {
    console.error('Voice error:', event.error);
  };
}
window.voiceInput = voiceInput;


// ── SECTION 6: DELETE NOTE FROM LIST ────────────────────────────────────────

function deleteNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  if (!confirm(`Delete "${note.title}"?`)) return;
  notes = notes.filter(n => n.id !== id);
  save_notes();
  render_notes_list();
}
window.deleteNote = deleteNote;


// ── SECTION 7: OPEN / EDIT NOTE ─────────────────────────────────────────────

function open_note(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  current_note_id = id;

  document.getElementById('notes-list-view').style.display = 'none';
  document.getElementById('note-editor-view').style.display = 'block';
  document.getElementById('note-title-display').textContent = note.title;
  document.getElementById('note-textarea').value = note.content;

  const back_btn = document.getElementById('headerBackBtn');
  back_btn.style.display = 'inline-flex';
  back_btn.setAttribute('onclick', 'back_to_list()');
}
window.open_note = open_note;

function back_to_list() {
  auto_save_current_note();
  current_note_id = null;

  document.getElementById('note-editor-view').style.display = 'none';
  document.getElementById('notes-list-view').style.display = 'block';

  const back_btn = document.getElementById('headerBackBtn');
  back_btn.style.display = 'none';
  back_btn.setAttribute('onclick', 'handleBack()');

  render_notes_list();
}
window.back_to_list = back_to_list;

function auto_save_current_note() {
  if (!current_note_id) return;
  const note = notes.find(n => n.id === current_note_id);
  if (!note) return;
  note.content = document.getElementById('note-textarea').value;
  note.updated = new Date().toISOString();
  save_notes();
}


// ── SECTION 8: DELETE NOTE FROM EDITOR ──────────────────────────────────────

function deleteCurrentNote() {
  if (!current_note_id) return;
  const note = notes.find(n => n.id === current_note_id);
  if (!note) return;
  if (!confirm(`Delete "${note.title}"?`)) return;
  notes = notes.filter(n => n.id !== current_note_id);
  save_notes();
  back_to_list();
}
window.deleteCurrentNote = deleteCurrentNote;


// ── SECTION 9: VOICE INPUT TO TEXTAREA ──────────────────────────────────────

function voiceInputToNote() {
  const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = 'en-US';
  recognition.start();

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    const ta = document.getElementById('note-textarea');
    const pos = ta.selectionStart;
    const before = ta.value.substring(0, pos);
    const after = ta.value.substring(pos);
    ta.value = before + transcript + after;
    ta.selectionStart = ta.selectionEnd = pos + transcript.length;
    ta.focus();
    auto_save_current_note();
  };

  recognition.onerror = function(event) {
    console.error('Voice error:', event.error);
  };
}
window.voiceInputToNote = voiceInputToNote;


// ── SECTION 10: NAVIGATION ───────────────────────────────────────────────────

function handleBack() {
  window.history.back();
}
window.handleBack = handleBack;
