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
// - Local/cloud sync now protects newer local notes from older Firebase
//   snapshots overwriting them.


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

// Tracks whether this device has made a local change that has not yet been
// confirmed by the Firebase listener.
let local_notes_dirty = false;


// ── SECTION 2: INIT ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  set_date_display();
  load_notes();
  redraw_list();

  // Start listening for changes pushed from other linked devices.
  if (typeof subscribeToNotes === 'function') {
    subscribeToNotes((cloud_notes) => {

      const incoming = Array.isArray(cloud_notes)
        ? cloud_notes
        : [];

      const local_latest = get_latest_note_update(notes);
      const cloud_latest = get_latest_note_update(incoming);

      // A local note is newer than the cloud copy.
      // Keep the local copy and push it back to Firebase instead of allowing
      // an older cloud snapshot to overwrite it.
      if (local_latest > cloud_latest) {
        if (typeof saveNotesToCloud === 'function') {
          saveNotesToCloud(notes);
        }
        return;
      }

      // A cloud note is newer than the local copy.
      // Accept the cloud version normally.
      if (cloud_latest > local_latest) {
        notes = incoming;
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(notes)
        );

        local_notes_dirty = false;

        redraw_list();
        return;
      }

      // Both versions have the same newest timestamp.
      // If they are identical, the local change has successfully reached
      // the cloud and the dirty flag can be cleared.
      if (local_latest === cloud_latest) {

        const local_json = JSON.stringify(notes);
        const cloud_json = JSON.stringify(incoming);

        if (local_json === cloud_json) {
          local_notes_dirty = false;
          return;
        }

        // If this device has a known unsynced local edit, preserve it.
        if (local_notes_dirty) {
          if (typeof saveNotesToCloud === 'function') {
            saveNotesToCloud(notes);
          }
          return;
        }

        // No known local edit is pending, so accept the cloud copy.
        notes = incoming;
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(notes)
        );

        redraw_list();
      }
    });
  }

  document.getElementById('newListInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add_category();
  });

  // #newNoteInput only exists while a note title is being added (redraw_list
  // creates it on demand), so it is usually missing at page load. Without this
  // guard the TypeError aborted the rest of this handler, which meant the
  // editor's autosave and selection-tracking listeners below never attached.
  const new_note_input = document.getElementById('newNoteInput');
  if (new_note_input) {
    new_note_input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add_note_item();
    });
  }

  const editor = document.getElementById('note-textarea');

  editor.addEventListener('input', () => {
    clearTimeout(auto_save_timer);
    auto_save_timer = setTimeout(auto_save_current_note, 800);
  });

  // Force-saves immediately whenever the app is backgrounded, closed, or the
  // browser/PWA tab is torn down — catches the case where you close the app
  // less than 800ms after your last keystroke, before the debounce fires.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(auto_save_timer);
      auto_save_current_note();
    }
  });

  window.addEventListener('pagehide', () => {
    clearTimeout(auto_save_timer);
    auto_save_current_note();
  });

  // Track the user's text selection so toolbar buttons can restore it
  // after the click moves focus away from the editor. selectionchange
  // catches touchscreen selection (drag handles) that mouseup/keyup miss.
  editor.addEventListener('mouseup', save_editor_selection);
  editor.addEventListener('keyup', save_editor_selection);
  document.addEventListener('selectionchange', save_editor_selection);

  // Mirrors standard word processors: pressing Enter on an EMPTY list item
  // (numbered or bulleted) exits the list and drops to a plain blank line,
  // instead of adding another numbered/bulleted empty item forever.
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    const sel = window.getSelection();
    if (sel.rangeCount === 0) return;

    let liNode = sel.getRangeAt(0).startContainer;
    if (liNode.nodeType === 3) liNode = liNode.parentElement;

    const li = liNode.closest('li');
    if (!li) return; // not in a list, let the other handler / default behavior run

    const is_empty = li.textContent.trim() === '';
    if (!is_empty) return; // has content, let the list auto-continue normally

    e.preventDefault();

    const list = li.closest('ol, ul');
    const newBlock = document.createElement('div');
    newBlock.appendChild(document.createElement('br'));

    list.after(newBlock);
    li.remove();
    if (list.children.length === 0) list.remove();

    const range = document.createRange();
    range.setStart(newBlock, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    auto_save_current_note();
  });

  // Mirrors how ordered/unordered lists behave: pressing Enter on a line
  // that starts with a checkbox creates a new line that also starts with
  // a checkbox, instead of a plain empty line.
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    const sel = window.getSelection();
    if (sel.rangeCount === 0) return;

    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;

    const block = node.closest('div, li, p');
    if (!block || block === editor) return;

    if (!line_starts_with_checkbox(block)) return; // let the browser handle Enter normally

    e.preventDefault();

    const newBlock = document.createElement('div');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    newBlock.appendChild(checkbox);
    newBlock.appendChild(document.createTextNode('\u00A0'));

    block.after(newBlock);

    const range = document.createRange();
    range.setStart(newBlock.lastChild, 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    auto_save_current_note();
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

  // Mark the local copy as newer/unsynced until the Firebase listener
  // confirms that the same data has reached the cloud.
  local_notes_dirty = true;

  // Push the latest notes up to the cloud so other linked devices get them.
  if (typeof saveNotesToCloud === 'function') {
    saveNotesToCloud(notes);
  }
}

// Finds the newest updated timestamp anywhere inside the notes structure.
// This lets the sync listener determine whether the local or cloud copy
// contains the newer note.
function get_latest_note_update(notesData) {

  let latest = 0;

  (notesData || []).forEach((category) => {

    (category.items || []).forEach((item) => {

      const time = Date.parse(item.updated || '');

      if (!Number.isNaN(time) && time > latest) {
        latest = time;
      }
    });
  });

  return latest;
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

  const mainDesc = document.getElementById('mainPageDescription');
  if (mainDesc) mainDesc.style.display = 'none';

  document.getElementById('note-title-display').textContent = item.title;
  set_header_title('📝  Note :');
  render_breadcrumb();
  reset_fmt_toolbar();
  document.getElementById('note-textarea').innerHTML = item.content || '';
  reset_history();

  // Makes the Enter key create a real new block (a <div>) instead of
  // a line break, so formatting commands like ordered/unordered list
  // attach to the correct line rather than the whole note from the start.
  document.execCommand('defaultParagraphSeparator', false, 'div');

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
  reset_fmt_toolbar();

  if (nav.level === 'note') {
    document.getElementById('note-editor-view').style.display = 'none';
    document.getElementById('notes-list-view').style.display = 'block';
    document.querySelector('main').classList.remove('hide-line');

    const toolbar = document.getElementById('listToolbarRow');
    if (toolbar) toolbar.style.display = 'flex';

    const mainDesc = document.getElementById('mainPageDescription');
    if (mainDesc) mainDesc.style.display = 'block';

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

  const mic = document.getElementById('micBtn');
  if (mic) mic.style.display = 'inline-flex';

  const save = document.getElementById('saveBtn');
  if (save) save.style.display = 'inline-flex';

}

function hide_back_btn() {
  const btn = document.getElementById('headerBackBtn');
  if (btn) btn.style.display = 'none';

  const mic = document.getElementById('micBtn');
  if (mic) mic.style.display = 'none';

  const save = document.getElementById('saveBtn');
  if (save) save.style.display = 'none';

}


// ── AUTO SAVE ────────────────────────────────────────────────────────────────

function auto_save_current_note() {
  if (nav.level !== 'note' || !nav.item_id) return;

  const item = find_item(nav.item_id);
  if (!item) return;

  item.content = document.getElementById('note-textarea').innerHTML;
  item.updated = new Date().toISOString();
  save_notes();

  if (typeof record_history === 'function') record_history();
}

// Manual save button handler — force-saves immediately (skips the 800ms
// debounce) and flashes "Saved ✓" on the button as confirmation.
function manual_save_click(el) {
  lock_scroll_position();
  clearTimeout(auto_save_timer);
  auto_save_current_note();

  if (el) {
    const original = el.textContent;
    el.textContent = 'Saved ✓';
    el.classList.add('active');
    setTimeout(() => {
      el.textContent = original;
      el.classList.remove('active');
    }, 1200);
  }
}
window.manual_save_click = manual_save_click;


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

// Inserts recognized speech at the cursor position inside the note editor.
function voiceInputToNote() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Voice input not supported.'); return; }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.start();

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;

    const editor = document.getElementById('note-textarea');
    editor.focus({ preventScroll: true });
    restore_editor_selection();

    const sel = window.getSelection();
    if (sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(transcript);
    range.insertNode(textNode);

    const newRange = document.createRange();
    newRange.setStartAfter(textNode);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    save_editor_selection();
    auto_save_current_note();

    // If Select mode is waiting for text to appear, pick the first word now.
    if (typeof on_editor_text_added === 'function') on_editor_text_added();
  };
}
window.voiceInputToNote = voiceInputToNote;


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

