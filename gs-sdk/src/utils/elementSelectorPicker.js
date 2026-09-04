/**
 * Element selector picker (preview-only).
 *
 * Activates when `?gsSelectElementSelector=true` is present. Highlights elements
 * on hover and, on click, sends the picked element metadata to the parent/opener
 * window via postMessage (same channel as the variant editor).
 *
 * The top bar lets the user review/change where the content will be placed
 * (replace / after / before); the choice travels back to the admin inside the
 * same `elementSelectorPicked` message.
 *
 * Side-effect free on import; call `initElementSelectorPicker()` to start.
 */

import { getParam } from "./urlParam";

const STYLE_ID = "gopersonal-element-selector-picker-styles";
const ROOT_CLASS = "gopersonal-element-selector-picker-root-active";
const HIGHLIGHT_BOX_CLASS = "gopersonal-element-selector-picker-highlight-box";
const HIGHLIGHT_LABEL_CLASS = "gopersonal-element-selector-picker-highlight-label";
const PLACEMENT_LABEL_CLASS = "gopersonal-element-selector-picker-placement-label";
const PANEL_CLASS = "gopersonal-element-selector-picker-panel";
const PANEL_BTN_CLASS = "gopersonal-element-selector-picker-panel-btn";
const PANEL_BTN_ACTIVE_CLASS = "gopersonal-element-selector-picker-panel-btn-active";
const BAR_CLASS = "gopersonal-element-selector-picker-bar";
const BAR_TEXT_CLASS = "gopersonal-element-selector-picker-bar-text";
const BAR_COMBO_CLASS = "gopersonal-element-selector-picker-bar-combo";
const BAR_SELECT_CLASS = "gopersonal-element-selector-picker-bar-select";
const BAR_CARET_CLASS = "gopersonal-element-selector-picker-bar-caret";
const BAR_CLOSE_CLASS = "gopersonal-element-selector-picker-bar-close";

const MODE_SELECT = "select";
const MODE_INTERACT = "interact";

const POSITION_REPLACE = "replace";
const POSITION_AFTER = "after";
const POSITION_BEFORE = "before";

const POSITIONS = [
  { position: POSITION_REPLACE, label: "reemplazarlo" },
  { position: POSITION_AFTER, label: "ir después" },
  { position: POSITION_BEFORE, label: "ir antes" },
];

const BAR_TEXT = "Apuntá y hacé click en el elemento — el contenido va a";

let mounted = false;
let activeRoot = null;
let highlightBox = null;
let highlightLabel = null;
let placementLabel = null;
let highlightedTarget = null;
let pickerCleanup = null;
let panel = null;
let bar = null;
let barSelect = null;
let pickerMode = MODE_SELECT;
let pickerPosition = POSITION_REPLACE;

