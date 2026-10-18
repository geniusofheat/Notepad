// ═══════════════════════════════════════════════════════════════════════
// NOTEPAD PHOTOS — local image picker, insertion, selection, and resizing
// Photo behavior stays isolated from the main note engine.
// ═══════════════════════════════════════════════════════════════════════


// ─── § PHOTO PICKER — open the device's normal file picker ──────────────

// Insert > Image comes here. The photo goes where the cursor is, so a cursor must be in the note.
function photo_cursor_ready() {
  const editor = document.getElementById('note-textarea');
  const view = document.getElementById('note-editor-view');
  if (!editor || (view && view.style.display === 'none')) return false;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) return true;
  return !!(typeof saved_range !== 'undefined' && saved_range && editor.contains(saved_range.commonAncestorContainer));
}

// Where the photo will go: the cursor (end of a selection, so no text is replaced).
let photo_insert_range = null;
function capture_photo_insert_point() {
  const editor = document.getElementById('note-textarea');
  let r = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) r = sel.getRangeAt(0).cloneRange();
  else if (typeof saved_range !== 'undefined' && saved_range && editor.contains(saved_range.commonAncestorContainer)) r = saved_range.cloneRange();
  if (r) r.collapse(false);
  photo_insert_range = r;
}
window.capture_photo_insert_point = capture_photo_insert_point;

function show_photo_message(text, title) {
  const t = document.getElementById('photoMsgText');
  const h = document.getElementById('photoMsgTitle');
  if (h) h.textContent = title || 'Place the cursor first';
  const o = document.getElementById('photoMsgOverlay');
  if (t) t.textContent = text;
  if (o) o.classList.add('open');
}
function close_photo_message() {
  const o = document.getElementById('photoMsgOverlay');
  if (o) o.classList.remove('open');
}

function trigger_photo_picker() {
  save_editor_selection();
  if (!photo_cursor_ready()) {
    show_photo_message('Please place the cursor in the notepad area where you would like the photo to be placed.');
    return;
  }
  capture_photo_insert_point();
  if (typeof keyboard_off === 'function') keyboard_off(true);
  const sheet = document.getElementById('photoSourceOverlay');
  if (sheet) sheet.classList.add('open');
}

function close_photo_sheet() {
  const sheet = document.getElementById('photoSourceOverlay');
  if (sheet) sheet.classList.remove('open');
}

// 'camera' = take a picture inside the app, 'photos' = gallery / pictures, 'files' = any file.
function choose_photo_source(kind) {
  close_photo_sheet();
  if (kind === 'camera') open_camera(); else open_photo_input(kind);
}

function open_photo_input(kind) {
  save_editor_selection();
  const ids = { camera: 'photoCameraInput', photos: 'photoFileInput', files: 'photoFilesInput' };
  const input = document.getElementById(ids[kind]);
  if (input) input.click();
}

// ─── In-app camera (no trip to the phone's camera app, so the note stays open) ───
let camera_stream = null;
let camera_facing = 'environment';

function stop_camera_stream() {
  if (camera_stream) camera_stream.getTracks().forEach((t) => t.stop());
  camera_stream = null;
}

function start_camera_stream() {
  stop_camera_stream();
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: camera_facing } }, audio: false })
    .then((stream) => {
      camera_stream = stream;
      const v = document.getElementById('cameraVideo');
      v.srcObject = stream;
      return v.play().catch(() => {});
    });
}

function open_camera() {
  save_editor_selection();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    open_photo_input('camera');         // very old browsers: the phone's camera app
    return;
  }
  const o = document.getElementById('cameraOverlay');
  start_camera_stream().then(() => { o.classList.add('open'); })
    .catch(() => {
      stop_camera_stream();
      if (typeof fmt_notice === 'function') fmt_notice('The camera could not be opened. Allow camera access for this site and try again.');
    });
}

function close_camera() {
  stop_camera_stream();
  const o = document.getElementById('cameraOverlay');
  if (o) o.classList.remove('open');
}

function flip_camera() {
  camera_facing = camera_facing === 'environment' ? 'user' : 'environment';
  start_camera_stream().catch(() => {});
}

function take_camera_photo() {
  const v = document.getElementById('cameraVideo');
  if (!v || !v.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth; canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);
  close_camera();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' });
    insert_note_photos({ target: { files: [file], value: '' } });
  }, 'image/jpeg', 0.92);
}