const TOGGLE_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript'];

let align_state = 'left'; // tracks the single cycling align button

// Remembers the last text selection made inside the editor, since clicking
// a toolbar button/select moves focus away and the browser forgets it.
// selectionchange catches touchscreen selection (drag handles) that
// mouseup/keyup alone can miss.
function save_editor_selection() {
  const editor = document.getElementById('note-textarea');
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      saved_range = range.cloneRange();

      // Selecting actual text (not just moving the cursor) is what
      // triggers the browser's native scroll-into-view on touch devices.
      if (!sel.isCollapsed) {
        lock_scroll_position();
      }
    }
  }
}

function restore_editor_selection() {
  const editor = document.getElementById('note-textarea');
  const sel = window.getSelection();

  // If the live selection is still inside the editor, trust it — the
  // square buttons no longer steal focus, so this is almost always the
  // freshest, most correct cursor position. Only fall back to the saved
  // range when focus genuinely left the editor (the Font/Highlight/List
  // dropdowns do this, since native <select> elements must take focus
  // to open).
  if (sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    return;
  }

  if (!saved_range) return;
  sel.removeAllRanges();
  sel.addRange(saved_range);
}

// Snapshot used specifically by the Font/Highlight/List dropdowns. Opening
// a native <select> can collapse or shift the editor's selection right as
// it takes focus — often before the general selectionchange tracking gets
// a chance to react — which was causing formatting to land at the start
// of the note instead of on the selected words. Capturing it here, on
// mousedown, happens a beat earlier and reliably grabs the real selection.
let frozen_range = null;

function freeze_editor_selection() {
  const editor = document.getElementById('note-textarea');
  const sel = window.getSelection();
  if (sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    frozen_range = sel.getRangeAt(0).cloneRange();
  } else if (saved_range) {
    frozen_range = saved_range.cloneRange();
  }
}
window.freeze_editor_selection = freeze_editor_selection;

function restore_frozen_selection() {
  if (!frozen_range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(frozen_range);
}

// Shows the white/black info box above the clicked control for ~2 seconds.
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

// Blue-highlights the button. Bold/italic/underline stay highlighted while
// active (cursor is inside that formatting); other buttons just flash blue
// for ~2 seconds.
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

// Checks whether a line's content starts with a checkbox, tolerating
// leading whitespace/non-breaking-space text nodes — which is what you
// get after backspacing two lines together, since the merge can leave a
// stray empty or whitespace-only text node in front of the checkbox.
function line_starts_with_checkbox(block) {
  for (const child of block.childNodes) {
    if (child.nodeType === 3) {
      if (child.textContent.trim() !== '') return false; // real text first
      continue; // whitespace-only, keep looking
    }
    if (child.nodeType === 1) {
      return child.tagName === 'INPUT' && child.type === 'checkbox';
    }
  }
  return false;
}

// Inserts an unchecked checkbox at the cursor. Uses a manual Range
// insertion instead of execCommand('insertHTML'), which is unreliable
// about exactly where "current selection" means on mobile browsers.
function insert_checkbox() {
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);

  // Insert in front of any selected text instead of deleting it — a checkbox
  // should never silently erase the words the user had selected.
  if (!range.collapsed) range.collapse(true);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  const space = document.createTextNode('\u00A0');

  range.insertNode(space);
  range.insertNode(checkbox);

  // Place the cursor right after the inserted space.
  const newRange = document.createRange();
  newRange.setStartAfter(space);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

// Finds the list element that was just created/toggled around the cursor
// and applies the chosen bullet/number style to it.
// Nudges the current block's left margin by the given number of pixels
// (negative = decrease, positive = increase), 1px per tap as requested.
// Never goes below 0.
function adjust_indent(delta) {
  lock_scroll_position();

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_editor_selection();

  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  // Every paragraph / list item touched by the selection (a bare first line
  // is wrapped in a <div> first so it has something to indent).
  const blocks = get_blocks_or_wrap();
  if (blocks.length === 0) return;

  // First-line indent (text-indent): only the first line of each paragraph
  // moves, like a typed paragraph indent. Notes indented with the old
  // toolbar used margin-left (whole paragraph); "decrease" still works on those.
  blocks.forEach((block) => {
    const current = parseInt(block.style.textIndent) || 0;
    const legacy = parseInt(block.style.marginLeft) || 0;

    if (delta < 0 && current === 0 && legacy > 0) {
      block.style.marginLeft = Math.max(0, legacy + delta) + 'px';
      return;
    }
    block.style.textIndent = Math.max(0, current + delta) + 'px';   // never below 0
  });

  save_editor_selection();
  auto_save_current_note();
}
window.adjust_indent = adjust_indent;

// Default indent: with no argument it toggles — applies a 5px indent if the
// (first) selected line has none, or removes indent if it already has some.
// force = 'on' always sets the default 5px indent; force = 'off' removes it.
function toggle_default_indent(force) {
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  const blocks = get_blocks_or_wrap();
  if (blocks.length === 0) return;

  const first = (parseInt(blocks[0].style.textIndent) || 0) +
                (parseInt(blocks[0].style.marginLeft) || 0);
  let indent_on;
  if (force === 'on') indent_on = true;
  else if (force === 'off') indent_on = false;
  else indent_on = first === 0;

  blocks.forEach((block) => {
    if (indent_on) {
      block.style.textIndent = '5px';            // first line only
    } else {
      block.style.textIndent = '';               // removes first-line AND old whole-paragraph indent
      block.style.marginLeft = '';
      if (!block.getAttribute('style')) block.removeAttribute('style');
    }
  });
}

// Moves the text cursor left/right by one character — a manual nudge for
// when precise touch placement is hard.
function move_cursor(direction) {
  lock_scroll_position();

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_editor_selection();

  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  sel.modify('move', direction === 1 ? 'forward' : 'backward', 'character');

  save_editor_selection();
}
window.move_cursor = move_cursor;

function apply_list_style(tag, style) {
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  const editor = document.getElementById('note-textarea');
  const range = sel.getRangeAt(0);

  // Style every innermost list the selection touches, so a selection that
  // spans several lines (or a nested list) is handled sensibly.
  const touched = Array.from(editor.querySelectorAll('ul, ol'))
    .filter((list) => range.intersectsNode(list));
  const innermost = touched.filter(
    (list) => !touched.some((other) => other !== list && list.contains(other))
  );
  const targets = innermost.filter((list) => list.tagName.toLowerCase() === tag);

  if (targets.length > 0) {
    targets.forEach((list) => { list.style.listStyleType = style; });
    return;
  }

  // Fallback (original behavior): nearest list around the selection.
  let node = range.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentElement;

  const list = node.closest(tag);
  if (list) list.style.listStyleType = style;
}

// Locks the current scroll position (both the page and the scrollable note
// body) and restores it a few times over the next moment, since mobile
// browsers auto-scroll focused/selected elements into view asynchronously —
// a single restore right after focusing isn't always enough to catch it.
function lock_scroll_position() {
  const container = document.querySelector('.notepad-body');
  const winY = window.scrollY;
  const contY = container ? container.scrollTop : 0;

  const restore = () => {
    window.scrollTo(0, winY);
    if (container) container.scrollTop = contY;
  };

  restore();
  requestAnimationFrame(restore);
  setTimeout(restore, 50);
  setTimeout(restore, 150);
}

// Handles the simple square buttons: Bold, Italic, Underline, Indent, Checkbox.
function handle_fmt_click(el) {
  const cmd = el.dataset.cmd;
  const label = el.dataset.label;

  lock_scroll_position();

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
    case 'underline':
      document.execCommand('underline');
      break;
    case 'strikeThrough':
      document.execCommand('strikeThrough');
      break;
    case 'superscript':
      document.execCommand('superscript');
      break;
    case 'subscript':
      document.execCommand('subscript');
      break;
    case 'indent':
      toggle_default_indent();
      break;
    case 'checkbox':
      insert_checkbox();
      break;
  }

  highlight_fmt_btn(el);
  // Menu items show their own active state; the floating tooltip would only
  // end up hidden behind the open menu.
  if (!el.closest('.fmt-menu')) show_fmt_tooltip(el, label);
  save_editor_selection();
  auto_save_current_note();
}
window.handle_fmt_click = handle_fmt_click;

