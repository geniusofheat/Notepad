// css_guide_engine.js
// Builds a three-level toggle list: CSS Version → Topic Group → Property/At-Rule
// Data sources:
//   css1_lessons.js, css2_lessons.js, css3_lessons.js, css4_lessons.js
//   css_atrules.js
// No inline styles. All styling via stylesheet classes.

// ─── § 1  VERSION ORDER ──────────────────────────────────────────────────────
const version_order = ["CSS1", "CSS2", "CSS3", "CSS4"];

// ─── § 2  TOPIC ORDER ────────────────────────────────────────────────────────
const topic_order = [
  "Accessibility & UI Controls",
  "Animation",
  "At-Rules",
  "Backgrounds",
  "Borders",
  "Box Model",
  "Clipping & Shape",
  "Color",
  "Content & Counters",
  "Display & Visibility",
  "Effects & Filters",
  "Flexbox",
  "Float & Clear",
  "Fonts & Typography",
  "Grid Layout",
  "Images & Objects",
  "Lists",
  "Logical Properties",
  "Masking",
  "Multi-Column Layout",
  "Outline",
  "Positioning",
  "Scroll & Snap",
  "Selectors",
  "Tables",
  "Text",
  "Transforms",
  "Transitions",
  "3D & Perspective",
  "Miscellaneous"
];

// ─── § 2B  NAVIGATION STACK ──────────────────────────────────────────────────
const nav_stack = [];

function push_nav_state() {
  const detail_el     = document.getElementById("css-lesson-detail");
  const breadcrumb_el = document.getElementById("css-guide-breadcrumb");
  const toggle_el     = document.getElementById("css-toggle-list");

  nav_stack.push({
    is_list:         !toggle_el.classList.contains("hidden"),
    detail_html:     detail_el     ? detail_el.innerHTML     : "",
    breadcrumb_html: breadcrumb_el ? breadcrumb_el.innerHTML : ""
  });
}

// ─── § 3  TOGGLE HANDLER ─────────────────────────────────────────────────────
function toggle_item(chevron_el) {
  const trigger_el = chevron_el.parentElement;
  const parent_el  = trigger_el.parentElement;
  const list_el    = parent_el.querySelector(":scope > .topic-group-list, :scope > .topic-property-list, :scope > .property-values-list");

  if (!list_el) return;

  const is_open = !list_el.classList.contains("hidden");

  if (is_open) {
    list_el.classList.add("hidden");
    chevron_el.textContent = "▶";
  } else {
    list_el.classList.remove("hidden");
    chevron_el.textContent = "▼";
  }
}

// ─── § 4  GET VERSION DATA ───────────────────────────────────────────────────
function get_version_data(version_name) {
  if (version_name === "CSS1") return css1_lessons;
  if (version_name === "CSS2") return css2_lessons;
  if (version_name === "CSS3") return css3_lessons;
  if (version_name === "CSS4") return css4_lessons;
  return null;
}

// ─── § 5  FIND PROPERTY WITH CONTEXT ─────────────────────────────────────────
function find_property_with_context(property_name) {
  const all_versions = [css1_lessons, css2_lessons, css3_lessons, css4_lessons];

  for (var i = 0; i < all_versions.length; i++) {
    var vd = all_versions[i];
    if (!vd || !vd.topics) continue;
    for (var j = 0; j < vd.topics.length; j++) {
      var td = vd.topics[j];
      if (!td.properties) continue;
      for (var k = 0; k < td.properties.length; k++) {
        if (td.properties[k].property === property_name) {
          return { property: td.properties[k], version: vd.version, topic: td.topic };
        }
      }
    }
  }

  if (typeof css_atrules !== "undefined") {
    var atrule_sets = [
      { version: "CSS2", rules: css_atrules.css2 },
      { version: "CSS3", rules: css_atrules.css3 }
    ];
    for (var i = 0; i < atrule_sets.length; i++) {
      var av = atrule_sets[i];
      if (!av.rules) continue;
      for (var j = 0; j < av.rules.length; j++) {
        if (av.rules[j].property === property_name) {
          return { property: av.rules[j], version: av.version, topic: "At-Rules" };
        }
      }
    }
  }

  return null;
}

