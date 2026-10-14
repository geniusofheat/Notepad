// ═══════════════════════════════════════════════════════════════════════
// NOTEPAD FONTS — Google Fonts for Font > Family
// Keeps the font catalog and font loading out of the main note engine.
//
//  • The Font > Family list has one group per Google Fonts style:
//    Display, Handwriting, Monospace, Sans Serif, Serif (+ System fonts).
//  • The full catalog (about 1,700 families) is downloaded once from the
//    Fontsource API (a free public mirror of Google Fonts), then kept on the
//    phone. Until then — or if the phone is offline — a built-in list of
//    popular families is used.
//  • A font is only downloaded from Google when it is chosen, or when a
//    note that uses it is opened.
// ═══════════════════════════════════════════════════════════════════════

const FONT_CATALOG_URL = 'https://api.fontsource.org/v1/fonts';
const FONT_CATALOG_KEY = 'notepad_font_catalog_v1';
const FONT_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Google Fonts style name -> label shown in the list (alphabetical)
const FONT_STYLES = [
  ['display', 'Display'],
  ['handwriting', 'Handwriting'],
  ['monospace', 'Monospace'],
  ['sans-serif', 'Sans Serif'],
  ['serif', 'Serif']
];

// Already loaded by index.html, so never requested twice.
const FONTS_PRELOADED = ['Crimson Pro', 'Playfair Display', 'Space Mono'];

// Names that are not Google families.
const FONTS_GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];