// Handles the single Align button — cycles left -> center -> right -> left.
function handle_align_click(el) {
  lock_scroll_position();

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_editor_selection();

  if (align_state === 'left') {
    document.execCommand('justifyCenter');
    align_state = 'center';
  } else if (align_state === 'center') {
    document.execCommand('justifyRight');
    align_state = 'right';
  } else {
    document.execCommand('justifyLeft');
    align_state = 'left';
  }

  el.classList.remove('align-left', 'align-center', 'align-right');
  el.classList.add('align-' + align_state);

  show_fmt_tooltip(el, 'Align ' + align_state.charAt(0).toUpperCase() + align_state.slice(1));
  save_editor_selection();
  auto_save_current_note();
}
window.handle_align_click = handle_align_click;

// Handles the Font select (Font Color / Font Size grouped options).
function handle_font_select(selectEl) {
  const value = selectEl.value;
  if (!value) return;

  lock_scroll_position();

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_frozen_selection();

  // The actual formatting lives in apply_font_choice() so the category menu
  // and this (legacy) select handler share one implementation.
  apply_font_choice(value);
  if (selectEl.getBoundingClientRect) {
    show_fmt_tooltip(selectEl, value.startsWith('size:') ? 'Font Size' : 'Font Color');
  }

  save_editor_selection();
  auto_save_current_note();
  selectEl.value = '';
}
window.handle_font_select = handle_font_select;

// Single authoritative implementation of font color / size / family.
// value is 'color:red', 'size:3' or 'name:Space Mono'.
function apply_font_choice(value) {
  const cut = value.indexOf(':');
  const type = value.slice(0, cut);
  const val = value.slice(cut + 1);

  if (type === 'color') {
    document.execCommand('foreColor', false, val);
  } else if (type === 'size') {
    document.execCommand('fontSize', false, val);
  } else if (type === 'name') {
    document.execCommand('fontName', false, val);
  }
}
window.apply_font_choice = apply_font_choice;

// Handles the Highlight select (Text Color / Background Color grouped options).
function handle_highlight_select(selectEl) {
  const value = selectEl.value;
  if (!value) return;

  lock_scroll_position();

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_frozen_selection();

  apply_highlight_choice(value);
  if (selectEl.getBoundingClientRect) {
    show_fmt_tooltip(selectEl, value.startsWith('text:') ? 'Text Color' : 'Background Color');
  }

  save_editor_selection();
  auto_save_current_note();
  selectEl.value = '';
}
window.handle_highlight_select = handle_highlight_select;

// Single authoritative implementation of text color / background highlight.
// value is 'text:red' (font color) or 'bg:yellow' (background highlight).
// 'bg:none' removes a highlight.
function apply_highlight_choice(value) {
  const cut = value.indexOf(':');
  const type = value.slice(0, cut);
  let val = value.slice(cut + 1);

  if (type === 'text') {
    document.execCommand('foreColor', false, val);
  } else if (type === 'bg') {
    if (val === 'none') val = 'transparent';
    document.execCommand('hiliteColor', false, val);
  }
}
window.apply_highlight_choice = apply_highlight_choice;

// Tracks exactly where the active list is, so the toggle button can turn
// it off later even if the cursor has since moved elsewhere.
let list_active_range = null;
let list_active_type = null;

// Handles the List select (Unordered List / Ordered List grouped style
// options). After a choice is made, the select hides and a highlighted
// UL/OL button takes its place — click that button to turn the list off.
function handle_list_select(selectEl) {
  const value = selectEl.value;
  if (!value) return;

  lock_scroll_position();

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });
  restore_frozen_selection();

  const type = value.split(':')[0];

  // The list creation / restyling lives in apply_list_choice() so the
  // category menu and this (legacy) select handler share one implementation.
  apply_list_choice(value);
  if (selectEl.getBoundingClientRect) {
    show_fmt_tooltip(selectEl, type === 'ul' ? 'Unordered List' : 'Ordered List');
  }

  save_editor_selection();
  auto_save_current_note();
  selectEl.value = '';

  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    list_active_range = sel.getRangeAt(0).cloneRange();
  }
  list_active_type = type;

  // The old UL/OL toggle button no longer exists in the redesigned toolbar
  // (the menu has a "Remove list" item instead), so only touch it if present.
  const btn = document.getElementById('listToggleBtn');
  if (btn) {
    selectEl.style.display = 'none';
    btn.textContent = '-' + type.toUpperCase() + '-';
    btn.classList.add('active');
    btn.style.display = 'flex';
  }
}
window.handle_list_select = handle_list_select;