function getParentWindow() {
  try {
    if (window.opener && window.opener !== window) return window.opener;
  } catch (_) {
    /* cross-origin opener access may throw */
  }
  try {
    if (window.parent && window.parent !== window) return window.parent;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function elementClassName(el) {
  if (!el || !el.className) return "";
  if (typeof el.className === "string") return el.className;
  if (typeof el.className.baseVal === "string") return el.className.baseVal;
  return String(el.className);
}

function cssEscToken(s) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  const str = String(s);
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || /[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/u.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

function cssPathFromRoot(root, element) {
  if (!root.contains(element) || element === root) return ":scope";
  const segments = [];
  let el = element;
  while (el && el !== root) {
    const parent = el.parentElement;
    if (!parent) break;
    let part = el.tagName.toLowerCase();
    if (el.id) {
      part = "#" + cssEscToken(el.id);
      segments.unshift(part);
      break;
    }
    const classes = elementClassName(el)
      .split(/\s+/)
      .filter(Boolean)
      .filter((c) => c !== ROOT_CLASS && c !== HIGHLIGHT_BOX_CLASS);
    if (classes.length) {
      part += "." + classes.map((c) => cssEscToken(c)).join(".");
    }
    const siblings = [...parent.children].filter((c) => c.tagName === el.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      part += ":nth-of-type(" + index + ")";
    }
    segments.unshift(part);
    el = parent;
  }
  return segments.join(" > ");
}

function selectorFromBody(target) {
  const selector = cssPathFromRoot(activeRoot, target);
  if (selector === ":scope") return "body";
  return "body > " + selector;
}

function elementPayload(target) {
  const className = elementClassName(target)
    .split(/\s+/)
    .filter((c) => c && c !== ROOT_CLASS && c !== HIGHLIGHT_BOX_CLASS)
    .join(" ");

  return {
    selector: selectorFromBody(target),
    tag: target.tagName,
    id: target.id || undefined,
    className: className || undefined,
    position: pickerPosition,
  };
}

/**
 * Text shown on the highlight box: the element id when it has one, the css
 * selector otherwise (the same value the admin ends up storing).
 */
function elementLabelText(target) {
  const id = target && target.id ? String(target.id).trim() : "";
  if (id) return "#" + id;
  return selectorFromBody(target);
}

function isInsidePicker(el) {
  if (!el) return false;
  if (panel && (el === panel || panel.contains(el))) return true;
  if (bar && (el === bar || bar.contains(el))) return true;
  return false;
}

function isPickableElement(el) {
  if (!el || el.nodeType !== 1) return false;
  if (isInsidePicker(el)) return false;
  if (!activeRoot || !activeRoot.contains(el)) return false;
  if (el === activeRoot || el === document.documentElement) return false;
  if (
    el.classList &&
    (el.classList.contains(HIGHLIGHT_BOX_CLASS) ||
      el.classList.contains(HIGHLIGHT_LABEL_CLASS) ||
      el.classList.contains(PLACEMENT_LABEL_CLASS))
  )
    return false;
  return true;
}

function collectCandidates(x, y, extra) {
  const candidates = [];
  const seen = new Set();

  function add(el) {
    if (!isPickableElement(el) || seen.has(el)) return;
    seen.add(el);
    candidates.push(el);
  }

  if (typeof document.elementsFromPoint === "function") {
    document.elementsFromPoint(x, y).forEach(add);
  } else {
    add(document.elementFromPoint(x, y));
  }

  if (extra) add(extra);

  return candidates;
}

function pickTargetFromPoint(x, y, extra) {
  const candidates = collectCandidates(x, y, extra);
  let best = null;
  let bestArea = Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area <= 0) continue;

    if (area < bestArea) {
      bestArea = area;
      best = el;
    }
  }

  return best;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    "." +
    ROOT_CLASS +
    "{outline:3px solid #5e40bf;outline-offset:2px}" +
    // Empty anchors (`<div id="gopersonal_home"></div>` and friends) are 0px
    // tall, so hit-testing can never reach them. While selecting, give them a
    // minimum height and a dashed hint so they can be hovered and picked.
    "." +
    ROOT_CLASS +
    " [id]:empty{min-height:14px!important;outline:1px dashed rgba(94,64,191,.7);outline-offset:-1px}" +
    "." +
    HIGHLIGHT_BOX_CLASS +
    "{position:fixed;pointer-events:none;box-sizing:border-box;border:2px solid rgba(94,64,191,.95);background:rgba(148,110,235,.28);z-index:2147483646;display:none}" +
    "." +
    HIGHLIGHT_LABEL_CLASS +
    "{position:absolute;top:0;left:0;max-width:320px;box-sizing:border-box;padding:2px 6px;border-radius:3px;background:#5e40bf;color:#fff;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}" +
    "." +
    PLACEMENT_LABEL_CLASS +
    "{position:absolute;left:0;max-width:100%;box-sizing:border-box;padding:2px 6px;background:rgba(17,24,39,.75);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;line-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}" +
    "." +
    BAR_CLASS +
    // The bar lives inside customer sites, so every rule that decides the
    // layout is forced: their global `select{width:100%}` and friends would
    // otherwise push the combo onto its own line.
    "{position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;min-height:68px!important;margin:0!important;padding:12px 56px!important;background:#2b0d38!important;color:#fff!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif!important;box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:auto}" +
    "." +
    BAR_TEXT_CLASS +
    "{display:flex!important;align-items:center!important;justify-content:center!important;flex-wrap:nowrap!important;gap:10px!important;max-width:100%!important;margin:0!important;padding:0!important;text-align:center;font-size:15px!important;line-height:20px!important;font-weight:700!important;color:#fff!important}" +
    "." +
    BAR_TEXT_CLASS +
    " span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "." +
    BAR_COMBO_CLASS +
    "{display:inline-flex!important;align-items:center!important;flex:0 0 auto!important;gap:8px!important;margin:0!important;padding:0 4px 2px 2px!important;border-bottom:1px solid rgba(255,255,255,.6)!important;cursor:pointer}" +
    "." +
    BAR_SELECT_CLASS +
    // The caret is a sibling element, never a background image: sites override
    // `background`/`background-position` on selects and it ends up on top of
    // the text.
    "{appearance:none!important;-webkit-appearance:none!important;flex:0 0 auto!important;display:inline-block!important;box-sizing:content-box!important;width:auto!important;min-width:0!important;max-width:none!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;color:#fff!important;font-family:inherit!important;font-size:15px!important;line-height:20px!important;font-weight:700!important;text-align:left;text-indent:0!important;cursor:pointer}" +
    "." +
    BAR_SELECT_CLASS +
    " option{color:#111827;background:#fff}" +
    "." +
    BAR_CARET_CLASS +
    "{flex:0 0 auto!important;display:block!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border-left:5px solid transparent!important;border-right:5px solid transparent!important;border-top:5px solid #fff!important;border-bottom:0!important;background:none!important;pointer-events:none}" +
    "." +
    BAR_CLOSE_CLASS +
    "{position:absolute!important;top:50%!important;right:16px!important;left:auto!important;transform:translateY(-50%)!important;display:flex!important;margin:0!important;padding:0!important}" +
    "." +
    BAR_CLOSE_CLASS +
    " button{appearance:none!important;-webkit-appearance:none!important;width:auto!important;min-width:0!important;height:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;padding:4px 6px!important;background:transparent!important;color:#fff!important;font-family:inherit!important;font-size:22px!important;line-height:1!important;cursor:pointer;opacity:.85}" +
    "." +
    BAR_CLOSE_CLASS +
    " button:hover{opacity:1}" +
    "." +
    PANEL_CLASS +
    "{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:4px;padding:4px;background:#111827;border-radius:9999px;box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;pointer-events:auto}" +
    "." +
    PANEL_BTN_CLASS +
    "{appearance:none;-webkit-appearance:none;border:0;margin:0;cursor:pointer;padding:7px 16px;border-radius:9999px;font-size:13px;line-height:1;font-weight:600;color:#9ca3af;background:transparent;transition:color .12s,background .12s}" +
    "." +
    PANEL_BTN_ACTIVE_CLASS +
    "{color:#fff;background:#5e40bf}";
  document.head.appendChild(style);
}

function applyModeUi() {
  if (activeRoot) {
    activeRoot.classList.toggle(ROOT_CLASS, pickerMode === MODE_SELECT);
  }
  if (!panel) return;
  const buttons = panel.querySelectorAll("." + PANEL_BTN_CLASS);
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const active = btn.getAttribute("data-mode") === pickerMode;
    btn.classList.toggle(PANEL_BTN_ACTIVE_CLASS, active);
  }
}