// Built-in starter catalog (used until the full one is downloaded).
const FONTS_BUILT_IN = {
  'display': 'Abril Fatface|Alfa Slab One|Anton|Atomic Age|Bangers|Bebas Neue|Bigshot One|Black Ops One|Bowlby One|Bungee|Bungee Inline|Bungee Shade|Carter One|Chango|Chelsea Market|Chonburi|Cinzel Decorative|Codystar|Comfortaa|Creepster|Eater|Elsie|Emilys Candy|Fascinate|Faster One|Federo|Fjalla One|Flavors|Fontdiner Swanky|Fredoka|Fugaz One|Gorditas|Gravitas One|Griffy|Kavoon|Lemon|Lilita One|Limelight|Lobster|Luckiest Guy|Megrim|Metal Mania|Modak|Monoton|New Rocker|Nosifer|Oleo Script|Orbitron|Original Surfer|Passion One|Pirata One|Playball|Poller One|Press Start 2P|Racing Sans One|Rammetto One|Ranchers|Righteous|Rubik Mono One|Russo One|Rye|Sancreek|Shrikhand|Sigmar One|Smokum|Spicy Rice|Staatliches|Special Elite|Titan One|Ultra|UnifrakturMaguntia|Unica One|Vast Shadow|Wallpoet|Yeseva One',
  'handwriting': 'Alex Brush|Allura|Amatic SC|Architects Daughter|Arizonia|Bad Script|Bilbo Swash Caps|Caveat|Caveat Brush|Cedarville Cursive|Charm|Charmonman|Condiment|Cookie|Courgette|Damion|Dancing Script|Delicious Handrawn|Euphoria Script|Gloria Hallelujah|Gochi Hand|Great Vibes|Handlee|Herr Von Muellerhoff|Homemade Apple|Indie Flower|Italianno|Just Another Hand|Kalam|Kaushan Script|La Belle Aurore|League Script|Lobster Two|Mansalva|Marck Script|Meddon|Merienda|Mr Dafoe|Nanum Pen Script|Neucha|Nothing You Could Do|Oooh Baby|Over the Rainbow|Pacifico|Pangolin|Parisienne|Patrick Hand|Permanent Marker|Pinyon Script|Rancho|Reenie Beanie|Rock Salt|Sacramento|Satisfy|Schoolbell|Sedgwick Ave|Shadows Into Light|Shadows Into Light Two|Sue Ellen Francisco|Sunshiney|Swanky and Moo Moo|Tangerine|Waiting for the Sunrise|Walter Turco|Yellowtail|Yesteryear|Zeyada',
  'monospace': 'Anonymous Pro|Azeret Mono|B612 Mono|Chivo Mono|Courier Prime|Cousine|Cutive Mono|DM Mono|Fira Code|Fira Mono|Fragment Mono|IBM Plex Mono|Inconsolata|JetBrains Mono|Kode Mono|Lekton|M PLUS 1 Code|Major Mono Display|Martian Mono|Nanum Gothic Coding|Noto Sans Mono|Nova Mono|Overpass Mono|Oxygen Mono|PT Mono|Red Hat Mono|Reddit Mono|Roboto Mono|Share Tech Mono|Sometype Mono|Source Code Pro|Space Mono|Spline Sans Mono|Syne Mono|Ubuntu Mono|VT323|Victor Mono|Xanh Mono',
  'sans-serif': 'Abel|Alata|Albert Sans|Archivo|Arimo|Asap|Assistant|Barlow|Barlow Condensed|Barlow Semi Condensed|Be Vietnam Pro|Bricolage Grotesque|Cabin|Cairo|Catamaran|Chivo|Commissioner|DM Sans|Dosis|Encode Sans|Epilogue|Exo 2|Figtree|Fira Sans|Fira Sans Condensed|Golos Text|Gothic A1|Hanken Grotesk|Heebo|Hind|Hind Siliguri|IBM Plex Sans|Inria Sans|Inter|Instrument Sans|Josefin Sans|Jost|Kanit|Karla|Lato|Lexend|Lexend Deca|Libre Franklin|M PLUS 1p|Manrope|Maven Pro|Montserrat|Mukta|Mulish|Nanum Gothic|Noto Sans|Nunito|Nunito Sans|Onest|Open Sans|Oswald|Outfit|Overpass|Oxygen|Plus Jakarta Sans|Poppins|Prompt|PT Sans|Public Sans|Questrial|Quicksand|Raleway|Readex Pro|Red Hat Display|Red Hat Text|Roboto|Rubik|Sarabun|Sen|Signika|Sora|Source Sans 3|Space Grotesk|Syne|Titillium Web|Ubuntu|Urbanist|Varela Round|Work Sans|Yanone Kaffeesatz',
  'serif': 'Abhaya Libre|Aleo|Alegreya|Alice|Alike|Amiri|Arapey|Arvo|Besley|Bitter|Bodoni Moda|Bree Serif|Brygada 1918|Cambo|Cantata One|Cardo|Castoro|Cinzel|Copse|Cormorant|Cormorant Garamond|Cormorant Infant|Crimson Pro|Crimson Text|DM Serif Display|DM Serif Text|Domine|EB Garamond|Enriqueta|Faustina|Fraunces|Frank Ruhl Libre|Gelasio|Gilda Display|Gloock|Ibarra Real Nova|Inknut Antiqua|Instrument Serif|Josefin Slab|Judson|Kameron|Libre Baskerville|Libre Bodoni|Libre Caslon Text|Literata|Lora|Lusitana|Marcellus|Martel|Mate|Merriweather|Neuton|Newsreader|Noticia Text|Noto Serif|Old Standard TT|Petrona|Piazzolla|Playfair Display|Prata|PT Serif|Quattrocento|Radley|Rasa|Roboto Serif|Roboto Slab|Rufina|Slabo 27px|Sorts Mill Goudy|Source Serif 4|Spectral|STIX Two Text|Sura|Taviraj|Tinos|Trirong|Unna|Vollkorn|Volkhov|Young Serif|Yrsa|Zilla Slab'
};

// catalog: { 'serif': [ {f:'Lora', w:[400,700]}, ... ], ... }  (sorted A-Z)
let font_catalog = null;

function font_sort(list) {
  return list.sort((a, b) => a.f.localeCompare(b.f, 'en', { sensitivity: 'base' }));
}

function font_catalog_built_in() {
  const out = {};
  FONT_STYLES.forEach(([key]) => {
    out[key] = font_sort((FONTS_BUILT_IN[key] || '').split('|').filter(Boolean).map((f) => ({ f, w: null })));
  });
  return out;
}

// Compact download format -> catalog
function font_catalog_from_entries(entries) {
  const out = {};
  FONT_STYLES.forEach(([key]) => { out[key] = []; });
  entries.forEach((e) => {
    // e = [family, style, "400,700"]
    if (!out[e[1]]) return;
    out[e[1]].push({ f: e[0], w: e[2] ? e[2].split(',').map(Number) : null });
  });
  FONT_STYLES.forEach(([key]) => font_sort(out[key]));
  return out;
}

function font_catalog_load_cached() {
  try {
    const raw = JSON.parse(localStorage.getItem(FONT_CATALOG_KEY) || 'null');
    if (raw && Array.isArray(raw.entries) && raw.entries.length > 100) {
      return { catalog: font_catalog_from_entries(raw.entries), saved: raw.saved || 0 };
    }
  } catch (err) { /* no cache */ }
  return null;
}