window.open_camera = open_camera;
window.close_camera = close_camera;
window.flip_camera = flip_camera;
window.take_camera_photo = take_camera_photo;
window.show_photo_message = show_photo_message;
window.close_photo_message = close_photo_message;
window.photo_cursor_ready = photo_cursor_ready;
window.close_photo_sheet = close_photo_sheet;
window.choose_photo_source = choose_photo_source;
window.open_photo_input = open_photo_input;
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
  let skipped = 0;
  const looks_like_image = (file) =>
    file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || '');

  files.forEach((file) => {

    if (!looks_like_image(file)) {
      remaining--;
      skipped++;

      if (remaining === 0) {
        finish_photo_insert(skipped);
      }

      return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {

      // Phone photos are several MB each, which overflows the phone's
      // storage for the note (nothing would save). Shrink before inserting.
      shrink_photo(e.target.result, file.type, function(small_url) {
        insert_one_photo(small_url, file.name);
      });
    };

    function insert_one_photo(photo_url, photo_name) {

      editor.focus({ preventScroll: true });
      // focus() can drop the caret at the top of the note: put it back where the
      // user placed it when they chose Insert > Image.
      if (photo_insert_range && editor.contains(photo_insert_range.commonAncestorContainer)) {
        const s0 = window.getSelection();
        s0.removeAllRanges();
        s0.addRange(photo_insert_range.cloneRange());
      } else {
        restore_editor_selection();
      }

      const sel = window.getSelection();

      if (!sel || sel.rangeCount === 0) {
        editor.appendChild(document.createElement('br'));
        editor.appendChild(
          create_note_photo(photo_url, photo_name)
        );
      } else {

        const range = sel.getRangeAt(0);

        if (!editor.contains(range.commonAncestorContainer)) {

          editor.appendChild(document.createElement('br'));
          editor.appendChild(
            create_note_photo(photo_url, photo_name)
          );

        } else {

          range.deleteContents();

          const image = create_note_photo(
            photo_url,
            photo_name
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
          photo_insert_range = newRange.cloneRange();
        }
      }

      remaining--;

      if (remaining === 0) {
        finish_photo_insert(skipped);
      }
    }

    reader.onerror = function() {
      remaining--;
      skipped++;

      if (remaining === 0) {
        finish_photo_insert(skipped);
      }
    };

    reader.readAsDataURL(file);
  });
}

window.insert_note_photos = insert_note_photos;



// ─── § PHOTO SHRINK — keep saved photos small enough to store and sync ───
// Longest side 1280 px, JPEG quality 0.8: roughly 150-300 KB instead of
// several MB. If anything goes wrong the original photo is used.

const PHOTO_MAX_SIDE = 1280;

function shrink_photo(data_url, mime_type, done) {
  if (mime_type === 'image/gif' || mime_type === 'image/svg+xml') {
    done(data_url);
    return;
  }

  const img = new Image();

  img.onload = function() {
    try {
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';          // JPEG has no transparency
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const small = canvas.toDataURL('image/jpeg', 0.8);
      done(small.length < data_url.length ? small : data_url);
    } catch (err) {
      done(data_url);
    }
  };

  img.onerror = function() { done(data_url); };
  img.src = data_url;
}

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

  // Tell the Formatting list a photo is active (title "Photo", − / + resize it).
  if (typeof on_photo_selected === 'function') on_photo_selected(image);
}


// ─── § PHOTO SELECTION — clear current selection ─────────────────────────

function clear_photo_selection() {

  const had_photo = !!selected_note_photo;

  if (selected_note_photo) {
    selected_note_photo.classList.remove('note-photo-selected');
  }

  if (photo_resize_handle) {
    photo_resize_handle.remove();
    photo_resize_handle = null;
  }

  selected_note_photo = null;
  photo_move_img = null;
  photo_resize_state = null;

  if (had_photo && typeof on_photo_deselected === 'function') on_photo_deselected();
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

  // Using the Formatting list or the action row (−, +, ...) is how the photo
  // is changed, so those taps keep it selected.
  if (event.target.closest('#formatToolbarSingle, #noteActionLine, #photoMsgOverlay')) {
    return;
  }

  clear_photo_selection();
}


// ─── § PHOTO POSITION — keep handle aligned during scrolling/resizing ───

function handle_photo_position_change() {
  position_photo_resize_handle();
}


// ─── § PHOTO SAVE — use the engine's existing note save system ──────────

function finish_photo_insert(skipped) {

  save_editor_selection();

  // The image itself is already inside #note-textarea.
  // auto_save_current_note() therefore saves the Base64 image as part
  // of the normal note HTML.
  auto_save_current_note();

  ['photoFileInput', 'photoCameraInput', 'photoFilesInput'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });

  if (skipped > 0 && typeof fmt_notice === 'function') {
    fmt_notice(skipped === 1 ? 'That file is not a picture, so it was skipped.'
                             : skipped + ' files were not pictures and were skipped.');
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

// ─── § PHOTO MOVE — Image > Size & Position > Move ──────────────────────
// Choose Move, then tap in the note where the image should go.

let photo_move_img = null;

function start_photo_move(img) {
  if (!img) {
    photo_move_img = null;
    show_photo_message('First tap the image you want to move until it has the blue border. Then choose Move, and tap in the note where you want the image to go.', 'Select the image first');
    return;
  }
  photo_move_img = img;
  show_photo_message('Tap in the note where you want the image moved to. The image will be placed at that spot.', 'Move image');
}
window.start_photo_move = start_photo_move;

function caret_range_at(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset); r.collapse(true);
    return r;
  }
  return null;
}

function handle_photo_move_click(event) {
  if (!photo_move_img) return;
  const editor = document.getElementById('note-textarea');
  const img = photo_move_img;
  event.preventDefault();
  event.stopPropagation();

  if (event.target.closest('.note-photo') === img) { photo_move_img = null; return; }   // tapped itself: cancel

  let range = caret_range_at(event.clientX, event.clientY);
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  // Never drop it inside itself.
  if (img.contains(range.commonAncestorContainer)) { photo_move_img = null; return; }

  // The blank line that followed the image goes with it.
  const next = img.nextElementSibling;
  const lone_spacer = next && next.tagName === 'DIV' && next.children.length === 1 && next.firstElementChild.tagName === 'BR' && !next.textContent;
  if (lone_spacer) next.remove();
  img.remove();

  range.insertNode(img);
  const spacer = document.createElement('div');
  spacer.appendChild(document.createElement('br'));
  img.parentNode.insertBefore(spacer, img.nextSibling);

  photo_move_img = null;
  select_note_photo(img);
  if (typeof keyboard_off === 'function') keyboard_off(true);
  if (typeof auto_save_current_note === 'function') auto_save_current_note();
}

document.addEventListener('DOMContentLoaded', function () {
  const editor = document.getElementById('note-textarea');
  if (editor) editor.addEventListener('click', handle_photo_move_click, true);
});
