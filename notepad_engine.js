// ── NOTEPAD_ENGINE.JS — VERSION ONE ─────────────────────────────────────────
// Level 1 — Categories (toggle/expand inline)
// Level 2 — Sub-categories (toggle/expand inline)
// Level 3 — Items (toggle/expand inline list, tapping a note title navigates
//           to a separate page for writing)
// Breadcrumb shows full path, lives inside header above title/date row.


// ── SECTION 1: STATE ────────────────────────────────────────────────────────

const STORAGE_KEY = 'notepad_notes';

let notes = [];

const expanded = {
  categories: new Set(),
  subcategories: new Set()
};

const adding = {
  category: false,
  subcategory: null,
  item: null
};

const nav = {
  level: 1,           // 1, 2, 3, or 'note'
  category_id: null,
  sub_id: null,
  item_id: null
};

let auto_save_timer = null;


// ── SECTION 2: INIT ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  set_date_display();
  load_notes();
  render_root();

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

function set_header_title(text) {
  const el = document.getElementById('pageTitle');
  if (el) el.textContent = text;
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


// ── SECTION 5: BREADCRUMB ───────────────────────────────────────────────────

function render_breadcrumb() {
  const el = document.getElementById('breadcrumb');
  if (!el) return;

  // Nothing selected yet — keep the breadcrumb empty on initial load
  if (!nav.category_id && !nav.sub_id && nav.level !== 'note') {
    el.innerHTML = '';
    return;
  }

  let crumbs = [{ label: 'Notepad', onclick: 'render_root()' }];

  if (nav.category_id) {
    const cat = notes.find(c => c.id === nav.category_id);
    if (cat) crumbs.push({ label: cat.title, onclick: `render_root()` });
  }

  if (nav.sub_id) {
    const sub = find_subcategory(nav.sub_id);
    if (sub) crumbs.push({ label: sub.title, onclick: `render_root()` });
  }

  if (nav.level === 'note' && nav.item_id) {
    const item = find_item(nav.item_id);
    if (item) crumbs.push({ label: item.title, onclick: null });
  }

  el.innerHTML = crumbs.map((c, i) => {
    const is_last = i === crumbs.length - 1;
    const sep = i > 0 ? '<span class="crumb-separator"> &gt; </span>' : '';
    if (is_last || !c.onclick) {
      return sep + `<span class="crumb current">${c.label}</span>`;
    }
    return sep + `<span class="crumb" onclick="${c.onclick}">${c.label}</span>`;
  }).join('');
}


// ── SECTION 6: ROOT RESET (TRUE "BACK TO NOTEPAD") ──────────────────────────

function render_root() {
  nav.level = 1;
  nav.category_id = null;
  nav.sub_id = null;
  nav.item_id = null;
  expanded.categories.clear();
  expanded.subcategories.clear();
  adding.subcategory = null;
  adding.item = null;

  show_list_view();
  set_header_title('📋  Notepad :');
  redraw_list();
}

// Redraws the list using current nav/expanded/adding state without
// resetting anything. This is what toggling, adding, and deleting call.
function redraw_list() {
  render_breadcrumb();

  const list = document.getElementById('notes-list');

  if (notes.length === 0) {
    list.innerHTML = '<div class="notepad-placeholder">You must click the [ new list + ] button to create your first list title.</div>';
    return;
  }

  let html = '<ol class="notes-ol">';
  notes.forEach((cat, idx) => {
    html += render_category_block(cat, idx + 1);
  });
  html += '</ol>';

  list.innerHTML = html;
}


// ── SECTION 7: CATEGORY (LEVEL 1) ───────────────────────────────────────────

function render_category_block(cat, number) {
  const is_open = expanded.categories.has(cat.id);

  let html = `
    <li class="notepad-row note-list-item">
      <div class="row-content">
        <span class="note-list-title" onclick="toggle_category('${cat.id}')">${cat.title}</span>
        <span class="bracket-action" onclick="show_add_subcategory_row('${cat.id}')">[ new list + ]</span>
        <button class="orange-btn" onclick="delete_category('${cat.id}')">✕</button>
      </div>
    </li>
  `;

  if (is_open) {
    html += `<li class="notepad-row sub-content"><div class="row-content full">`;

    if (adding.subcategory === cat.id) {
      html += render_add_row_markup('submit_subcategory', cat.id, 'Enter list name...');
    } else if (!cat.subcategories || cat.subcategories.length === 0) {
      html += '<div class="notepad-placeholder">You must click the [ add item + ] button to create a title for this list.</div>';
    } else {
      html += '<ul class="sub-list level-2">';
      cat.subcategories.forEach((sub) => {
        html += render_subcategory_block(cat.id, sub);
      });
      html += '</ul>';
    }

    html += `</div></li>`;
  }

  return html;
}

function toggle_category(cat_id) {
  if (expanded.categories.has(cat_id)) {
    expanded.categories.delete(cat_id);
    nav.category_id = null;
    nav.sub_id = null;
  } else {
    expanded.categories.add(cat_id);
    nav.category_id = cat_id;
    nav.sub_id = null;
  }
  adding.subcategory = null;
  redraw_list();
}
window.toggle_category = toggle_category;

function show_add_subcategory_row(cat_id) {
  adding.subcategory = cat_id;
  adding.item = null;
  expanded.categories.add(cat_id);
  nav.category_id = cat_id;
  redraw_list();
  focus_live_input();
}
window.show_add_subcategory_row = show_add_subcategory_row;

function submit_subcategory(cat_id) {
  const input = document.getElementById('liveAddInput');
  const title = input ? input.value.trim() : '';
  if (!title) { if (input) input.focus(); return; }

  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  if (!cat.subcategories) cat.subcategories = [];

  const sub = {
    id: make_id(),
    title: title,
    created: new Date().toISOString(),
    items: []
  };

  const idx = alpha_insert_index(cat.subcategories, title);
  cat.subcategories.splice(idx, 0, sub);
  save_notes();
  adding.subcategory = null;
  redraw_list();
}
window.submit_subcategory = submit_subcategory;

function delete_category(cat_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  if (!confirm(`Delete "${cat.title}" and all its contents?`)) return;
  notes = notes.filter(c => c.id !== cat_id);
  expanded.categories.delete(cat_id);
  save_notes();
  render_root();
}
window.delete_category = delete_category;


// ── SECTION 8: SUB-CATEGORY (LEVEL 2) ───────────────────────────────────────

function render_subcategory_block(cat_id, sub) {
  const is_open = expanded.subcategories.has(sub.id);

  let html = `
    <li class="notepad-row sub-list-item">
      <div class="row-content">
        <span class="note-list-title" onclick="toggle_subcategory('${sub.id}')">${sub.title}</span>
        <span class="bracket-action" onclick="show_add_item_row('${sub.id}')">[ add item + ]</span>
        <button class="orange-btn" onclick="delete_subcategory('${cat_id}', '${sub.id}')">✕</button>
      </div>
    </li>
  `;

  if (is_open) {
    html += `<li class="notepad-row sub-content"><div class="row-content full">`;

    if (adding.item === sub.id) {
      html += render_add_row_markup('submit_item', sub.id, 'Enter note title...');
    } else if (!sub.items || sub.items.length === 0) {
      html += '<div class="notepad-placeholder">You must click the [ add note + ] button to create a title for this note.</div>';
    } else {
      html += '<ul class="sub-list level-3">';
      sub.items.forEach((item) => {
        html += render_item_block(sub.id, item);
      });
      html += '</ul>';
    }

    html += `</div></li>`;
  }

  return html;
}

function toggle_subcategory(sub_id) {
  if (expanded.subcategories.has(sub_id)) {
    expanded.subcategories.delete(sub_id);
    nav.sub_id = null;
  } else {
    expanded.subcategories.add(sub_id);
    nav.sub_id = sub_id;
  }
  adding.item = null;
  redraw_list();
}
window.toggle_subcategory = toggle_subcategory;

function show_add_item_row(sub_id) {
  adding.item = sub_id;
  adding.subcategory = null;
  expanded.subcategories.add(sub_id);
  nav.sub_id = sub_id;
  redraw_list();
  focus_live_input();
}
window.show_add_item_row = show_add_item_row;

function submit_item(sub_id) {
  const input = document.getElementById('liveAddInput');
  const title = input ? input.value.trim() : '';
  if (!title) { if (input) input.focus(); return; }

  const sub = find_subcategory(sub_id);
  if (!sub) return;
  if (!sub.items) sub.items = [];

  const item = {
    id: make_id(),
    title: title,
    content: '',
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  };

  const idx = alpha_insert_index(sub.items, title);
  sub.items.splice(idx, 0, item);
  save_notes();
  adding.item = null;
  redraw_list();
}
window.submit_item = submit_item;

function delete_subcategory(cat_id, sub_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  const sub = cat.subcategories.find(s => s.id === sub_id);
  if (!sub) return;
  if (!confirm(`Delete "${sub.title}" and all its items?`)) return;
  cat.subcategories = cat.subcategories.filter(s => s.id !== sub_id);
  expanded.subcategories.delete(sub_id);
  if (nav.sub_id === sub_id) nav.sub_id = null;
  save_notes();
  redraw_list();
}
window.delete_subcategory = delete_subcategory;


// ── SECTION 9: ITEM ROW (LEVEL 3) — TAP NAVIGATES TO NOTE PAGE ──────────────

function render_item_block(sub_id, item) {
  return `
    <li class="notepad-row sub-list-item">
      <div class="row-content">
        <span class="note-list-title" onclick="open_note('${sub_id}', '${item.id}')">${item.title}</span>
        <button class="orange-btn" onclick="delete_item('${sub_id}', '${item.id}')">✕</button>
      </div>
    </li>
  `;
}

function delete_item(sub_id, item_id) {
  const sub = find_subcategory(sub_id);
  if (!sub) return;
  const item = sub.items.find(i => i.id === item_id);
  if (!item) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  sub.items = sub.items.filter(i => i.id !== item_id);
  save_notes();
  redraw_list();
}
window.delete_item = delete_item;


// ── SECTION 10: NOTE PAGE (SEPARATE VIEW) ───────────────────────────────────

function open_note(sub_id, item_id) {
  const sub = find_subcategory(sub_id);
  if (!sub) return;
  const item = sub.items.find(i => i.id === item_id);
  if (!item) return;

  // find owning category for breadcrumb
  const cat = notes.find(c => c.subcategories && c.subcategories.some(s => s.id === sub_id));

  nav.level = 'note';
  nav.category_id = cat ? cat.id : null;
  nav.sub_id = sub_id;
  nav.item_id = item_id;

  document.getElementById('notes-list-view').style.display = 'none';
  document.getElementById('noteAddRow').style.display = 'none';
  document.getElementById('note-editor-view').style.display = 'block';
  document.querySelector('main').classList.add('hide-line');

  document.getElementById('note-title-display').textContent = 'Note:';
  set_header_title(item.title);
  render_breadcrumb();
  document.getElementById('note-textarea').value = item.content || '';

  show_back_btn();
}
window.open_note = open_note;

function auto_save_current_note() {
  if (nav.level !== 'note' || !nav.item_id) return;
  const item = find_item(nav.item_id);
  if (!item) return;
  item.content = document.getElementById('note-textarea').value;
  item.updated = new Date().toISOString();
  save_notes();
}

function deleteCurrentNote() {
  if (nav.level !== 'note' || !nav.item_id) return;
  const sub = find_subcategory(nav.sub_id);
  if (!sub) return;
  const item = sub.items.find(i => i.id === nav.item_id);
  if (!item) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  sub.items = sub.items.filter(i => i.id !== nav.item_id);
  save_notes();
  back_one_level();
}
window.deleteCurrentNote = deleteCurrentNote;


// ── SECTION 11: BACK NAVIGATION ─────────────────────────────────────────────

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
    nav.level = 1;
    nav.item_id = null;
    expanded.categories.add(nav.category_id);
    expanded.subcategories.add(nav.sub_id);
    redraw_list();
  } else {
    window.history.back();
  }
}

