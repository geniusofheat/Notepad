// ── NOTEPAD_ENGINE_2.JS ──────────────────────────────────────────────────────
// Two-level structure:
// Level 1 — Main list titles (expand/collapse inline)
// Level 2 — Note titles (tap opens note writing view)
// Toolbar row: [ new list + ] always visible, reveals input on tap
// Add note row: hidden, shown only when [ add note + ] is tapped
//
// CHANGES IN THIS VERSION:
// - Storage is localStorage PLUS Firebase cloud sync (via notepad_sync.js).
// - Note editor switched from <textarea> to contenteditable <div> so notes
//   can now store formatted HTML (bold, italic, lists, headings, etc).
// - New SECTION 14 at the bottom: formatting toolbar button handlers.


// ── SECTION 1: STATE ────────────────────────────────────────────────────────

const STORAGE_KEY = 'notepad_notes';

let notes = [];

const expanded = new Set();

let adding_to = null;

let nav = {
  level: 1,
  category_id: null,
  item_id: null
};

let auto_save_timer = null;

let saved_range = null; // last known text selection inside the note editor


// ── SECTION 2: INIT ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  set_date_display();
  load_notes();
  redraw_list();

  // Start listening for changes pushed from other linked devices.
  if (typeof subscribeToNotes === 'function') {
    subscribeToNotes((cloud_notes) => {
      notes = cloud_notes || [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      redraw_list();
    });
  }

  document.getElementById('newListInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add_category();
  });

  document.getElementById('newNoteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add_note_item();
  });

  const editor = document.getElementById('note-textarea');

  editor.addEventListener('input', () => {
    clearTimeout(auto_save_timer);
    auto_save_timer = setTimeout(auto_save_current_note, 800);
  });

  // Track the user's text selection so toolbar buttons can restore it
  // after the click moves focus away from the editor.
  editor.addEventListener('mouseup', save_editor_selection);
  editor.addEventListener('keyup', save_editor_selection);
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

  // Push the latest notes up to the cloud so other linked devices get them.
  if (typeof saveNotesToCloud === 'function') {
    saveNotesToCloud(notes);
  }
}


// ── SECTION 4: ID GENERATOR ─────────────────────────────────────────────────

function make_id() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
}


// ── SECTION 5: ALPHABETICAL INSERT ──────────────────────────────────────────

function alpha_insert_index(arr, title) {
  const lower = title.trim().toLowerCase();
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].title.trim().toLowerCase() > lower) return i;
  }
  return arr.length;
}


// ── SECTION 6: BREADCRUMB ───────────────────────────────────────────────────

function render_breadcrumb() {
  const el = document.getElementById('breadcrumb');
  if (!el) return;

  if (!nav.category_id && nav.level !== 'note') {
    el.innerHTML = '';
    return;
  }

  let crumbs = [{ label: 'Notepad', onclick: 'go_home()' }];

  if (nav.category_id) {
    const cat = notes.find(c => c.id === nav.category_id);
    if (cat) crumbs.push({ label: cat.title, onclick: null });
  }

  if (nav.level === 'note' && nav.item_id) {
    const item = find_item(nav.item_id);
    if (item) crumbs.push({ label: item.title, onclick: null });
  }

  el.innerHTML = crumbs.map((c, i) => {
    const sep = i > 0 ? '<span class="crumb-separator"> &gt; </span>' : '';
    if (!c.onclick) {
      return sep + `<span class="crumb current">${c.label}</span>`;
    }
    return sep + `<span class="crumb" onclick="${c.onclick}">${c.label}</span>`;
  }).join('');
}


// ── SECTION 7: LIST TOOLBAR (NEW LIST) ──────────────────────────────────────

function show_list_toolbar() {
  const fields = document.getElementById('listAddFields');
  if (fields) {
    fields.style.display = 'flex';
    setTimeout(() => {
      const input = document.getElementById('newListInput');
      if (input) { input.value = ''; input.focus(); }
    }, 0);
  }
}
window.show_list_toolbar = show_list_toolbar;

