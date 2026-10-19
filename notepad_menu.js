// notepad_menu.js — Formatting list navigation, Active view and On labels.
//
// Three levels:  Main categories (Text / Image / Insert)  >  Subcategories  >  Options.
// Back goes up one level. The list is context-aware: a selected photo shows Image,
// otherwise Text; Insert is always there.
//
// Active button ON  : the list opens on "Active formatting" — only the formatting that is
//                     on for the selected text (or the caret), each with an On label.
//                     Tapping a row turns that formatting off for the selection.
// Active button OFF : the normal list. Choices apply to newly typed text.
//
// Everything here sits on top of the engine's existing handlers (run_fmt_item etc.).

(function () {
  'use strict';

  const NEUTRAL_VALUES = ['', 'none', 'normal', '0', '0px', '0%', 'transparent', 'baseline', 'auto', 'initial', 'start'];

  function menu_el() { return document.getElementById('fmtMenu'); }

  // ── Navigation ────────────────────────────────────────────────────────────

  function current_cat(m) { return m.querySelector(':scope > .fmt-cat.open'); }
  function current_sub(cat) { return cat ? cat.querySelector(':scope > .fmt-sub > .fmt-subcat.open') : null; }

  // The words of a head or option, without the On label or the current value.
  function own_text(el) {
    let out = '';
    el.childNodes.forEach((n) => { if (n.nodeType === 3) out += n.nodeValue; });
    return out.trim();
  }

  function head_text(li) {
    const h = li && li.querySelector(':scope > .fmt-head');
    return h ? own_text(h) : '';
  }

  // The Formatting list's title is always a main category (Text, Image or Insert):
  // the one being browsed, or the one that fits what is selected. Option names go in
  // the action row, never here.
  let last_cat_name = null;
  let browsing = false;      // the user has navigated since the list opened: show the category they are in
  function ctx_name() { return (typeof selected_photo === 'function' && selected_photo()) ? 'Image' : 'Text'; }
  // The title when nothing has been chosen yet (a fresh note): None, or Image while a photo is selected.
  function idle_name() { return (typeof selected_photo === 'function' && selected_photo()) ? 'Image' : 'None'; }

  // The list the last chosen option belongs to (Resize for 50%, Weight for Bold, ...).
  function value_item() {
    const item = (typeof active_fmt_item !== 'undefined') ? active_fmt_item : null;
    if (!item || !document.contains(item) || !item.closest('#fmtMenu')) return null;
    if (typeof photo_label_active !== 'undefined' && photo_label_active && selected_photo()) return null;
    const cat = item.closest('.fmt-cat');
    if (!cat || cat.dataset.cat !== ctx_name()) return null;
    return item;
  }
  // The title the select list shows for a pressed title in the pop-up list: the CSS-style name.
  // A list inside Font reads "Font Size", "Font Style", "Font Family" ...; a title with no list
  // above it (Font, Appearance, Text) is just its own name.
  const TITLE_PREFIX = { Font: 'Font' };
  function title_of(li) {
    if (!li) return '';
    const own = head_text(li);
    if (li.classList.contains('fmt-cat') || li.classList.contains('fmt-subcat')) return own;
    let list = li;                                     // Display, Serif ... belong to Family
    while (list.parentElement && list.parentElement.closest('li') && !list.parentElement.closest('li').classList.contains('fmt-subcat')) list = list.parentElement.closest('li');
    const sub = list.parentElement && list.parentElement.closest('li.fmt-subcat');
    const pre = sub ? (TITLE_PREFIX[head_text(sub)] || '') : '';
    const name = head_text(list);
    return pre && name.toLowerCase().indexOf(pre.toLowerCase()) !== 0 ? pre + ' ' + name : name;
  }
  function value_list_of(item) {
    let li = item.parentElement.closest('li');
    if (li && li.hasAttribute('data-font-style')) li = li.parentElement.closest('li');   // Serif, Display ... -> Family
    return li;
  }
  function update_label() {
    const l = document.getElementById('fmtCategoryLabel');
    if (!l) return;
    const item = browsing ? null : value_item();
    const li = item && value_list_of(item);
    l.textContent = (li && title_of(li)) || last_cat_name || idle_name();

    // Active list open and the highlighted word has no formatting: say so ("None" if it does not fit).
    const mm = menu_el();
    if (mm && mm.classList.contains('view-active')) {
      if (active_entries.length === 0) {
        l.textContent = 'No formatting';
        if (l.scrollWidth > l.clientWidth + 1) l.textContent = 'None';
      } else {
        l.textContent = active_entries.length === 1 ? (active_entries[0].full || active_entries[0].title) : 'Active';
      }
    }
  }
  window.fmt_update_label = function (reset) {
    if (reset) last_cat_name = null;
    update_label();
  };

  // The open value list inside a subcategory (Resize inside Size & Position), if any.
  function sub_of(cat, sub) { return sub; }
  function deepest_open_group(sub) {
    if (!sub) return null;
    const open = sub.querySelectorAll('.fmt-group.open');
    return open.length ? open[open.length - 1] : null;
  }

  function nav_update() {
    const m = menu_el();
    if (!m) return;
    const cat = current_cat(m);
    const sub = current_sub(cat);
    const level = cat ? (sub ? 2 : 1) : 0;

    ['nav-0', 'nav-1', 'nav-2'].forEach((c) => m.classList.remove(c));
    m.classList.add('nav-' + level);
    m.classList.toggle('active-on', !!select_mode);

    const top = deepest_open_group(sub_of(cat, sub)) || sub || cat;
    if (top) last_cat_name = title_of(top);
    update_label();

    const back = document.getElementById('fmtBack');
    if (back) {
      if (m.classList.contains('view-active')) back.textContent = 'Back to main list';
      else if (level === 2) {
        const g = deepest_open_group(sub_of(cat, sub));
        back.textContent = g ? 'Back to ' + head_text(g.parentElement.closest('li')) : 'Back to ' + head_text(cat);
      }
      else if (level === 1) back.textContent = 'Back to main list';
      else back.textContent = '';
    }
  }

  function fmt_back() {
    const m = menu_el();
    if (!m) return;
    browsing = true;

    if (m.classList.contains('view-active')) {
      m.classList.remove('view-active');
      nav_update();
      m.scrollTop = 0;
      return;
    }

    const cat = current_cat(m);
    const sub = current_sub(cat);

    const group = deepest_open_group(sub);
    if (group) {
      group.classList.remove('open');          // one step back: from Resize to Size & Position
    } else if (sub) {
      sub.classList.remove('open');
      sub.querySelectorAll('.open').forEach((el) => el.classList.remove('open'));
    } else if (cat) {
      cat.classList.remove('open');
      cat.querySelectorAll('.open').forEach((el) => el.classList.remove('open'));
    }
    nav_update();
    m.scrollTop = 0;
  }

  // ── Reading the formatting at the selection ───────────────────────────────

  const norm_cache = {};

  // Browsers write the same CSS value several ways; this makes them comparable.
  function norm(prop, value) {
    const key = prop + '|' + value;
    if (key in norm_cache) return norm_cache[key];
    const probe = document.createElement('span');
    let out;
    try {
      probe.style[prop] = value;
      out = probe.style[prop];
    } catch (err) { out = ''; }
    if (!out) out = String(value).trim().toLowerCase();
    norm_cache[key] = out;
    return out;
  }

  function color_hex(value) {
    const probe = color_hex.ctx || (color_hex.ctx = document.createElement('canvas').getContext('2d'));
    if (!probe) return String(value).toLowerCase();
    probe.fillStyle = '#010203';
    probe.fillStyle = value;
    return String(probe.fillStyle).toLowerCase();
  }

  function is_neutral(value) {
    return NEUTRAL_VALUES.indexOf(String(value).trim().toLowerCase()) !== -1;
  }

  // The element whose formatting we are reading: first text of the selection.
  function target_element() {
    const editor = get_editor();
    if (!editor) return null;

    let range = null;
    if (select_mode && select_range) range = select_range;
    else {
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && range_in_editor(sel.getRangeAt(0))) range = sel.getRangeAt(0);
      else if (typeof saved_range !== 'undefined' && saved_range && range_in_editor(saved_range)) range = saved_range;
    }
    if (!range) return editor;

    if (!range.collapsed) {
      const walker = document.createTreeWalker(range.commonAncestorContainer.nodeType === 3
        ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (!n.nodeValue.trim()) continue;
        if (!range.intersectsNode(n)) continue;
        if (n === range.endContainer && range.endOffset === 0) continue;
        if (n === range.startContainer && range.startOffset >= n.nodeValue.length) continue;
        return n.parentElement || editor;
      }
    }

    let node = range.startContainer;
    if (node.nodeType === 1) {
      node = node.childNodes[range.startOffset] || node.childNodes[range.startOffset - 1] || node;
      while (node && node.nodeType === 1 && node.lastChild && node === range.startContainer) node = node.lastChild;
    }
    const el = node.nodeType === 3 ? node.parentElement : node;
    return el && editor.contains(el) ? el : editor;
  }

  function read_text_state() {
    const editor = get_editor();
    const el = target_element();
    if (!editor || !el) return null;
    const cs = getComputedStyle(el);
    const base = getComputedStyle(editor);
    const block = el.closest(BLOCK_SELECTOR) && editor.contains(el.closest(BLOCK_SELECTOR)) ? el.closest(BLOCK_SELECTOR) : editor;

    const inline = (prop, block_only) => {
      let n = el;
      while (n && n !== editor.parentElement) {
        if (n === editor) break;
        if (n.style && n.style[prop] && (!block_only || n.matches(BLOCK_SELECTOR))) return n.style[prop];
        n = n.parentElement;
      }
      if (editor.style && editor.style[prop] && block_only) return editor.style[prop];
      return '';
    };
    const cmd = (name) => { try { return document.queryCommandState(name); } catch (err) { return false; } };
    return { el, cs, base, block, inline, cmd };
  }

  // One reader per kind of option: returns { value, shown, off } or null when it is off.
  // `item` is any option of the group (it says which property the group controls).
  function probe_text(item, st) {
    const d = item.dataset;
    const act = d.act;
    const cmdname = d.cmd;

    if (cmdname) {
      switch (cmdname) {
        case 'bold': {
          const w = parseInt(st.cs.fontWeight, 10) || 400;
          return w >= 600 ? { value: 'bold', shown: String(w), off: () => apply_span_style({ fontWeight: '400' }) } : null;
        }
        case 'italic':
          return st.cs.fontStyle === 'italic' || st.cmd('italic')
            ? { value: 'italic', shown: '', off: () => { if (st.cmd('italic')) document.execCommand('italic'); else apply_span_style({ fontStyle: 'normal' }); } } : null;
        case 'underline':
        case 'strikeThrough':
        case 'superscript':
        case 'subscript':
          return st.cmd(cmdname) ? { value: cmdname, shown: '', off: () => document.execCommand(cmdname) } : null;
        default:
          return null;
      }
    }

    switch (act) {
      case 'fontpx': {
        const px = Math.round(parseFloat(st.cs.fontSize));
        const base = Math.round(parseFloat(st.base.fontSize));
        if (!px || px === base) return null;
        return { value: String(px), shown: px + ' px', off: () => apply_span_style({ fontSize: st.base.fontSize }) };
      }
      case 'fontname': {
        const first = (v) => String(v).split(',')[0].replace(/["']/g, '').trim().toLowerCase();
        const cur = first(st.cs.fontFamily);
        if (!cur || cur === first(st.base.fontFamily)) return null;
        return { value: cur, shown: st.cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
                 off: () => apply_span_style({ fontFamily: st.base.fontFamily }) };
      }
      case 'color': {
        const cur = color_hex(st.cs.color);
        if (cur === color_hex(st.base.color)) return null;
        return { value: cur, shown: '', off: () => apply_span_style({ color: st.base.color }) };
      }
      case 'hilite': {
        const raw = st.inline('backgroundColor');
        if (!raw || is_neutral(raw) || raw === 'rgba(0, 0, 0, 0)') return null;
        return { value: color_hex(raw), shown: '', off: () => apply_span_style({ backgroundColor: 'transparent' }) };
      }
      case 'align': {
        const a = st.cs.textAlign;
        if (!a || a === 'left' || a === 'start') return null;
        return { value: a, shown: a, off: () => document.execCommand('justifyLeft') };
      }
      case 'indent-set': {
        const v = st.inline('textIndent', true);
        if (!v || parseFloat(v) === 0) return null;
        return { value: String(parseFloat(v)), shown: parseFloat(v) + ' px', off: () => apply_indent_set(0) };
      }
      case 'linespace': {
        const v = st.inline('lineHeight', true);
        if (!v) return null;
        return { value: v, shown: v, off: () => apply_block_style('lineHeight', '') };
      }
      case 'list': {
        const list = st.el.closest('ul, ol');
        if (!list || !get_editor().contains(list)) return null;
        const style = list.style.listStyleType || (list.tagName === 'UL' ? 'disc' : 'decimal');
        return { value: list.tagName.toLowerCase() + ':' + style, shown: style, off: () => remove_list(), list: true };
      }
      case 'list-pos': {
        const list = st.el.closest('ul, ol');
        if (!list || !list.style.listStylePosition) return null;
        return { value: list.style.listStylePosition, shown: list.style.listStylePosition,
                 off: () => apply_list_position('outside') };
      }
      case 'css': {
        const prop = d.prop;
        const block = d.scope === 'block';
        let raw = st.inline(prop, block);
        if (!raw) return null;
        if (prop === 'textDecorationLine') {
          if (!st.cmd('underline') && !st.cmd('strikeThrough') && raw.indexOf('none') !== -1) return null;
        }
        if (prop === 'webkitTextStroke') {
          if (parseFloat(raw) === 0 || /^0px/.test(raw)) return null;
        } else if (is_neutral(raw) && !/^\d/.test(raw)) {
          return null;
        } else if (/^-?0(px|%|em)?$/.test(raw.trim()) && prop !== 'fontWeight') {
          return null;
        }
        if (prop === 'fontWeight' && parseInt(raw, 10) === 400) return null;
        const neutral = CSS_NEUTRAL[prop];
        return {
          value: norm(prop, raw), shown: raw, raw,
          off: block
            ? () => apply_block_style(prop, '')
            : () => apply_span_style({ [prop]: neutral !== undefined ? neutral : 'initial' })
        };
      }
      default:
        return null;
    }
  }

  const CSS_NEUTRAL = {
    textShadow: 'none', webkitTextStroke: '0px currentColor', letterSpacing: 'normal', wordSpacing: 'normal',
    textTransform: 'none', fontVariantCaps: 'normal', fontKerning: 'auto', fontStyle: 'normal', fontWeight: '400',
    textDecorationLine: 'none', verticalAlign: 'baseline'
  };

  // ── Reading the formatting of a selected photo ────────────────────────────

  function photo_fn_value(img, prop, name) {
    const re = new RegExp('(?:^|\\s)' + name + '\\(([^)]*)\\)');
    const m = re.exec(img.style[prop] || '');
    return m ? m[1] : null;
  }

  function probe_photo(item, img) {
    const d = item.dataset;
    const fn = d.fn;
    const prop = d.prop;
    const style = img.style;

    if (fn) {
      const [target, name] = fn.split(':');
      const v = photo_fn_value(img, target, name);
      if (v === null) return null;
      return { value: v, shown: v, off: () => photo_function_set(img, target, name, null) };
    }
    if (prop === 'width') return null;      // a photo always has a size; nothing to turn off
    if (prop === 'height') {
      if (!style.height || style.height === 'auto') return null;
      return { value: style.height, shown: style.height, off: () => { img.style.height = 'auto'; } };
    }
    if (prop === 'align') {
      let side = null;
      if (style.float === 'left') side = 'wrap-left';
      else if (style.float === 'right') side = 'wrap-right';
      else if (style.marginLeft === 'auto' && style.marginRight === 'auto') side = 'center';
      else if (style.marginLeft === 'auto') side = 'right';
      else if (style.marginRight === 'auto' && style.marginLeft) side = 'left';
      if (!side) return null;
      return { value: side, shown: side, off: () => { ['float', 'marginLeft', 'marginRight'].forEach((k) => { img.style[k] = ''; }); } };
    }
    if (prop === 'flip') {
      const x = photo_fn_value(img, 'transform', 'scaleX');
      const y = photo_fn_value(img, 'transform', 'scaleY');
      const side = x === '-1' ? 'h' : (y === '-1' ? 'v' : null);
      if (!side) return null;
      return { value: side, shown: side === 'h' ? 'horizontal' : 'vertical',
               off: () => { photo_function_set(img, 'transform', 'scaleX', null); photo_function_set(img, 'transform', 'scaleY', null); } };
    }
    if (prop) {
      const raw = style[prop];
      if (!raw || is_neutral(raw) || /^0(px|%)?$/.test(raw)) return null;
      return { value: norm(prop, raw), shown: raw, raw, off: () => { img.style[prop] = ''; } };
    }
    return null;
  }

  // ── Walking the menu: On labels and the Active list ───────────────────────

  // Does this option (one row of a group) describe the value the probe found?
  function value_matches(item, probe) {
    const d = item.dataset;
    const v = String(d.val === undefined ? '' : d.val);

    if (d.cmd) return true;                       // a toggle: it has its own probe
    switch (d.act) {
      case 'fontpx':     return probe.value === v;
      case 'fontname':   return probe.value === v.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      case 'color':      return probe.value === color_hex(v);
      case 'hilite':     return v !== 'none' && probe.value === color_hex(v);
      case 'align':      return probe.value === v;
      case 'indent-set': return v !== '0' && probe.value === v;
      case 'linespace':  return parseFloat(probe.value) === parseFloat(v);
      case 'list':       return probe.value === v;
      case 'list-pos':   return probe.value === v;
      case 'css': {
        if (is_neutral(v) || (/^0(px)?$/.test(v) && d.prop !== 'fontWeight')) return false;
        return norm(d.prop, d.min !== undefined ? v + (d.unit || '') : v) === probe.value;
      }
      case 'photo': {
        if (d.fn) return parseFloat(probe.value) === parseFloat(v);
        if (d.prop === 'align' || d.prop === 'flip') return probe.value === v;
        if (d.prop === 'height') return parseFloat(probe.value) === parseFloat(v);
        if (d.prop === 'opacity') return Math.round(parseFloat(probe.value) * 100) === parseFloat(v);
        if (is_neutral(v) || v === '0') return false;
        return norm(d.prop, d.min !== undefined ? v + (d.unit || '') : v) === probe.value;
      }
      default: return false;
    }
  }

  function clear_labels(root) {
    root.querySelectorAll('.fmt-on, .fmt-curval').forEach((el) => el.remove());
    root.querySelectorAll('.has-val').forEach((el) => el.classList.remove('has-val'));
    root.querySelectorAll('.is-on').forEach((el) => el.classList.remove('is-on'));
  }

  function add_on(el, shown) {
    const tag = document.createElement('span');
    tag.className = 'fmt-on';
    tag.textContent = 'On';
    el.insertBefore(tag, el.firstChild);
    if (shown) {
      const val = document.createElement('span');
      val.className = 'fmt-curval';
      val.textContent = shown;
      el.appendChild(val);
      el.classList.add('has-val');
    }
  }

  function probe_key(item) {
    const d = item.dataset;
    return d.cmd ? 'cmd:' + d.cmd : (d.act || '') + '|' + (d.prop || '') + '|' + (d.fn || '') + '|' + (d.scope || '');
  }

  // Goes through one main category: puts On labels on the matching options and on
  // their option heads, and returns the list of On entries for the Active view.
  function scan(cat, mode) {
    const st = mode === 'image' ? null : read_text_state();
    const img = mode === 'image' ? selected_photo() : null;
    if (mode === 'image' ? !img : !st) return [];

    const cache = {};
    const probe = (item) => {
      const key = probe_key(item);
      if (!(key in cache)) cache[key] = mode === 'image' ? probe_photo(item, img) : probe_text(item, st);
      return cache[key];
    };

    const info = [];
    cat.querySelectorAll('.fmt-subcat > .fmt-sub > .fmt-group').forEach((group) => {
      const items = Array.from(group.querySelectorAll('.fmt-item')).filter((it) => it.dataset.act || it.dataset.cmd);
      const matched = [];
      let first = null;
      items.forEach((it) => {
        const p = probe(it);
        if (!p) return;
        if (!first) first = { item: it, p };
        if (value_matches(it, p)) matched.push(it);
      });
      if (first) info.push({ group, matched, first, key: probe_key(first.item) });
    });

    // A value that is not in the list (letter spacing 3.5 px) shows On on the first option of its kind.
    const owned = {};
    info.forEach((g) => { if (g.matched.length) owned[g.key] = true; });
    info.forEach((g) => {
      if (!g.matched.length && !owned[g.key]) { owned[g.key] = true; g.loose = true; }
    });

    const entries = [];
    info.forEach((g) => {
      if (!g.matched.length && !g.loose) return;
      // Italic is already shown by its group head ("On Style Italic"), so the item itself gets no second On.
      g.matched.forEach((it) => { it.classList.add('is-on'); if (it.dataset.cmd !== 'italic') add_on(it, ''); });

      let shown = g.first.p.shown || '';
      if (g.matched.length) {
        const s = g.matched[0].dataset.short || '';
        if (s.indexOf(': ') !== -1) shown = s.slice(s.indexOf(': ') + 2);
        else if (!shown) shown = own_text(g.matched[0]);
      }
      if (/^(Color|Background color|Border color)$/.test(head_text(g.group)) && g.matched.length) {
        shown = own_text(g.matched[0]);
      }
      // Several options on in one list: the line only says how many; the list shows which.
      if (g.matched.length > 1) shown = g.matched.length + ' items';
      const head = g.group.querySelector(':scope > .fmt-head');
      add_on(head, shown);

      // One row per list: the list title, with what is on shown to the right (Style  Italic).
      const first_on = g.matched.length ? g.matched[0] : null;
      const off_probe = first_on ? probe(first_on) : g.first.p;
      entries.push({ title: head_text(g.group), full: title_of(g.group), shown, off: off_probe.off, mode, group: g.group });
    });
    return entries;
  }

  function active_category() {
    const m = menu_el();
    return m.querySelector(':scope > .fmt-cat[data-cat="' + (selected_photo() ? 'Image' : 'Text') + '"]');
  }

  function refresh_states() {
    const m = menu_el();
    if (!m || !m.classList.contains('open')) return [];
    clear_labels(m);
    const mode = selected_photo() ? 'image' : 'text';
    m.classList.toggle('ctx-image', mode === 'image');
    m.classList.toggle('active-on', !!select_mode);
    const cat = active_category();
    const entries = cat ? scan(cat, mode) : [];
    if (m.classList.contains('view-active')) render_active_view(entries);
    return entries;
  }

  // ── The Active list ───────────────────────────────────────────────────────

  let active_entries = [];
  let quick_open = '';      // title of the On row whose values are showing
  let quick_items = [];

  // Last row of the Active list: opens the full formatting list for the highlighted word.
  function add_choose_row(view) {
    const r = document.createElement('div');
    r.className = 'fmt-item fmt-choose-row';
    r.textContent = 'Choose formatting \u203a';
    view.appendChild(r);
  }

  // The regular list, with Active still on: whatever is chosen applies to the highlighted text.
  function show_regular_list() {
    const m = menu_el();
    if (!m) return;
    m.querySelectorAll('.open').forEach((el) => el.classList.remove('open'));
    m.classList.remove('view-active');
    browsing = false;
    last_cat_name = null;
    const cat = active_category();
    if (cat) cat.classList.add('open');
    nav_update();
    m.scrollTop = 0;
    refresh_states();
  }
  window.fmt_choose_formatting = show_regular_list;

  function render_active_view(entries) {
    const view = document.getElementById('fmtActiveView');
    if (!view) return;
    active_entries = entries;
    update_label();
    view.innerHTML = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fmt-empty-row';
      empty.textContent = 'No formatting on this word.';
      view.appendChild(empty);
      add_choose_row(view);
      return;
    }

    entries.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'fmt-item fmt-active-row';
      row.dataset.entry = String(i);
      const on = document.createElement('span');
      on.className = 'fmt-on';
      on.textContent = 'On';
      row.appendChild(on);
      row.appendChild(document.createTextNode(entry.title));
      if (entry.shown) {
        const v = document.createElement('span');
        v.className = 'fmt-curval';
        v.textContent = entry.shown;
        row.appendChild(v);
      }
      view.appendChild(row);

      // On + quick select: the row the user opened shows its list of values right under it.
      if (entry.group && entry.title === quick_open) {
        row.classList.add('quick-open');
        const box = document.createElement('div');
        box.className = 'fmt-quick-list';
        quick_items = [];
        const g = entry.group;
        if (g.hasAttribute('data-font-style') && typeof populate_font_group === 'function') populate_font_group(g);
        let list_items = Array.from(g.querySelectorAll('.fmt-item')).filter((it) => it.dataset.act || it.dataset.cmd);
        const is_on = (it) => it.classList.contains('is-on');
        const on_count = list_items.filter(is_on).length;
        if (on_count > 1) list_items = list_items.filter(is_on).concat(list_items.filter((it) => !is_on(it)));
        list_items.forEach((it) => {
          const q = document.createElement('div');
          q.className = 'fmt-item fmt-quick-item';
          q.dataset.quick = String(quick_items.length);
          if (it.classList.contains('is-on')) {
            const on = document.createElement('span');
            on.className = 'fmt-on';
            on.textContent = 'On';
            q.appendChild(on);
          }
          q.appendChild(document.createTextNode(own_text(it)));
          quick_items.push(it);
          box.appendChild(q);
        });
        view.appendChild(box);

        // The list is its own scroll box under the title. One value on (26 px): it snaps to the top,
        // right under the title; the values before it (1 to 25) sit above and show on scrolling up.
        const menu = menu_el();
        box.style.maxHeight = Math.max(120, Math.floor(menu.clientHeight * 0.7)) + 'px';
        box.style.overflowY = 'auto';
        const on_q = on_count === 1 ? Array.from(box.children).find((q) => q.querySelector(':scope > .fmt-on')) : null;
        if (on_q) {
          const spacer = document.createElement('div');
          spacer.style.height = box.clientHeight + 'px';
          box.appendChild(spacer);
          box.scrollTop = on_q.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
        }
        menu.scrollTop += row.getBoundingClientRect().top - menu.getBoundingClientRect().top;   // title stays in view
      }
    });
    add_choose_row(view);
  }

  function show_active_view(on) {
    const m = menu_el();
    if (!m) return;
    m.querySelectorAll('.open').forEach((el) => el.classList.remove('open'));
    m.classList.toggle('view-active', !!on);
    quick_open = '';
    nav_update();
    m.scrollTop = 0;
    refresh_states();
  }

  function turn_off_entry(row) {
    const entry = active_entries[parseInt(row.dataset.entry, 10)];
    if (!entry || nav.level !== 'note') return;

    lock_scroll_position();
    if (entry.mode === 'image') {
      try { entry.off(); } catch (err) { console.error(err); }
      if (typeof position_photo_resize_handle === 'function') position_photo_resize_handle();
      auto_save_current_note();
      refresh_states();
      return;
    }

    fmt_prime_selection();
    freeze_editor_selection();
    try { entry.off(); } catch (err) { console.error('Turn off failed:', entry.title, err); }
    fmt_finish(null);        // saves, keeps the selection, and refreshes the labels
  }

  // ── Hooks the engine calls ────────────────────────────────────────────────

  window.fmt_menu_opened = function () {
    const m = menu_el();
    if (!m) return;
    m.querySelectorAll('.open').forEach((el) => el.classList.remove('open'));
    m.classList.remove('view-active');
    m.classList.toggle('ctx-image', !!selected_photo());
    m.classList.toggle('active-on', !!select_mode);
    last_cat_name = null;
    browsing = false;
    if (select_mode) m.classList.add('view-active');
    else {
      // The list opens on the options for what is being worked on. After a value was
      // chosen it reopens on that same list (Resize: 10% 25% 50% ...) so another value
      // can be picked; otherwise Image for a selected image, or Text.
      const item = value_item();
      if (item) {
        for (let li = item.parentElement.closest('li'); li && li !== m; li = li.parentElement.closest('li')) {
          if (li.hasAttribute('data-font-style') && typeof populate_font_group === 'function') populate_font_group(li);
          li.classList.add('open');
        }
      } else if (selected_photo()) {
        const cat = active_category();     // a selected image opens on the Image options
        if (cat) cat.classList.add('open');
      }
      // otherwise the list opens on the main titles (Text, Insert)
    }
    nav_update();
    m.scrollTop = 0;
    refresh_states();
  };

  window.fmt_menu_closed = function () {
    const m = menu_el();
    if (!m) return;
    browsing = false;          // collapsed: the title names the list of the last chosen value
    last_cat_name = null;      // browsing a category without choosing leaves the title at None
    m.classList.remove('view-active');
    nav_update();
    update_label();
    clear_labels(m);
  };

  window.fmt_refresh_states = function () { refresh_states(); };
  window.fmt_nav_update = nav_update;

  // Active button pressed on / off.
  window.fmt_active_changed = function (on) {
    const m = menu_el();
    if (!m) return;
    if (on) {
      toggle_fmt_menu(true);          // opens on the Active list
    } else if (m.classList.contains('open')) {
      toggle_fmt_menu(false);         // Active off hides the list again
    }
  };

  window.fmt_menu_click = function (event) {
    const t = event.target;
    const m = menu_el();
    keyboard_off();                 // tapping the list never raises the keypad
    if (typeof lock_scroll_position === 'function') lock_scroll_position();   // and never moves the page

    if (m.classList.contains('view-active')) {
      const qi = t.closest('.fmt-quick-item');
      if (qi) {                       // a value picked from the quick list
        const it = quick_items[parseInt(qi.dataset.quick, 10)];
        if (it) { run_fmt_item(it); refresh_states(); }
        return;
      }
      if (t.closest('.fmt-choose-row')) { show_regular_list(); return; }
      const arow = t.closest('.fmt-active-row');
      if (arow) {                     // an On title opens / closes its quick list
        const entry = active_entries[parseInt(arow.dataset.entry, 10)];
        if (entry && entry.group) {
          quick_open = quick_open === entry.title ? '' : entry.title;
          render_active_view(active_entries);
        }
      }
      return;                         // Active list: no other navigation
    }
    if (t.closest('#fmtBack')) { fmt_back(); return; }

    if (t.closest('#fmtActiveView')) return;

    const head = t.closest('.fmt-head');
    if (head) {
      browsing = true;
      const li = head.parentElement;
      if (li.hasAttribute('data-font-style') && typeof populate_font_group === 'function') populate_font_group(li);

      if (li.classList.contains('fmt-cat') && li.classList.contains('open')) {
        const sub = current_sub(li);
        if (sub) { sub.classList.remove('open'); sub.querySelectorAll('.open').forEach((el) => el.classList.remove('open')); }
        nav_update();
        m.scrollTop = 0;
        return;
      }
      if (li.classList.contains('fmt-subcat') && li.classList.contains('open')) {
        // pressing an open title again folds its list back up to the titles
        li.classList.remove('open');
        li.querySelectorAll('.open').forEach((el) => el.classList.remove('open'));
        nav_update();
        refresh_states();
        m.scrollTop = 0;
        return;
      }

      if (li.classList.contains('fmt-cat') || li.classList.contains('fmt-subcat')) {
        Array.from(li.parentElement.children).forEach((sib) => { if (sib !== li) sib.classList.remove('open'); });
        li.classList.add('open');
        m.scrollTop = 0;
      } else {
        toggle_fmt_branch(li);
      }
      nav_update();
      refresh_states();
      return;
    }

    const item = t.closest('.fmt-item');
    if (!item) return;

    const act = item.dataset.act;
    if (act === 'insert-image') {
      close_fmt_menu();
      if (typeof trigger_photo_picker === 'function') trigger_photo_picker();
      return;
    }
    if (act === 'insert-files') {
      close_fmt_menu();
      save_editor_selection();
      if (!photo_cursor_ready()) { show_photo_message('Please place the cursor in the notepad area where you would like the photo to be placed.'); return; }
      capture_photo_insert_point();
      if (typeof open_photo_input === 'function') open_photo_input('files');
      return;
    }

    run_fmt_item(item);
    if (select_mode) show_active_view(true);   // Active on: back to the status list, now showing the new format
    else close_fmt_menu();                     // the list contracts; the action row names the chosen option
  };
})();
