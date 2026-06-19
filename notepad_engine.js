// ── NOTEPAD_ENGINE.JS ────────────────────────────────────────────────────────
// Three-level nested navigation:
// Level 1 — Categories (e.g. Groceries)
// Level 2 — Sub-categories (e.g. Vegetables)
// Level 3 — Items (e.g. Green Beans)
// Note View — Notepad for the selected item


// ── SECTION 1: STATE ────────────────────────────────────────────────────────

const STORAGE_KEY = 'notepad_notes';

let notes = [];

const nav = {
  level: 1,
  category_id: null,
  sub_id: null,
  item_id: null
};

let auto_save_timer = null;


// ── SECTION 2: INIT ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  set_date_display();
  set_header_title('📋  Notepad :');
  load_notes();
  render_level_1();

  document.getElementById('newNoteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handle_input_submit();
  });

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


// ── SECTION 4: ID GENERATOR ─────────────────────────────────────────────────

function make_id() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
}


// ── SECTION 5: INPUT HANDLER ─────────────────────────────────────────────────
// The existing plus button calls handleAddNoteBtn().
// This routes the input to the correct add function based on current level.

function handleAddNoteBtn() {
  handle_input_submit();
}
window.handleAddNoteBtn = handleAddNoteBtn;

function handle_input_submit() {
  if (nav.level === 1) {
    add_category();
  } else if (nav.level === 2) {
    add_subcategory(nav.category_id);
  } else if (nav.level === 3) {
    add_item(nav.category_id, nav.sub_id);
  }
}


// ── SECTION 6: RENDER LEVEL 1 — CATEGORIES ──────────────────────────────────

function render_level_1() {
  nav.level = 1;
  nav.category_id = null;
  nav.sub_id = null;
  nav.item_id = null;

  show_list_view();
  set_header_title('📋 Notes List');
  set_input_placeholder('Create A New List Title...');
  hide_back_btn();

  const list = document.getElementById('notes-list');
  let html = '<ol class="notes-ol">';

  if (notes.length === 0) {
    html += '<div class="notepad-placeholder">To use Notepad you have to create a list with a title. Then you can add new categories to the list and write notes for your items.</div>';
  } else {
    notes.forEach((cat) => {
      html += `
        <li class="notepad-row note-list-item">
          <span class="note-list-title" onclick="go_to_level_2('${cat.id}')">${cat.title}</span>
          <button class="orange-btn" onclick="go_to_level_2('${cat.id}')">＋</button>
          <button class="orange-btn" onclick="delete_category('${cat.id}')">✕</button>
        </li>
      `;
    });

    const blank_count = Math.max(0, 12 - notes.length);
    for (let i = 0; i < blank_count; i++) {
      html += '<li class="notepad-row blank"></li>';
    }
  }

  html += '</ol>';
  list.innerHTML = html;
}


// ── SECTION 7: ADD CATEGORY (LEVEL 1) ───────────────────────────────────────

function add_category() {
  const input = document.getElementById('newNoteInput');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }

  const cat = {
    id: make_id(),
    title: title,
    created: new Date().toISOString(),
    subcategories: []
  };

  notes.push(cat);
  save_notes();
  input.value = '';
  render_level_1();
}

function delete_category(cat_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  if (!confirm(`Delete "${cat.title}" and all its contents?`)) return;
  notes = notes.filter(c => c.id !== cat_id);
  save_notes();
  render_level_1();
}
window.delete_category = delete_category;


// ── SECTION 8: RENDER LEVEL 2 — SUB-CATEGORIES ──────────────────────────────