// ─── § 6  VERSION CLICK ──────────────────────────────────────────────────────
function on_version_click(version_name) {
  const version_obj = get_version_data(version_name);
  if (!version_obj) return;

  push_nav_state();

  const breadcrumb_el = document.getElementById("css-guide-breadcrumb");
  if (breadcrumb_el) {
    breadcrumb_el.innerHTML =
      '<span class="breadcrumb-active">CSS Guide</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + version_name + '</span>';
  }

  render_version_detail(version_obj);
}

// ─── § 7  TOPIC CLICK ────────────────────────────────────────────────────────
function on_topic_click(topic_name, version_name) {
  const version_obj = get_version_data(version_name);
  if (!version_obj) return;

  if (topic_name === "At-Rules") {
    push_nav_state();

    const breadcrumb_el = document.getElementById("css-guide-breadcrumb");
    if (breadcrumb_el) {
      breadcrumb_el.innerHTML =
        '<span class="breadcrumb-active">CSS Guide</span>' +
        '<span class="breadcrumb-sep"> › </span>' +
        '<span class="breadcrumb-active">' + version_name + '</span>' +
        '<span class="breadcrumb-sep"> › </span>' +
        '<span class="breadcrumb-active">At-Rules</span>';
    }

    render_atrules_topic(version_name);
    return;
  }

  var topic_obj = null;
  for (var i = 0; i < version_obj.topics.length; i++) {
    if (version_obj.topics[i].topic === topic_name) {
      topic_obj = version_obj.topics[i];
      break;
    }
  }

  if (!topic_obj) return;

  push_nav_state();

  const breadcrumb_el = document.getElementById("css-guide-breadcrumb");
  if (breadcrumb_el) {
    breadcrumb_el.innerHTML =
      '<span class="breadcrumb-active">CSS Guide</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + version_name + '</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + topic_name + '</span>';
  }

  render_topic_detail(topic_obj, version_name);
}

// ─── § 8  PROPERTY CLICK ─────────────────────────────────────────────────────
function on_property_click(property_name) {
  const result = find_property_with_context(property_name);
  if (!result) return;

  push_nav_state();

  const breadcrumb_el = document.getElementById("css-guide-breadcrumb");
  if (breadcrumb_el) {
    breadcrumb_el.innerHTML =
      '<span class="breadcrumb-active">CSS Guide</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + result.version + '</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + result.topic + '</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + property_name + '</span>';
  }

  render_lesson_detail(result.property);
}

// ─── § 8B  VALUE CLICK ───────────────────────────────────────────────────────
function on_value_click(value_name, property_name) {
  const result = find_property_with_context(property_name);
  if (!result) return;

  push_nav_state();

  const breadcrumb_el = document.getElementById("css-guide-breadcrumb");
  if (breadcrumb_el) {
    breadcrumb_el.innerHTML =
      '<span class="breadcrumb-active">CSS Guide</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + result.version + '</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + result.topic + '</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + property_name + '</span>' +
      '<span class="breadcrumb-sep"> › </span>' +
      '<span class="breadcrumb-active">' + value_name + '</span>';
  }

  render_value_detail(value_name, result.property);
}