function back_to_list() { back_one_level(); }
window.back_to_list = back_to_list;


// ── SECTION 12: ADD ROW MARKUP + LIVE ALPHABETICAL REPOSITION ───────────────

function render_add_row_markup(submit_fn, parent_id, placeholder) {
  return `
    <div class="add-row" id="liveAddRow">
      <input
        id="liveAddInput"
        class="text-input"
        type="text"
        placeholder="${placeholder}"
        oninput="on_live_input_change(this.value)"
        onkeydown="if(event.key==='Enter') ${submit_fn}('${parent_id}')"
      />
      <button class="orange-btn" onclick="${submit_fn}('${parent_id}')">＋</button>
      <button class="orange-btn" onclick="cancel_add_row()">✕</button>
    </div>
  `;
}

function cancel_add_row() {
  adding.subcategory = null;
  adding.item = null;
  redraw_list();
}
window.cancel_add_row = cancel_add_row;

function focus_live_input() {
  setTimeout(() => {
    const el = document.getElementById('liveAddInput');
    if (el) el.focus();
  }, 0);
}

function on_live_input_change(value) {
  // Live alphabetical reposition is visual-only feedback; final placement
  // is computed precisely on submit via alpha_insert_index.
}
window.on_live_input_change = on_live_input_change;

function alpha_insert_index(arr, title) {
  const lower = title.trim().toLowerCase();
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].title.trim().toLowerCase() > lower) return i;
  }
  return arr.length;
}


