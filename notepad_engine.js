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

// Returns true when the notes were stored on this device. A full phone
// storage (very large photos) makes localStorage throw; that must never stop
// Save / Back from working, so the error is caught and reported instead.
function save_notes() {
  let stored = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (err) {
    stored = false;
    console.error('Could not store notes on this device:', err);
  }

  // Mark the local copy as newer/unsynced until the Firebase listener
  // confirms that the same data has reached the cloud.
  local_notes_dirty = true;

  // Push the latest notes up to the cloud so other linked devices get them.
  try {
    if (typeof saveNotesToCloud === 'function') saveNotesToCloud(notes);
  } catch (err) {
    console.error('Could not send notes to the cloud:', err);
  }
  return stored;
}

// Finds the newest updated timestamp anywhere inside the notes structure.
// This lets the sync listener determine whether the local or cloud copy
// contains the newer note.
function get_latest_note_update(notesData) {

  let latest = 0;

  (notesData || []).forEach((category) => {

    // Renaming a list stamps the list itself.
    const category_time = Date.parse(category.updated || '');
    if (!Number.isNaN(category_time) && category_time > latest) latest = category_time;

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

// ── RENAMING TITLES ──────────────────────────────────────────────────────────
// [ edit ] in the toolbar turns Edit mode on. While it is on, tapping a list
// title or a note title (instead of opening it) turns that title into a text
// box. Enter or ✓ saves the new name, ✕ cancels. Tap [ done ] to leave Edit mode.

let edit_mode = false;
let rename_target = null;      // { cat_id, item_id | null }

function esc_attr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function current_title_of(target) {
  const cat = notes.find((c) => c.id === target.cat_id);
  if (!cat) return '';
  if (!target.item_id) return cat.title;
  const item = (cat.items || []).find((i) => i.id === target.item_id);
  return item ? item.title : '';
}

function rename_row_html() {
  return `
    <input class="text-input rename-input" id="renameInput" value="${esc_attr(current_title_of(rename_target))}"
           aria-label="New title" onkeydown="if(event.key==='Enter'){commit_rename();}else if(event.key==='Escape'){cancel_rename();}">
    <button class="orange-btn" onmousedown="event.preventDefault()" onclick="commit_rename()" aria-label="Save name">✓</button>
    <button class="orange-btn" onmousedown="event.preventDefault()" onclick="cancel_rename()" aria-label="Cancel">✕</button>`;
}

function toggle_edit_mode() {
  if (nav.level === 'note') return;
  if (rename_target) commit_rename();       // finish the title being typed first

  edit_mode = !edit_mode;
  rename_target = null;

  const btn = document.getElementById('editBtn');
  if (btn) {
    btn.textContent = edit_mode ? 'done' : 'edit';
    btn.classList.toggle('active', edit_mode);
    btn.setAttribute('aria-pressed', edit_mode ? 'true' : 'false');
  }
  redraw_list();
}
window.toggle_edit_mode = toggle_edit_mode;

// Tapping a title: rename it in Edit mode, otherwise open / close it as usual.
function title_tap(cat_id, item_id) {
  if (edit_mode) {
    if (rename_target) commit_rename();
    rename_target = { cat_id, item_id: item_id || null };
    redraw_list();
    return;
  }
  if (item_id) open_note(cat_id, item_id);
  else toggle_category(cat_id);
}
window.title_tap = title_tap;

function by_title(a, b) {
  const x = a.title.trim().toLowerCase();
  const y = b.title.trim().toLowerCase();
  return x < y ? -1 : (x > y ? 1 : 0);
}

function commit_rename() {
  if (!rename_target) return;
  const box = document.getElementById('renameInput');
  const target = rename_target;
  const title = box ? box.value.trim() : '';
  rename_target = null;

  const cat = notes.find((c) => c.id === target.cat_id);
  const entry = cat
    ? (target.item_id ? (cat.items || []).find((i) => i.id === target.item_id) : cat)
    : null;

  // An empty name, or no change, leaves the title as it was.
  if (entry && title && title !== entry.title) {
    entry.title = title;
    entry.updated = new Date().toISOString();       // so other devices pick up the new name
    if (target.item_id) cat.items.sort(by_title);   // keep the A-Z order
    else notes.sort(by_title);
    save_notes();
  }
  redraw_list();
}
window.commit_rename = commit_rename;

function cancel_rename() {
  rename_target = null;
  redraw_list();
}
window.cancel_rename = cancel_rename;

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
          ${rename_target && rename_target.cat_id === cat.id && !rename_target.item_id
            ? rename_row_html()
            : `<span class="note-list-title" onclick="title_tap('${cat.id}')">${cat.title}</span>`}
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
                ${rename_target && rename_target.item_id === item.id
                  ? rename_row_html()
                  : `<span class="note-list-title" onclick="title_tap('${cat.id}', '${item.id}')">${item.title}</span>`}
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
  list.classList.toggle('editing-titles', edit_mode);

  // A title being renamed gets the cursor right away.
  const box = document.getElementById('renameInput');
  if (box) {
    box.focus();
    box.select();
  }
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

// A first line typed (or loaded) with no paragraph around it has no "12 px after
// it". Wrap such loose top-level text in a <div> so every paragraph is a block.
// Only run at calm moments (Enter pressed, note opened) -- never while typing,
// because moving the text being typed would break the phone keyboard's word
// suggestions.
function wrap_loose_top_level() {
  const ed = get_editor();
  if (!ed) return;
  const sel = window.getSelection();
  const BLOCKS = /^(DIV|P|UL|OL|BLOCKQUOTE|H[1-6]|PRE|TABLE|IMG)$/;
  let run = [];

  const flush = () => {
    const worth = run.some((n) => n.nodeType === 1 || n.textContent.trim() !== '');
    const holds_caret = sel.rangeCount > 0 && run.some((n) => n.contains(sel.anchorNode));
    if (run.length && worth && !holds_caret) {
      const div = document.createElement('div');
      ed.insertBefore(div, run[0]);
      run.forEach((n) => div.appendChild(n));
    }
    run = [];
  };

  Array.from(ed.childNodes).forEach((n) => {
    if (n.nodeType === 1 && BLOCKS.test(n.tagName)) { flush(); return; }
    run.push(n);
  });
  flush();
}

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
  wrap_loose_top_level();
  if (typeof load_fonts_in_html === 'function') load_fonts_in_html(item.content);
  reset_history();

  // Makes the Enter key create a real new block (a <div>) instead of
  // a line break, so formatting commands like ordered/unordered list
  // attach to the correct line rather than the whole note from the start.
  document.execCommand('defaultParagraphSeparator', false, 'div');

  show_back_btn();
  fit_note_area();
}
window.open_note = open_note;

// The note box is a fixed-height scroll area that fills the screen below the
// toolbar: a finger on the note scrolls the note only; a finger anywhere else
// scrolls the whole page. Re-measured whenever the screen size, the keypad or
// the toolbar height changes.
function fit_note_area() {
  const body = document.getElementById('noteBody');
  const view = document.getElementById('note-editor-view');
  if (!body || !view || view.style.display === 'none') return;

  const viewport = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const top = body.getBoundingClientRect().top + window.scrollY;   // top of the note box on the page
  const height = Math.max(160, Math.floor(viewport - top - 12));
  body.style.height = height + 'px';
}
window.fit_note_area = fit_note_area;

window.addEventListener('resize', fit_note_area);
window.addEventListener('orientationchange', () => setTimeout(fit_note_area, 200));
if (window.visualViewport) window.visualViewport.addEventListener('resize', fit_note_area);
window.addEventListener('load', fit_note_area);


// ── BACK NAVIGATION ─────────────────────────────────────────────────────────

function handleBack() {
  back_one_level();
}
window.handleBack = handleBack;

function back_one_level() {
  try { auto_save_current_note(); } catch (err) { console.error('Save on Back failed:', err); }
  try { reset_fmt_toolbar(); } catch (err) { console.error(err); }

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

// The note's HTML for saving / undo: a photo's blue "selected" outline is only
// a temporary look and must not be stored.
function editor_clean_html() {
  const editor = document.getElementById('note-textarea');
  const has_photo_mark = !!editor.querySelector('.note-photo-selected');
  if (!has_photo_mark && editor.innerHTML.indexOf('\u200b') === -1 && editor.innerHTML.indexOf('data-tf') === -1) return editor.innerHTML;
  const copy = editor.cloneNode(true);
  copy.querySelectorAll('.note-photo-selected').forEach((el) => {
    el.classList.remove('note-photo-selected');
  });
  // Formatting that was chosen but never typed into leaves an empty span; do not store it.
  copy.querySelectorAll('span').forEach((el) => {
    if (el.textContent === '\u200b' && !el.querySelector('img, input')) el.remove();
  });
  copy.querySelectorAll('[data-tf]').forEach((el) => el.removeAttribute('data-tf'));
  return copy.innerHTML.replace(/\u200b/g, '');
}

function auto_save_current_note() {
  if (nav.level !== 'note' || !nav.item_id) return;

  const item = find_item(nav.item_id);
  if (!item) return;

  const editor = document.getElementById('note-textarea');

  // A ticked checkbox is only a live property of the element; copy it into the
  // HTML attribute so the tick is part of the saved note (and of undo / sync).
  editor.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    if (box.checked) box.setAttribute('checked', '');
    else box.removeAttribute('checked');
  });

  item.content = editor_clean_html();
  item.updated = new Date().toISOString();
  const stored = save_notes();

  try {
    if (typeof record_history === 'function') record_history();
  } catch (err) {
    console.error('Undo history failed:', err);
  }
  return stored;
}

// Manual save button handler — force-saves immediately (skips the 800ms
// debounce) and flashes "Saved ✓" on the button as confirmation.
function manual_save_click(el) {
  lock_scroll_position();
  clearTimeout(auto_save_timer);
  const stored = auto_save_current_note() !== false;

  if (el) {
    const original = el.textContent;
    el.textContent = stored ? 'Saved ✓' : 'Not saved ✗';
    if (!stored) alert('This note could not be saved because your phone storage for this app is full. Try removing a photo or two.');
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
// Is the soft keypad showing right now? (The visible screen is much shorter than it has been.)
let tallest_view = 0;
function keypad_is_up() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  tallest_view = Math.max(tallest_view, h);
  return tallest_view - h > 120;
}
if (window.visualViewport) window.visualViewport.addEventListener('resize', keypad_is_up);
window.addEventListener('load', keypad_is_up);

// Keeps the page where it was when the keypad comes up (the browser likes to scroll it).
let hold_y = 0, hold_cont = 0, hold_until = 0;
function hold_page_start() {
  const c = document.querySelector('.notepad-body');
  hold_y = window.scrollY;
  hold_cont = c ? c.scrollTop : 0;
  hold_until = Date.now() + 1500;
}
function hold_page_apply() {
  if (Date.now() > hold_until) return;
  if (window.scrollY !== hold_y) window.scrollTo(0, hold_y);
  const c = document.querySelector('.notepad-body');
  if (c && c.scrollTop !== hold_cont) c.scrollTop = hold_cont;
}
function hold_page_apply_soon() {
  if (Date.now() > hold_until) return;
  [0, 50, 150, 300, 600, 1000].forEach((ms) => setTimeout(hold_page_apply, ms));
}

function keyboard_off(force) {
  const editor = get_editor();
  if (!editor) return;
  // Active off and the user is typing (cursor in the note, keypad up): leave the keypad and
  // the blinking cursor alone, so formatting can be chosen while typing carries on.
  if (!force && !select_mode && document.activeElement === editor && editor.getAttribute('inputmode') !== 'none' && keypad_is_up()) return;
  editor.setAttribute('inputmode', 'none');
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

// The list opens upward from the Formatting bar and may use all the room above it, so the
// note below stays in view. With almost no room above it falls back to opening downward.
function place_fmt_menu() {
  const menu = document.getElementById('fmtMenu');
  const row = document.querySelector('.fmt-row');
  const action = document.getElementById('noteActionLine');
  if (!menu || !row || !menu.classList.contains('open')) return;
  const view_h = document.documentElement.clientHeight;
  const parent = menu.offsetParent || document.body;
  const p = parent.getBoundingClientRect();
  const row_top = row.getBoundingClientRect().top;
  const room = row_top - 4;
  if (room >= 140) {
    menu.style.top = 'auto';
    menu.style.bottom = (p.bottom - row_top + 2) + 'px';
    menu.style.maxHeight = room + 'px';
  } else {
    const below = (action ? action.getBoundingClientRect().bottom : row.getBoundingClientRect().bottom) + 4;
    menu.style.bottom = 'auto';
    menu.style.top = (below - p.top) + 'px';
    menu.style.maxHeight = Math.max(140, view_h - below - 8) + 'px';
  }
}
window.addEventListener('resize', place_fmt_menu);
if (window.visualViewport) window.visualViewport.addEventListener('resize', place_fmt_menu);
window.addEventListener('scroll', place_fmt_menu, true);

function toggle_fmt_menu(force) {
  const menu = document.getElementById('fmtMenu');
  const btn = document.getElementById('fmtCategoryBtn');
  if (!menu) return;

  // Active is on and its status list is showing: the category button leads to the full list
  // (the highlighted word stays selected); pressing it there closes the list as usual.
  if (typeof force !== 'boolean' && select_mode && menu.classList.contains('open') && menu.classList.contains('view-active') && typeof fmt_choose_formatting === 'function') {
    fmt_choose_formatting();
    return;
  }

  const open = typeof force === 'boolean' ? force : !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  if (open) keyboard_off();   // opening never raises the keypad; if it is already up while typing it stays
  if (open) place_fmt_menu();
  lock_scroll_position();   // the page never moves when the list opens or closes
  if (!open) {
    // Closing leaves a clean list: next time it starts at the main categories.
    menu.querySelectorAll('.open').forEach((el) => el.classList.remove('open'));
  }

  if (btn) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('active', open);
  }
  if (open) fmt_menu_opened();     // notepad_menu.js: context, Active view, On labels
  else fmt_menu_closed();
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
  fmt_menu_click(event);           // notepad_menu.js: Back, drill-down, items
}

// Marks bold / italic / underline / strikethrough / superscript / subscript
// items as active when the current selection already has that format.
function refresh_fmt_menu_state() {
  fmt_refresh_states();            // notepad_menu.js: On labels and values
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
// Character styles from the Font / Text / Effects menus that the browser's own
// "remove format" leaves behind.
const CLEARABLE_SPAN_STYLES = ['textShadow', 'webkitTextStroke', 'letterSpacing', 'wordSpacing', 'textTransform',
  'textDecorationLine', 'fontKerning', 'fontVariantCaps', 'fontStyle', 'fontWeight', 'fontSize', 'fontFamily', 'color', 'backgroundColor'];

// Spans touched by a range (collected BEFORE the browser's own remove-format
// reshuffles the note).
function spans_touching(range) {
  const editor = get_editor();
  if (!range || range.collapsed) return [];
  return Array.from(editor.querySelectorAll('span')).filter((span) => range.intersectsNode(span));
}

function clear_span_styles(spans) {
  spans.forEach((span) => {
    if (!span.isConnected) return;
    CLEARABLE_SPAN_STYLES.forEach((prop) => { span.style[prop] = ''; });
    if (!span.getAttribute('style')) span.removeAttribute('style');
    if (span.attributes.length === 0) {
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.remove();
    }
  });
}

function clear_all_formatting() {
  const editor = get_editor();
  const sel = window.getSelection();
  const chosen = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  const spans = spans_touching(chosen);

  // Remember the selection by text position; unwrapping spans can collapse it.
  let keep = null;
  if (chosen && !chosen.collapsed) {
    const pre = document.createRange();
    pre.selectNodeContents(editor);
    pre.setEnd(chosen.startContainer, chosen.startOffset);
    keep = { start: pre.toString().length, length: chosen.toString().length };
  }

  document.execCommand('removeFormat');
  clear_span_styles(spans);

  if (keep) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let pos = 0, node, start = null, end = null;
    while ((node = walker.nextNode())) {
      const next = pos + node.data.length;
      if (!start && keep.start <= next) start = [node, keep.start - pos];
      if (!end && keep.start + keep.length <= next) { end = [node, keep.start + keep.length - pos]; break; }
      pos = next;
    }
    if (start && end) {
      const r = document.createRange();
      r.setStart(start[0], start[1]);
      r.setEnd(end[0], end[1]);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  const blocks = get_selected_blocks();
  reset_paragraph_formatting();

  const headings = blocks.filter((block) => /^(H[1-6]|BLOCKQUOTE)$/.test(block.tagName));
  if (headings.length > 0) convert_blocks(headings, 'div');
}

// Wraps the selected text in <span style="..."> using exact CSS values. The
// browser's own fontSize command is used only to wrap the text (it knows just
// seven coarse steps); each wrapper is then swapped for a span carrying the
// requested style(s), e.g. {fontSize:'18px'} or {fontWeight:'700'}. Re-styling
// text that already has that style replaces it instead of nesting spans
// deeper each time. A bare caret inside a word styles that word.
// Returns false when there was nothing to style.
// Active is off: formatting is for the text typed next. An empty span (holding an
// invisible zero-width space) is put at the caret and the caret goes inside it, so the
// words already in the note never change.
const ZWSP = '\u200b';

function apply_pending_span_style(styles) {
  const editor = get_editor();
  const sel = window.getSelection();
  if (sel.rangeCount === 0 || !range_in_editor(sel.getRangeAt(0))) return false;
  if (!sel.isCollapsed) sel.collapseToEnd();

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const here = node.nodeType === 3 ? node.parentElement : node;

  let span = null;
  if (here && here !== editor && here.tagName === 'SPAN' && here.textContent === ZWSP) {
    span = here;                                   // already waiting for text: just change its style
  } else {
    span = document.createElement('span');
    span.appendChild(document.createTextNode(ZWSP));
    range.insertNode(span);
  }
  Object.keys(styles).forEach((prop) => { span.style[prop] = styles[prop]; });

  const caret = document.createRange();
  caret.setStart(span.firstChild, 1);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);

  return true;
}

function apply_span_style(styles) {
  const editor = get_editor();
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return false;
  if (!select_mode) return apply_pending_span_style(styles);
  const props = Object.keys(styles);

  if (sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const word = range.startContainer.nodeType === 3
      ? word_range_at(range.startContainer, range.startOffset) : null;
    if (!word) return false;
    sel.removeAllRanges();
    sel.addRange(word);
  }

  // Older notes may already contain <font size="7">; leave those alone.
  const before = new Set(editor.querySelectorAll('font[size="7"]'));
  document.execCommand('fontSize', false, '7');

  const wrappers = Array.from(editor.querySelectorAll('font[size="7"]'))
    .filter((el) => !before.has(el));
  if (wrappers.length === 0) return false;

  const live = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const saved = live ? {
    sc: live.startContainer, so: live.startOffset,
    ec: live.endContainer, eo: live.endOffset
  } : null;
  const replaced = new Map();

  wrappers.forEach((font) => {
    const span = document.createElement('span');
    props.forEach((prop) => { span.style[prop] = styles[prop]; });

    // The browser sometimes reuses an existing <font color="..."> (or face)
    // element for the size. Keep that element so its color / font survive,
    // and put the new style on a span inside it.
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

    // Values set earlier inside this text are superseded by the new one.
    span.querySelectorAll('span').forEach((inner) => {
      let touched = false;
      props.forEach((prop) => {
        if (inner.style[prop]) { inner.style[prop] = ''; touched = true; }
      });
      if (touched) {
        if (!inner.getAttribute('style')) inner.removeAttribute('style');
        if (inner.attributes.length === 0) {
          while (inner.firstChild) inner.parentNode.insertBefore(inner.firstChild, inner);
          inner.remove();
        }
      }
    });
    span.querySelectorAll('font[size]').forEach((inner) => inner.removeAttribute('size'));

    // Same text already wrapped in a span with this style: update that span, no nesting.
    const parent = span.parentElement;
    if (parent && parent !== editor && parent.tagName === 'SPAN' &&
        props.every((prop) => parent.style[prop]) && parent.childNodes.length === 1) {
      props.forEach((prop) => { parent.style[prop] = styles[prop]; });
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
  return true;
}

// Font size in exact pixels (1-50).
function apply_font_px(px) {
  if (!apply_span_style({ fontSize: px + 'px' })) {
    fmt_notice('Select some text first (or press Active).');
  }
}
window.apply_font_px = apply_font_px;

// Font weight 100-900 (400 = normal, 700 = bold). Used by Bold and its − / +.
function current_weight() {
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return 400;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  if (!node) return 400;
  return parseInt(getComputedStyle(node).fontWeight, 10) || 400;
}

function apply_weight(weight) {
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return false;

  if (!select_mode) return apply_span_style({ fontWeight: String(weight) });

  // A bare caret between words has no text to thicken.
  const caret = sel.getRangeAt(0);
  const on_word = caret.startContainer.nodeType === 3 &&
    word_range_at(caret.startContainer, caret.startOffset);
  if (sel.isCollapsed && !on_word) return false;
  return apply_span_style({ fontWeight: String(weight) });
}

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
    ['marginLeft', 'textIndent', 'marginTop', 'marginBottom', 'lineHeight', 'textAlign', 'direction', 'whiteSpace', 'wordBreak'].forEach((prop) => {
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


// ── CSS options from the Font / Text / Effects categories ───────────────────
// An item with data-act="css" sets one CSS property. data-scope="block" puts it
// on the paragraph(s); otherwise it goes on a span around the selected text (or
// the word the cursor is in). Items with data-min / data-max / data-inc are
// numbers that − / + step through.

function css_value_for(item, override) {
  const unit = item.dataset.unit || '';
  const raw = override !== undefined ? override : item.dataset.val;
  if (!item.hasAttribute('data-min') && override === undefined) return { shown: raw, css: raw };
  const num = typeof raw === 'number' ? raw : parseFloat(raw);
  return { shown: num, css: String(num) + unit };
}

// Returns the number applied (for range items) so the title can show it.
function apply_css_item(item, override) {
  const prop = item.dataset.prop;
  const v = css_value_for(item, override);
  if (item.dataset.scope === 'block') {
    apply_block_style(prop, v.css);
  } else if (!apply_span_style({ [prop]: v.css })) {
    fmt_notice('Select some text first (or press Active).');
  }
  return item.hasAttribute('data-min') ? v.shown : undefined;
}

// Decoration > None: take off underline and line-through, whichever way they were set.
function remove_text_decoration() {
  ['underline', 'strikeThrough'].forEach((command) => {
    try { if (document.queryCommandState(command)) document.execCommand(command); } catch (err) { /* ignore */ }
  });
  apply_span_style({ textDecorationLine: 'none' });
}

// Vertical align > Baseline: take off superscript / subscript.
function remove_vertical_align() {
  ['superscript', 'subscript'].forEach((command) => {
    try { if (document.queryCommandState(command)) document.execCommand(command); } catch (err) { /* ignore */ }
  });
}

// Lists > Marker position: markers inside or outside the text block.
function apply_list_position(where) {
  const editor = get_editor();
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const lists = Array.from(editor.querySelectorAll('ul, ol')).filter((list) => range.intersectsNode(list));
  if (lists.length === 0) { fmt_notice('The cursor is not inside a list.'); return; }
  lists.forEach((list) => { list.style.listStylePosition = where; });
}


// ── Photo options (the Photo category) ──────────────────────────────────────
// They act on the photo that is selected (tap a photo: blue border). Choosing
// a photo selects it, puts "Photo" in the Formatting list's title and gives
// − / + the photo's size.

function selected_photo() {
  return (typeof selected_note_photo !== 'undefined' && selected_note_photo && get_editor().contains(selected_note_photo))
    ? selected_note_photo : null;
}

// filter / transform are made of several functions; set one without losing the others.
function photo_function_set(img, prop, name, text) {
  const map = {};
  const re = /([\w-]+)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(img.style[prop] || ''))) map[m[1]] = m[2];
  if (text === null) delete map[name]; else map[name] = text;
  const joined = Object.keys(map).map((k) => k + '(' + map[k] + ')').join(' ');
  img.style[prop] = joined;
  if (!img.getAttribute('style')) img.removeAttribute('style');
}

const PHOTO_FILTER_NEUTRAL = { blur: 0, brightness: 100, contrast: 100, grayscale: 0, 'hue-rotate': 0, invert: 0, saturate: 100, sepia: 0 };

function photo_current_percent(img) {
  const box = img.parentElement ? img.parentElement.clientWidth : 0;
  return box > 0 ? Math.round(img.getBoundingClientRect().width / box * 100) : 100;
}

function apply_photo_item(item, override) {
  const img = selected_photo();
  if (!img) { fmt_notice('Tap an image first.'); return override; }

  const unit = item.dataset.unit || '';
  const ranged = item.hasAttribute('data-min');
  const raw = override !== undefined ? override : item.dataset.val;
  const num = ranged ? (typeof raw === 'number' ? raw : parseFloat(raw)) : null;
  const prop = item.dataset.prop;
  const fn = item.dataset.fn;

  if (fn) {
    const [target, name] = fn.split(':');            // filter:blur, transform:rotate
    if (target === 'filter') {
      const neutral = PHOTO_FILTER_NEUTRAL[name];
      photo_function_set(img, 'filter', name, num === neutral ? null : num + unit);
    } else if (target === 'transform') {
      photo_function_set(img, 'transform', name, num === 0 ? null : num + 'deg');
    }
  } else if (prop === 'align') {
    const side = String(raw);
    ['float', 'marginLeft', 'marginRight'].forEach((k) => { img.style[k] = ''; });
    if (side === 'center') { img.style.marginLeft = 'auto'; img.style.marginRight = 'auto'; }
    else if (side === 'right') { img.style.marginLeft = 'auto'; img.style.marginRight = '0'; }
    else if (side === 'left') { img.style.marginLeft = '0'; img.style.marginRight = 'auto'; }
    else if (side === 'wrap-left') { img.style.float = 'left'; img.style.marginRight = '12px'; }
    else if (side === 'wrap-right') { img.style.float = 'right'; img.style.marginLeft = '12px'; }
  } else if (prop === 'flip') {
    photo_function_set(img, 'transform', 'scaleX', raw === 'h' ? '-1' : null);
    photo_function_set(img, 'transform', 'scaleY', raw === 'v' ? '-1' : null);
  } else if (prop === 'height') {
    img.style.height = num === 0 ? 'auto' : num + 'px';
  } else if (prop === 'opacity') {
    img.style.opacity = num >= 100 ? '' : String(num / 100);
  } else if (prop === 'width') {
    img.style.width = num + '%';
  } else if (ranged) {
    img.style[prop] = num + unit;
    // A border needs a style and a color to show up.
    if (prop === 'borderWidth' && num > 0) {
      if (!img.style.borderStyle || img.style.borderStyle === 'none') img.style.borderStyle = 'solid';
      if (!img.style.borderColor) img.style.borderColor = 'black';
    }
  } else {
    img.style[prop] = String(raw);
    if (prop === 'borderColor' && !img.style.borderStyle) img.style.borderStyle = 'solid';
  }

  if (!img.getAttribute('style')) img.removeAttribute('style');
  if (typeof position_photo_resize_handle === 'function') position_photo_resize_handle();
  return ranged ? num : undefined;
}

function photo_operation(kind) {
  const img = selected_photo();
  if (kind === 'move') { start_photo_move(img); return; }
  if (!img) { fmt_notice('Tap an image first.'); return; }

  if (kind === 'alt') {
    const text = window.prompt('Describe this photo (alt text):', img.alt || '');
    if (text !== null) img.alt = text;
  } else if (kind === 'reset') {
    img.removeAttribute('style');
    img.style.height = 'auto';
    if (typeof position_photo_resize_handle === 'function') position_photo_resize_handle();
  } else if (kind === 'remove') {
    if (typeof clear_photo_selection === 'function') clear_photo_selection();
    img.remove();
  }
}

// Called by the photo code when a photo becomes selected / deselected.
let photo_label_active = false;   // list title reads "Image" until another photo option is chosen

function on_photo_selected(img) {
  keyboard_off(true);
  if (typeof fmt_update_label === 'function') fmt_update_label(true);
  photo_label_active = true;
  const size_item = document.querySelector('#fmtMenu .fmt-item[data-act="photo"][data-prop="width"]');
  if (size_item) set_active_fmt_item(size_item, photo_current_percent(img), 'Image');
}
window.on_photo_selected = on_photo_selected;

function on_photo_deselected() {
  if (typeof fmt_update_label === 'function') fmt_update_label(true);
  if (active_fmt_item && active_fmt_item.dataset.act && /^photo/.test(active_fmt_item.dataset.act)) {
    set_active_fmt_item(null);
  }
}
window.on_photo_deselected = on_photo_deselected;


// ── Cut / Copy / Paste / Clear (Effects) ────────────────────────────────────
// They work on the selected text (including a Select-mode selection). Copy and
// Cut also keep their own copy inside the app: phones often refuse to let a
// web page read the system clipboard, and Paste then uses this copy.

let internal_clip = null;      // { html, text }

function selection_clip() {
  const sel = window.getSelection();
  if (sel.rangeCount === 0 || sel.isCollapsed || !range_in_editor(sel.getRangeAt(0))) return null;
  const box = document.createElement('div');
  box.appendChild(sel.getRangeAt(0).cloneContents());
  return { html: box.innerHTML, text: sel.toString() };
}

function copy_selection() {
  const clip = selection_clip();
  if (!clip) { fmt_notice('Select some text first (or press Active).'); return false; }
  internal_clip = clip;

  let done = false;
  try { done = document.execCommand('copy'); } catch (err) { done = false; }
  if (!done && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(clip.text).catch(() => { /* the in-app copy still works */ });
  }
  fmt_notice('Copied');
  return true;
}

function cut_selection() {
  if (!copy_selection()) return;
  document.execCommand('delete');
}

// Delete the selected text (nothing goes to the clipboard).
function clear_selected_text() {
  const sel = window.getSelection();
  if (sel.rangeCount === 0 || sel.isCollapsed || !range_in_editor(sel.getRangeAt(0))) {
    fmt_notice('Select some text first (or press Active).');
    return;
  }
  document.execCommand('delete');
}

// Pasted web content must never bring scripts or event handlers along.
function clean_pasted_html(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form, base').forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

function escape_html(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// Reads the system clipboard if the phone allows it: { html, text } or null.
async function read_system_clipboard() {
  if (!navigator.clipboard) return null;
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      let html = '', text = '';
      for (const item of items) {
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      }
      if (html || text) return { html, text };
    }
  } catch (err) { /* fall through to readText */ }
  try {
    if (navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) return { html: '', text };
    }
  } catch (err) { /* blocked */ }
  return null;
}

async function paste_clipboard() {
  const editor = get_editor();
  const from_system = await read_system_clipboard();
  const clip = from_system || internal_clip;

  if (!clip) {
    fmt_notice('Nothing to paste yet. Copy some text first.');
    return false;
  }

  // The permission prompt can take focus away: put the selection back.
  keyboard_off();
  editor.focus({ preventScroll: true });
  const sel = window.getSelection();
  const target = (select_mode && select_range && !select_range.collapsed) ? select_range : (saved_range || frozen_range);
  if (target) {
    sel.removeAllRanges();
    sel.addRange(target.cloneRange());
  }

  const html = clip.html ? clean_pasted_html(clip.html) : escape_html(clip.text || '');
  document.execCommand('insertHTML', false, html);
  return true;
}

// ── Active option + − / + stepping + action-row title ──────────────────────
// The last option chosen in the Formatting list is the "active option". Its
// name stays in the list's title, and the − / + buttons step ONLY what that
// option controls (they never touch other formatting already on the text).
// The title at the left of the action row names what − / + are controlling:
// Weight, Size, Spacing, ... or "All" while Select is on.

let active_fmt_item = null;
let active_fmt_value = null;     // current number for range options
let select_controls_selection = false;   // Select is on and − / + stretch the selection

// What each kind of option is called in the action row.
const CONTROL_TITLES = {
  size: 'Size', fontpx: 'Size', fontname: 'Font', color: 'Color', hilite: 'Highlight',
  align: 'Alignment', 'indent-set': 'Indent', linespace: 'Line spacing',
  'space-before': 'Space before', 'space-after': 'Space after', list: 'Spacing'
};

function control_title(item) {
  if (!item) return '';
  if (item.dataset.ctl) return item.dataset.ctl;
  if (item.dataset.cmd === 'bold') return 'Weight';
  return CONTROL_TITLES[item.dataset.act] || '';
}

// Options stepped by a number: {min, max, inc, kind}, or null.
//  - Bold: weight 100-900 in steps of 100
//  - Font Size: 1-50 px
//  - List options: the space after each list item (0-50 px), default 6 px
//  - CSS options with data-min / data-max / data-inc (letter spacing, line
//    height, photo size, opacity, ...)
function range_spec(item) {
  if (!item) return null;
  if (item.dataset.act === 'list') return { min: 0, max: 50, inc: 1, kind: 'listgap' };
  if (item.dataset.act === 'fontpx') return { min: 1, max: 50, inc: 1, kind: 'fontpx' };
  if (item.dataset.cmd === 'bold') return { min: 100, max: 900, inc: 100, kind: 'weight' };
  if (item.hasAttribute('data-min') && item.hasAttribute('data-max')) {
    return {
      min: parseFloat(item.dataset.min),
      max: parseFloat(item.dataset.max),
      inc: parseFloat(item.dataset.inc) || 1,
      kind: item.dataset.act === 'photo' ? 'photo' : 'css'
    };
  }
  return null;
}

function is_range_item(item) {
  return !!range_spec(item);
}

// The choices − / + can move through: sibling options of the same kind
// (e.g. a color list, the indent sizes). Toggle commands such as Italic,
// and one-off actions, have nothing to step through.
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
  const spec = range_spec(item);
  if (spec && value !== null && value !== undefined) {
    if (spec.kind === 'fontpx') return 'Size: ' + value + ' px';
    if (spec.kind === 'weight') return 'Weight: ' + value;
    if (spec.kind === 'css' || spec.kind === 'photo') {
      const unit = item.dataset.unit || '';
      const shown = unit === '%' || unit === '°' ? value + unit : (unit ? value + ' ' + unit.trim() : String(value));
      return (item.dataset.ctl || '') + ': ' + shown;
    }
  }
  return item.dataset.short || item.dataset.label || item.textContent.trim();
}

// Spacing after list items lives on the list as --li-gap (default 6 px).
function list_gap_at_selection() {
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return 6;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const list = node && node.closest ? node.closest('ul, ol') : null;
  if (!list || !get_editor().contains(list)) return 6;
  const raw = parseInt(list.style.getPropertyValue('--li-gap'), 10);
  return isNaN(raw) ? 6 : raw;
}

// Sets the space after each list item of every list the selection touches.
// Returns false when the cursor is not in a list.
function apply_list_gap(px) {
  const editor = get_editor();
  const sel = window.getSelection();
  if (sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);

  const touched = Array.from(editor.querySelectorAll('ul, ol'))
    .filter((list) => range.intersectsNode(list));
  const innermost = touched.filter(
    (list) => !touched.some((other) => other !== list && list.contains(other))
  );
  if (innermost.length === 0) return false;

  innermost.forEach((list) => list.style.setProperty('--li-gap', px + 'px'));
  return true;
}

function update_action_title() {
  const el = document.getElementById('actionTitle');
  if (!el) return;

  let text = '';
  let pressable = false;

  if (select_mode && select_controls_selection) {
    text = 'All';                 // press it to select the whole note
    pressable = true;
  } else {
    text = active_fmt_item ? fmt_item_title(active_fmt_item, active_fmt_value).replace(/^[^:]+:\s*/, '') : 'None';
    pressable = select_mode && !!text;   // press it to go back to stretching the selection
  }

  el.textContent = text;
  el.classList.toggle('pressable', pressable);
  el.disabled = !pressable;
  el.setAttribute('aria-label', pressable
    ? (select_controls_selection ? 'Select all text' : 'Back to selecting words')
    : text);
}

function set_active_fmt_item(item, value, label_override) {
  active_fmt_item = item;
  const spec = range_spec(item);
  if (item) select_controls_selection = false;     // a chosen option takes over − / +

  if (!spec) {
    active_fmt_value = null;
  } else if (value !== undefined && value !== null) {
    active_fmt_value = value;
  } else if (spec.kind === 'listgap') {
    active_fmt_value = list_gap_at_selection();
  } else {
    active_fmt_value = parseFloat(item.dataset.val);
  }

  // The list's title stays a main category; the option's name shows in the action row.
  if (typeof fmt_update_label === 'function') fmt_update_label();
  update_step_buttons();
}

function update_step_buttons() {
  const down = document.getElementById('stepDownBtn');
  const up = document.getElementById('stepUpBtn');
  update_action_title();

  if (select_mode && select_controls_selection) {
    if (down) down.disabled = false;
    if (up) up.disabled = false;
    return;
  }

  const spec = range_spec(active_fmt_item);
  if (spec) {
    if (down) down.disabled = !(active_fmt_value > spec.min);
    if (up) up.disabled = !(active_fmt_value < spec.max);
    return;
  }

  const list = fmt_step_list(active_fmt_item);
  const idx = list.indexOf(active_fmt_item);

  if (down) down.disabled = !(idx > 0);
  if (up) up.disabled = !(idx >= 0 && idx < list.length - 1);
}

function step_fmt(direction) {
  if (nav.level !== 'note') return;

  // Select is on and nothing else was chosen: − / + take a word off / add a word.
  if (select_mode && select_controls_selection) {
    keyboard_off();
    stretch_selection(direction);
    return;
  }

  if (!active_fmt_item) return;

  const spec = range_spec(active_fmt_item);
  if (spec) {
    const next = Math.round(Math.min(spec.max, Math.max(spec.min, active_fmt_value + (direction > 0 ? spec.inc : -spec.inc))) * 100) / 100;
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

// Tap on the title at the left of the action row (only active in Select mode).
//  "All"          -> select the whole note
//  option title   -> hand − / + back to stretching the selection
function action_title_click() {
  if (nav.level !== 'note' || !select_mode) return;
  keyboard_off();

  if (select_controls_selection) {
    select_all_text();
  } else {
    select_controls_selection = true;
    update_step_buttons();
  }
}
window.action_title_click = action_title_click;


// ── Menu dispatcher ─────────────────────────────────────────────────────────

const CHARACTER_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript'];
const CHARACTER_ACTS = ['size', 'fontname', 'color', 'hilite', 'fontpx', 'decor-none', 'valign-baseline'];

function is_character_item(item) {
  if (item.dataset.cmd) return CHARACTER_COMMANDS.indexOf(item.dataset.cmd) !== -1;
  if (item.dataset.act === 'css') return item.dataset.scope !== 'block';
  return CHARACTER_ACTS.indexOf(item.dataset.act) !== -1;
}

// ═════════════════════════════════════════════════════════════════════════════
// NORMAL MODE — formatting for NEW text
//   Active is off. Whatever is switched on in the select list is applied to the text typed
//   next, anywhere in the note. Words already in the note are never touched.
// ═════════════════════════════════════════════════════════════════════════════

// ── Formatting for newly typed text ─────────────────────────────────────────
// Choosing a character format in the list (Active off) never touches words already in the
// note. It is added to "the format for new text", which stays on until it is switched off.
// That format is written into the note as an empty zero-width span at the cursor, and the
// cursor sits inside it, so whatever is typed next picks it up. It works the same whether the
// format is chosen before or after the cursor is put in the note, and it does not depend on
// the keyboard (phone keyboards ignore the browser's own "typing style").

let typing_format = {};          // { cssProperty: value }
let typing_composing = false;    // a phone keyboard is in the middle of composing a word
let typing_ensuring = false;

function typing_key(obj) {
  return JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

function caret_element() {
  const sel = window.getSelection();
  if (sel.rangeCount === 0 || !range_in_editor(sel.getRangeAt(0))) return null;
  const node = sel.getRangeAt(0).startContainer;
  return node.nodeType === 3 ? node.parentElement : node;
}

// What a property is right now at the cursor: the new-text format if it sets it, else the note.
function effective_style(prop) {
  if (typing_format[prop] !== undefined) return typing_format[prop];
  const el = caret_element();
  return el ? getComputedStyle(el)[prop] : '';
}

function decor_tokens(value) {
  return String(value || '').split(/\s+/).filter((t) => t && t !== 'none');
}

// Works out what a menu item does to the new-text format. Returns { handled, value }.
function typing_format_item(item, val, override) {
  const cmd = item.dataset.cmd;
  const act = item.dataset.act;
  let value;

  const set = (prop, v) => { typing_format[prop] = v; };
  const toggle_decor = (word) => {
    const now = decor_tokens(effective_style('textDecorationLine'));
    const next = now.includes(word) ? now.filter((t) => t !== word) : now.concat(word);
    if (next.length) set('textDecorationLine', next.join(' ')); else delete typing_format.textDecorationLine;
  };

  if (cmd === 'bold') {
    if (override !== undefined) set('fontWeight', String(override));
    else set('fontWeight', parseInt(effective_style('fontWeight'), 10) >= 600 ? '400' : '700');
    value = parseInt(typing_format.fontWeight, 10);
  } else if (cmd === 'italic') {
    const now = effective_style('fontStyle');
    set('fontStyle', (now === 'italic' || now === 'oblique') ? 'normal' : 'italic');
  } else if (cmd === 'underline') {
    toggle_decor('underline');
  } else if (cmd === 'strikeThrough') {
    toggle_decor('line-through');
  } else if (cmd === 'superscript' || cmd === 'subscript') {
    const want = cmd === 'superscript' ? 'super' : 'sub';
    set('verticalAlign', effective_style('verticalAlign') === want ? 'baseline' : want);
  } else if (act === 'fontpx') {
    value = override !== undefined ? override : parseInt(val, 10);
    set('fontSize', value + 'px');
  } else if (act === 'color') {
    set('color', val);
  } else if (act === 'hilite') {
    set('backgroundColor', val === 'none' ? 'transparent' : val);
  } else if (act === 'fontname') {
    if (typeof load_google_font === 'function') load_google_font(val);
    set('fontFamily', val);
  } else if (act === 'decor-none') {
    delete typing_format.textDecorationLine;
    set('textDecorationLine', 'none');
    delete typing_format.textDecorationLine;
  } else if (act === 'valign-baseline') {
    delete typing_format.verticalAlign;
  } else if (act === 'css' && item.dataset.scope !== 'block') {
    const v = css_value_for(item, override);
    set(item.dataset.prop, v.css);
    value = item.hasAttribute('data-min') ? v.shown : undefined;
  } else {
    return { handled: false };
  }
  return { handled: true, value };
}

function style_typing_span(span, fmt) {
  span.removeAttribute('style');
  Object.keys(fmt).forEach((prop) => { span.style[prop] = fmt[prop]; });
}

function put_caret_in(span) {
  const caret = document.createRange();
  caret.setStart(span.firstChild, span.firstChild.data.length);
  caret.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(caret);
}

// Makes sure the cursor is inside a span carrying the current new-text format.
// A typing span with nothing typed in it yet (only the invisible marker character).
function typing_span_is_blank(s) {
  return s.textContent.replace(/\u200b/g, '') === '' && !s.querySelector('img, input, br');
}

// Removes typing spans nobody typed into (the cursor moved away). Never creates anything, so
// moving the cursor, tapping and deleting leave the note exactly as it is.
function tidy_typing_spans() {
  if (typing_ensuring || typing_composing) return;
  const editor = get_editor();
  if (!editor) return;
  const el = caret_element();
  const cur = el && el.closest ? el.closest('span[data-tf]') : null;
  editor.querySelectorAll('span[data-tf]').forEach((s) => { if (s !== cur && typing_span_is_blank(s)) s.remove(); });
}

// A phone keyboard keeps the word being typed "in composition" (the letters are not final yet),
// and text inside a composition cannot be restyled. Ending it first lets the new format start
// with the very next letter typed.
function finish_composition() {
  const editor = get_editor();
  if (!editor || !typing_composing || document.activeElement !== editor) return;
  const sel = window.getSelection();
  const keep = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  editor.blur();
  editor.focus({ preventScroll: true });
  if (keep) { sel.removeAllRanges(); sel.addRange(keep); }
  typing_composing = false;
}

function ensure_typing_span() {
  if (typing_ensuring || typing_composing || select_mode) return;
  const editor = get_editor();
  const sel = window.getSelection();
  if (!editor || document.activeElement !== editor || sel.rangeCount === 0 || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!range_in_editor(range)) return;

  typing_ensuring = true;
  try {
    const want = typing_key(typing_format);
    const nothing = Object.keys(typing_format).length === 0;
    const el = caret_element();
    const cur = el && el.closest ? el.closest('span[data-tf]') : null;
    const here = cur && editor.contains(cur) ? cur : null;
    const blank = (s) => s.textContent.replace(/​/g, '') === '' && !s.querySelector('img, input, br');

    // Spans left behind where the cursor used to be (never typed into) go away.
    editor.querySelectorAll('span[data-tf]').forEach((s) => { if (s !== here && blank(s)) s.remove(); });

    if (here && here.dataset.tf === want) return;
    if (!here && nothing) return;

    if (here && blank(here)) {
      // waiting for text: change it in place
      if (nothing) {
        const caret = document.createRange();
        caret.setStartBefore(here);
        caret.collapse(true);
        here.remove();
        sel.removeAllRanges();
        sel.addRange(caret);
        return;
      }
      style_typing_span(here, typing_format);
      here.dataset.tf = want;
      put_caret_in(here);
      return;
    }

    // Cursor right after a span that already has this format: carry on inside it.
    if (range.startContainer.nodeType === 1) {
      const prev = range.startContainer.childNodes[range.startOffset - 1];
      if (prev && prev.nodeType === 1 && prev.matches && prev.matches('span[data-tf]') && prev.dataset.tf === want && prev.lastChild && prev.lastChild.nodeType === 3) {
        const caret = document.createRange();
        caret.setStart(prev.lastChild, prev.lastChild.data.length);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
        return;
      }
    }

    const span = document.createElement('span');
    span.dataset.tf = want;
    span.appendChild(document.createTextNode(ZWSP));
    style_typing_span(span, typing_format);

    if (here) {
      // The cursor is inside text that has an older format: put back the surrounding look first.
      const old = {};
      try { JSON.parse(here.dataset.tf).forEach(([k]) => { old[k] = true; }); } catch (err) { /* ignore */ }
      const outside = here.parentElement ? getComputedStyle(here.parentElement) : null;
      Object.keys(old).forEach((prop) => {
        if (typing_format[prop] === undefined && outside && prop !== 'textDecorationLine') span.style[prop] = outside[prop];
      });
    }
    range.insertNode(span);
    put_caret_in(span);
  } finally {
    typing_ensuring = false;
  }
}

function run_fmt_item(item, value_override) {
  if (nav.level !== 'note') return;

  const had_caret = !!caret_element();

  lock_scroll_position();
  fmt_prime_selection();
  freeze_editor_selection();   // keeps the legacy frozen-selection helpers in step

  // Active is off: character formatting is for the text typed next, never for the words
  // already there, so a highlighted range collapses to its end first.
  if (!select_mode && is_character_item(item)) {
    const live = window.getSelection();
    if (live.rangeCount > 0 && range_in_editor(live.getRangeAt(0)) && !live.isCollapsed) live.collapseToEnd();
  }

  const cmd = item.dataset.cmd;
  const act = item.dataset.act;
  const val = item.dataset.val || '';
  let applied_value;     // for options stepped by number (font size, weight, list spacing)
  const stepping = value_override !== undefined;

  // Character formats (Active off) go into the format for new text; existing words never change.
  let typed_as_span = false;
  if (!select_mode && is_character_item(item)) {
    const r = typing_format_item(item, val, stepping ? value_override : undefined);
    if (r.handled) { typed_as_span = true; applied_value = r.value; }
  }

  try {
    if (typed_as_span) {
      // stored as the format for new text (see ensure_typing_span)
    } else if (cmd === 'bold' && stepping) {
      // − / + on Bold: exact weight (100-900) on the selected text
      if (apply_weight(value_override)) applied_value = value_override;
      else { applied_value = active_fmt_value; fmt_notice('Select some text first (or press Active).'); }
    } else if (cmd) {
      // bold, italic, underline, strikethrough, superscript, subscript, checkbox
      handle_fmt_click(item);
      if (cmd === 'bold') applied_value = current_weight();
    } else {
      switch (act) {
        case 'size':          apply_font_choice('size:' + val); break;
        case 'fontname':
          if (typeof load_google_font === 'function') load_google_font(val);   // download it from Google Fonts if needed
          apply_font_choice('name:' + val);
          break;
        case 'color':         apply_font_choice('color:' + val); break;
        case 'hilite':        apply_highlight_choice('bg:' + val); break;

        case 'para-break':    insert_paragraph_break(false); break;
        case 'line-break':    insert_paragraph_break(true); break;
        case 'para-reset':    reset_paragraph_formatting(); break;
        case 'cursor':        move_cursor(parseInt(val, 10)); break;

        case 'list':
          // Choosing a list style makes the list; − / + then change the space
          // after each list item (and never re-create the list).
          if (!stepping) apply_list_choice(val);
          if (stepping) {
            if (apply_list_gap(value_override)) applied_value = value_override;
            else { applied_value = active_fmt_value; fmt_notice('The cursor is not inside a list.'); }
          } else {
            applied_value = list_gap_at_selection();
          }
          break;
        case 'list-off':
          if (!remove_list()) fmt_notice('The cursor is not inside a list.');
          break;

        case 'align':         apply_alignment(val); break;

        case 'indent':        adjust_indent(parseInt(val, 10)); break;
        case 'indent-set':    apply_indent_set(parseInt(val, 10)); break;
        case 'fontpx':        applied_value = stepping ? value_override : parseInt(val, 10);
                              apply_font_px(applied_value); break;
        case 'indent-default': toggle_default_indent('on'); break;
        case 'indent-remove': toggle_default_indent('off'); break;

        case 'linespace': {
          applied_value = stepping ? value_override : parseFloat(val);
          apply_block_style('lineHeight', applied_value === 1 ? '' : String(applied_value));
          break;
        }
        case 'space-before':  apply_block_style('marginTop', val + 'px'); break;
        case 'space-after':   apply_block_style('marginBottom', val + 'px'); break;

        case 'css':           applied_value = apply_css_item(item, stepping ? value_override : undefined); break;
        case 'clip-copy':     copy_selection(); break;
        case 'clip-cut':      cut_selection(); break;
        case 'clip-paste':
          paste_clipboard().then(() => { fmt_finish(null); update_undo_redo_buttons(); });
          break;
        case 'clear-text':    clear_selected_text(); break;
        case 'decor-none':    remove_text_decoration(); break;
        case 'valign-baseline': remove_vertical_align(); break;
        case 'list-pos':      apply_list_position(val); break;

        case 'photo':         applied_value = apply_photo_item(item, stepping ? value_override : undefined); break;
        case 'photo-op':      photo_operation(val); break;

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

  if (typed_as_span && had_caret) { finish_composition(); ensure_typing_span(); }
  fmt_finish(item);

  // Stepping the photo's size keeps the word "Image" in the list's title.
  const keep_photo_label = stepping && photo_label_active && !!selected_photo();
  if (!stepping) photo_label_active = false;
  set_active_fmt_item(item, applied_value, keep_photo_label ? 'Image' : undefined);
}
window.run_fmt_item = run_fmt_item;


// ═════════════════════════════════════════════════════════════════════════════
// STATUS MODE — the Active button is on
//   Part 1 (this section and the word navigation below): the arrow buttons highlight word
//   to word and the Active list shows the formatting of the highlighted word.
//   Part 2 (STATUS MODE PART 2, further down): the cursor reaches blank space, so Active
//   turns itself off and the select list is back to normal.
// ═════════════════════════════════════════════════════════════════════════════

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
  if (typeof fmt_refresh_states === 'function') fmt_refresh_states();   // the On list follows the highlighted word
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

// ── Word navigation helpers (Select mode: All / + / − and the arrow buttons) ─
// The note's text is flattened into one string (a "\n" after every text node,
// so words never run together across paragraphs) so "the next word" is just
// the next run of word characters.

function flat_text() {
  const walker = document.createTreeWalker(get_editor(), NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = '';
  let n;
  while ((n = walker.nextNode())) {
    nodes.push({ node: n, start: text.length });
    text += n.data + '\n';
  }
  return { text, nodes };
}

function point_to_pos(flat, container, offset) {
  if (container.nodeType === 3) {
    const hit = flat.nodes.find((e) => e.node === container);
    if (hit) return hit.start + offset;
  }
  const b = document.createRange();
  b.setStart(container, offset);
  b.collapse(true);
  for (const e of flat.nodes) {
    if (b.comparePoint(e.node, 0) >= 0) return e.start;   // first text at/after the point
  }
  return flat.text.length;
}

function pos_to_point(flat, pos) {
  for (const e of flat.nodes) {
    if (pos >= e.start && pos <= e.start + e.node.data.length) return [e.node, pos - e.start];
  }
  return null;
}

// The whole word just after (dir > 0) or just before (dir < 0) a range.
function neighbour_word(range, dir) {
  const flat = flat_text();
  const text = flat.text;
  let p;

  if (dir > 0) {
    p = point_to_pos(flat, range.endContainer, range.endOffset);
    while (p < text.length && is_word_char(text[p])) p++;      // finish a half-selected word
    while (p < text.length && !is_word_char(text[p])) p++;
    if (p >= text.length) return null;
  } else {
    p = point_to_pos(flat, range.startContainer, range.startOffset) - 1;
    while (p >= 0 && is_word_char(text[p])) p--;               // skip back over a half-selected word
    while (p >= 0 && !is_word_char(text[p])) p--;
    if (p < 0) return null;
  }

  const point = pos_to_point(flat, p);
  return point ? word_range_at(point[0], point[1]) : null;
}

// Select mode, + / −: add the next word to the selection, or drop the last one
// (a selection never shrinks below one word).
function stretch_selection(direction) {
  if (!select_range || select_range.collapsed) {
    const first = find_first_word_range();
    if (first) set_select_range(first, true);
    return;
  }

  if (direction > 0) {
    const word = neighbour_word(select_range, 1);
    if (!word) return;
    const grown = select_range.cloneRange();
    grown.setEnd(word.endContainer, word.endOffset);
    set_select_range(grown, true);
    return;
  }

  // Last word of the selection = the word holding its final character.
  const flat = flat_text();
  let p = point_to_pos(flat, select_range.endContainer, select_range.endOffset) - 1;
  while (p >= 0 && !is_word_char(flat.text[p])) p--;
  const point = p >= 0 ? pos_to_point(flat, p) : null;
  const last = point ? word_range_at(point[0], point[1]) : null;
  if (!last) return;

  const before = neighbour_word(last, -1);
  if (!before || before.compareBoundaryPoints(Range.START_TO_START, select_range) < 0) return;

  const shrunk = select_range.cloneRange();
  shrunk.setEnd(before.endContainer, before.endOffset);
  set_select_range(shrunk, true);
}

// "All": the whole note becomes the selection.
function select_all_text() {
  const editor = get_editor();
  if (!editor) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  set_select_range(range, true);
}

// Action-row ← / →.
//  Select off: the cursor moves one character.
//  Select on:  the highlight jumps to the next word in that direction.
function move_left_right(direction) {
  if (nav.level !== 'note') return;
  keyboard_off();

  if (select_mode) {
    const base = select_range && !select_range.collapsed ? select_range : null;
    let word;
    if (base) {
      word = neighbour_word(base, direction);
    } else {
      word = find_first_word_range();
    }
    if (word) set_select_range(word, true);
    else if (base && direction > 0) status_mode_leave_after_last_word();   // no more words: new text goes here
    return;
  }

  move_cursor(direction);
}
window.move_left_right = move_left_right;

function enter_select_mode() {
  const editor = get_editor();
  if (!editor) return;

  // Where the cursor is when Active is pressed: that word is the one inspected.
  let caret = null;
  const live = window.getSelection();
  if (live.rangeCount > 0 && range_in_editor(live.getRangeAt(0))) caret = live.getRangeAt(0).cloneRange();
  else if (saved_range && range_in_editor(saved_range)) caret = saved_range.cloneRange();

  select_mode = true;
  select_controls_selection = true;      // − / + stretch the selection; title reads "All"
  select_pending_first_word = false;
  editor.classList.add('select-mode');

  // No soft keyboard while picking words — it would cover the toolbar.
  keyboard_off();

  const btn = document.getElementById('fmtSelectBtn');
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
  }

  let picked = false;
  if (caret && caret.collapsed) {
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(caret);
    select_word_at_caret();
    picked = !!select_range;
  }

  const first = picked ? null : find_first_word_range();
  if (picked) {
    // the word at the cursor is already selected
  } else if (first) {
    set_select_range(first, true);
  } else {
    // Empty note: stay in Select mode; the first word is picked once text
    // appears (see on_editor_text_added) or when the user taps a word.
    select_pending_first_word = true;
    select_range = null;
    paint_select_highlight();
  }
  update_step_buttons();
  if (typeof fmt_active_changed === 'function') fmt_active_changed(true);   // opens the Active list
}

// silent = true skips collapsing the native selection (used when leaving a note).
function exit_select_mode(silent) {
  const editor = get_editor();
  const was_on = select_mode;

  select_mode = false;
  select_controls_selection = false;
  select_range = null;
  select_pending_first_word = false;
  update_step_buttons();

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
  if (was_on && !silent && typeof fmt_active_changed === 'function') fmt_active_changed(false);
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

  if (typeof clear_photo_selection === 'function') clear_photo_selection();   // nothing is selected in a freshly opened note
  typing_format = {};                  // a freshly opened note starts with no new-text format
  set_active_fmt_item(null);
  if (typeof fmt_update_label === 'function') fmt_update_label(true);   // the list title reads None again
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
    // Enter starts a new paragraph: make sure the line before it is one too.
    editor.addEventListener('input', (e) => {
      if (e.inputType === 'insertParagraph') wrap_loose_top_level();
    });

    // Ticking / unticking a checkbox saves the note right away.
    editor.addEventListener('change', (e) => {
      if (e.target && e.target.type === 'checkbox') {
        clearTimeout(auto_save_timer);
        auto_save_current_note();
      }
    });

    editor.addEventListener('beforeinput', (ev) => {
      const kind = ev.inputType || '';
      if (kind === 'insertText' || kind === 'insertParagraph' || kind === 'insertFromPaste') { ensure_typing_span(); return; }

      // Backspace right after a format was chosen would only delete the invisible marker: remove
      // the marker and delete the real letter before it instead.
      if (kind === 'deleteContentBackward' && ev.cancelable) {
        const s = window.getSelection();
        const el = caret_element();
        const sp = el && el.closest ? el.closest('span[data-tf]') : null;
        if (sp && s.isCollapsed && typing_span_is_blank(sp)) {
          ev.preventDefault();
          const at = document.createRange();
          at.setStartBefore(sp);
          at.collapse(true);
          sp.remove();
          s.removeAllRanges();
          s.addRange(at);
          document.execCommand('delete');
        }
      }
    });
    // Tapping into the note raises the keypad; the page must not slide up and cover the title.
    ['pointerdown', 'touchstart'].forEach((type) => editor.addEventListener(type, hold_page_start, { capture: true, passive: true }));
    editor.addEventListener('focus', hold_page_apply_soon);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', hold_page_apply_soon);
    window.addEventListener('scroll', hold_page_apply, { passive: true });
    editor.addEventListener('compositionstart', () => { ensure_typing_span(); typing_composing = true; });
    editor.addEventListener('compositionend', () => { typing_composing = false; });
    document.addEventListener('selectionchange', tidy_typing_spans);

    editor.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.note-photo')) return;

      // Tapping the note means the user wants the text, not the menu.
      close_fmt_menu();

      // Tapping into the note to type: bring the keypad back.
      if (!select_mode) { setTimeout(() => { keyboard_on(); tidy_typing_spans(); }, 0); return; }
      if (e.target.tagName === 'INPUT') return;   // checkbox tap
      const tap_x = e.clientX, tap_y = e.clientY;
      setTimeout(() => status_mode_tap(tap_x, tap_y), 0);
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


// ═════════════════════════════════════════════════════════════════════════════
// STATUS MODE PART 2 — the cursor lands on blank space: Active turns off
//   Blank space = after the last word, or a tap anywhere there is no word (same line, next
//   line, 90 lines down). New text will be typed there, so the select list goes back to
//   NORMAL MODE: the normal formatting options, titles reading None until a format is chosen.
// ═════════════════════════════════════════════════════════════════════════════

// Leaves status mode with the cursor at `caret` (a collapsed Range inside the note).
function status_mode_leave(caret) {
  const editor = get_editor();
  if (!editor || !select_mode) return;

  if (caret && range_in_editor(caret)) {
    const sel = window.getSelection();
    editor.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(caret);
    save_editor_selection();
  }

  exit_select_mode(false);               // un-highlights, closes the Active list, Active button off

  // Back to the normal list: titles read None unless a format is already on for new text.
  if (Object.keys(typing_format).length === 0) {
    set_active_fmt_item(null);
    if (typeof fmt_update_label === 'function') fmt_update_label(true);
  }
  ensure_typing_span();                  // the new-text format (if any) goes in at the cursor
}

// Right arrow with no more words: the cursor goes right after the last word.
function status_mode_leave_after_last_word() {
  if (!select_range) return;
  const caret = select_range.cloneRange();
  caret.collapse(false);
  status_mode_leave(caret);
}

// A tap in the note while Active is on: on a word it highlights that word; on blank space it
// puts the cursor there and turns Active off.
function status_mode_tap(x, y) {
  if (!select_mode) return;

  const sel = window.getSelection();
  const live = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  if (live && range_in_editor(live) && !live.collapsed) {   // dragged handles: adopt the selection
    set_select_range(live, false);
    return;
  }

  select_word_at_caret();

  const over_word = !!select_range && Array.from(select_range.getClientRects()).some((r) =>
    x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3);
  if (over_word) return;

  // Blank space: put the cursor where the finger went (or at the end of the note).
  let caret = null;
  if (document.caretRangeFromPoint) caret = document.caretRangeFromPoint(x, y);
  if (!caret || !range_in_editor(caret)) caret = live && range_in_editor(live) ? live : null;
  if (caret) caret.collapse(true);
  status_mode_leave(caret);
}


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

  const html = editor_clean_html();
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
// One ? button, two sets of help: one for the lists screen, one for the note
// screen. Each is a list of topics; tapping a topic opens its bullet list and
// closes the one that was open (same idea as the Formatting list).

const HELP_TOPICS_MAIN = [
  { title: 'Your lists and notes', items: [
    'This home screen holds your lists, and each list holds your notes.',
    'Tap a list title to open or close it.',
    'Tap a note title to open it for writing and formatting.',
    'New lists and new notes are placed in alphabetical order automatically.'
  ]},
  { title: 'Making a list', items: [
    'Tap [ new list + ], type a title, and confirm to add it.',
    'The new list appears in alphabetical order with the other lists.'
  ]},
  { title: 'Adding and opening notes', items: [
    'Open a list, then tap [ add note + ] inside it.',
    'Type a title for the note and confirm to add it.',
    'Tap the note title to open the writing screen.',
    'Use the ← Back button on the note screen to return here.'
  ]},
  { title: 'Renaming lists and notes', items: [
    'Tap [ edit ] in the toolbar to turn Edit mode on; the button now reads [ done ].',
    'While Edit mode is on, tap any list title or note title and it turns into a text box with a cursor.',
    'Type the new name, then press Enter or ✓ to save it (✕ cancels).',
    'The renamed list or note moves to its new alphabetical place, and the change syncs to your other devices.',
    'Tapping titles does not open them while Edit mode is on; tap [ done ] when you are finished.'
  ]},
  { title: 'Deleting lists and notes', items: [
    'The ✕ next to a list deletes that whole list and every note in it, after asking you to confirm.',
    'The ✕ next to a note deletes only that note, right away, with no confirmation.',
    'Deleted lists and notes cannot be brought back.'
  ]},
  { title: 'Syncing devices', items: [
    'Tap [ sync + ] on a new device and choose OK to create a new sync code.',
    'Choose Cancel instead to type in a code from another device and link to it.',
    'Once a device is linked, tapping [ sync + ] just shows its existing code.',
    'Anyone who has your code can link to your notes, so keep it private.'
  ]},
  { title: 'Saving and offline use', items: [
    'Every change is saved on this device automatically as you go.',
    'With a sync code, your notes are also copied to the cloud and to your linked devices.',
    'Without a sync code, your notes stay on this device only.',
    'Clearing your browser or site data can erase notes that were never synced.'
  ]}
];

const HELP_TOPICS_NOTE = [
  { title: 'The note screen', items: [
    'The title of the note is shown on its own line above the buttons.',
    '🎤 types what you say into the note at the cursor.',
    '💾 Save saves right now; the note also saves by itself a moment after you stop typing.',
    '← Back saves and returns to your lists.',
    'Touch the note to scroll the note; touch anywhere else to scroll the whole page.'
  ]},
  { title: 'The Formatting list', items: [
    'The top row reads "Formatting :", then the list, then the Active button.',
    'Three levels: main categories (Text, Image, Insert), then subcategories, then options.',
    'Tap a category or subcategory to open it; the Back row at the top takes you up one level.',
    'Text shows while you work with text; tap a photo and Image shows instead. Insert is always there.',
    'An option applies right away; there is no Apply button.',
    'A black On label on the left of an option or group shows that it is on; the current value is on the right.',
    'After you choose an option the list closes and its title shows what you chose.',
    'The list floats above the bar and never covers the note; tap the note to close it.',
    'The list opens upward over the space above the bar. If you are typing, the keypad and cursor stay while you choose; otherwise choosing never brings the keypad up.'
  ]},
  { title: 'The Active button', items: [
    'Active OFF: the formatting you choose is for the text you type next; the words already in the note do not change.',
    'Active ON: it works on the words you have selected, and the list opens on Active formatting.',
    'Press Active once: the first word of the note turns blue and the action row title reads All.',
    'Active formatting lists only the formatting that is on for the blue text, each with an On label.',
    'Active quick select menu: tap an On title (like Size) to open its values, then tap a different value to change it; the new value shows in the action row.',
    'The Active quick select menu only offers lists that are already on. Turn Active off to pick other formatting.',
    'Tap any word to select it instead, or drag the handles to select more.',
    'With no text selected, Active formatting shows what is on for the text you will type next.',
    'Press Active again to turn it off; the list closes.',
    'In an empty note, Active waits and picks the first word as soon as text appears.'
  ]},
  { title: 'The action row (←  →  −  +)', items: [
    'The action row is the line at the top right of the white note area.',
    'The title on its left says what − and + are changing: Weight, Size, Spacing, Indent, Color, and so on.',
    '− and + step only the option you chose last, and never change other formatting.',
    'With Active on and the title reading All, tap All to select the whole note.',
    'With Active on, + adds the next word to the selection and − takes the last word off.',
    'After you choose a formatting option while Active is on, − and + control that option; tap the title to give them back to the selection.',
    '← and → move the cursor one letter left or right.',
    'With Active on, ← and → move the blue highlight to the next word in that direction.'
  ]},
  { title: 'Undo and redo (↶ ↷)', items: [
    '↶ undoes the last change, including formatting.',
    '↷ brings back what you undid.',
    'Each note starts with fresh undo history when you open it.',
    'Making a new change after undoing clears what ↷ could redo.'
  ]},
  { title: 'Text > Font', items: [
    'Family: Google Fonts, grouped as Display, Handwriting, Monospace, Sans Serif and Serif, plus System (Monospace, Sans-serif, Serif).',
    'Open a Family group to see its fonts A to Z; a font downloads from Google the first time you use it, so you need internet for that.',
    'After you choose a font, − and + move to the previous or next font in the same group.',
    'Size: 1 px to 50 px; everything you type starts at 18 px, and − and + change it 1 px at a time.',
    'Style: Italic, Normal or Oblique.',
    'Variant: Normal, Small caps, All small caps, Petite caps or Titling caps.',
    'Weight: Thin, Extra light, Light, Normal, Medium, Semi bold, Bold, Extra bold or Black; − and + step it by 100.',
    'Kerning: Auto, Normal or None (spacing between letter pairs).'
  ]},
  { title: 'Text > Appearance', items: [
    'Color: Black, Blue, Brown, Cyan, Gold, Gray, Green, Magenta, Navy, Orange, Pink, Purple, Red, Teal, White or Yellow.',
    'Background color: the color behind the letters (also None).',
    'Decoration: Line through, None, Overline or Underline.',
    'Shadow: Hard, Medium, None or Soft shadow behind the letters.',
    'Glow: None, Soft, Medium or Strong light around the letters.',
    'Outline: None, Thin, Medium or Thick line around the letters.'
  ]},
  { title: 'Text > Alignment & Spacing', items: [
    'Align: Center, Justify, Left or Right.',
    'Direction: Left to right or Right to left.',
    'Indent: None, or 5 to 50 px, on the first line of the paragraph only.',
    'Line height: Single, 1.15 lines, 1.5 lines, Double, 2.5 lines or Triple; − and + change it by 0.1.',
    'Letter spacing and Word spacing: Normal, or more or less space in px; − and + change it 1 px at a time.',
    'Vertical align: Baseline, Subscript or Superscript.',
    'White space: Normal, No wrap, Pre or Pre wrap.',
    'Space Before and Space After: None, 6, 12, 18, 24, 36 or 48 px; − and + change it 1 px at a time.',
    'Pressing Enter starts a new paragraph, with 12 px of space after it.'
  ]},
  { title: 'Text > Lists', items: [
    'Bulleted: Bullet, Circle or Square markers.',
    'Numbered: Lowercase letters, Lowercase Roman, Numbers, Numbers with zero, Uppercase letters or Uppercase Roman.',
    'Checkboxes: puts a tick box at the cursor, and ticks are saved with the note.',
    'Marker position: Inside or Outside the text block.',
    'Pressing Enter at the end of an item starts the next item.',
    'After you choose a list, the action row title reads Spacing and − / + change the space after each list item (6 px to start).',
    'Remove list: turns the list back into plain lines.'
  ]},
  { title: 'Text > Word Formatting and Text Tools', items: [
    'Word break: Break all, Keep all or Normal. Transform: Capitalize, Lowercase, None or Uppercase.',
    'Text Tools: Clear (deletes the selected text), Clear formatting, Copy, Cut and Paste.',
    'Text Tools also has Line break (same paragraph), New paragraph and Quote.',
    'Copy, Cut and Paste work on the selected text (turn Active on and pick words first).',
    'If your phone asks permission to paste from the clipboard, allow it; otherwise Paste uses what you last copied inside the note.'
  ]},
  { title: 'Image (formatting a photo)', items: [
    'Tap a photo in the note: it gets a blue border and the Formatting list shows Image.',
    'While a photo is selected, − and + make it smaller or larger (the action row title reads Resize).',
    'Appearance: Brightness, Contrast, Saturate, Sepia, Grayscale, Invert, Hue rotate, Blur and Opacity.',
    'Size & Position: Resize (the photo\'s width as a percent of the note), Height, Object fit, Align, Rotate and Flip.',
    'Align: Center, Left, Right, Wrap text around left side or Wrap text around right side.',
    'Object fit: Contain, Cover, Fill, None or Scale down; Flip: Horizontal, None or Vertical.',
    'Border & Background: Border color, Border style (None, Solid, Dashed, Dotted, Double, Groove, Ridge), Border width, Border radius, Background color and Shadow.',
    'Spacing: Margin top, Margin bottom, Margin left, Margin right and Padding.',
    'Other: Alt text, Remove image and Reset image.',
    'Tap away from the photo to let go of it.'
  ]},
  { title: 'Insert', items: [
    'Image: first tap in the note where the photo should go, then Insert > Image and pick Camera, Photos or Files.',
    'Files: opens your phone\'s file browser; open folders, use its Back, and pick a picture.',
    'Move image: tap the image first (blue border), choose Move image, then tap in the note where it should go.',
    'Only pictures can go into a note; anything else is skipped with a message.'
  ]},
  { title: 'Adding photos', items: [
    'Put the cursor in the note, then Insert > Image: 📷 Camera, 🖼 Photos or 📁 Files.',
    'Camera opens inside Notepad; Take photo puts the picture in the note at the cursor.',
    'If the cursor is not in the note, a message asks you to place it first.',
    'Photos opens your picture library; you can pick several at once.',
    'Files opens the phone\'s file browser, where you can open internal storage and any folder.',
    'Photos are shrunk to a sensible size and inserted at the cursor.',
    'The orange ↘ handle on a selected photo can also be dragged to resize it.'
  ]},
  { title: 'Typing and the keypad', items: [
    'The keypad appears only when you tap into the note itself.',
    'Using the Formatting list, Active or the action row keeps it hidden.',
    'Tap the note again whenever you want to type.'
  ]},
  { title: 'Tips', items: [
    'To type in a new style, choose the option first (Active off), then type.',
    'To change words already written, turn Active on, select them, then choose.',
    'Formatting stacks: choose several options in a row on the same selection.',
    'Not sure what you did? ↶ undoes it.'
  ]}
];

function build_help_html(topics) {
  return topics.map((topic, i) => {
    const items = topic.items.map((text) => '<li>' + text + '</li>').join('');
    return '<div class="help-topic" data-topic="' + i + '">' +
      '<div class="help-topic-head" role="button" tabindex="0">' + topic.title + '</div>' +
      '<ul class="help-list help-topic-body">' + items + '</ul>' +
    '</div>';
  }).join('');
}

// Opens one topic and closes any other; tapping an open topic closes it.
function toggle_help_topic(topic_el) {
  if (!topic_el) return;
  const was_open = topic_el.classList.contains('open');
  document.querySelectorAll('#helpModalBody .help-topic.open')
    .forEach((el) => el.classList.remove('open'));
  if (!was_open) {
    topic_el.classList.add('open');
    if (topic_el.scrollIntoView) topic_el.scrollIntoView({ block: 'nearest' });
  }
}
window.toggle_help_topic = toggle_help_topic;

function show_help_modal() {
  const body = document.getElementById('helpModalBody');
  const overlay = document.getElementById('helpModalOverlay');
  const heading = document.getElementById('helpModalTitle');
  if (!body || !overlay) return;

  const in_note = nav.level === 'note';
  body.innerHTML =
    '<p class="help-intro">' + (in_note
      ? 'Tap a topic to see how it works.'
      : 'Tap a topic to see how it works.') + '</p>' +
    build_help_html(in_note ? HELP_TOPICS_NOTE : HELP_TOPICS_MAIN);

  if (heading) heading.textContent = in_note ? 'Help — Writing a note' : 'Help — Your lists';
  body.scrollTop = 0;
  const modal = body.closest('.help-modal');
  if (modal) modal.scrollTop = 0;

  overlay.style.display = 'flex';
}
window.show_help_modal = show_help_modal;

function hide_help_modal(event) {
  const overlay = document.getElementById('helpModalOverlay');
  if (overlay) overlay.style.display = 'none';
}
window.hide_help_modal = hide_help_modal;

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('helpModalBody');
  if (!body) return;
  body.addEventListener('click', (e) => {
    const head = e.target.closest('.help-topic-head');
    if (head) toggle_help_topic(head.parentElement);
  });
  body.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('help-topic-head')) {
      e.preventDefault();
      toggle_help_topic(e.target.parentElement);
    }
  });
});
