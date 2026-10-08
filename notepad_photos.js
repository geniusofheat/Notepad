// ═══════════════════════════════════════════════════════════════════════
// NOTEPAD PHOTOS — local image picker and note image insertion
// Works with notepad_engine.js selection and save system.
// ═══════════════════════════════════════════════════════════════════════


// ─── § PHOTO PICKER — open the device's normal file picker ──────────────

function trigger_photo_picker() {
  save_editor_selection();

  const input = document.getElementById('photoFileInput');

  if (input) {
    input.click();
  }
}

window.trigger_photo_picker = trigger_photo_picker;


// ─── § PHOTO INSERTION — process selected image files ───────────────────

function insert_note_photos(event) {
  const input = event.target;

  if (!input || !input.files || input.files.length === 0) {
    return;
  }

  const files = Array.from(input.files);
  const editor = document.getElementById('note-textarea');

  if (!editor) {
    input.value = '';
    return;
  }

  // Restore the exact cursor/selection maintained by notepad_engine.js.
  editor.focus({ preventScroll: true });
  restore_editor_selection();

  let remaining = files.length;

  files.forEach((file) => {

    if (!file.type.startsWith('image/')) {
      remaining--;

      if (remaining === 0) {
        finish_photo_insert();
      }

      return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {

      // Restore the engine's current selection before each image.
      editor.focus({ preventScroll: true });
      restore_editor_selection();

      const sel = window.getSelection();

      if (!sel || sel.rangeCount === 0) {
        editor.appendChild(document.createElement('br'));
        editor.appendChild(create_note_photo(e.target.result, file.name));
      } else {

        const range = sel.getRangeAt(0);

        // Make sure the selection is actually inside the note editor.
        if (!editor.contains(range.commonAncestorContainer)) {
          editor.appendChild(document.createElement('br'));
          editor.appendChild(create_note_photo(e.target.result, file.name));
        } else {

          range.deleteContents();

          const image = create_note_photo(
            e.target.result,
            file.name
          );

          range.insertNode(image);

          // Put a blank line after the image so the user can continue
          // typing below it.
          const spacer = document.createElement('div');
          spacer.appendChild(document.createElement('br'));

          image.parentNode.insertBefore(
            spacer,
            image.nextSibling
          );

          // Place the cursor in the new blank line.
          const newRange = document.createRange();
          newRange.setStart(spacer, 0);
          newRange.collapse(true);

          sel.removeAllRanges();
          sel.addRange(newRange);

          // Give the engine the new cursor position.
          save_editor_selection();
        }
      }

      remaining--;

      if (remaining === 0) {
        finish_photo_insert();
      }
    };

    reader.onerror = function() {
      remaining--;

      if (remaining === 0) {
        finish_photo_insert();
      }
    };

    reader.readAsDataURL(file);
  });
}

window.insert_note_photos = insert_note_photos;


// ─── § PHOTO ELEMENT — create the image stored inside the note HTML ─────

function create_note_photo(data_url, filename) {
  const image = document.createElement('img');

  image.className = 'note-photo';
  image.src = data_url;
  image.alt = filename || 'Photo';

  return image;
}


// ─── § PHOTO SAVE — use the engine's existing save system ───────────────

function finish_photo_insert() {
  save_editor_selection();
  auto_save_current_note();

  const input = document.getElementById('photoFileInput');

  if (input) {
    input.value = '';
  }
}


// ─── § PHOTO BUTTON — follow the engine's existing editor navigation ────

function update_photo_button() {
  const photoButton = document.getElementById('photoBtn');

  if (!photoButton) return;

  const editorView = document.getElementById('note-editor-view');

  if (!editorView) return;

  if (editorView.style.display === 'none') {
    photoButton.style.display = 'none';
  } else {
    photoButton.style.display = 'inline-flex';
  }
}


// ─── § PHOTO BUTTON — observe the same editor display changes ───────────

document.addEventListener('DOMContentLoaded', function() {

  update_photo_button();

  const editorView = document.getElementById('note-editor-view');

  if (!editorView) return;

  const observer = new MutationObserver(function() {
    update_photo_button();
  });

  observer.observe(editorView, {
    attributes: true,
    attributeFilter: ['style']
  });
});