// ── SECTION 13: LOOKUP HELPERS ──────────────────────────────────────────────

function find_subcategory(sub_id) {
  for (const cat of notes) {
    if (!cat.subcategories) continue;
    const sub = cat.subcategories.find(s => s.id === sub_id);
    if (sub) return sub;
  }
  return null;
}

function find_item(item_id) {
  for (const cat of notes) {
    if (!cat.subcategories) continue;
    for (const sub of cat.subcategories) {
      if (!sub.items) continue;
      const item = sub.items.find(i => i.id === item_id);
      if (item) return item;
    }
  }
  return null;
}


// ── SECTION 14: VIEW HELPERS ─────────────────────────────────────────────────

function show_list_view() {
  document.getElementById('note-editor-view').style.display = 'none';
  document.getElementById('noteAddRow').style.display = 'flex';
  document.getElementById('notes-list-view').style.display = 'block';
  document.querySelector('main').classList.remove('hide-line');
}

function show_back_btn() {
  const btn = document.getElementById('headerBackBtn');
  if (btn) btn.style.display = 'inline-flex';
}

function hide_back_btn() {
  const btn = document.getElementById('headerBackBtn');
  if (btn) btn.style.display = 'none';
}


// ── SECTION 15: VOICE INPUT ──────────────────────────────────────────────────

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
