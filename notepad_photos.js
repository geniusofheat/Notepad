// ═══════════════════════════════════════════════════════════════════════
// NOTEPAD PHOTOS — local image picker and note image insertion
// ═══════════════════════════════════════════════════════════════════════

// ─── § PHOTO SELECTION — preserve the cursor before opening file picker ───

let saved_photo_selection = null;

function save_photo_selection() {
  const editor = document.getElementById('note-textarea');

  if (!editor) return;

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);

  if (editor.contains(range.commonAncestorContainer)) {
    saved_photo_selection = range.cloneRange();
  }
}


// ─── § PHOTO SELECTION — restore cursor after file picker closes ─────────

function restore_photo_selection() {
  const editor = document.getElementById('note-textarea');

  if (!editor) return;

  editor.focus();

  if (!saved_photo_selection) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    return;
  }

  const selection = window.getSelection();

  selection.removeAllRanges();
  selection.addRange(saved_photo_selection);
}


// ─── § PHOTO PICKER — open Android's normal file picker ─────────────────

function trigger_photo_picker() {
  save_photo_selection();

  const input = document.getElementById('photoFileInput');

  if (!input) return;

  input.click();
}


// ─── § PHOTO INSERTION — read selected image files ──────────────────────

function insert_note_photos(event) {
  const input = event.target;

  if (!input || !input.files || input.files.length === 0) {
    return;
  }

  const files = Array.from(input.files);

  restore_photo_selection();

  insert_photo_files(files);
}


// ─── § PHOTO INSERTION — insert each selected image into the note ───────

function insert_photo_files(files) {
  const editor = document.getElementById('note-textarea');

  if (!editor || !files || files.length === 0) {
    return;
  }

  restore_photo_selection();

  let files_remaining = files.length;

  files.forEach(function(file) {
    if (!file.type.startsWith('image/')) {
      files_remaining--;

      if (files_remaining === 0) {
        finish_photo_insert();
      }

      return;
    }

    const reader = new FileReader();

    reader.onload = function(load_event) {
      const image = document.createElement('img');

      image.className = 'note-photo';
      image.src = load_event.target.result;
      image.alt = file.name;

      insert_element_at_cursor(image);

      files_remaining--;

      if (files_remaining === 0) {
        finish_photo_insert();
      }
    };

    reader.onerror = function() {
      files_remaining--;

      if (files_remaining === 0) {
        finish_photo_insert();
      }
    };

    reader.readAsDataURL(file);
  });
}


// ─── § PHOTO INSERTION — place image at current cursor position ─────────

function insert_element_at_cursor(element) {
  const editor = document.getElementById('note-textarea');

  if (!editor) return;

  restore_photo_selection();

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    editor.appendChild(element);
    editor.appendChild(document.createElement('br'));
    return;
  }

  const range = selection.getRangeAt(0);

  if (!editor.contains(range.commonAncestorContainer)) {
    editor.appendChild(element);
    editor.appendChild(document.createElement('br'));
    return;
  }

  range.deleteContents();
  range.insertNode(element);

  const spacer = document.createElement('br');

  if (element.nextSibling) {
    element.parentNode.insertBefore(spacer, element.nextSibling);
  } else {
    element.parentNode.appendChild(spacer);
  }

  const new_range = document.createRange();

  new_range.setStartAfter(spacer);
  new_range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(new_range);

  saved_photo_selection = new_range.cloneRange();
}


// ─── § PHOTO SAVE — save note after images have been inserted ───────────

function finish_photo_insert() {
  const editor = document.getElementById('note-textarea');

  if (!editor) return;

  editor.focus();

  if (typeof auto_save_current_note === 'function') {
    auto_save_current_note();
  }

  saved_photo_selection = null;

  const input = document.getElementById('photoFileInput');

  if (input) {
    input.value = '';
  }
}


// ─── § PHOTO BUTTON — keep Photos button visible only in note editor ────

function update_photo_button_visibility() {
  const editor_view = document.getElementById('note-editor-view');
  const photo_button = document.getElementById('photoBtn');

  if (!editor_view || !photo_button) return;

  const editor_visible =
    editor_view.style.display !== 'none' &&
    getComputedStyle(editor_view).display !== 'none';

  photo_button.style.display = editor_visible ? 'inline-block' : 'none';
}


// ─── § PHOTO BUTTON — watch existing editor navigation ──────────────────

function start_photo_button_observer() {
  const editor_view = document.getElementById('note-editor-view');

  if (!editor_view) return;

  update_photo_button_visibility();

  const observer = new MutationObserver(function() {
    update_photo_button_visibility();
  });

  observer.observe(editor_view, {
    attributes: true,
    attributeFilter: ['style', 'class']
  });
}


// ─── § PHOTO MODULE — initialize after page is loaded ───────────────────

document.addEventListener('DOMContentLoaded', function() {
  start_photo_button_observer();
});