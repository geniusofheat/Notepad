// ── NOTEPAD PHOTOS ───────────────────────────────────────────────────────────
// Opens the device's native file picker and inserts selected images into
// the current note at the cursor position.

let photo_saved_range = null;


// ─── § SAVE CURSOR POSITION ─────────────────────────────────────────────────

function save_photo_selection() {
  const editor = document.getElementById('note-textarea');
  const selection = window.getSelection();

  if (!editor || !selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);

  if (editor.contains(range.commonAncestorContainer)) {
    photo_saved_range = range.cloneRange();
  }
}


// ─── § RESTORE CURSOR POSITION ──────────────────────────────────────────────

function restore_photo_selection() {
  if (!photo_saved_range) return;

  const selection = window.getSelection();

  selection.removeAllRanges();
  selection.addRange(photo_saved_range);
}


// ─── § OPEN PHOTO FILE PICKER ────────────────────────────────────────────────

function trigger_photo_picker() {
  save_photo_selection();

  const input = document.getElementById('photoFileInput');

  if (input) {
    input.click();
  }
}

window.trigger_photo_picker = trigger_photo_picker;


// ─── § INSERT SELECTED PHOTOS ───────────────────────────────────────────────

function insert_note_photos(event) {
  const files = Array.from(event.target.files || []);
  const editor = document.getElementById('note-textarea');

  if (!editor || files.length === 0) {
    event.target.value = '';
    return;
  }

  restore_photo_selection();

  editor.focus({ preventScroll: true });

  const selection = window.getSelection();

  let range;

  if (photo_saved_range) {
    range = photo_saved_range.cloneRange();
  } else if (
    selection.rangeCount > 0 &&
    editor.contains(selection.getRangeAt(0).commonAncestorContainer)
  ) {
    range = selection.getRangeAt(0).cloneRange();
  } else {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  range.deleteContents();

  let remaining = files.length;

  files.forEach((file) => {

    const reader = new FileReader();

    reader.onload = function(e) {

      const image = document.createElement('img');

      image.src = e.target.result;
      image.className = 'note-photo';
      image.alt = file.name;

      range.insertNode(image);

      const spacer = document.createElement('div');
      spacer.appendChild(document.createElement('br'));

      image.after(spacer);

      range = document.createRange();
      range.setStartAfter(spacer);
      range.collapse(true);

      remaining--;

      if (remaining === 0) {

        const newSelection = window.getSelection();

        newSelection.removeAllRanges();
        newSelection.addRange(range);

        if (typeof auto_save_current_note === 'function') {
          auto_save_current_note();
        }
      }
    };

    reader.onerror = function() {

      remaining--;

      if (
        remaining === 0 &&
        typeof auto_save_current_note === 'function'
      ) {
        auto_save_current_note();
      }
    };

    reader.readAsDataURL(file);
  });

  photo_saved_range = null;

  // Reset the input so the same photo can be selected again later.
  event.target.value = '';
}


// ─── § PHOTO BUTTON VISIBILITY ───────────────────────────────────────────────
// The existing engine controls when the note editor is shown/hidden.
// Watch that existing element so the new Photo button follows it without
// changing the existing navigation code.

function update_photo_button_visibility() {

  const editorView = document.getElementById('note-editor-view');
  const photoButton = document.getElementById('photoBtn');

  if (!editorView || !photoButton) return;

  if (editorView.style.display !== 'none') {
    photoButton.style.display = 'inline-flex';
  } else {
    photoButton.style.display = 'none';
  }
}


const photo_view_observer = new MutationObserver(
  update_photo_button_visibility
);


function initialize_photo_button() {

  const editorView = document.getElementById('note-editor-view');

  if (!editorView) return;

  photo_view_observer.observe(editorView, {
    attributes: true,
    attributeFilter: ['style']
  });

  update_photo_button_visibility();
}


if (document.readyState === 'loading') {

  document.addEventListener(
    'DOMContentLoaded',
    initialize_photo_button
  );

} else {

  initialize_photo_button();
}