function go_to_level_2(cat_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;

  nav.level = 2;
  nav.category_id = cat_id;
  nav.sub_id = null;
  nav.item_id = null;

  show_list_view();
  set_header_title(cat.title);
  set_input_placeholder('Type a Sub-Category name...');
  show_back_btn();

  const list = document.getElementById('notes-list');
  let html = '<ol class="notes-ol">';

  if (!cat.subcategories || cat.subcategories.length === 0) {
    html += '<div class="notepad-placeholder">Type a name for your Sub-Categories List and press the plus button to create the list title.</div>';
  } else {
    cat.subcategories.forEach((sub) => {
      html += `
        <li class="notepad-row note-list-item">
          <span class="note-list-title" onclick="go_to_level_3('${cat_id}', '${sub.id}')">${sub.title}</span>
          <button class="orange-btn" onclick="go_to_level_3('${cat_id}', '${sub.id}')">＋</button>
          <button class="orange-btn" onclick="delete_subcategory('${cat_id}', '${sub.id}')">✕</button>
        </li>
      `;
    });

    const blank_count = Math.max(0, 12 - cat.subcategories.length);
    for (let i = 0; i < blank_count; i++) {
      html += '<li class="notepad-row blank"></li>';
    }
  }

  html += '</ol>';
  list.innerHTML = html;
}
window.go_to_level_2 = go_to_level_2;


// ── SECTION 9: ADD SUB-CATEGORY (LEVEL 2) ───────────────────────────────────

function add_subcategory(cat_id) {
  const input = document.getElementById('newNoteInput');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }

  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;

  const sub = {
    id: make_id(),
    title: title,
    created: new Date().toISOString(),
    items: []
  };

  if (!cat.subcategories) cat.subcategories = [];
  cat.subcategories.push(sub);
  save_notes();
  input.value = '';
  go_to_level_2(cat_id);
}

function delete_subcategory(cat_id, sub_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  const sub = cat.subcategories.find(s => s.id === sub_id);
  if (!sub) return;
  if (!confirm(`Delete "${sub.title}" and all its items?`)) return;
  cat.subcategories = cat.subcategories.filter(s => s.id !== sub_id);
  save_notes();
  go_to_level_2(cat_id);
}
window.delete_subcategory = delete_subcategory;


// ── SECTION 10: RENDER LEVEL 3 — ITEMS ──────────────────────────────────────

function go_to_level_3(cat_id, sub_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  const sub = cat.subcategories.find(s => s.id === sub_id);
  if (!sub) return;

  nav.level = 3;
  nav.category_id = cat_id;
  nav.sub_id = sub_id;
  nav.item_id = null;

  show_list_view();
  set_header_title(sub.title);
  set_input_placeholder('Type an item name...');
  show_back_btn();

  const list = document.getElementById('notes-list');
  let html = '<ol class="notes-ol">';

  if (!sub.items || sub.items.length === 0) {
    html += '<div class="notepad-placeholder">Type your notes here.</div>';
  } else {
    sub.items.forEach((item) => {
      html += `
        <li class="notepad-row note-list-item">
          <span class="note-list-title" onclick="open_note('${cat_id}', '${sub_id}', '${item.id}')">${item.title}</span>
          <button class="orange-btn" onclick="open_note('${cat_id}', '${sub_id}', '${item.id}')">＋</button>
          <button class="orange-btn" onclick="delete_item('${cat_id}', '${sub_id}', '${item.id}')">✕</button>
        </li>
      `;
    });

    const blank_count = Math.max(0, 12 - sub.items.length);
    for (let i = 0; i < blank_count; i++) {
      html += '<li class="notepad-row blank"></li>';
    }
  }

  html += '</ol>';
  list.innerHTML = html;
}
window.go_to_level_3 = go_to_level_3;


// ── SECTION 11: ADD ITEM (LEVEL 3) ──────────────────────────────────────────

function add_item(cat_id, sub_id) {
  const input = document.getElementById('newNoteInput');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }

  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  const sub = cat.subcategories.find(s => s.id === sub_id);
  if (!sub) return;

  const item = {
    id: make_id(),
    title: title,
    content: '',
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  };

  if (!sub.items) sub.items = [];
  sub.items.push(item);
  save_notes();
  input.value = '';
  go_to_level_3(cat_id, sub_id);
}

function delete_item(cat_id, sub_id, item_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  const sub = cat.subcategories.find(s => s.id === sub_id);
  if (!sub) return;
  const item = sub.items.find(i => i.id === item_id);
  if (!item) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  sub.items = sub.items.filter(i => i.id !== item_id);
  save_notes();
  go_to_level_3(cat_id, sub_id);
}
window.delete_item = delete_item;


