const key = "gs-v-1";
const GS_VUUID = "gs_vuuid";
const GS_GAID = "gs_gaid";

export const getToken = () => {
  const item = localStorage.getItem(key);
  if (!item) {
    return {};
  }
  return JSON.parse(item);
};

export const checkSameClientId = (clientId) => {
  const item = localStorage.getItem(key + "-clientId");
  if (!item) {
    return false;
  }
  return item == clientId;
};

export const setClientId = (clientId) => {
  localStorage.setItem(key + "-clientId", clientId);
};

export const isTokenValid = () => {
  const item = localStorage.getItem(key);
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
  const item = localStorage.getItem(key);
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
  const item = localStorage.getItem(key);
  if (item) {
    const session = JSON.parse(item);
    session[fieldKey] = value;
    setSession(session);
  } else {
    return {};
  }
};

export const setSession = (data = {}) => {
  data.ts = new Date();
  localStorage.setItem(key, JSON.stringify(data));
  return data;
};

export const clearSession = () => {
  localStorage.removeItem(key);
  localStorage.removeItem("gs_content_seen");
};

export const setVUUID = (value) => {
  localStorage.setItem(GS_VUUID, value);
};
export const getVUUID = () => {
  const item = localStorage.getItem(GS_VUUID);
  return item;
};

export const setUsedGAId = (value) => {
  localStorage.setItem(GS_GAID, value);
};
export const getUsedGAId = () => {
  const item = localStorage.getItem(GS_GAID);
  return item;
};