// Single authoritative implementation of list creation / restyling.
// value is 'ul:disc', 'ul:circle', 'ul:square', 'ol:decimal',
// 'ol:lower-alpha' or 'ol:upper-roman'.
//  - not in a list            -> creates one of the chosen type
//  - in a list of the other type -> converts it (ul <-> ol)
//  - already in that type of list -> only changes the bullet/number style
//    (never toggles the list off by accident)
function apply_list_choice(value) {
  const cut = value.indexOf(':');
  const tag = value.slice(0, cut);
  const style = value.slice(cut + 1);

  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const editor = document.getElementById('note-textarea');
  const current = node && node.closest('ul, ol');
  const in_matching_list =
    current && editor.contains(current) && current.tagName.toLowerCase() === tag;

  if (!in_matching_list) {
    document.execCommand(tag === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
  }
  apply_list_style(tag, style);
}
window.apply_list_choice = apply_list_choice;

// Turns the list around the selection off, leaving its text as plain lines.
// Returns false when the selection is not inside a list.
function remove_list() {
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return false;

  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const editor = document.getElementById('note-textarea');
  const current = node && node.closest('ul, ol');
  if (!current || !editor.contains(current)) return false;

  document.execCommand(
    current.tagName.toLowerCase() === 'ul' ? 'insertUnorderedList' : 'insertOrderedList'
  );
  return true;
}
window.remove_list = remove_list;

// Turns the active list off (using the position it was created at) and
// swaps the button back to the select so a new choice can be made.
function handle_list_toggle_click() {
  const btn = document.getElementById('listToggleBtn');
  const selectEl = document.getElementById('listSelect');

  lock_scroll_position();

  const editor = document.getElementById('note-textarea');
  editor.focus({ preventScroll: true });

  if (list_active_range) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(list_active_range);
  }

  if (list_active_type === 'ul') {
    document.execCommand('insertUnorderedList');
  } else if (list_active_type === 'ol') {
    document.execCommand('insertOrderedList');
  }

  save_editor_selection();
  auto_save_current_note();

  // These two elements belonged to the old toolbar; guard so the function
  // stays safe to call from the redesigned one.
  if (btn) {
    btn.classList.remove('active');
    btn.style.display = 'none';
  }
  if (selectEl) selectEl.style.display = '';

  list_active_range = null;
  list_active_type = null;
}
window.handle_list_toggle_click = handle_list_toggle_click;


// ── SECTION 14B: CATEGORY FORMATTING MENU + SELECT MODE ─────────────────────
// The redesigned toolbar is one row — Formatting : [Category menu] [Select].
// Every menu item runs through run_fmt_item(). Items that already had a
// handler in SECTION 14 (bold / italic / underline / checkbox, indent,
// font, highlight, list) call that same handler; only genuinely new
// commands (strikethrough, spacing, styles, ...) are implemented here.

const BLOCK_SELECTOR = 'div, p, li, h1, h2, h3, h4, h5, h6, blockquote';

let select_mode = false;            // true while Select mode is on
let select_range = null;            // the temporary custom selection (a live Range)
let select_pending_first_word = false;
let fmt_notice_timer = null;

function get_editor() {
  return document.getElementById('note-textarea');
}

// ── Soft keyboard control ───────────────────────────────────────────────────
// Focusing a contenteditable raises the Samsung keypad. Toolbar commands must
// focus the editor to run (execCommand needs it), so while the toolbar is in
// use the editor is marked inputmode="none" — focus works, keypad stays down.
// The keypad comes back only when the user taps into the note to type.
function keyboard_off() {
  const editor = get_editor();
  if (editor) editor.setAttribute('inputmode', 'none');
}
window.keyboard_off = keyboard_off;

function keyboard_on() {
  const editor = get_editor();
  if (!editor || select_mode) return;                 // Select mode never wants the keypad
  if (editor.getAttribute('inputmode') !== 'none') return;

  editor.removeAttribute('inputmode');

  // Re-focus so the browser re-evaluates and shows the keypad, keeping the caret.
  if (document.activeElement === editor) {
    const sel = window.getSelection();
    const keep = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    editor.blur();
    editor.focus({ preventScroll: true });
    if (keep) { sel.removeAllRanges(); sel.addRange(keep); }
  }
}
window.keyboard_on = keyboard_on;

function range_in_editor(range) {
  const editor = get_editor();
  return !!range && !!editor && editor.contains(range.commonAncestorContainer);
}


// ── Menu open / close / expand ──────────────────────────────────────────────

function toggle_fmt_menu(force) {
  const menu = document.getElementById('fmtMenu');
  const btn = document.getElementById('fmtCategoryBtn');
  if (!menu) return;

  const open = typeof force === 'boolean' ? force : !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  if (open) keyboard_off();   // opening the menu must never leave the keypad up
  if (!open) {
    // Closing leaves a clean list: next time only the ten categories show.
    menu.querySelectorAll('.open').forEach((el) => el.classList.remove('open'));
  }

  if (btn) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('active', open);
  }
  if (open) refresh_fmt_menu_state();
}
window.toggle_fmt_menu = toggle_fmt_menu;

function close_fmt_menu() {
  toggle_fmt_menu(false);
}
window.close_fmt_menu = close_fmt_menu;

// Accordion: tapping a category (or group) head opens it and closes its
// siblings. The category button label shows the open category's name.
function toggle_fmt_branch(li) {
  if (!li || !li.parentElement) return;

  const was_open = li.classList.contains('open');
  Array.from(li.parentElement.children).forEach((sib) => {
    if (sib !== li) sib.classList.remove('open');
  });
  li.classList.toggle('open', !was_open);

  if (li.classList.contains('fmt-cat')) {
    const menu = document.getElementById('fmtMenu');
    if (menu && !was_open) menu.scrollTop = Math.max(0, li.offsetTop - 4);
  }
}

function handle_fmt_menu_click(event) {
  const head = event.target.closest('.fmt-head');
  if (head) {
    toggle_fmt_branch(head.parentElement);
    return;
  }

  const item = event.target.closest('.fmt-item');
  if (item) {
    run_fmt_item(item);
    close_fmt_menu();          // list contracts; the title shows the chosen option
  }
}

// Marks bold / italic / underline / strikethrough / superscript / subscript
// items as active when the current selection already has that format.
function refresh_fmt_menu_state() {
  const menu = document.getElementById('fmtMenu');
  const editor = get_editor();
  if (!menu || !editor) return;

  const sel = window.getSelection();
  const in_editor = sel.rangeCount > 0 && range_in_editor(sel.getRangeAt(0));

  menu.querySelectorAll('.fmt-item[data-cmd]').forEach((el) => {
    if (!TOGGLE_COMMANDS.includes(el.dataset.cmd)) return;
    let on = false;
    if (in_editor) {
      try { on = document.queryCommandState(el.dataset.cmd); } catch (err) { on = false; }
    }
    el.classList.toggle('active', on);
  });
}

// Short message under the toolbar row (for things that could not be applied).
function fmt_notice(message) {
  const el = document.getElementById('fmtNotice');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(fmt_notice_timer);
  fmt_notice_timer = setTimeout(() => { el.style.display = 'none'; }, 2500);
}


// ── Selection handling for menu commands ────────────────────────────────────

// Puts the right selection back before a command runs. Menu items do not
// take focus (mousedown is cancelled), but if the browser did move the
// selection away, fall back to Select mode's range, then the last saved one.
function fmt_prime_selection() {
  const editor = get_editor();
  const sel = window.getSelection();
  keyboard_off();

  // Look at the live selection BEFORE focus(): focusing a blurred
  // contenteditable can drop the caret at the start of the note.
  const live_ok = sel.rangeCount > 0 && range_in_editor(sel.getRangeAt(0));
  const live_clone = live_ok ? sel.getRangeAt(0).cloneRange() : null;

  editor.focus({ preventScroll: true });

  let target = null;
  if (select_mode && select_range && !select_range.collapsed) {
    target = select_range;
  } else if (live_clone) {
    target = live_clone;
  } else {
    target = saved_range || frozen_range;
  }

  if (target) {
    sel.removeAllRanges();
    sel.addRange(target.cloneRange());
  }
}

// After a command: keep the selection (so more formats can be stacked),
// keep Select mode's temporary range in step with it, refresh state, save.
function fmt_finish(item) {
  save_editor_selection();

  if (select_mode) {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && range_in_editor(sel.getRangeAt(0)) && !sel.getRangeAt(0).collapsed) {
      set_select_range(sel.getRangeAt(0), false);
    } else {
      paint_select_highlight();
    }
  }

  refresh_fmt_menu_state();

  if (item && !item.dataset.cmd) {
    item.classList.add('active');
    setTimeout(() => item.classList.remove('active'), 600);
  }

  auto_save_current_note();
}


