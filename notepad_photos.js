// ═══════════════════════════════════════════════════════════════════════
// NOTEPAD PHOTOS — local image picker, insertion, and resizing
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

      editor.focus({ preventScroll: true });
      restore_editor_selection();

      const sel = window.getSelection();

      if (!sel || sel.rangeCount === 0) {
        editor.appendChild(document.createElement('br'));
        editor.appendChild(create_note_photo(e.target.result, file.name));
      } else {

        const range = sel.getRangeAt(0);

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

          const spacer = document.createElement('div');
          spacer.appendChild(document.createElement('br'));

          image.parentNode.insertBefore(
            spacer,
            image.nextSibling
          );

          const newRange = document.createRange();
          newRange.setStart(spacer, 0);
          newRange.collapse(true);

          sel.removeAllRanges();
          sel.addRange(newRange);

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

  // Keep the image proportional when resized.
  image.style.height = 'auto';

  image.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();

    select_note_photo(image);
  });

  return image;
}


// ─── § PHOTO SELECTION — select one photo for resizing ──────────────────

let selected_note_photo = null;

function select_note_photo(image) {
  clear_photo_selection();

  selected_note_photo = image;
  image.classList.add('note-photo-selected');

  show_photo_resize_controls(image);
}


// ─── § PHOTO SELECTION — clear current selection ─────────────────────────

function clear_photo_selection() {
  document.querySelectorAll('.note-photo-selected').forEach((image) => {
    image.classList.remove('note-photo-selected');
  });

  document.querySelectorAll('.photo-resize-controls').forEach((controls) => {
    controls.remove();
  });

  selected_note_photo = null;
}


// ─── § RESIZE CONTROLS — create controls below selected photo ────────────

function show_photo_resize_controls(image) {

  const controls = document.createElement('div');

  controls.className = 'photo-resize-controls';

  const smaller = document.createElement('button');
  smaller.type = 'button';
  smaller.className = 'orange-btn';
  smaller.textContent = '−';
  smaller.title = 'Make photo smaller';

  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'photo-size-label';

  const larger = document.createElement('button');
  larger.type = 'button';
  larger.className = 'orange-btn';
  larger.textContent = '+';
  larger.title = 'Make photo larger';

  smaller.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    resize_note_photo(image, -50);
  });

  larger.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    resize_note_photo(image, 50);
  });

  controls.appendChild(smaller);
  controls.appendChild(sizeLabel);
  controls.appendChild(larger);

  image.parentNode.insertBefore(
    controls,
    image.nextSibling
  );

  update_photo_size_label(image, sizeLabel);
}


// ─── § PHOTO RESIZING — change width while preserving aspect ratio ──────

function resize_note_photo(image, amount) {

  if (!image || !image.naturalWidth) return;

  const currentWidth = image.offsetWidth;

  let newWidth = currentWidth + amount;

  const minimumWidth = 50;
  const maximumWidth = image.parentElement
    ? image.parentElement.clientWidth
    : window.innerWidth;

  newWidth = Math.max(
    minimumWidth,
    Math.min(newWidth, maximumWidth)
  );

  image.style.width = newWidth + 'px';
  image.style.height = 'auto';

  const label = image.nextElementSibling;

  if (label && label.classList.contains('photo-resize-controls')) {
    const sizeLabel = label.querySelector('.photo-size-label');

    if (sizeLabel) {
      update_photo_size_label(image, sizeLabel);
    }
  }

  auto_save_current_note();
}


// ─── § PHOTO SIZE LABEL ─────────────────────────────────────────────────

function update_photo_size_label(image, label) {
  label.textContent = Math.round(image.offsetWidth) + ' px';
}


// ─── § PHOTO CLICK-AWAY — tapping elsewhere deselects the photo ─────────

document.addEventListener('click', function(event) {

  if (
    selected_note_photo &&
    !event.target.closest('.note-photo') &&
    !event.target.closest('.photo-resize-controls')
  ) {
    clear_photo_selection();
  }
});


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


// ─── § PHOTO BUTTON — observe the editor display changes ────────────────

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