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

async function onNotificationReceived(e) {
  const data = JSON.parse(JSON.stringify(e.data.json()));
  console.log('notification received data', data);
  
  const gsCampaignId = data.data?.gsCampaignId;
  if(gsCampaignId){
    const gsCampaign = await getKey(gsCampaignId);
    if(gsCampaign){
      console.log('Already seen campaign', gsCampaign);
      return;
    }
  }
  const options = {
    body: data.notification.body,
    icon: data.notification.image || "",
    actions: [],
    data: {
        url: data.data?.url || '',
        primaryUrl: data.data?.url || '',
        secondaryUrl: "",
        actions: [],
        title: data.notification.title,
        body: data.notification.body,
        icon: data.notification.image || "",
    },
  }

  if(data.data?.banner){
    options.image = data.data.banner;
  }
  
  try {
    await self.registration.showNotification(data.notification.title, options);

    if(gsCampaignId){
      await setKey(gsCampaignId, {seen: true});
    }
  }catch(ex){
    console.log('error notification received', ex);
  }
}

async function onNotificationClicked(i) {
  i.notification.close();
  console.log("notification clicked", i);
  if (i.notification.data && i.notification.data.url) {
      let url = i.notification.data.url;
      if (i.action === "gopersonal-primary-action") {
          url = i.notification.data.primaryUrl;
      } else if (i.action === "gopersonal-secondary-action") {
          url = i.notification.data.secondaryUrl;
      }
      try {
          return self.clients.openWindow(url);
      } catch (e) {
          console.log("error notification clicked");
          return self.clients.openWindow(url);
      }
  }
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
  } catch (e){
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
  } catch (e){
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
  } catch (e){
    console.log('error getting key', e);
    return null;
  }
}