function setPickerMode(mode) {
  pickerMode = mode === MODE_INTERACT ? MODE_INTERACT : MODE_SELECT;
  if (pickerMode !== MODE_SELECT) clearHighlight();
  applyModeUi();
}

function normalizePosition(value) {
  const position = String(value || "").trim().toLowerCase();
  if (position === POSITION_AFTER) return POSITION_AFTER;
  if (position === POSITION_BEFORE) return POSITION_BEFORE;
  if (position === POSITION_REPLACE) return POSITION_REPLACE;
  return null;
}

/** Text of the little label pinned to the highlighted element. */
function placementLabelText() {
  if (pickerPosition === POSITION_REPLACE) {
    return "El contenido dinámico va a reemplazar este elemento";
  }
  return "El contenido dinámico se va a agregar acá";
}

function applyBarUi() {
  if (barSelect) barSelect.value = pickerPosition;
}

function applyPlacementLabel() {
  if (!placementLabel) return;
  placementLabel.textContent = placementLabelText();
  // Pinned where the content lands: under the element for "después", over it
  // for "antes", inside it for "reemplazar".
  if (pickerPosition === POSITION_AFTER) {
    placementLabel.style.top = "100%";
    placementLabel.style.bottom = "auto";
  } else if (pickerPosition === POSITION_BEFORE) {
    placementLabel.style.top = "-14px";
    placementLabel.style.bottom = "auto";
  } else {
    placementLabel.style.top = "auto";
    placementLabel.style.bottom = "0";
  }
}