// ─── § X  TOGGLE EXPAND AND CONTRACT ─────────────────────────────────────────
function toggle_expand(clicked_el) {
  const card       = clicked_el.closest(".card");
  const all_bodies = card.querySelectorAll(".expand-body");
  const all_titles = card.querySelectorAll(".expand-title");
  const this_body  = clicked_el.nextElementSibling;
  const is_open    = !this_body.classList.contains("hidden");

  all_bodies.forEach(function(b) { b.classList.add("hidden"); });
  all_titles.forEach(function(t) { t.classList.remove("expanded"); });

  const breadcrumb_el = document.getElementById("css-guide-breadcrumb");
  if (breadcrumb_el) {
    const existing_sep = breadcrumb_el.querySelector(".breadcrumb-value-sep");
    const existing_val = breadcrumb_el.querySelector(".breadcrumb-value");
    if (existing_sep) existing_sep.remove();
    if (existing_val) existing_val.remove();
  }

  if (!is_open) {
    this_body.classList.remove("hidden");
    clicked_el.classList.add("expanded");

    if (breadcrumb_el) {
      breadcrumb_el.innerHTML +=
        '<span class="breadcrumb-sep breadcrumb-value-sep"> › </span>' +
        '<span class="breadcrumb-active breadcrumb-value">' + clicked_el.textContent + '</span>';
    }
  }
}

