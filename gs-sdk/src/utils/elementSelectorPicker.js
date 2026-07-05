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
const HIGHLIGHT_CLASS = "gopersonal-element-selector-picker-highlight";

let mounted = false;
let activeRoot = null;
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
    const classes = (el.className && typeof el.className === "string"
      ? el.className.split(/\s+/).filter(Boolean)
      : []
    ).filter((c) => c !== HIGHLIGHT_CLASS && c !== ROOT_CLASS);
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
  return {
    selector: selectorFromBody(target),
    tag: target.tagName,
    id: target.id || undefined,
    className:
      typeof target.className === "string"
        ? target.className
            .split(/\s+/)
            .filter((c) => c && c !== HIGHLIGHT_CLASS && c !== ROOT_CLASS)
            .join(" ")
        : undefined,
  };
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    "." +
    ROOT_CLASS +
    "{outline:3px solid rgba(59,130,246,.95);outline-offset:2px;position:relative;z-index:1}" +
    "." +
    HIGHLIGHT_CLASS +
    "{outline:2px dashed rgba(234,179,8,.95)!important;outline-offset:1px}";
  document.head.appendChild(style);
}

function clearHighlight() {
  if (!activeRoot) return;
  const prev = activeRoot.querySelectorAll("." + HIGHLIGHT_CLASS);
  prev.forEach((n) => n.classList.remove(HIGHLIGHT_CLASS));
}

function postElementToParent(target) {
  const payload = elementPayload(target);
  const targetWindow = getParentWindow();
  try {
    if (targetWindow) {
      targetWindow.postMessage(
        {
          namespace: "gopersonal",
          source: "preview",
          type: "elementSelectorPicked",
          payload,
        },
        "*",
      );
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
}

export function showElementSelectorPicker() {
  hideElementSelectorPicker();

  if (!document.body) return;

  ensureStyles();
  activeRoot = document.body;
  activeRoot.classList.add(ROOT_CLASS);

  function pickTargetFromEvent(e) {
    const top = document.elementFromPoint(e.clientX, e.clientY);
    if (!top || !activeRoot.contains(top)) return null;
    return top;
  }

  function onMove(e) {
    if (!activeRoot) return;
    const target = pickTargetFromEvent(e);
    clearHighlight();
    if (!target) return;
    target.classList.add(HIGHLIGHT_CLASS);
  }

  function onClick(e) {
    if (!activeRoot) return;
    const target = pickTargetFromEvent(e);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    postElementToParent(target);
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);

  pickerCleanup = function () {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
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