// ── SECTION 12: NOTE VIEW ────────────────────────────────────────────────────

function open_note(cat_id, sub_id, item_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  const sub = cat.subcategories.find(s => s.id === sub_id);
  if (!sub) return;
  const item = sub.items.find(i => i.id === item_id);
  if (!item) return;

  nav.level = 'note';
  nav.category_id = cat_id;
  nav.sub_id = sub_id;
  nav.item_id = item_id;

  document.getElementById('notes-list-view').style.display = 'none';
  document.getElementById('noteAddRow').style.display = 'none';
  document.getElementById('note-editor-view').style.display = 'block';
  document.querySelector('main').classList.add('hide-line');

  document.getElementById('note-title-display').textContent = 'Note:';
  set_header_title(item.title);
  document.getElementById('note-textarea').value = item.content || '';

  show_back_btn();
}
window.open_note = open_note;

function auto_save_current_note() {
  if (nav.level !== 'note' || !nav.item_id) return;

  const cat = notes.find(c => c.id === nav.category_id);
  if (!cat) return;
  const sub = cat.subcategories.find(s => s.id === nav.sub_id);
  if (!sub) return;
  const item = sub.items.find(i => i.id === nav.item_id);
  if (!item) return;

  item.content = document.getElementById('note-textarea').value;
  item.updated = new Date().toISOString();
  save_notes();
}

function deleteCurrentNote() {
  if (nav.level !== 'note' || !nav.item_id) return;
  const cat = notes.find(c => c.id === nav.category_id);
  if (!cat) return;
  const sub = cat.subcategories.find(s => s.id === nav.sub_id);
  if (!sub) return;
  const item = sub.items.find(i => i.id === nav.item_id);
  if (!item) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  sub.items = sub.items.filter(i => i.id !== nav.item_id);
  save_notes();
  back_one_level();
}
window.deleteCurrentNote = deleteCurrentNote;


// ── SECTION 13: BACK NAVIGATION ─────────────────────────────────────────────

function handleBack() {
  back_one_level();
}
window.handleBack = handleBack;

function back_one_level() {
  auto_save_current_note();

  if (nav.level === 'note') {
    document.getElementById('note-editor-view').style.display = 'none';
    document.getElementById('noteAddRow').style.display = 'flex';
    document.getElementById('notes-list-view').style.display = 'block';
    document.querySelector('main').classList.remove('hide-line');
    go_to_level_3(nav.category_id, nav.sub_id);
  } else if (nav.level === 3) {
    go_to_level_2(nav.category_id);
  } else if (nav.level === 2) {
    render_level_1();
  } else {
    window.history.back();
  }
}

function back_to_list() { back_one_level(); }
window.back_to_list = back_to_list;


// ── SECTION 14: HEADER & UI HELPERS ─────────────────────────────────────────

function set_header_title(text) {
  const el = document.getElementById('pageTitle');
  if (el) el.textContent = text;
}

function set_input_placeholder(text) {
  const el = document.getElementById('newNoteInput');
  if (el) el.placeholder = text;
}

function show_back_btn() {
  const btn = document.getElementById('headerBackBtn');
  if (btn) btn.style.display = 'inline-flex';
}

function hide_back_btn() {
  const btn = document.getElementById('headerBackBtn');
  if (btn) btn.style.display = 'none';
}

function show_list_view() {
  document.getElementById('note-editor-view').style.display = 'none';
  document.getElementById('noteAddRow').style.display = 'flex';
  document.getElementById('notes-list-view').style.display = 'block';
  document.querySelector('main').classList.remove('hide-line');
}


// ── SECTION 15: VOICE INPUT ──────────────────────────────────────────────────

function voiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Voice input not supported in this browser.'); return; }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.start();

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    const input = document.getElementById('newNoteInput');
    if (input) {
      input.value = transcript;
      input.focus();
    }
  };

  recognition.onerror = function(event) {
    console.error('Voice error:', event.error);
  };
}
window.voiceInput = voiceInput;

function voiceInputToNote() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Voice input not supported in this browser.'); return; }

  const recognition = new SpeechRecognition();
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