// ─── § 9  RENDER VERSION DETAIL ──────────────────────────────────────────────
function render_version_detail(version_obj) {
  const detail_el = document.getElementById("css-lesson-detail");
  if (!detail_el) return;

  let topics_html = "";
  if (version_obj.topics && version_obj.topics.length) {
    topics_html = '<ul class="topic-property-list">';
    version_obj.topics.forEach(function(topic_obj) {
      const safe_topic   = topic_obj.topic.replace(/'/g, "\\'");
      const safe_version = version_obj.version.replace(/'/g, "\\'");
      topics_html += '<li class="property-item" onclick="on_topic_click(\'' + safe_topic + '\', \'' + safe_version + '\')">';
      topics_html +=   topic_obj.topic;
      topics_html += '</li>';
    });
    if (typeof css_atrules !== "undefined") {
      var key = version_obj.version === "CSS2" ? "css2" : version_obj.version === "CSS3" ? "css3" : null;
      if (key && css_atrules[key] && css_atrules[key].length) {
        const safe_version = version_obj.version.replace(/'/g, "\\'");
        topics_html += '<li class="property-item" onclick="on_topic_click(\'At-Rules\', \'' + safe_version + '\')">';
        topics_html +=   'At-Rules';
        topics_html += '</li>';
      }
    }
    topics_html += '</ul>';
  }

  detail_el.innerHTML =
    '<div class="card">' +
      '<h3>' + version_obj.version + '</h3>' +
      '<h4>Released : ' + version_obj.released + '</h4>' +
      '<hr>' +
      '<ol class="expand-list">' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">Lesson Topics :</div>' +
          '<div class="expand-body">' + topics_html + '</div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">Definition :</div>' +
          '<div class="expand-body hidden"><p>' + (version_obj.definition || '') + '</p></div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">What It Introduced :</div>' +
          '<div class="expand-body hidden"><p>' + (version_obj.what_it_introduced || '') + '</p></div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">Note :</div>' +
          '<div class="expand-body hidden"><p>' + (version_obj.note || '') + '</p></div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">Tip :</div>' +
          '<div class="expand-body hidden"><p>' + (version_obj.tip || '') + '</p></div>' +
        '</li>' +
      '</ol>' +
    '</div>';

  document.getElementById("css-toggle-list").classList.add("hidden");
  document.querySelector("#css-back-btn button").textContent = "← Back to CSS Versions";
  document.getElementById("css-back-btn").classList.remove("hidden");
  detail_el.classList.remove("hidden");
}

// ─── § 10  RENDER TOPIC DETAIL ───────────────────────────────────────────────
function render_topic_detail(topic_obj, version_name) {
  const detail_el = document.getElementById("css-lesson-detail");
  if (!detail_el) return;

  let properties_html = "";
  if (topic_obj.properties && topic_obj.properties.length) {
    properties_html = '<ul class="topic-property-list">';
    topic_obj.properties.forEach(function(prop_obj) {
      const safe_property = prop_obj.property.replace(/'/g, "\\'");
      properties_html += '<li class="property-item" onclick="on_property_click(\'' + safe_property + '\')">';
      properties_html +=   prop_obj.property;
      properties_html += '</li>';
    });
    properties_html += '</ul>';
  }

  detail_el.innerHTML =
    '<div class="card">' +
      '<h3>Lesson Topic : ' + topic_obj.topic + '</h3>' +
      '<ol class="expand-list">' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">Properties :</div>' +
          '<div class="expand-body">' + properties_html + '</div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">Definition :</div>' +
          '<div class="expand-body hidden"><p>' + (topic_obj.definition || '') + '</p></div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">What It Introduced :</div>' +
          '<div class="expand-body hidden"><p>' + (topic_obj.what_it_introduced || '') + '</p></div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">Note :</div>' +
          '<div class="expand-body hidden"><p>' + (topic_obj.note || '') + '</p></div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">Tip :</div>' +
          '<div class="expand-body hidden"><p>' + (topic_obj.tip || '') + '</p></div>' +
        '</li>' +
      '</ol>' +
    '</div>';

  document.getElementById("css-toggle-list").classList.add("hidden");
  document.querySelector("#css-back-btn button").textContent = "← Back to  Lesson Topics :";
  document.getElementById("css-back-btn").classList.remove("hidden");
  detail_el.classList.remove("hidden");
}

// ─── § 10B  RENDER AT-RULES TOPIC ────────────────────────────────────────────
function render_atrules_topic(version_name) {
  const detail_el = document.getElementById("css-lesson-detail");
  if (!detail_el) return;

  const key = version_name === "CSS2" ? "css2" : version_name === "CSS3" ? "css3" : null;
  const rules = (key && typeof css_atrules !== "undefined") ? css_atrules[key] : [];

  let rules_html = "";
  if (rules && rules.length) {
    rules_html = '<ul class="topic-property-list">';
    rules.forEach(function(rule_obj) {
      const safe_property = rule_obj.property.replace(/'/g, "\\'");
      rules_html += '<li class="property-item" onclick="on_property_click(\'' + safe_property + '\')">';
      rules_html +=   rule_obj.property;
      rules_html += '</li>';
    });
    rules_html += '</ul>';
  }

  detail_el.innerHTML =
    '<div class="card">' +
      '<h3>At-Rules</h3>' +
      '<ol class="expand-list">' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">At-Rules in ' + version_name + ' :</div>' +
          '<div class="expand-body">' + rules_html + '</div>' +
        '</li>' +
        '<li>' +
          '<div class="expand-title" onclick="toggle_expand(this)">What Is an At-Rule :</div>' +
          '<div class="expand-body hidden"><p>At-rules are special CSS instructions that control how CSS behaves rather than styling elements directly. They begin with the @ symbol and serve purposes such as importing files, defining animations, setting up fonts, and applying conditional styles.</p></div>' +
        '</li>' +
      '</ol>' +
    '</div>';

  document.getElementById("css-toggle-list").classList.add("hidden");
  document.querySelector("#css-back-btn button").textContent = "← Back to  CSS Versions : :";
  document.getElementById("css-back-btn").classList.remove("hidden");
  detail_el.classList.remove("hidden");
}

// ─── § 11  RENDER PROPERTY DETAIL ────────────────────────────────────────────
function render_lesson_detail(lesson) {
  const detail_el = document.getElementById("css-lesson-detail");
  if (!detail_el) return;

  const is_atrule = lesson.property && lesson.property.charAt(0) === "@";
  let atrule_notice_html = "";
  if (is_atrule) {
    atrule_notice_html =
      '<div class="atrule-notice">' +
        '<p><strong>This is a CSS at-rule, not a style property.</strong> At-rules are special instructions that control how CSS behaves. They begin with the @ symbol and serve purposes such as defining animations, loading fonts, importing files, and applying conditional styles.</p>' +
      '</div>';
  }

  let reference_html = "";
  if (lesson.w3schools_url) {
    reference_html =
      '<h4>Reference :</h4>' +
      '<p><a href="' + lesson.w3schools_url + '" target="_blank">W3Schools Link</a></p>';
  }

  let info_html = "";
  if (!is_atrule) {
    let applies_html = "";
    if (lesson.applies_to && lesson.applies_to.length) {
      applies_html = '<li><strong>Applies to :</strong> ' + lesson.applies_to.join(", ") + '</li>';
    }
    info_html =
      '<h4>Property Info :</h4><ul>' +
        (lesson.inherited  !== undefined ? '<li><strong>Inherited :</strong> '  + lesson.inherited  + '</li>' : '') +
        (lesson.animatable !== undefined ? '<li><strong>Animatable :</strong> ' + lesson.animatable + '</li>' : '') +
        applies_html +
      '</ul>';
  } else {
    let applies_html = "";
    if (lesson.applies_to && lesson.applies_to.length) {
      applies_html = '<h4>Applies To :</h4><p>' + lesson.applies_to.join(", ") + '</p>';
    }
    info_html = applies_html;
  }

  let tip_html = "";
  if (lesson.tip) {
    tip_html = '<h4>Tip :</h4><p>' + lesson.tip + '</p>';
  }

  let note_html = "";
  if (lesson.note) {
    note_html = '<h4>Note :</h4><p>' + lesson.note + '</p>';
  }

  let values_html = "";
  if (lesson.values && lesson.values.length) {
    values_html = '<h4>Values :</h4><ol class="expand-list">';
    lesson.values.forEach(function(v) {
      values_html +=
        '<li class="value-item">' +
          '<div class="expand-title" onclick="toggle_expand(this)">' + v.value + '</div>' +
          '<div class="expand-body hidden">' +
            '<p>' + (v.description || '') + '</p>' +
            (v.syntax_example ? '<pre class="code-block">' + v.syntax_example + '</pre>' : '') +
          '</div>' +
        '</li>';
    });
    values_html += '</ol>';
  }

  let examples_html = "";
  if (lesson.examples && lesson.examples.length) {
    examples_html = '<h4>Examples :</h4><ol>';
    lesson.examples.forEach(function(ex) {
      examples_html +=
        '<li>' +
          '<p>' + ex.label + '</p>' +
          '<pre class="code-block">' + ex.code + '</pre>' +
        '</li>';
    });
    examples_html += '</ol>';
  }

  let default_html = "";
  if (lesson.default_value && lesson.default_value !== "n/a") {
    const dv = lesson.default_value;
    default_html =
      '<h4>Default Value :</h4>' +
      '<p>' + dv.charAt(0).toUpperCase() + dv.slice(1) + '</p>';
  }

  let syntax_html = "";
  if (lesson.syntax) {
    syntax_html =
      '<h4>Syntax :</h4>' +
      '<pre class="code-block">' + lesson.syntax + '</pre>';
  }

  const title_label = is_atrule ? "At-Rule : " : "Property Name : ";

  detail_el.innerHTML =
    '<div class="card">' +
      '<h3>' + title_label + lesson.property + '</h3>' +
      '<hr>' +
      atrule_notice_html +
      '<p>' + (lesson.definition || '') + '</p>' +
      values_html +
      info_html +
      default_html +
      syntax_html +
      note_html +
      tip_html +
      examples_html +
      reference_html +
    '</div>';

  document.getElementById("css-toggle-list").classList.add("hidden");
  document.querySelector("#css-back-btn button").textContent = "← Back to Properties :";
  document.getElementById("css-back-btn").classList.remove("hidden");
  detail_el.classList.remove("hidden");
}

// ─── § 11B  RENDER VALUE DETAIL ──────────────────────────────────────────────
function render_value_detail(value_name, lesson) {
  const detail_el = document.getElementById("css-lesson-detail");
  if (!detail_el) return;

  let applies_html = "";
  if (lesson.applies_to && lesson.applies_to.length) {
    applies_html = '<h4>Applies To :</h4><p>' + lesson.applies_to.join(", ") + '</p>';
  }

  let tip_html = "";
  if (lesson.tip) {
    tip_html = '<h4>Tip :</h4><p>' + lesson.tip + '</p>';
  }

  let note_html = "";
  if (lesson.note) {
    note_html = '<h4>Note :</h4><p>' + lesson.note + '</p>';
  }

  let examples_html = "";
  if (lesson.examples && lesson.examples.length) {
    examples_html = '<h4>Examples :</h4><ol>';
    lesson.examples.forEach(function(ex) {
      examples_html +=
        '<li>' +
          '<p>' + ex.label + '</p>' +
          '<pre class="code-block">' + ex.code + '</pre>' +
        '</li>';
    });
    examples_html += '</ol>';
  }

  let reference_html = "";
  if (lesson.w3schools_url) {
    reference_html =
      '<h4>Reference :</h4>' +
      '<p><a href="' + lesson.w3schools_url + '" target="_blank">W3Schools Link</a></p>';
  }

  let default_html = "";
  if (lesson.default_value && lesson.default_value !== "n/a") {
    const dv = lesson.default_value;
    default_html =
      '<h4>Default Value :</h4>' +
      '<p>' + dv.charAt(0).toUpperCase() + dv.slice(1) + '</p>';
  }

  detail_el.innerHTML =
    '<div class="card">' +
      '<h3>Value : ' + value_name + '</h3>' +
      '<hr>' +
      '<h4>Definition :</h4>' +
      '<p>' + (lesson.definition || '') + '</p>' +
      default_html +
      '<h4>Syntax :</h4>' +
      '<pre class="code-block">' + (lesson.syntax || '') + '</pre>' +
      applies_html +
      tip_html +
      note_html +
      examples_html +
      reference_html +
    '</div>';

  document.getElementById("css-toggle-list").classList.add("hidden");
  document.querySelector("#css-back-btn button").textContent = "← Back to Properties :";
  document.getElementById("css-back-btn").classList.remove("hidden");
  detail_el.classList.remove("hidden");
}

// ─── § 12  BACK TO LIST ──────────────────────────────────────────────────────
function show_topic_list() {
  const detail_el     = document.getElementById("css-lesson-detail");
  const breadcrumb_el = document.getElementById("css-guide-breadcrumb");
  const toggle_el     = document.getElementById("css-toggle-list");
  const back_btn      = document.getElementById("css-back-btn");

  if (nav_stack.length === 0) {
    toggle_el.classList.remove("hidden");
    detail_el.classList.add("hidden");
    back_btn.classList.add("hidden");
    if (breadcrumb_el) {
      breadcrumb_el.innerHTML = '<span class="breadcrumb-active">CSS Guide</span>';
    }
    return;
  }

  const prev = nav_stack.pop();

  if (prev.is_list) {
    toggle_el.classList.remove("hidden");
    detail_el.classList.add("hidden");
    back_btn.classList.add("hidden");
  } else {
    toggle_el.classList.add("hidden");
    detail_el.innerHTML = prev.detail_html;
    detail_el.classList.remove("hidden");
    back_btn.classList.remove("hidden");
  }

  if (breadcrumb_el) {
    breadcrumb_el.innerHTML = prev.breadcrumb_html;
  }
}

// ─── § 13  BUILD THREE-LEVEL TOGGLE LIST ─────────────────────────────────────
function build_toggle_list() {
  const container = document.getElementById("css-toggle-list");
  if (!container) return;

  let html = '<ul class="topic-list">';

  version_order.forEach(function(version_name) {
    const version_obj = get_version_data(version_name);
    if (!version_obj) return;

    html += '<li class="version-group content-block">';
    html +=   '<div class="topic-trigger">';
    html +=     '<em class="chevron" onclick="toggle_item(this)">▶</em>';
    html +=     '<h4 onclick="on_version_click(\'' + version_name + '\')">' + version_name + '</h4>';
    html +=   '</div>';
    html +=   '<ul class="topic-group-list hidden">';

    const sorted_topics = version_obj.topics.slice().sort(function(a, b) {
      const ai = topic_order.indexOf(a.topic);
      const bi = topic_order.indexOf(b.topic);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    sorted_topics.forEach(function(topic_obj) {
      const safe_topic   = topic_obj.topic.replace(/'/g, "\\'");
      const safe_version = version_name.replace(/'/g, "\\'");

      html += '<li class="topic-group">';
      html +=   '<div class="topic-trigger">';
      html +=     '<em class="chevron" onclick="toggle_item(this)">▶</em>';
      html +=     '<h4 onclick="on_topic_click(\'' + safe_topic + '\', \'' + safe_version + '\')">' + topic_obj.topic + '</h4>';
      html +=   '</div>';
      html +=   '<ul class="topic-property-list hidden">';

      if (topic_obj.properties) {
        topic_obj.properties.forEach(function(prop_obj) {
          const safe_property = prop_obj.property.replace(/'/g, "\\'");

          html += '<li>';
          html +=   '<div class="topic-trigger">';
          html +=     '<em class="chevron" onclick="toggle_item(this)">▶</em>';
          html +=     '<span>' + prop_obj.property + '</span>';
          html +=   '</div>';
          html +=   '<ul class="property-values-list hidden">';

          if (prop_obj.values && prop_obj.values.length) {
            prop_obj.values.forEach(function(v) {
              const safe_value = v.value.replace(/'/g, "\\'");
              html += '<li onclick="on_value_click(\'' + safe_value + '\', \'' + safe_property + '\')">';
              html +=   v.value;
              html += '</li>';
            });
          }

          html +=   '</ul>';
          html += '</li>';
        });
      }

      html +=   '</ul>';
      html += '</li>';
    });

    if (typeof css_atrules !== "undefined") {
      const key = version_name === "CSS2" ? "css2" : version_name === "CSS3" ? "css3" : null;
      if (key && css_atrules[key] && css_atrules[key].length) {
        const safe_version = version_name.replace(/'/g, "\\'");

        html += '<li class="topic-group">';
        html +=   '<div class="topic-trigger">';
        html +=     '<em class="chevron" onclick="toggle_item(this)">▶</em>';
        html +=     '<h4 onclick="on_topic_click(\'At-Rules\', \'' + safe_version + '\')">At-Rules</h4>';
        html +=   '</div>';
        html +=   '<ul class="topic-property-list hidden">';

        css_atrules[key].forEach(function(rule_obj) {
          const safe_property = rule_obj.property.replace(/'/g, "\\'");

          html += '<li>';
          html +=   '<div class="topic-trigger">';
          html +=     '<em class="chevron" onclick="toggle_item(this)">▶</em>';
          html +=     '<span>' + rule_obj.property + '</span>';
          html +=   '</div>';
          html +=   '<ul class="property-values-list hidden">';

          if (rule_obj.values && rule_obj.values.length) {
            rule_obj.values.forEach(function(v) {
              const safe_value = v.value.replace(/'/g, "\\'");
              html += '<li onclick="on_value_click(\'' + safe_value + '\', \'' + safe_property + '\')">';
              html +=   v.value;
              html += '</li>';
            });
          }

          html +=   '</ul>';
          html += '</li>';
        });

        html +=   '</ul>';
        html += '</li>';
      }
    }

    html +=   '</ul>';
    html += '</li>';
  });

  html += '</ul>';
  container.innerHTML = html;
}

// ─── § 14  INIT ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function() {
  build_toggle_list();
});