// Downloads the full list once (then again after a week). Failure is silent:
// the built-in list keeps working.
function font_catalog_refresh() {
  if (typeof fetch !== 'function') return;

  const cached = font_catalog_load_cached();
  if (cached && Date.now() - cached.saved < FONT_CATALOG_MAX_AGE_MS) return;

  const timer = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = setTimeout(() => { if (timer) timer.abort(); }, 20000);

  fetch(FONT_CATALOG_URL, timer ? { signal: timer.signal } : undefined)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((list) => {
      const entries = [];
      list.forEach((e) => {
        if (!e || e.type !== 'google' || !e.family) return;
        if (!FONT_STYLES.some(([key]) => key === e.category)) return;
        entries.push([e.family, e.category, (e.weights || []).join(',')]);
      });
      if (entries.length < 100) return;

      font_catalog = font_catalog_from_entries(entries);
      try {
        localStorage.setItem(FONT_CATALOG_KEY, JSON.stringify({ saved: Date.now(), entries }));
      } catch (err) { /* storage full: still usable this session */ }

      // Groups already opened are rebuilt from the full list.
      document.querySelectorAll('#fmtMenu .fmt-group[data-font-style]').forEach((group) => {
        group.removeAttribute('data-filled');
        if (group.classList.contains('open')) populate_font_group(group);
      });
    })
    .catch(() => { /* offline: keep the built-in list */ })
    .then(() => clearTimeout(timeout));
}

function font_catalog_get() {
  if (!font_catalog) {
    const cached = font_catalog_load_cached();
    font_catalog = cached ? cached.catalog : font_catalog_built_in();
  }
  return font_catalog;
}

// Fills one style group (Serif, Display, ...) the first time it is opened, so
// hundreds of items are not built until they are wanted.
function populate_font_group(group) {
  if (!group || group.getAttribute('data-filled') === '1') return;
  const key = group.getAttribute('data-font-style');
  const list = font_catalog_get()[key] || [];
  const ul = group.querySelector(':scope > .fmt-sub');
  if (!ul) return;

  const html = list.map((e) => {
    const safe = e.f.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return '<li class="fmt-item" data-act="fontname" data-ctl="Font family" data-gfont="1" data-val="' + safe +
      '" data-short="' + safe + '">' + safe + '</li>';
  }).join('');
  ul.innerHTML = html;
  group.setAttribute('data-filled', '1');
}
window.populate_font_group = populate_font_group;

// ── Loading a font from Google ──────────────────────────────────────────

const fonts_requested = new Set(FONTS_PRELOADED);

function font_weights_for(family) {
  const cat = font_catalog_get();
  for (const [key] of FONT_STYLES) {
    const hit = (cat[key] || []).find((e) => e.f === family);
    if (hit) return hit.w;
  }
  return null;
}

function load_google_font(family) {
  if (!family || fonts_requested.has(family)) return;
  if (FONTS_GENERIC.includes(family.toLowerCase())) return;
  fonts_requested.add(family);

  // Ask for every weight the family has (so Weight 100-900 works). When the
  // weights are not known yet, ask for the regular face only: a request that
  // names a weight the family lacks would fail completely.
  const weights = font_weights_for(family);
  let spec = family.trim().replace(/ /g, '+');
  if (weights && weights.length) {
    spec += ':wght@' + Array.from(new Set(weights)).sort((a, b) => a - b).join(';');
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + spec + '&display=swap';
  link.setAttribute('data-gfont', family);
  link.onerror = () => { fonts_requested.delete(family); link.remove(); };
  document.head.appendChild(link);
}
window.load_google_font = load_google_font;

// Opening a note: load every font the note uses.
function load_fonts_in_html(html) {
  if (!html) return;
  const names = new Set();
  const face = /\bface="([^"]+)"/g;
  const css = /font-family:\s*([^;"]+)/g;
  let m;
  while ((m = face.exec(html))) names.add(m[1]);
  while ((m = css.exec(html))) names.add(m[1]);

  names.forEach((raw) => {
    raw.split(',').forEach((part) => {
      const name = part.replace(/&quot;|["']/g, '').trim();
      if (name) load_google_font(name);
    });
  });
}
window.load_fonts_in_html = load_fonts_in_html;

document.addEventListener('DOMContentLoaded', () => {
  font_catalog_get();
  setTimeout(font_catalog_refresh, 1500);   // after the page has settled
});