// ── Block helpers (paragraph / heading / list-item level formatting) ────────

// True when the range only touches the very edge of the block (for example a
// selection that ends at the start of the next line) and holds none of its text.
function touches_only_edge(range, block) {
  const whole = document.createRange();
  whole.selectNodeContents(block);

  const inter = range.cloneRange();
  if (inter.compareBoundaryPoints(Range.START_TO_START, whole) < 0) {
    inter.setStart(whole.startContainer, whole.startOffset);
  }
  if (inter.compareBoundaryPoints(Range.END_TO_END, whole) > 0) {
    inter.setEnd(whole.endContainer, whole.endOffset);
  }
  return inter.collapsed;
}

// The innermost paragraph / heading / quote / list-item blocks the current
// selection touches. A collapsed cursor returns the one block it sits in.
function get_selected_blocks() {
  const editor = get_editor();
  const sel = window.getSelection();
  if (!editor || sel.rangeCount === 0) return [];

  const range = sel.getRangeAt(0);
  if (!range_in_editor(range)) return [];

  let blocks = Array.from(editor.querySelectorAll(BLOCK_SELECTOR))
    .filter((block) => range.intersectsNode(block));

  if (!range.collapsed) {
    blocks = blocks.filter((block) => !touches_only_edge(range, block));
  }

  // Keep only innermost blocks so a wrapper <div> does not get the style
  // meant for the lines inside it.
  return blocks.filter((block) => !blocks.some((other) => other !== block && block.contains(other)));
}

// Same, but if the cursor is in bare text sitting directly in the editor
// (no block around it yet), wrap that line in a <div> first.
function get_blocks_or_wrap() {
  let blocks = get_selected_blocks();
  if (blocks.length === 0) {
    document.execCommand('formatBlock', false, 'div');
    blocks = get_selected_blocks();
  }
  return blocks;
}

function apply_block_style(prop, value) {
  const blocks = get_blocks_or_wrap();
  blocks.forEach((block) => {
    block.style[prop] = value;
    if (!block.getAttribute('style')) block.removeAttribute('style');
  });
}

// Converts the given blocks to another element ('div', 'h1'..'h6',
// 'blockquote'), one block at a time, so a selection that spans several
// paragraphs gives several headings (the browser's own formatBlock would merge
// them into one). Indent / spacing / alignment styles carry over.
function convert_blocks(blocks, tag) {
  const sel = window.getSelection();
  const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;

  // Text nodes survive being moved; remember the selection by node + offset.
  const saved = range ? {
    sc: range.startContainer, so: range.startOffset,
    ec: range.endContainer, eo: range.endOffset
  } : null;
  const replaced = new Map();

  blocks.forEach((block) => {
    if (block.tagName.toLowerCase() === tag) return;

    const converted = document.createElement(tag);
    const style = block.getAttribute('style');
    if (style) converted.setAttribute('style', style);

    while (block.firstChild) converted.appendChild(block.firstChild);
    block.parentNode.replaceChild(converted, block);
    replaced.set(block, converted);
  });

  if (!saved) return;
  const mapped = (node) => replaced.get(node) || node;
  try {
    const restored = document.createRange();
    restored.setStart(mapped(saved.sc), saved.so);
    restored.setEnd(mapped(saved.ec), saved.eo);
    sel.removeAllRanges();
    sel.addRange(restored);
  } catch (err) { /* keep whatever selection the browser chose */ }
}

// Paragraph style: 'div' (normal text), 'h1'..'h6', or 'blockquote'.
function apply_block_tag(tag) {
  const blocks = get_blocks_or_wrap();
  if (blocks.length === 0) return;

  if (blocks.some((block) => block.tagName === 'LI')) {
    fmt_notice('Headings and quotes can\u2019t be applied inside a list. Remove the list first.');
    return;
  }
  convert_blocks(blocks, tag);
}

// Clear formatting: removes character formatting (bold, color, size, font,
// highlight, ...) AND paragraph formatting (headings, quotes, indent,
// spacing, alignment) from the selection. Lists are left as lists.
function clear_all_formatting() {
  document.execCommand('removeFormat');

  const blocks = get_selected_blocks();
  reset_paragraph_formatting();

  const headings = blocks.filter((block) => /^(H[1-6]|BLOCKQUOTE)$/.test(block.tagName));
  if (headings.length > 0) convert_blocks(headings, 'div');
}

// Font size in exact pixels (1-50). The browser's own fontSize command only
// knows seven coarse steps, so it is used to wrap the text and each wrapper is
// then swapped for <span style="font-size: Npx">. Re-sizing text that already
// has a pixel size replaces that size instead of nesting spans deeper each time.
function apply_font_px(px) {
  const editor = get_editor();
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  // A bare caret has no text to size: use the word it sits in.
  if (sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const word = range.startContainer.nodeType === 3
      ? word_range_at(range.startContainer, range.startOffset) : null;
    if (!word) {
      fmt_notice('Select some text first (or tap Select).');
      return;
    }
    sel.removeAllRanges();
    sel.addRange(word);
  }

  // Older notes may already contain <font size="7">; leave those alone.
  const before = new Set(editor.querySelectorAll('font[size="7"]'));
  document.execCommand('fontSize', false, '7');

  const wrappers = Array.from(editor.querySelectorAll('font[size="7"]'))
    .filter((el) => !before.has(el));
  if (wrappers.length === 0) return;

  const live = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const saved = live ? {
    sc: live.startContainer, so: live.startOffset,
    ec: live.endContainer, eo: live.endOffset
  } : null;
  const replaced = new Map();

  wrappers.forEach((font) => {
    const span = document.createElement('span');
    span.style.fontSize = px + 'px';

    // The browser sometimes reuses an existing <font color="..."> (or face)
    // element for the size. Keep that element so its color / font survive,
    // and put the pixel size on a span inside it.
    const carries_other_format =
      font.hasAttribute('color') || font.hasAttribute('face') || font.hasAttribute('style');

    if (carries_other_format) {
      font.removeAttribute('size');
      while (font.firstChild) span.appendChild(font.firstChild);
      font.appendChild(span);
    } else {
      while (font.firstChild) span.appendChild(font.firstChild);
      font.parentNode.replaceChild(span, font);
    }
    replaced.set(font, span);

    // Sizes set earlier inside this text are superseded by the new one.
    span.querySelectorAll('span').forEach((inner) => {
      if (inner.style.fontSize) {
        inner.style.fontSize = '';
        if (!inner.getAttribute('style')) inner.removeAttribute('style');
        if (inner.attributes.length === 0) {
          while (inner.firstChild) inner.parentNode.insertBefore(inner.firstChild, inner);
          inner.remove();
        }
      }
    });
    span.querySelectorAll('font[size]').forEach((inner) => inner.removeAttribute('size'));

    // Same text already wrapped in a sized span: update that span, no nesting.
    const parent = span.parentElement;
    if (parent && parent !== editor && parent.tagName === 'SPAN' &&
        parent.style.fontSize && parent.childNodes.length === 1) {
      parent.style.fontSize = px + 'px';
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      span.remove();
      replaced.set(font, parent);
    }
  });

  // Tidy empty style="" attributes the browser leaves behind.
  editor.querySelectorAll('[style=""]').forEach((el) => el.removeAttribute('style'));

  if (saved) {
    const mapped = (node) => replaced.get(node) || node;
    try {
      const restored = document.createRange();
      restored.setStart(mapped(saved.sc), saved.so);
      restored.setEnd(mapped(saved.ec), saved.eo);
      sel.removeAllRanges();
      sel.addRange(restored);
    } catch (err) { /* keep the browser's selection */ }
  }
}
window.apply_font_px = apply_font_px;

