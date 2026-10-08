// ═══════════════════════════════════════════════════════════════════════
// NOTEPAD PHOTOS — local image picker, insertion, selection, and resizing
// Photo behavior stays isolated from the main note engine.
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
        editor.appendChild(
          create_note_photo(e.target.result, file.name)
        );
      } else {

        const range = sel.getRangeAt(0);

        if (!editor.contains(range.commonAncestorContainer)) {

          editor.appendChild(document.createElement('br'));
          editor.appendChild(
            create_note_photo(e.target.result, file.name)
          );

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


// ─── § PHOTO ELEMENT — create the image stored inside note HTML ─────────

function create_note_photo(data_url, filename) {
  const image = document.createElement('img');

  image.className = 'note-photo';
  image.src = data_url;
  image.alt = filename || 'Photo';

  image.style.height = 'auto';

  return image;
}


// ─── § PHOTO SELECTION — current selected photo ─────────────────────────

let selected_note_photo = null;
let photo_resize_handle = null;
let photo_resize_state = null;


// ─── § PHOTO SELECTION — select one photo ───────────────────────────────

function select_note_photo(image) {
  if (!image) return;

  clear_photo_selection();

  selected_note_photo = image;
  image.classList.add('note-photo-selected');

  show_photo_resize_handle(image);
}


// ─── § PHOTO SELECTION — clear current selection ─────────────────────────

function clear_photo_selection() {

  if (selected_note_photo) {
    selected_note_photo.classList.remove('note-photo-selected');
  }

  if (photo_resize_handle) {
    photo_resize_handle.remove();
    photo_resize_handle = null;
  }

  selected_note_photo = null;
  photo_resize_state = null;
}


// ─── § PHOTO HANDLE — create temporary lower-right corner handle ─────────

function show_photo_resize_handle(image) {

  if (photo_resize_handle) {
    photo_resize_handle.remove();
  }

  const handle = document.createElement('div');

  handle.className = 'photo-resize-handle';
  handle.setAttribute('aria-label', 'Resize photo');

  photo_resize_handle = handle;

  document.body.appendChild(handle);

  position_photo_resize_handle();

  handle.addEventListener('pointerdown', start_photo_resize);
}


// ─── § PHOTO HANDLE — keep handle attached to photo corner ──────────────

function position_photo_resize_handle() {

  if (!selected_note_photo || !photo_resize_handle) {
    return;
  }

  const rect = selected_note_photo.getBoundingClientRect();

  photo_resize_handle.style.left =
    Math.round(rect.right - 11) + 'px';

  photo_resize_handle.style.top =
    Math.round(rect.bottom - 11) + 'px';
}


// ─── § PHOTO RESIZING — begin corner drag ───────────────────────────────

function start_photo_resize(event) {

  if (!selected_note_photo) return;

  event.preventDefault();
  event.stopPropagation();

  const image = selected_note_photo;
  const rect = image.getBoundingClientRect();

  photo_resize_state = {
    image: image,
    startWidth: rect.width,
    startHeight: rect.height,
    anchorX: rect.left,
    anchorY: rect.top,
    startDiagonal: Math.sqrt(
      (rect.width * rect.width) +
      (rect.height * rect.height)
    ),
    pointerId: event.pointerId
  };

  photo_resize_handle.setPointerCapture(event.pointerId);

  photo_resize_handle.addEventListener(
    'pointermove',
    continue_photo_resize
  );

  photo_resize_handle.addEventListener(
    'pointerup',
    finish_photo_resize
  );

  photo_resize_handle.addEventListener(
    'pointercancel',
    finish_photo_resize
  );
}


// ─── § PHOTO RESIZING — follow the dragged corner ───────────────────────

function continue_photo_resize(event) {

  if (!photo_resize_state) return;

  event.preventDefault();

  const state = photo_resize_state;

  const deltaX = event.clientX - state.anchorX;
  const deltaY = event.clientY - state.anchorY;

  const currentDiagonal = Math.sqrt(
    (deltaX * deltaX) +
    (deltaY * deltaY)
  );

  let scale =
    currentDiagonal / state.startDiagonal;

  scale = Math.max(0.10, scale);

  const image = state.image;

  const parentWidth = image.parentElement
    ? image.parentElement.clientWidth
    : window.innerWidth;

  const minimumWidth = 50;

  let newWidth = state.startWidth * scale;

  newWidth = Math.max(
    minimumWidth,
    Math.min(newWidth, parentWidth)
  );

  image.style.width = Math.round(newWidth) + 'px';
  image.style.height = 'auto';

  position_photo_resize_handle();
}


// ─── § PHOTO RESIZING — finish drag and save the note ───────────────────

function finish_photo_resize(event) {

  if (!photo_resize_state) return;

  event.preventDefault();

  const handle = photo_resize_handle;

  if (handle && handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId);
  }

  if (handle) {
    handle.removeEventListener(
      'pointermove',
      continue_photo_resize
    );

    handle.removeEventListener(
      'pointerup',
      finish_photo_resize
    );

    handle.removeEventListener(
      'pointercancel',
      finish_photo_resize
    );
  }

  photo_resize_state = null;

  position_photo_resize_handle();

  // The resized width is now an inline style on the actual <img>.
  // Therefore it is included automatically in item.content when the
  // existing note save system saves editor.innerHTML.
  auto_save_current_note();
}


// ─── § PHOTO CLICK — select photos already loaded from saved HTML ───────

function handle_photo_editor_click(event) {

  const image = event.target.closest('.note-photo');

  if (!image) return;

  event.preventDefault();
  event.stopPropagation();

  select_note_photo(image);
}


// ─── § PHOTO CLICK-AWAY — tapping elsewhere deselects the photo ─────────

function handle_photo_document_click(event) {

  if (!selected_note_photo) return;

  if (event.target.closest('.note-photo')) {
    return;
  }

  if (event.target.closest('.photo-resize-handle')) {
    return;
  }

  clear_photo_selection();
}


// ─── § PHOTO POSITION — keep handle aligned during scrolling/resizing ───

function handle_photo_position_change() {
  position_photo_resize_handle();
}


// ─── § PHOTO SAVE — use the engine's existing note save system ──────────

function finish_photo_insert() {

  save_editor_selection();

  // The image itself is already inside #note-textarea.
  // auto_save_current_note() therefore saves the Base64 image as part
  // of the normal note HTML.
  auto_save_current_note();

  const input = document.getElementById('photoFileInput');

  if (input) {
    input.value = '';
  }
}


// ─── § PHOTO BUTTON — follow existing editor navigation ─────────────────

function update_photo_button() {

  const photoButton = document.getElementById('photoBtn');

  if (!photoButton) return;

  const editorView =
    document.getElementById('note-editor-view');

  if (!editorView) return;

  if (editorView.style.display === 'none') {
    photoButton.style.display = 'none';
  } else {
    photoButton.style.display = 'inline-flex';
  }
}


// ─── § PHOTO INITIALIZATION ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {

  update_photo_button();

  const editor =
    document.getElementById('note-textarea');

  if (editor) {
    // Delegation means this works for both newly inserted photos and
    // photos loaded later from saved note HTML.
    editor.addEventListener(
      'click',
      handle_photo_editor_click
    );
  }

  document.addEventListener(
    'click',
    handle_photo_document_click
  );

  document.addEventListener(
    'scroll',
    handle_photo_position_change,
    true
  );

  window.addEventListener(
    'resize',
    handle_photo_position_change
  );

  const editorView =
    document.getElementById('note-editor-view');

  if (!editorView) return;

  const observer = new MutationObserver(function() {
    update_photo_button();
  });

  observer.observe(editorView, {
    attributes: true,
    attributeFilter: ['style']
  });
});