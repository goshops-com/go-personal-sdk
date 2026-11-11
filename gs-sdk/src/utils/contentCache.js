const STORAGE_KEY = "gs_content_post_cache";
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 50;

// El cache es un solo blob con todas las respuestas. El string se sigue leyendo
// de storage en cada acceso (otra pestaña o una invalidacion pueden cambiarlo),
// pero solo se vuelve a parsear cuando cambia.
let parsedRaw = null;
let parsedCache = null;

function getCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    if (raw !== parsedRaw || !parsedCache) {
      parsedCache = JSON.parse(raw);
      parsedRaw = raw;
    }
    return parsedCache;
  } catch (e) {
    parsedRaw = null;
    parsedCache = null;
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

function writeCache(cache) {
  const raw = JSON.stringify(cache);
  localStorage.setItem(STORAGE_KEY, raw);
  parsedRaw = raw;
  parsedCache = cache;
}

function saveCache(cache) {
  try {
    writeCache(cache);
  } catch (e) {
    // localStorage full — purge and retry
    purgeOldEntries(cache, 0);
    try {
      writeCache(cache);
    } catch (_) {
      // No quedo guardado: lo que hay en memoria ya no coincide con storage.
      parsedRaw = null;
      parsedCache = null;
    }
  }
}

// Las respuestas se copian al entrar y al salir del cache: el render modifica
// el objeto que recibe, y cada lectura tiene que ver el dato tal como vino.
function cloneData(data) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(data);
    } catch (e) {}
  }
  return JSON.parse(JSON.stringify(data));
}

function buildCacheKey(contentId, options) {
  const page = options || {};
  const parts = [
    contentId,
    page.type || "",
    page.category_id || "",
    page.product_id || "",
    page.product_url || "",
  ];
  return parts.join("::");
}

function purgeOldEntries(cache, ttl) {
  const now = Date.now();
  const keys = Object.keys(cache);
  for (const key of keys) {
    if (now - cache[key].ts > ttl) {
      delete cache[key];
    }
  }
  // If still over limit, remove oldest
  const remaining = Object.keys(cache);
  if (remaining.length > MAX_ENTRIES) {
    remaining
      .sort((a, b) => cache[a].ts - cache[b].ts)
      .slice(0, remaining.length - MAX_ENTRIES)
      .forEach((k) => delete cache[k]);
  }
}

export function getCachedContent(contentId, options) {
  const ttl = window.gsConfig?.contentCacheTTL || DEFAULT_TTL;
  const cache = getCache();
  const key = buildCacheKey(contentId, options);
  const entry = cache[key];
  if (!entry) return null;

  if (Date.now() - entry.ts > ttl) {
    delete cache[key];
    saveCache(cache);
    return null;
  }
  return cloneData(entry.data);
}

export function setCachedContent(contentId, options, data) {
  const cache = getCache();
  const ttl = window.gsConfig?.contentCacheTTL || DEFAULT_TTL;
  purgeOldEntries(cache, ttl);
  const key = buildCacheKey(contentId, options);
  cache[key] = { data: cloneData(data), ts: Date.now() };
  saveCache(cache);
}

export function invalidateContentCache() {
  localStorage.removeItem(STORAGE_KEY);
}

export function purgeContentCache() {
  const ttl = window.gsConfig?.contentCacheTTL || DEFAULT_TTL;
  const cache = getCache();
  const before = Object.keys(cache).length;
  purgeOldEntries(cache, ttl);
  const after = Object.keys(cache).length;
  if (after !== before) {
    saveCache(cache);
  }
}