function hide_list_toolbar() {
  const fields = document.getElementById('listAddFields');
  if (fields) fields.style.display = 'none';
  const input = document.getElementById('newListInput');
  if (input) input.value = '';
}


// ── SECTION 8: ADD NOTE ROW (PER LIST) ──────────────────────────────────────

function show_add_note_row(cat_id) {
  adding_to = cat_id;
  expanded.add(cat_id);
  nav.category_id = cat_id;

  const desc = document.getElementById('description-paragraph');
  if (desc) desc.style.display = 'none';

  redraw_list();

  setTimeout(() => {
    const input = document.getElementById('newNoteInput');
    if (input) { input.value = ''; input.focus(); }
  }, 0);
}
window.show_add_note_row = show_add_note_row;

function cancel_add_note() {
  adding_to = null;

  const input = document.getElementById('newNoteInput');
  if (input) input.value = '';

  const desc = document.getElementById('description-paragraph');
  if (desc) desc.style.display = 'none';

  redraw_list();
}
window.cancel_add_note = cancel_add_note;


// ── SECTION 9: ADD CATEGORY (LEVEL 1) ───────────────────────────────────────

function add_category() {
  const input = document.getElementById('newListInput');
  const title = input ? input.value.trim() : '';
  if (!title) { if (input) input.focus(); return; }

  const cat = {
    id: make_id(),
    title: title,
    created: new Date().toISOString(),
    items: []
  };

  const idx = alpha_insert_index(notes, title);
  notes.splice(idx, 0, cat);
  save_notes();
  hide_list_toolbar();
  redraw_list();
}
window.add_category = add_category;

function delete_category(cat_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;
  if (!confirm(`Delete "${cat.title}" and all its notes?`)) return;

  notes = notes.filter(c => c.id !== cat_id);
  expanded.delete(cat_id);

  if (adding_to === cat_id) {
    adding_to = null;
    cancel_add_note();
  }

  if (nav.category_id === cat_id) nav.category_id = null;

  save_notes();
  redraw_list();
}
window.delete_category = delete_category;


// ── SECTION 10: ADD NOTE ITEM (LEVEL 2) ─────────────────────────────────────

function add_note_item() {
  if (!adding_to) return;

  const input = document.getElementById('newNoteInput');
  const title = input ? input.value.trim() : '';
  if (!title) { if (input) input.focus(); return; }

  const cat = notes.find(c => c.id === adding_to);
  if (!cat) return;

  const item = {
    id: make_id(),
    title,
    content: '',
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  };

  if (!cat.items) cat.items = [];

  const idx = alpha_insert_index(cat.items, title);
  cat.items.splice(idx, 0, item);

  save_notes();
  cancel_add_note();
  redraw_list();
}
window.add_note_item = add_note_item;

function delete_note_item(cat_id, item_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;

  cat.items = (cat.items || []).filter(i => i.id !== item_id);

  save_notes();
  redraw_list();
}
window.delete_note_item = delete_note_item;


// ── SECTION 11: EXPAND / COLLAPSE LEVEL 1 ───────────────────────────────────

function toggle_category(cat_id) {
  if (expanded.has(cat_id)) {
    expanded.delete(cat_id);
    if (nav.category_id === cat_id) nav.category_id = null;
  } else {
    expanded.add(cat_id);
    nav.category_id = cat_id;
  }

  redraw_list();
}
window.toggle_category = toggle_category;


// ── SECTION 12: MAIN LIST RENDER ────────────────────────────────────────────

