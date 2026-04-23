/**
 * GoPersonal variant editor (preview-only).
 *
 * Escucha el param `?gsPreviewVariant=<id>` y, únicamente cuando está presente,
 * monta un FAB sobre la página del shop con la acción "Edit variant": abre un
 * picker scopeado al contenedor [data-gopersonal="true"] (o
 * [data-opersonal="true"]) + data-variant=<id> y permite editar textos.
 * Al confirmar, envía todos los cambios acumulados al `window.opener` /
 * `window.parent` mediante postMessage.
 *
 * Todo el módulo es side-effect free en import: nada se ejecuta hasta que
 * `initVariantEditor()` se llama y, aun así, sale temprano si no hay variantId.
 */

import { previewVariant } from "./urlParam";

// ---------------------------------------------------------------------------
// Module state (scoped, no globals)
// ---------------------------------------------------------------------------

let previewVariantId = null;
let mounted = false;

const STYLE_ID = "gopersonal-selector-picker-styles";
const DRAWER_STYLE_ID = "gopersonal-text-drawer-styles";
const ROOT_CLASS = "gopersonal-selector-picker-root-active";
const HIGHLIGHT_CLASS = "gopersonal-selector-picker-highlight";

let activeRoot = null;
let overlay = null;
let pickerCleanup = null;
let textDrawerOpen = false;
let textDrawerRoot = null;
let drawerEscapeHandler = null;

const TEXT_EDIT_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "SPAN", "A", "LABEL", "BUTTON", "LI",
  "TD", "TH", "FIGCAPTION", "BLOCKQUOTE", "STRONG", "EM", "B", "I", "U", "S", "SMALL",
  "MARK", "SUB", "SUP", "Q", "CITE", "ABBR", "TIME", "ADDRESS", "DD", "DT", "SUMMARY",
  "LEGEND", "CAPTION", "PRE", "CODE", "DEL", "INS", "KBD", "SAMP", "VAR",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syncPreviewIdsFromUrl() {
  try {
    const v = previewVariant();
    if (v && String(v).trim()) {
      previewVariantId = String(v).trim();
    }
  } catch (_) {
    /* ignore */
  }
}

function isTextEditableElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (TEXT_EDIT_TAGS.has(tag)) return true;
  if (tag === "INPUT") {
    const t = (el.type || "text").toLowerCase();
    return ["text", "search", "email", "tel", "url", "password", "number"].includes(t);
  }
  if (tag === "TEXTAREA") return true;
  return false;
}

function getTextFromElement(el) {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el.value;
  return el.innerText != null ? el.innerText : el.textContent || "";
}

function setTextOnElement(el, value) {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    el.textContent = value;
  }
}

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

