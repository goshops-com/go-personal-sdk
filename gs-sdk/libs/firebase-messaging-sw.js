self.addEventListener("install", onServiceWorkerInstalled);
self.addEventListener("activate", onServiceWorkerActivated);
self.addEventListener("push", (e) => e.waitUntil(onNotificationReceived(e)));
self.addEventListener("notificationclick", (e) => e.waitUntil(onNotificationClicked(e)));
self.addEventListener("notificationclose", (e) => e.waitUntil(onNotificationClosed(e)));

function onServiceWorkerInstalled(e) {
  e.waitUntil(self.skipWaiting());
}

function onServiceWorkerActivated(e) {
  e.waitUntil(self.clients.claim());
}

const MAX_ACTIONS = 2;
const SAFE_ACTION_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function buildNotificationActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return [];
  }
  const safe = actions
    .slice(0, MAX_ACTIONS)
    .filter((a) => a && typeof a.action === 'string' && typeof a.title === 'string')
    .filter((a) => SAFE_ACTION_ID_REGEX.test(a.action))
    .map((a) => ({
      action: String(a.action),
      title: String(a.title).slice(0, 32),
      ...(a.icon && typeof a.icon === 'string' ? { icon: a.icon } : {}),
    }));
  return safe;
}

function buildNotificationData(payload) {
  const dataPayload = payload.data || {};
  const defaultUrl = dataPayload.defaultUrl || dataPayload.url || '';
  const data = {
    url: dataPayload.url || defaultUrl,
    primaryUrl: dataPayload.url || defaultUrl,
    secondaryUrl: '',
    title: payload.notification?.title,
    body: payload.notification?.body,
    icon: payload.notification?.image || '',
  };
  if (defaultUrl) {
    data.defaultUrl = defaultUrl;
  }
  Object.keys(dataPayload).forEach((key) => {
    if (key === 'gsCampaignId' || key === 'banner' || key === 'url' || key === 'defaultUrl') return;
    const val = dataPayload[key];
    if (typeof val === 'string' && val.length > 0 && SAFE_ACTION_ID_REGEX.test(key)) {
      data[key] = val;
    }
  });
  return data;
}

async function onNotificationReceived(e) {
  const data = JSON.parse(JSON.stringify(e.data.json()));
  console.log('notification received data', data);

  const gsCampaignId = data.data?.gsCampaignId;
  if (gsCampaignId) {
    const gsCampaign = await getKey(gsCampaignId);
    if (gsCampaign) {
      console.log('Already seen campaign', gsCampaign);
      return;
    }
  }

  const rawActions = data.notification?.actions;
  const actions = buildNotificationActions(rawActions);
  const notificationData = buildNotificationData(data);

  if (actions.length >= 1) {
    notificationData.primaryUrl = notificationData[actions[0].action] || notificationData.url || '';
  }
  if (actions.length >= 2) {
    notificationData.secondaryUrl = notificationData[actions[1].action] || '';
  }

  const options = {
    body: data.notification?.body ?? '',
    icon: data.notification?.image || '',
    actions,
    data: notificationData,
  };

  if (data.data?.banner) {
    options.image = data.data.banner;
  }

  try {
    await self.registration.showNotification(data.notification?.title ?? '', options);

    if (gsCampaignId) {
      await setKey(gsCampaignId, { seen: true });
    }
  } catch (ex) {
    console.log('error notification received', ex);
  }
}

function isAllowedUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function onNotificationClicked(event) {
  event.notification.close();
  console.log('notification clicked', event);

  const data = event.notification.data || {};
  const action = typeof event.action === 'string' ? event.action : '';

  let url = data.defaultUrl || data.url || '/';

  if (action && data[action] && isAllowedUrl(data[action])) {
    url = data[action];
  } else if (action === 'gopersonal-primary-action' && isAllowedUrl(data.primaryUrl)) {
    url = data.primaryUrl;
  } else if (action === 'gopersonal-secondary-action' && isAllowedUrl(data.secondaryUrl)) {
    url = data.secondaryUrl;
  } else if (!isAllowedUrl(url)) {
    return Promise.resolve();
  }

  const openOrFocus = self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    });
  event.waitUntil(openOrFocus);
  return openOrFocus;
}

async function onNotificationClosed(e) {
  console.log("notification closed", e);
}

const DB_NAME = 'gs_service_worker_db';
const DB_VERSION = 1;
const STORE_NAME = 'gs_key_value_store';

async function openDB() {
  try {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => resolve(null);

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  } catch (e) {
    console.log('error opening db', e);
    return null;
  }
}

async function setKey(key, value) {
  try {
    const db = await openDB();
    if (!db) return false;

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);

      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch (e) {
    console.log('error setting key', e);
    return false;
  }
}

async function getKey(key) {
  try {
    const db = await openDB();
    if (!db) return null;

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);

      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch (e) {
    console.log('error getting key', e);
    return null;
  }
}