function setPickerPosition(position) {
  pickerPosition = normalizePosition(position) || POSITION_REPLACE;
  applyBarUi();
  applyPlacementLabel();
}

function ensureBar() {
  if (bar) return;
  bar = document.createElement("div");
  bar.className = BAR_CLASS;
  bar.setAttribute("data-gopersonal-picker-ui", "true");

  const textWrapper = document.createElement("div");
  textWrapper.className = BAR_TEXT_CLASS;

  const sentence = document.createElement("span");
  sentence.textContent = BAR_TEXT;
  textWrapper.appendChild(sentence);

  const combo = document.createElement("span");
  combo.className = BAR_COMBO_CLASS;

  barSelect = document.createElement("select");
  barSelect.className = BAR_SELECT_CLASS;
  POSITIONS.forEach(function (item) {
    const option = document.createElement("option");
    option.value = item.position;
    option.textContent = item.label;
    barSelect.appendChild(option);
  });
  barSelect.addEventListener("change", function (e) {
    e.stopPropagation();
    setPickerPosition(barSelect.value);
  });
  combo.appendChild(barSelect);

  const caret = document.createElement("span");
  caret.className = BAR_CARET_CLASS;
  combo.appendChild(caret);

  // The caret is not clickable on its own, so clicking anywhere on the combo
  // opens the native dropdown.
  combo.addEventListener("click", function (e) {
    if (e.target === barSelect) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      barSelect.showPicker();
    } catch (_) {
      barSelect.focus();
    }
  });

  textWrapper.appendChild(combo);

  bar.appendChild(textWrapper);

  const closeWrapper = document.createElement("div");
  closeWrapper.className = BAR_CLOSE_CLASS;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    hideElementSelectorPicker();
    try {
      window.close();
    } catch (_) {
      /* the window may not be script-closable */
    }
  });
  closeWrapper.appendChild(closeBtn);
  bar.appendChild(closeWrapper);

  document.documentElement.appendChild(bar);
}

function ensurePanel() {
  if (panel) return;
  panel = document.createElement("div");
  panel.className = PANEL_CLASS;
  panel.setAttribute("data-gopersonal-picker-ui", "true");

  const modes = [
    { mode: MODE_SELECT, label: "Seleccionar" },
    { mode: MODE_INTERACT, label: "Interactuar" },
  ];

  modes.forEach(function (item) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = PANEL_BTN_CLASS;
    btn.setAttribute("data-mode", item.mode);
    btn.textContent = item.label;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      setPickerMode(item.mode);
    });
    panel.appendChild(btn);
  });

  document.documentElement.appendChild(panel);
}

function ensureHighlightBox() {
  if (highlightBox) return;
  highlightBox = document.createElement("div");
  highlightBox.className = HIGHLIGHT_BOX_CLASS;

  highlightLabel = document.createElement("div");
  highlightLabel.className = HIGHLIGHT_LABEL_CLASS;
  highlightBox.appendChild(highlightLabel);

  placementLabel = document.createElement("div");
  placementLabel.className = PLACEMENT_LABEL_CLASS;
  highlightBox.appendChild(placementLabel);

  applyPlacementLabel();
  document.documentElement.appendChild(highlightBox);
}