// First-line indent set to an exact size (0 removes it, including any older
// whole-paragraph indent). Used by the Indentation menu and the − / + buttons.
function apply_indent_set(px) {
  const blocks = get_blocks_or_wrap();
  blocks.forEach((block) => {
    if (px > 0) {
      block.style.textIndent = px + 'px';
    } else {
      block.style.textIndent = '';
      block.style.marginLeft = '';
      if (!block.getAttribute('style')) block.removeAttribute('style');
    }
  });
}

function insert_paragraph_break(soft) {
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  // Never replace the selected text with a break — drop the caret at its end.
  if (!sel.isCollapsed) sel.collapseToEnd();
  document.execCommand(soft ? 'insertLineBreak' : 'insertParagraph');
}

function reset_paragraph_formatting() {
  get_selected_blocks().forEach((block) => {
    ['marginLeft', 'textIndent', 'marginTop', 'marginBottom', 'lineHeight', 'textAlign'].forEach((prop) => {
      block.style[prop] = '';
    });
    if (!block.getAttribute('style')) block.removeAttribute('style');
  });
}

const ALIGN_COMMANDS = {
  left: 'justifyLeft',
  center: 'justifyCenter',
  right: 'justifyRight',
  justify: 'justifyFull'
};

// Direct alignment choice (the old single button cycled; this does not).
function apply_alignment(kind) {
  const cmd = ALIGN_COMMANDS[kind];
  if (!cmd) return;
  document.execCommand(cmd);
  if (kind !== 'justify') align_state = kind;
}


// ── Active option + − / + stepping ──────────────────────────────────────────
// The last option chosen in the Formatting list is the "active option". Its
// name stays in the list's title, and the − / + buttons step ONLY that option
// to the previous / next choice in the same list (they never touch other
// formatting already on the text).

let active_fmt_item = null;
let active_fmt_value = null;     // current number for range options (font size)

// Range options (font size) are stepped by a number: data-min / data-max /
// data-inc. Pressing the option loads its normal value (data-val, 14 px);
// − / + then move it one step at a time.
function is_range_item(item) {
  return !!item && item.hasAttribute('data-min') && item.hasAttribute('data-max');
}

// The choices − / + can move through: sibling options of the same kind
// (e.g. a color list, the indent sizes). Toggle commands such as Bold, and
// one-off actions, have nothing to step through.
function fmt_step_list(item) {
  if (!item || !item.dataset.act || item.hasAttribute('data-nostep') || is_range_item(item)) return [];
  const siblings = Array.from(item.parentElement.children).filter(
    (el) => el.classList.contains('fmt-item') &&
            el.dataset.act === item.dataset.act &&
            !el.hasAttribute('data-nostep')
  );
  return siblings.length >= 2 ? siblings : [];
}

function fmt_item_title(item, value) {
  if (is_range_item(item) && value !== null && value !== undefined && item.dataset.title) {
    return item.dataset.title.replace('{v}', value);
  }
  return item.dataset.short || item.dataset.label || item.textContent.trim();
}

function set_active_fmt_item(item, value) {
  active_fmt_item = item;
  active_fmt_value = is_range_item(item)
    ? (value !== undefined && value !== null ? value : parseInt(item.dataset.val, 10))
    : null;

  const label = document.getElementById('fmtCategoryLabel');
  if (label) label.textContent = item ? fmt_item_title(item, active_fmt_value) : 'Category';
  update_step_buttons();
}

function update_step_buttons() {
  const down = document.getElementById('stepDownBtn');
  const up = document.getElementById('stepUpBtn');

  if (is_range_item(active_fmt_item)) {
    const min = parseInt(active_fmt_item.dataset.min, 10);
    const max = parseInt(active_fmt_item.dataset.max, 10);
    if (down) down.disabled = !(active_fmt_value > min);
    if (up) up.disabled = !(active_fmt_value < max);
    return;
  }

  const list = fmt_step_list(active_fmt_item);
  const idx = list.indexOf(active_fmt_item);

  if (down) down.disabled = !(idx > 0);
  if (up) up.disabled = !(idx >= 0 && idx < list.length - 1);
}

function step_fmt(direction) {
  if (nav.level !== 'note' || !active_fmt_item) return;

  if (is_range_item(active_fmt_item)) {
    const min = parseInt(active_fmt_item.dataset.min, 10);
    const max = parseInt(active_fmt_item.dataset.max, 10);
    const inc = parseInt(active_fmt_item.dataset.inc, 10) || 1;
    const next = Math.min(max, Math.max(min, active_fmt_value + (direction > 0 ? inc : -inc)));
    if (next === active_fmt_value) return;
    run_fmt_item(active_fmt_item, next);
    return;
  }

  const list = fmt_step_list(active_fmt_item);
  const next = list[list.indexOf(active_fmt_item) + (direction > 0 ? 1 : -1)];
  if (!next) return;

  run_fmt_item(next);
}
window.step_fmt = step_fmt;


// ── Menu dispatcher ─────────────────────────────────────────────────────────

function run_fmt_item(item, value_override) {
  if (nav.level !== 'note') return;

  lock_scroll_position();
  fmt_prime_selection();
  freeze_editor_selection();   // keeps the legacy frozen-selection helpers in step

  const cmd = item.dataset.cmd;
  const act = item.dataset.act;
  const val = item.dataset.val || '';
  let applied_value;     // for options stepped by number (font size)

  try {
    if (cmd) {
      // bold, italic, underline, strikethrough, superscript, subscript, checkbox
      handle_fmt_click(item);
    } else {
      switch (act) {
        case 'size':          apply_font_choice('size:' + val); break;
        case 'fontname':      apply_font_choice('name:' + val); break;
        case 'color':         apply_font_choice('color:' + val); break;
        case 'hilite':        apply_highlight_choice('bg:' + val); break;

        case 'para-break':    insert_paragraph_break(false); break;
        case 'line-break':    insert_paragraph_break(true); break;
        case 'para-reset':    reset_paragraph_formatting(); break;
        case 'cursor':        move_cursor(parseInt(val, 10)); break;

        case 'list':          apply_list_choice(val); break;
        case 'list-off':
          if (!remove_list()) fmt_notice('The cursor is not inside a list.');
          break;

        case 'align':         apply_alignment(val); break;

        case 'indent':        adjust_indent(parseInt(val, 10)); break;
        case 'indent-set':    apply_indent_set(parseInt(val, 10)); break;
        case 'fontpx':        applied_value = value_override !== undefined ? value_override : parseInt(val, 10);
                              apply_font_px(applied_value); break;
        case 'indent-default': toggle_default_indent('on'); break;
        case 'indent-remove': toggle_default_indent('off'); break;

        case 'linespace':     apply_block_style('lineHeight', val === 'single' ? '' : val); break;
        case 'space-before':  apply_block_style('marginTop', val + 'px'); break;
        case 'space-after':   apply_block_style('marginBottom', val + 'px'); break;

        case 'style': {
          // Quote switches on and off: pressing it again on a quote restores normal text.
          const chosen = get_selected_blocks();
          const all_quotes = val === 'blockquote' && chosen.length > 0 &&
            chosen.every((block) => block.tagName === 'BLOCKQUOTE');
          apply_block_tag(all_quotes ? 'div' : val);
          break;
        }
        case 'clear':         clear_all_formatting(); break;
      }
    }
  } catch (err) {
    console.error('Formatting command failed:', act || cmd, err);
  }

  fmt_finish(item);
  set_active_fmt_item(item, applied_value);
}
window.run_fmt_item = run_fmt_item;