function redraw_list() {
  render_breadcrumb();

  const list = document.getElementById('notes-list');
  if (!list) return;

  if (notes.length === 0) {
    list.innerHTML = '<div class="notepad-placeholder">Tap [ new list + ] above to create your first list.</div>';
    return;
  }

  let html = '<ol class="notes-ol">';

  notes.forEach((cat) => {
    const is_open = expanded.has(cat.id);
    const is_adding = adding_to === cat.id;
    const has_items = cat.items && cat.items.length > 0;

    html += `
      <li class="note-list-item">
        <div class="row-content">
          <span class="note-list-title" onclick="toggle_category('${cat.id}')">${cat.title}</span>
          <span class="bracket-action" onclick="show_add_note_row('${cat.id}')">[ add note + ]</span>
          <button class="orange-btn" onclick="delete_category('${cat.id}')">✕</button>
        </div>
      </li>
    `;

    if (is_adding) {
      html += `
        <li class="sub-content-row add-note-row">
          <div class="row-content">
            <input class="text-input" id="newNoteInput" placeholder="Enter note title..." onkeydown="if(event.key==='Enter') add_note_item()">
            <button class="orange-btn-44" onclick="add_note_item()">＋</button>
            <button class="orange-btn" onclick="cancel_add_note()">✕</button>
          </div>
        </li>
      `;
    }

    if (is_open) {
      html += `<li class="sub-content-row">`;

      if (has_items) {
        html += '<ul class="note-items-list">';
        cat.items.forEach((item) => {
          html += `
            <li class="note-item-row">
              <div class="row-content">
                <span class="note-list-title" onclick="open_note('${cat.id}', '${item.id}')">${item.title}</span>
                <button class="orange-btn" onclick="delete_note_item('${cat.id}', '${item.id}')">✕</button>
              </div>
            </li>
          `;
        });
        html += '</ul>';
      } else {
        html += `<div class="notepad-placeholder" id="description-paragraph">
          Tap [ add note + ] beside the list title to create your first note.
        </div>`;
      }

      html += `</li>`;
    }
  });

  html += '</ol>';
  list.innerHTML = html;
}


// ── NAV + NOTE VIEW ─────────────────────────────────────────────────────────

function go_home() {
  nav.level = 1;
  nav.category_id = null;
  nav.item_id = null;
  expanded.clear();
  adding_to = null;
  cancel_add_note();
  hide_list_toolbar();
  set_header_title('📋  Notepad :');
  redraw_list();
}
window.go_home = go_home;

function open_note(cat_id, item_id) {
  const cat = notes.find(c => c.id === cat_id);
  if (!cat) return;

  const item = cat.items.find(i => i.id === item_id);
  if (!item) return;

  nav.level = 'note';
  nav.category_id = cat_id;
  nav.item_id = item_id;

  document.getElementById('notes-list-view').style.display = 'none';
  document.getElementById('note-editor-view').style.display = 'block';
  document.querySelector('main').classList.add('hide-line');

  const toolbar = document.getElementById('listToolbarRow');
  if (toolbar) toolbar.style.display = 'none';

  document.getElementById('note-title-display').textContent = item.title;
  set_header_title('📝  Note :');
  render_breadcrumb();
  document.getElementById('note-textarea').innerHTML = item.content || '';

  show_back_btn();
}
window.open_note = open_note;


// ── BACK NAVIGATION ─────────────────────────────────────────────────────────

function handleBack() {
  back_one_level();
}
window.handleBack = handleBack;

function back_one_level() {
  auto_save_current_note();

  if (nav.level === 'note') {
    document.getElementById('note-editor-view').style.display = 'none';
    document.getElementById('notes-list-view').style.display = 'block';
    document.querySelector('main').classList.remove('hide-line');

    const toolbar = document.getElementById('listToolbarRow');
    if (toolbar) toolbar.style.display = 'flex';

    nav.level = 1;
    nav.item_id = null;
    expanded.add(nav.category_id);
    set_header_title('📋  Notepad :');
    redraw_list();
    show_back_btn();
  } else {
    hide_back_btn();
    window.history.back();
  }
}
window.back_one_level = back_one_level;


// ── LOOKUP HELPERS ──────────────────────────────────────────────────────────

function find_item(item_id) {
  for (const cat of notes) {
    if (!cat.items) continue;
    const item = cat.items.find(i => i.id === item_id);
    if (item) return item;
  }
  return null;
}


// ── VIEW HELPERS ─────────────────────────────────────────────────────────────

