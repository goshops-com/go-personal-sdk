/**
 * Element selector picker (preview-only).
 *
 * Activates when `?gsSelectElementSelector=true` is present. Highlights elements
 * on hover and, on click, sends the picked element metadata to the parent/opener
 * window via postMessage (same channel as the variant editor).
 *
 * Side-effect free on import; call `initElementSelectorPicker()` to start.
 */

import { getParam } from "./urlParam";

const STYLE_ID = "gopersonal-element-selector-picker-styles";
const ROOT_CLASS = "gopersonal-element-selector-picker-root-active";
const HIGHLIGHT_BOX_CLASS = "gopersonal-element-selector-picker-highlight-box";

let mounted = false;
let activeRoot = null;
let highlightBox = null;
let highlightedTarget = null;
let pickerCleanup = null;

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
  return String(s).replace(/([\0-\x1f!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, "\\$1");
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
  };
}

function isPickableElement(el) {
  if (!el || el.nodeType !== 1) return false;
  if (!activeRoot || !activeRoot.contains(el)) return false;
  if (el === activeRoot || el === document.documentElement) return false;
  if (el.classList && el.classList.contains(HIGHLIGHT_BOX_CLASS)) return false;
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
    "{outline:3px solid rgba(59,130,246,.95);outline-offset:2px}" +
    "." +
    HIGHLIGHT_BOX_CLASS +
    "{position:fixed;pointer-events:none;box-sizing:border-box;border:2px dashed rgba(234,179,8,.95);background:rgba(234,179,8,.08);z-index:2147483646;display:none}";
  document.head.appendChild(style);
}

function ensureHighlightBox() {
  if (highlightBox) return;
  highlightBox = document.createElement("div");
  highlightBox.className = HIGHLIGHT_BOX_CLASS;
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
  }
}

export function showElementSelectorPicker() {
  hideElementSelectorPicker();

  if (!document.body) return;

  ensureStyles();
  activeRoot = document.body;
  activeRoot.classList.add(ROOT_CLASS);

  function onMove(e) {
    if (!activeRoot) return;
    const target = pickTargetFromPoint(e.clientX, e.clientY);
    if (!target) {
      clearHighlight();
      return;
    }
    updateHighlightBox(target);
  }

  function onClick(e) {
    if (!activeRoot) return;
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