// ── Select mode ─────────────────────────────────────────────────────────────
// First press: mode on + first word of the note selected.
// While on: tapping a word selects that word; native drag handles still work.
// Second press: mode off, temporary selection cleared.
// The blue/white look is a CSS Custom Highlight painted over a Range (with a
// ::selection fallback) — nothing is ever written into the note's HTML.

const WORD_CHAR = /[\p{L}\p{N}_'’-]/u;
const WORD_START = /[\p{L}\p{N}][\p{L}\p{N}_'’-]*/u;

function is_word_char(ch) {
  return !!ch && WORD_CHAR.test(ch);
}

function paint_select_highlight() {
  if (!(window.CSS && CSS.highlights && typeof Highlight === 'function')) return;

  CSS.highlights.delete('fmt-select');
  if (select_mode && select_range && !select_range.collapsed) {
    CSS.highlights.set('fmt-select', new Highlight(select_range));
  }
}

function set_select_range(range, push_native) {
  select_range = range ? range.cloneRange() : null;
  if (select_range) {
    select_pending_first_word = false;
    saved_range = select_range.cloneRange();
  }

  if (select_range && push_native) {
    const editor = get_editor();
    const sel = window.getSelection();
    editor.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(select_range.cloneRange());
  }

  paint_select_highlight();
}

// Two text nodes are "adjacent" for word purposes when nothing but
// formatting tags sits between them (no line break, checkbox or photo).
function text_nodes_adjacent(a, b) {
  const between = document.createRange();
  between.setStart(a, a.data.length);
  between.setEnd(b, 0);
  return !between.cloneContents().querySelector('br, img, input');
}

function neighbour_text_node(node, direction) {
  const walker = document.createTreeWalker(get_editor(), NodeFilter.SHOW_TEXT);
  walker.currentNode = node;
  const other = direction < 0 ? walker.previousNode() : walker.nextNode();
  if (!other) return null;
  if (block_of(other) !== block_of(node)) return null;
  const first = direction < 0 ? other : node;
  const second = direction < 0 ? node : other;
  return text_nodes_adjacent(first, second) ? other : null;
}

// Nearest block element inside the editor (null for bare top-level text).
function block_of(node) {
  const editor = get_editor();
  let el = node && node.nodeType === 3 ? node.parentElement : node;
  while (el && el !== editor) {
    if (el.matches && el.matches(BLOCK_SELECTOR)) return el;
    el = el.parentElement;
  }
  return null;
}

// Range covering the whole word at (text node, offset). The word may continue
// into neighbouring text nodes (e.g. "he<b>llo</b>"). Null if not on a word.
function word_range_at(node, offset) {
  const text = node.data;
  let at = offset;

  if (!is_word_char(text[at])) {
    if (at > 0 && is_word_char(text[at - 1])) at = at - 1;
    else return null;
  }

  let start_node = node;
  let start_off = at;
  for (;;) {
    while (start_off > 0 && is_word_char(start_node.data[start_off - 1])) start_off--;
    if (start_off > 0) break;
    const prev = neighbour_text_node(start_node, -1);
    if (prev && prev.data.length > 0 && is_word_char(prev.data[prev.data.length - 1])) {
      start_node = prev;
      start_off = prev.data.length;
    } else {
      break;
    }
  }

  let end_node = node;
  let end_off = at + 1;
  for (;;) {
    while (end_off < end_node.data.length && is_word_char(end_node.data[end_off])) end_off++;
    if (end_off < end_node.data.length) break;
    const next = neighbour_text_node(end_node, 1);
    if (next && next.data.length > 0 && is_word_char(next.data[0])) {
      end_node = next;
      end_off = 0;
    } else {
      break;
    }
  }

  const range = document.createRange();
  range.setStart(start_node, start_off);
  range.setEnd(end_node, end_off);
  return range;
}

function find_first_word_range() {
  const editor = get_editor();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const match = WORD_START.exec(node.data);
    if (match) return word_range_at(node, match.index);
  }
  return null;
}

// Tap handler for Select mode: turn the tapped caret into its whole word.
function select_word_at_caret() {
  if (!select_mode) return;

  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  if (!range_in_editor(range)) return;

  // The user dragged native handles: adopt their selection as-is.
  if (!range.collapsed) {
    set_select_range(range, false);
    return;
  }

  let node = range.startContainer;
  let offset = range.startOffset;

  if (node.nodeType !== 3) {
    // Caret sits between elements: look at the nearest text beside it.
    let target = node.childNodes[offset] || null;
    let from_end = false;
    if (!target) {
      target = node.childNodes[offset - 1] || null;
      from_end = true;
    }
    if (!target) return;

    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let text_node = target.nodeType === 3 ? target : null;
    if (!text_node) {
      let n;
      while ((n = walker.nextNode())) text_node = n;           // last text node
      if (!from_end) { walker.currentNode = target; text_node = walker.nextNode(); } // first
    }
    if (!text_node) return;
    node = text_node;
    offset = from_end ? text_node.data.length : 0;
  }

  const word = word_range_at(node, offset);
  if (word) set_select_range(word, true);
}

function enter_select_mode() {
  const editor = get_editor();
  if (!editor) return;

  select_mode = true;
  select_pending_first_word = false;
  editor.classList.add('select-mode');

  // No soft keyboard while picking words — it would cover the toolbar.
  keyboard_off();

  const btn = document.getElementById('fmtSelectBtn');
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
  }

  const first = find_first_word_range();
  if (first) {
    set_select_range(first, true);
  } else {
    // Empty note: stay in Select mode; the first word is picked once text
    // appears (see on_editor_text_added) or when the user taps a word.
    select_pending_first_word = true;
    select_range = null;
    paint_select_highlight();
  }
}

// silent = true skips collapsing the native selection (used when leaving a note).
function exit_select_mode(silent) {
  const editor = get_editor();
  const was_on = select_mode;

  select_mode = false;
  select_range = null;
  select_pending_first_word = false;

  if (editor) {
    // inputmode stays "none" here on purpose: removing it while the note is
    // focused would raise the keypad the moment Select is switched off.
    // It is cleared when the user taps the note to type (keyboard_on).
    editor.classList.remove('select-mode');
  }

  paint_select_highlight();

  const btn = document.getElementById('fmtSelectBtn');
  if (btn) {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  }

  if (was_on && !silent && editor) {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && range_in_editor(sel.getRangeAt(0)) && !sel.isCollapsed) {
      sel.collapseToEnd();
      save_editor_selection();
    }
  }
}

function toggle_select_mode() {
  if (nav.level !== 'note') return;
  if (select_mode) exit_select_mode(false);
  else enter_select_mode();
}
window.toggle_select_mode = toggle_select_mode;

// Called when text appears in the note by something other than typing
// (voice input, paste): finishes a pending "select the first word".
function on_editor_text_added() {
  // Only acts when Select mode was switched on in an empty note and is still
  // waiting for its first word. Formatting commands also fire input events,
  // and those must never move the user's selection.
  if (!select_mode || !select_pending_first_word) return;

  const first = find_first_word_range();
  if (first) set_select_range(first, true);
}
window.on_editor_text_added = on_editor_text_added;

// Leaving a note (or opening another) puts the toolbar back to normal.
function reset_fmt_toolbar() {
  exit_select_mode(true);
  close_fmt_menu();
  const ed = get_editor();
  if (ed) ed.removeAttribute('inputmode');   // a freshly opened note is typeable

  set_active_fmt_item(null);
  document.querySelectorAll('#fmtMenu .open').forEach((el) => el.classList.remove('open'));
}
window.reset_fmt_toolbar = reset_fmt_toolbar;