function show_back_btn() {
  const btn = document.getElementById('headerBackBtn');
  if (btn) btn.style.display = 'inline-flex';
}

function hide_back_btn() {
  const btn = document.getElementById('headerBackBtn');
  if (btn) btn.style.display = 'none';
}


// ── AUTO SAVE ────────────────────────────────────────────────────────────────

function auto_save_current_note() {
  if (nav.level !== 'note' || !nav.item_id) return;

  const item = find_item(nav.item_id);
  if (!item) return;

  item.content = document.getElementById('note-textarea').innerHTML;
  item.updated = new Date().toISOString();
  save_notes();
}


// ── VOICE INPUT ──────────────────────────────────────────────────────────────

function voiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Voice input not supported.'); return; }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.start();

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    const input = document.getElementById('newListInput');
    if (input) { input.value = transcript; input.focus(); }
  };
}
window.voiceInput = voiceInput;


// ── SECTION 13: EXPORT / IMPORT (MANUAL CROSS-DEVICE BACKUP) ────────────────

// Downloads the current notes array as a .json file the user can transfer
// to another device (email, Drive, USB, etc.) and load with import_notes().
function export_notes() {
  const data_str = JSON.stringify(notes, null, 2);
  const blob = new Blob([data_str], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `notepad_backup_${stamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window.export_notes = export_notes;

// Opens the hidden file picker. Wire this to your "Import" button's onclick.
function trigger_import() {
  const input = document.getElementById('importFileInput');
  if (input) input.click();
}
window.trigger_import = trigger_import;

// Reads the picked .json file, validates it, then asks whether to replace
// everything or merge with what's already on this device.
function import_notes(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    let imported;
    try {
      imported = JSON.parse(e.target.result);
    } catch (err) {
      alert('That file could not be read as valid backup data.');
      event.target.value = '';
      return;
    }

    if (!Array.isArray(imported)) {
      alert('That file does not look like a Notepad backup.');
      event.target.value = '';
      return;
    }

    const replace = confirm(
      'Tap OK to REPLACE all current lists with this backup.\nTap Cancel to MERGE instead (keeps what\'s here and adds anything new from the backup).'
    );

    if (replace) {
      notes = imported;
    } else {
      merge_notes(imported);
    }

    save_notes();
    expanded.clear();
    redraw_list();
    alert('Import complete.');

    event.target.value = '';
  };
  reader.readAsText(file);
}
window.import_notes = import_notes;

// Merge logic: lists are matched by title (case-insensitive). Existing lists
// keep their notes; any note titles not already present get added in.
function merge_notes(imported) {
  imported.forEach((incoming_cat) => {
    const existing_cat = notes.find(
      c => c.title.trim().toLowerCase() === incoming_cat.title.trim().toLowerCase()
    );

    if (!existing_cat) {
      const idx = alpha_insert_index(notes, incoming_cat.title);
      notes.splice(idx, 0, incoming_cat);
      return;
    }

    if (!existing_cat.items) existing_cat.items = [];

    (incoming_cat.items || []).forEach((incoming_item) => {
      const dup = existing_cat.items.find(
        i => i.title.trim().toLowerCase() === incoming_item.title.trim().toLowerCase()
      );
      if (!dup) {
        const idx = alpha_insert_index(existing_cat.items, incoming_item.title);
        existing_cat.items.splice(idx, 0, incoming_item);
      }
    });
  });
}


// ── SECTION 14: RICH TEXT FORMATTING TOOLBAR ────────────────────────────────

const TOGGLE_COMMANDS = ['bold', 'italic', 'insertUnorderedList', 'insertOrderedList'];

// Remembers the last text selection made inside the editor, since clicking
// a toolbar button/select moves focus away and the browser forgets it.
function save_editor_selection() {
  const editor = document.getElementById('note-textarea');
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      saved_range = range.cloneRange();
    }
  }
}

function restore_editor_selection() {
  if (!saved_range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(saved_range);
}

// Shows the white/black info box above the clicked button for ~2 seconds.
function show_fmt_tooltip(el, label) {
  const tooltip = document.getElementById('fmtTooltip');
  if (!tooltip) return;

  tooltip.textContent = label;
  tooltip.style.display = 'block';

  const rect = el.getBoundingClientRect();
  tooltip.style.top = (rect.top + window.scrollY - tooltip.offsetHeight - 8) + 'px';
  tooltip.style.left = (rect.left + window.scrollX) + 'px';

  clearTimeout(window._fmtTooltipTimer);
  window._fmtTooltipTimer = setTimeout(() => {
    tooltip.style.display = 'none';
  }, 2000);
}

// Blue-highlights the button. Toggle commands stay highlighted while
// active (e.g. bold stays blue while the cursor is in bold text); other
// commands just flash blue for ~2 seconds.
function highlight_fmt_btn(el) {
  const cmd = el.dataset.cmd;

  if (TOGGLE_COMMANDS.includes(cmd)) {
    const active = document.queryCommandState(cmd);
    el.classList.toggle('active', active);
  } else {
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 2000);
  }
}

// Inserts an unchecked checkbox at the cursor.
function insert_checkbox() {
  document.execCommand('insertHTML', false, '<input type="checkbox"> ');
}

// Increases the left margin of the current block each time it's tapped.
function apply_margin() {
  const editor = document.getElementById('note-textarea');
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentElement;

  let block = node.closest('div, p, li, blockquote');

  if (!block || block === editor) {
    document.execCommand('formatBlock', false, 'div');
    node = window.getSelection().getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    block = node.closest('div, p, li, blockquote');
  }

  if (!block) return;

  const current = parseInt(block.style.marginLeft) || 0;
  block.style.marginLeft = (current + 20) + 'px';
}

// Handles every square toolbar button (B, I, UL, OL, indent, margin, checkbox).
function handle_fmt_click(el) {
  const cmd = el.dataset.cmd;
  const label = el.dataset.label;

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_editor_selection();

  switch (cmd) {
    case 'bold':
      document.execCommand('bold');
      break;
    case 'italic':
      document.execCommand('italic');
      break;
    case 'insertUnorderedList':
      document.execCommand('insertUnorderedList');
      break;
    case 'insertOrderedList':
      document.execCommand('insertOrderedList');
      break;
    case 'indent':
      document.execCommand('indent');
      break;
    case 'margin':
      apply_margin();
      break;
    case 'hiliteColor':
      document.execCommand('hiliteColor', false, 'yellow');
      break;
    case 'checkbox':
      insert_checkbox();
      break;
  }

  highlight_fmt_btn(el);
  show_fmt_tooltip(el, label);
  save_editor_selection();
  auto_save_current_note();
}
window.handle_fmt_click = handle_fmt_click;

// Handles the H (heading) dropdown.
function handle_heading_select(selectEl) {
  const value = selectEl.value;
  if (!value) return;

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_editor_selection();

  document.execCommand('formatBlock', false, value);

  show_fmt_tooltip(selectEl, 'Heading ' + value);
  save_editor_selection();
  auto_save_current_note();
  selectEl.value = '';
}
window.handle_heading_select = handle_heading_select;

// Handles the FS (font size) dropdown. Uses execCommand's 1-7 scale.
function handle_fontsize_select(selectEl) {
  const value = selectEl.value;
  if (!value) return;

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_editor_selection();

  document.execCommand('fontSize', false, value);

  show_fmt_tooltip(selectEl, 'Font Size');
  save_editor_selection();
  auto_save_current_note();
  selectEl.value = '';
}
window.handle_fontsize_select = handle_fontsize_select;

// Handles the FC (font color) dropdown.
function handle_fontcolor_select(selectEl) {
  const value = selectEl.value;
  if (!value) return;

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_editor_selection();

  document.execCommand('foreColor', false, value);

  show_fmt_tooltip(selectEl, 'Font Color');
  save_editor_selection();
  auto_save_current_note();
  selectEl.value = '';
}
window.handle_fontcolor_select = handle_fontcolor_select;
