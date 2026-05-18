const key = "gs-v-1";
const GS_VUUID = "gs_vuuid";
const GS_GAID = "gs_gaid";
const COOKIE_MAX_BYTES = 3500;
const COOKIE_SESSION_TTL_SECONDS = 24 * 60 * 60;
const COOKIE_ID_TTL_SECONDS = 365 * 24 * 60 * 60;


// Keys for GA4 session sync in traffic split
const GS_GAID_ACCEPTED = "gs_gaid_accepted";
const GS_GAID_REJECTED = "gs_gaid_rejected";
const COOKIE_FALLBACK_KEYS = [key, `${key}-clientId`, GS_VUUID];

let cookieFallbackEnabled = false;

export const configureStorage = ({ cookieFallback = false } = {}) => {
  cookieFallbackEnabled = cookieFallback === true;
};

const canUseCookieFallback = (storageKey) => {
  return cookieFallbackEnabled && COOKIE_FALLBACK_KEYS.includes(storageKey) && typeof document !== "undefined";
};

const byteLength = (value) => {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x").length;
};

const getCookieValue = (storageKey) => {
  if (!canUseCookieFallback(storageKey) || !document.cookie) {
    return null;
  }

  const name = `${encodeURIComponent(storageKey)}=`;
  const cookies = document.cookie.split("; ");
  const cookie = cookies.find((item) => item.startsWith(name));
  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(cookie.slice(name.length));
  } catch (e) {
    return null;
  }
};

const deleteCookieValue = (storageKey) => {
  if (!canUseCookieFallback(storageKey)) {
    return;
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(storageKey)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
};

const setCookieValue = (storageKey, value) => {
  if (!canUseCookieFallback(storageKey)) {
    return;
  }

  const maxAge = storageKey === key ? COOKIE_SESSION_TTL_SECONDS : COOKIE_ID_TTL_SECONDS;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const cookie = `${encodeURIComponent(storageKey)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;

  if (byteLength(cookie) > COOKIE_MAX_BYTES) {
    deleteCookieValue(storageKey);
    window.gsLog?.("Cookie fallback skipped because value is too large", storageKey);
    return;
  }

  document.cookie = cookie;
};

const getStorageItem = (storageKey) => {
  const item = localStorage.getItem(storageKey);
  if (item !== null) {
    return item;
  }

  const cookieValue = getCookieValue(storageKey);
  if (cookieValue !== null) {
    localStorage.setItem(storageKey, cookieValue);
    return cookieValue;
  }

  return null;
};

const setStorageItem = (storageKey, value) => {
  localStorage.setItem(storageKey, value);
  setCookieValue(storageKey, value);
};

const removeStorageItem = (storageKey) => {
  localStorage.removeItem(storageKey);
  deleteCookieValue(storageKey);
};


export const getToken = () => {
  const item = getStorageItem(key);
  if (!item) {
    return {};
  }
  return JSON.parse(item);
};

export const checkSameClientId = (clientId) => {
  const item = getStorageItem(key + "-clientId");
  if (!item) {
    return false;
  }
  return item == clientId;
};

export const setClientId = (clientId) => {
  setStorageItem(key + "-clientId", clientId);
};

export const isTokenValid = () => {
  const item = getStorageItem(key);
  if (!item) {
    return false;
  }
  try {
    const itemObj = JSON.parse(item);
    const timestamp = new Date(itemObj.ts);
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);
    return timestamp > oneDayAgo;
  } catch (e) {
    console.log(e);
    return false;
  }
};

export const getSession = () => {
  const item = getStorageItem(key);
  if (item) {
    const session = JSON.parse(item);
    const vuuid = getVUUID();
    session["vuuid"] = vuuid;
    return session;
  } else {
    return {};
  }
};

export const addDataToSession = (fieldKey, value) => {
  const item = getStorageItem(key);
  if (item) {
    const session = JSON.parse(item);
    session[fieldKey] = value;
    setSession(session);
  } else {
    return {};
  }
};

export const setSession = (data = {}, preserveTs = false) => {
  if (!preserveTs) {
    data.ts = new Date();
  }
  setStorageItem(key, JSON.stringify(data));
  return data;
};

export const clearSession = () => {
  removeStorageItem(key);
  localStorage.removeItem("gs_content_seen");
};

export const setVUUID = (value) => {
  setStorageItem(GS_VUUID, value);
};
export const getVUUID = () => {
  const item = getStorageItem(GS_VUUID);
  return item;
};

// GA4 Accepted GA ID
export const setGAIdAccepted = (gaId) => {
  localStorage.setItem(GS_GAID_ACCEPTED, gaId);
};
export const getGAIdAccepted = () => {
  return localStorage.getItem(GS_GAID_ACCEPTED);
};

// GA4 Rejected GA ID
export const setGAIdRejected = (gaId) => {
  localStorage.setItem(GS_GAID_REJECTED, gaId);
};
export const getGAIdRejected = () => {
  return localStorage.getItem(GS_GAID_REJECTED);
};