// Wires up the menu and Select mode. Separate from the main DOMContentLoaded
// handler so nothing here depends on it.
document.addEventListener('DOMContentLoaded', () => {
  const editor = get_editor();
  const menu = document.getElementById('fmtMenu');
  const bar = document.getElementById('formatToolbarSingle');
  const action_line = document.getElementById('noteActionLine');

  if (menu) {
    // Menu items must never steal focus / collapse the editor selection.
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', handle_fmt_menu_click);
  }

  // Snapshot the selection the instant a touch lands on the toolbar, before
  // the browser has any chance to move it.
  if (bar) {
    ['pointerdown', 'touchstart'].forEach((type) => {
      bar.addEventListener(type, () => {
        keyboard_off();            // hide the keypad the instant the toolbar is touched
        freeze_editor_selection();
      }, { capture: true, passive: true });
    });
  }

  if (action_line) {
    ['pointerdown', 'touchstart'].forEach((type) => {
      action_line.addEventListener(type, () => {
        keyboard_off();
        freeze_editor_selection();
      }, { capture: true, passive: true });
    });
  }

  if (editor) {
    editor.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.note-photo')) return;

      // Tapping the note means the user wants the text, not the menu.
      close_fmt_menu();

      // Tapping into the note to type: bring the keypad back.
      if (!select_mode) { setTimeout(keyboard_on, 0); return; }
      if (e.target.tagName === 'INPUT') return;   // checkbox tap
      setTimeout(select_word_at_caret, 0);
    });

    // Pasted text can satisfy a pending "select the first word". Ordinary
    // typing is ignored so a keystroke never replaces the selected word.
    editor.addEventListener('input', (e) => {
      if (!select_mode) return;
      if (!/^(insertFromPaste|insertFromDrop|insertFromYank|insertReplacementText)$/.test(e.inputType || '')) return;
      on_editor_text_added();
    });
  }

  // Native drag handles: adopt whatever range the user selects while in
  // Select mode so formatting and the blue highlight follow it.
  document.addEventListener('selectionchange', () => {
    if (!select_mode) return;
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed && range_in_editor(range)) {
      set_select_range(range, false);
    }
  });
});


// ── SECTION 14C: UNDO / REDO ────────────────────────────────────────────────
// The browser's own undo does not know about formatting done by this toolbar
// (indent, spacing, styles, checkboxes), so the note keeps its own history of
// snapshots. A snapshot is recorded every time the note is saved — after
// typing pauses, after each toolbar command, and after photo changes.

let undo_stack = [];
let redo_stack = [];
let history_busy = false;
const HISTORY_MAX_ENTRIES = 100;
const HISTORY_MAX_CHARS = 30000000;   // photos are large base64 strings

// Caret position as a character count of text before it (survives innerHTML swaps).
function caret_text_offset() {
  const editor = get_editor();
  const sel = window.getSelection();
  if (!editor || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range_in_editor(range)) return null;

  const before = document.createRange();
  before.selectNodeContents(editor);
  before.setEnd(range.endContainer, range.endOffset);
  return before.toString().length;
}

function restore_caret_text_offset(offset) {
  const editor = get_editor();
  if (!editor || offset === null || offset === undefined) return;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node;
  let last = null;
  while ((node = walker.nextNode())) {
    last = node;
    if (remaining <= node.data.length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= node.data.length;
  }
  if (last) {
    const range = document.createRange();
    range.setStart(last, last.data.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function history_total_chars() {
  return undo_stack.reduce((sum, entry) => sum + entry.html.length, 0);
}

function update_undo_redo_buttons() {
  const undo = document.getElementById('undoBtn');
  const redo = document.getElementById('redoBtn');
  if (undo) {
    undo.disabled = undo_stack.length < 2;
    undo.classList.toggle('disabled', undo_stack.length < 2);
  }
  if (redo) {
    redo.disabled = redo_stack.length === 0;
    redo.classList.toggle('disabled', redo_stack.length === 0);
  }
}

// Records the editor's current HTML if it differs from the latest snapshot.
function record_history() {
  if (history_busy) return;
  const editor = get_editor();
  if (!editor) return;

  const html = editor.innerHTML;
  const top = undo_stack[undo_stack.length - 1];
  if (top && top.html === html) return;

  undo_stack.push({ html, caret: caret_text_offset() });
  redo_stack = [];

  while (undo_stack.length > HISTORY_MAX_ENTRIES ||
         (undo_stack.length > 2 && history_total_chars() > HISTORY_MAX_CHARS)) {
    undo_stack.shift();
  }
  update_undo_redo_buttons();
}

// Starts a fresh history for the note that was just opened.
function reset_history() {
  undo_stack = [];
  redo_stack = [];
  const editor = get_editor();
  if (editor) undo_stack.push({ html: editor.innerHTML, caret: null });
  update_undo_redo_buttons();
}
window.reset_history = reset_history;

function apply_history_entry(entry) {
  const editor = get_editor();
  if (!editor) return;

  history_busy = true;
  try {
    keyboard_off();                       // undo/redo must not raise the keypad
    if (typeof clear_photo_selection === 'function') clear_photo_selection();
    if (select_mode) exit_select_mode(true);

    editor.innerHTML = entry.html;
    restore_caret_text_offset(entry.caret);
    save_editor_selection();

    clearTimeout(auto_save_timer);
    auto_save_current_note();             // saves the restored note (not recorded: history_busy)
  } finally {
    history_busy = false;
  }
  update_undo_redo_buttons();
}

function undo_note() {
  if (nav.level !== 'note') return;
  record_history();                        // capture edits made in the last moment

  if (undo_stack.length < 2) return;
  const current = undo_stack.pop();
  redo_stack.push(current);
  apply_history_entry(undo_stack[undo_stack.length - 1]);
}
window.undo_note = undo_note;

function redo_note() {
  if (nav.level !== 'note') return;
  if (redo_stack.length === 0) return;

  const entry = redo_stack.pop();
  undo_stack.push(entry);
  apply_history_entry(entry);
}
window.redo_note = redo_note;


// ── SECTION 15: HELP MODAL ──────────────────────────────────────────────────

// Content shown for the main list page (nav.level === 1). Note-editor-page
// content will be added separately once that's designed.
const HELP_CONTENT_MAIN = `
  <p>Need a hand with your lists? Here's what to know:</p>
  <ul class="help-list">
    <li>The ✕ button deletes that entire list and every note inside it — it will ask you to confirm before deleting anything.</li>
    <li>Sync codes link devices together: on a brand-new device, tap [ sync + ] to create a code. Enter that same code on another device to link it. Once a device is already linked, tapping [ sync + ] again just shows you the existing code — it won't create a new one.</li>
    <li>Tapping a list title opens or closes it — list titles are tappable, not just decorative.</li>
    <li>Lists and notes sort themselves alphabetically automatically. There's no manual drag-to-reorder.</li>
    <li>Notes still save fine without an internet connection — they'll sync back up once you're online again.</li>
  </ul>
`;

function show_help_modal() {
  const body = document.getElementById('helpModalBody');
  const overlay = document.getElementById('helpModalOverlay');
  if (!body || !overlay) return;

  if (nav.level === 'note') {
    // Note-editor help content not built yet — falls back to main content
    // for now until that's designed.
    body.innerHTML = HELP_CONTENT_MAIN;
  } else {
    body.innerHTML = HELP_CONTENT_MAIN;
  }

  overlay.style.display = 'flex';
}
window.show_help_modal = show_help_modal;

function hide_help_modal(event) {
  const overlay = document.getElementById('helpModalOverlay');
  if (overlay) overlay.style.display = 'none';
}
window.hide_help_modal = hide_help_modal;