function updateHighlightBox(el) {
  ensureHighlightBox();
  highlightedTarget = el || null;
  if (!el) {
    highlightBox.style.display = "none";
    return;
  }

  const rect = el.getBoundingClientRect();
  highlightBox.style.display = "block";
  highlightBox.style.top = rect.top + "px";
  highlightBox.style.left = rect.left + "px";
  highlightBox.style.width = rect.width + "px";
  highlightBox.style.height = rect.height + "px";

  if (highlightLabel) {
    highlightLabel.textContent = elementLabelText(el);
    // Sits just above the box when there is room, inside its top-left corner
    // otherwise, so it is always visible.
    highlightLabel.style.top = rect.top >= 20 ? "-18px" : "0px";
  }
}

function clearHighlight() {
  updateHighlightBox(null);
}

function refreshHighlightBox() {
  if (highlightedTarget && highlightedTarget.isConnected) {
    updateHighlightBox(highlightedTarget);
  } else {
    clearHighlight();
  }
}

function postElementToParent(target) {
  const payload = elementPayload(target);
  const message = {
    namespace: "gopersonal",
    source: "preview",
    type: "elementSelectorPicked",
    payload,
  };
  const targetWindow = getParentWindow();
  try {
    console.log("[gs-sdk][elementSelectorPicker] postMessage to parent:", message);
    if (targetWindow) {
      targetWindow.postMessage(message, "*");
    } else {
      console.warn("[gs-sdk][elementSelectorPicker] No parent/opener window found");
    }
  } catch (e) {
    console.warn("[gs-sdk][elementSelectorPicker] postMessage failed:", e);
  }
}

export function hideElementSelectorPicker() {
  if (pickerCleanup) {
    pickerCleanup();
    pickerCleanup = null;
  }
  clearHighlight();
  if (activeRoot) {
    activeRoot.classList.remove(ROOT_CLASS);
    activeRoot = null;
  }
  if (highlightBox) {
    highlightBox.remove();
    highlightBox = null;
    highlightLabel = null;
    placementLabel = null;
  }
  if (panel) {
    panel.remove();
    panel = null;
  }
  if (bar) {
    bar.remove();
    bar = null;
    barSelect = null;
  }
  pickerMode = MODE_SELECT;
}

export function showElementSelectorPicker() {
  hideElementSelectorPicker();

  if (!document.body) return;

  ensureStyles();
  activeRoot = document.body;
  pickerMode = MODE_SELECT;
  ensureBar();
  ensurePanel();
  applyModeUi();
  applyBarUi();

  function onMove(e) {
    if (!activeRoot || pickerMode !== MODE_SELECT) return;
    if (isInsidePicker(document.elementFromPoint(e.clientX, e.clientY))) {
      clearHighlight();
      return;
    }
    const target = pickTargetFromPoint(e.clientX, e.clientY);
    if (!target) {
      clearHighlight();
      return;
    }
    updateHighlightBox(target);
  }

  function onClick(e) {
    if (!activeRoot) return;
    // Never let the picker UI be treated as a selection; let its own click
    // handlers run so the mode toggle and the top bar work.
    if (isInsidePicker(e.target)) return;
    // Interaction mode: leave every click untouched so the page behaves
    // normally (open/close popups, dropdowns, navigate, etc.).
    if (pickerMode !== MODE_SELECT) return;
    const target = pickTargetFromPoint(e.clientX, e.clientY, e.target);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    postElementToParent(target);
  }

  function onViewportChange() {
    refreshHighlightBox();
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange, true);

  pickerCleanup = function () {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange, true);
    clearHighlight();
  };
}

/**
 * Starts the body-scoped element picker when `gsSelectElementSelector=true`.
 * Safe to call multiple times; no-op without the query param.
 */
export function initElementSelectorPicker() {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (mounted) return;
    if (getParam("gsSelectElementSelector") !== "true") return;

    mounted = true;

    // Position currently selected in the admin (replace | after | before).
    pickerPosition = normalizePosition(getParam("gsSelectorPosition")) || POSITION_REPLACE;

    window.gsShowElementSelectorPicker = showElementSelectorPicker;
    window.gsHideElementSelectorPicker = hideElementSelectorPicker;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showElementSelectorPicker, {
        once: true,
      });
    } else {
      showElementSelectorPicker();
    }
  } catch (e) {
    try {
      console.warn("[gs-sdk][elementSelectorPicker] init failed:", e);
    } catch (_) {
      /* ignore */
    }
    mounted = false;
  }
}