function findVariantRoot(variantId) {
  if (!variantId) return null;
  const nodes = document.querySelectorAll(
    '[data-gopersonal="true"],[data-opersonal="true"]',
  );
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.getAttribute("data-variant") === String(variantId)) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function ensureDrawerStyles() {
  if (document.getElementById(DRAWER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = DRAWER_STYLE_ID;
  style.textContent =
    ".gp-text-drawer-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:2147483645}" +
    ".gp-text-drawer{position:fixed;top:0;left:0;bottom:0;width:min(400px,100vw);background:#fff;box-shadow:8px 0 24px rgba(15,23,42,.12);z-index:2147483646;display:flex;flex-direction:column;font-family:system-ui,-apple-system,sans-serif}" +
    ".gp-text-drawer-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #e5e7eb}" +
    ".gp-text-drawer-title{font-size:17px;font-weight:600;color:#111827;margin:0}" +
    ".gp-text-drawer-close{width:36px;height:36px;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#6b7280;font-size:22px;line-height:1}" +
    ".gp-text-drawer-close:hover{background:#f3f4f6;color:#111827}" +
    ".gp-text-drawer-body{padding:18px;flex:1;overflow:auto}" +
    ".gp-text-drawer-body label{display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:8px}" +
    ".gp-text-drawer-body textarea{width:100%;box-sizing:border-box;min-height:120px;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;line-height:1.45;resize:vertical;font:inherit}" +
    ".gp-text-drawer-body textarea:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}" +
    ".gp-text-drawer-footer{display:flex;gap:10px;padding:16px 18px;border-top:1px solid #e5e7eb;justify-content:flex-end;background:#fafafa}" +
    ".gp-text-drawer-footer button{padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none}" +
    ".gp-text-drawer-cancel{background:#fff;border:1px solid #d1d5db!important;color:#374151}" +
    ".gp-text-drawer-cancel:hover{background:#f9fafb}" +
    ".gp-text-drawer-save{background:#059669;color:#fff}" +
    ".gp-text-drawer-save:hover{background:#047857}";
  document.head.appendChild(style);
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
    "{outline:2px dashed rgba(234,179,8,.95)!important;outline-offset:1px}" +
    ".gopersonal-selector-picker-overlay{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid rgba(234,179,8,.95);background:rgba(234,179,8,.08);z-index:2147483646}";
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Text drawer
// ---------------------------------------------------------------------------

function closeTextDrawer() {
  if (drawerEscapeHandler) {
    document.removeEventListener("keydown", drawerEscapeHandler, true);
    drawerEscapeHandler = null;
  }
  textDrawerOpen = false;
  if (textDrawerRoot && textDrawerRoot.parentNode) {
    textDrawerRoot.parentNode.removeChild(textDrawerRoot);
  }
  textDrawerRoot = null;
}

function openTextDrawer(targetEl, ctx) {
  closeTextDrawer();
  ensureDrawerStyles();
  textDrawerOpen = true;

  const previousText = getTextFromElement(targetEl);
  const titleText = "Edit " + targetEl.tagName;

  const root = document.createElement("div");
  root.className = "gp-text-drawer-root";
  root.innerHTML =
    '<div class="gp-text-drawer-backdrop" data-action="backdrop"></div>' +
    '<aside class="gp-text-drawer" role="dialog" aria-modal="true" aria-label="' +
    titleText.replace(/"/g, "&quot;") +
    '">' +
    '<header class="gp-text-drawer-header">' +
    "<h2 class=\"gp-text-drawer-title\">" +
    titleText.replace(/</g, "&lt;") +
    "</h2>" +
    '<button type="button" class="gp-text-drawer-close" data-action="close" aria-label="Close">×</button>' +
    "</header>" +
    '<div class="gp-text-drawer-body">' +
    '<label for="gp-text-drawer-field">Text</label>' +
    '<textarea id="gp-text-drawer-field" spellcheck="true"></textarea>' +
    "</div>" +
    '<footer class="gp-text-drawer-footer">' +
    '<button type="button" class="gp-text-drawer-cancel" data-action="cancel">Cancel</button>' +
    '<button type="button" class="gp-text-drawer-save" data-action="save">Save</button>' +
    "</footer>" +
    "</aside>";

  const textarea = root.querySelector("#gp-text-drawer-field");
  textarea.value = getTextFromElement(targetEl);

  function save() {
    const next = textarea.value;
    setTextOnElement(targetEl, next);

    if (!Array.isArray(window.gsVariantTextEdits)) {
      window.gsVariantTextEdits = [];
    }
    window.gsVariantTextEdits.push({
      variantId: ctx.variantId,
      selectorFromVariantRoot: cssPathFromRoot(ctx.activeRoot, targetEl),
      tag: targetEl.tagName,
      previousText,
      text: next,
      at: new Date().toISOString(),
    });

    try {
      window.dispatchEvent(
        new CustomEvent("gopersonal:text-updated", {
          detail: {
            variantId: ctx.variantId,
            tag: targetEl.tagName,
            text: next,
            previousText,
            element: targetEl,
          },
        }),
      );
    } catch (_) {
      /* ignore */
    }
    closeTextDrawer();
  }

  root.addEventListener("click", function (e) {
    const t = e.target;
    const action = t && t.getAttribute && t.getAttribute("data-action");
    if (action === "backdrop" || action === "close" || action === "cancel") {
      e.preventDefault();
      closeTextDrawer();
    }
    if (action === "save") {
      e.preventDefault();
      save();
    }
  });

  document.body.appendChild(root);
  textDrawerRoot = root;

  drawerEscapeHandler = function (ev) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeTextDrawer();
    }
  };
  document.addEventListener("keydown", drawerEscapeHandler, true);

  requestAnimationFrame(function () {
    textarea.focus();
    textarea.select();
  });
}

// ---------------------------------------------------------------------------
// Selector picker
// ---------------------------------------------------------------------------

function createOverlay() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "gopersonal-selector-picker-overlay";
  document.documentElement.appendChild(overlay);
}

function updateOverlay(el) {
  if (!overlay || !activeRoot) return;
  const rect = el.getBoundingClientRect();
  overlay.style.display = "block";
  overlay.style.top = window.scrollY + rect.top + "px";
  overlay.style.left = window.scrollX + rect.left + "px";
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
}

function hideOverlay() {
  if (overlay) overlay.style.display = "none";
}

function clearHighlight() {
  if (!activeRoot) return;
  const prev = activeRoot.querySelectorAll("." + HIGHLIGHT_CLASS);
  prev.forEach((n) => n.classList.remove(HIGHLIGHT_CLASS));
  hideOverlay();
}

function hideSelectorPicker() {
  closeTextDrawer();
  if (pickerCleanup) {
    pickerCleanup();
    pickerCleanup = null;
  }
  clearHighlight();
  if (activeRoot) {
    activeRoot.classList.remove(ROOT_CLASS);
    activeRoot = null;
  }
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function showSelectorPicker(payload) {
  const variantId = payload && payload.variantId;
  hideSelectorPicker();

  if (!Array.isArray(window.gsVariantTextEdits)) {
    window.gsVariantTextEdits = [];
  } else {
    window.gsVariantTextEdits.length = 0;
  }

  const root = findVariantRoot(variantId);
  if (!root) {
    console.warn("[gs-sdk][variantEditor] No container for variant:", variantId);
    return;
  }

  ensureStyles();
  activeRoot = root;
  activeRoot.classList.add(ROOT_CLASS);
  createOverlay();

  function pickTargetFromEvent(e) {
    const top = document.elementFromPoint(e.clientX, e.clientY);
    if (!top || !activeRoot.contains(top)) return null;
    return top;
  }

  function onMove(e) {
    if (!activeRoot || textDrawerOpen) return;
    const target = pickTargetFromEvent(e);
    clearHighlight();
    if (!target || target === overlay) return;
    target.classList.add(HIGHLIGHT_CLASS);
    updateOverlay(target);
  }

  function onClick(e) {
    if (!activeRoot) return;
    const target = pickTargetFromEvent(e);
    if (!target || target === overlay) return;
    e.preventDefault();
    e.stopPropagation();

    if (isTextEditableElement(target)) {
      openTextDrawer(target, { variantId, activeRoot });
      return;
    }

    const selectorUnderRoot = cssPathFromRoot(activeRoot, target);
    const detail = {
      variantId,
      selectorFromVariantRoot: selectorUnderRoot,
      tag: target.tagName,
      id: target.id || undefined,
      className:
        typeof target.className === "string"
          ? target.className
              .split(/\s+/)
              .filter((c) => c && c !== HIGHLIGHT_CLASS)
              .join(" ")
          : undefined,
    };

    try {
      window.dispatchEvent(new CustomEvent("gopersonal:selector-picked", { detail }));
    } catch (_) {
      /* ignore */
    }
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);

  pickerCleanup = function () {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    clearHighlight();
  };
}

// ---------------------------------------------------------------------------
// Post messages to parent (admin editor window)
// ---------------------------------------------------------------------------

function postVariantEditsToParent() {
  const edits = Array.isArray(window.gsVariantTextEdits)
    ? [...window.gsVariantTextEdits]
    : [];
  const payload = {
    variantId: previewVariantId,
    edits,
  };
  const targetWindow = getParentWindow();
  try {
    if (targetWindow) {
      targetWindow.postMessage(
        {
          namespace: "gopersonal",
          source: "preview",
          type: "variantEditsSave",
          payload,
        },
        "*",
      );
    }
  } catch (e) {
    console.warn("[gs-sdk][variantEditor] postMessage failed:", e);
  }
  if (Array.isArray(window.gsVariantTextEdits)) {
    window.gsVariantTextEdits.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Floating action bar (FAB)
// ---------------------------------------------------------------------------

const BAR_ID = "gopersonal-edit-variant-fab-bar";
const BTN_PRIMARY_ID = "gopersonal-edit-variant-fab";
const FAB_STYLE_ID = "gopersonal-edit-variant-fab-styles";
const GP_PURPLE = "#5036a2";
const GP_PURPLE_HOVER = "#402680";

function injectFabStyles() {
  if (document.getElementById(FAB_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = FAB_STYLE_ID;
  s.textContent =
    "#" +
    BAR_ID +
    "{position:fixed;bottom:24px;right:24px;z-index:2147483647;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:10px;max-width:calc(100vw - 32px)}" +
    "#" +
    BTN_PRIMARY_ID +
    "{padding:12px 22px;font:700 14px system-ui,-apple-system,sans-serif;color:#fff;background:" +
    GP_PURPLE +
    ";border:none;border-radius:999px;cursor:pointer;box-shadow:0 4px 16px rgba(80,54,162,.45);transition:background .15s}" +
    "#" +
    BTN_PRIMARY_ID +
    ":hover{background:" +
    GP_PURPLE_HOVER +
    "}" +
    "#" +
    BTN_PRIMARY_ID +
    ":disabled{opacity:.55;cursor:not-allowed}";
  document.head.appendChild(s);
}

function setFabEditingMode(editing) {
  const primary = document.getElementById(BTN_PRIMARY_ID);
  if (!primary) return;
  if (editing) {
    primary.textContent = "Confirm";
    primary.dataset.mode = "confirm";
  } else {
    primary.textContent = "Edit variant";
    primary.dataset.mode = "edit";
  }
}

function mountFab() {
  if (document.getElementById(BAR_ID)) return;
  if (!document.body) return;
  injectFabStyles();

  const bar = document.createElement("div");
  bar.id = BAR_ID;

  const primaryBtn = document.createElement("button");
  primaryBtn.id = BTN_PRIMARY_ID;
  primaryBtn.type = "button";
  primaryBtn.textContent = "Edit variant";
  primaryBtn.dataset.mode = "edit";

  primaryBtn.addEventListener("click", function () {
    const mode = primaryBtn.dataset.mode;
    if (mode !== "confirm") {
      syncPreviewIdsFromUrl();
      if (!previewVariantId) {
        console.warn(
          "[gs-sdk][variantEditor] No variant id — expected ?gsPreviewVariant=<id>.",
        );
        return;
      }
      showSelectorPicker({ variantId: previewVariantId });
      setFabEditingMode(true);
    } else {
      postVariantEditsToParent();
      hideSelectorPicker();
      setFabEditingMode(false);
    }
  });

  bar.appendChild(primaryBtn);
  document.body.appendChild(bar);
}

// ---------------------------------------------------------------------------
// Public init — no-op unless gsPreviewVariant URL param is present.
// ---------------------------------------------------------------------------

/**
 * Monta el editor de variante en la página. Seguro de llamar múltiples veces
 * y seguro de llamar en SSR (no-op si no hay window/document o si falta el
 * param `gsPreviewVariant`).
 */
export function initVariantEditor() {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (mounted) return;

    syncPreviewIdsFromUrl();
    if (!previewVariantId) return;

    mounted = true;

    if (!Array.isArray(window.gsVariantTextEdits)) {
      window.gsVariantTextEdits = [];
    }

    // Expose under namespaced globals for optional external use (e.g. debugging)
    window.gsShowSelectorPicker = showSelectorPicker;
    window.gsHideSelectorPicker = hideSelectorPicker;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountFab, { once: true });
    } else {
      mountFab();
    }
  } catch (e) {
    try {
      console.warn("[gs-sdk][variantEditor] init failed:", e);
    } catch (_) {
      /* ignore */
    }
    mounted = false;
  }
}
