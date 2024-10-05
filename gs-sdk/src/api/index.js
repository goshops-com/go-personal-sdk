import { httpGet, httpPost, httpPut, httpPostFormData, configure, httpPatch } from '../utils/http';
import { setSession, addDataToSession, clearSession, isTokenValid, getToken, checkSameClientId, setClientId, getSession, getVUUID, setVUUID } from '../utils/storage';
import { jsonToQueryString, getParam } from '../utils/urlParam';
import { setupContentSelector } from '../utils/configure';
import { getContentByContext } from './content';
import { getSharedToken, clearToken } from '../utils/session';
import { initVendorFenicio } from '../vendors/fenicio';
import { subscribeQueue } from '../utils/queue';
import { addToQueue } from '../utils/queue';

window.gsStore = {
  interactionCount: 0
};


export const init = async (clientId, options) => {

  if (options.playgroundToken) {
    clearSession();
    clientId = configure(clientId);
    setClientId(clientId);
    setSession({
      token: options.playgroundToken
    });
    return clientId;
  }

  // window.gsLog('Init Options', JSON.stringify(options));
  window.gsConfig.includeDraft = options.includeDraft;

  clientId = configure(clientId);
  const clientOrigin = window.location.origin;

  const sameClientId = checkSameClientId(clientId);
  const reset = getParam('gsReset');
  if (reset || !sameClientId) {
    clearSession();
    setClientId(clientId);
  }

  if (isTokenValid()) {
    const obj = getToken();
    const session = getSession();
    executeInitialLoad(clientId, session, options);
    subscribeQueue();
    return obj;
  }

  let q = '?';
  if (options.byPassCache) {
    q += 'byPassCache=true';
  }

  let externalSessionId;
  if (options.multipleDomains) {
    externalSessionId = await getSharedToken(clientId, clientOrigin);
  }

  let vuuid = getVUUID();
  if (!vuuid) {
    vuuid = generateUUID();
    setVUUID(vuuid);
  }
  const obj = await httpPost(`/channel/init${q}`, { clientId, externalSessionId, gsVUID: vuuid, firstURL: window.location.href });
  setSession(obj);

  const gsElementSelector = getParam('gsElementSelector');
  const gsContentKey = getParam('gsContentKey');

  if (gsElementSelector != null && gsContentKey != null) {
    await setupContentSelector(gsContentKey);
  }
  executeInitialLoad(clientId, obj, options);
  subscribeQueue();
  return clientId;
};

function generateUUID() {
  // Generate a random UUID
  function uuidv4() {
    try {
      return self.crypto.randomUUID();
    } catch (e) {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
  }

  // Get the current timestamp
  function getTimestamp() {
    return Date.now();
  }

  // Generate the UUID and timestamp
  const uuid = uuidv4();
  const timestamp = getTimestamp();

  // Return the prefixed string
  return `_gsVUUID_${uuid}_${timestamp}`;
}

async function executeInitialLoad(clientId, session, options) {
  if (options.singlePage) {
    return;
  }

  if (options && options.provider == 'Magento_V2') {
    try {
      if (window.location.pathname.startsWith('/gpsearch')) {

        document.querySelectorAll('a.product-item-photo').forEach(function (anchor) {
          let href = anchor.getAttribute('href');
          if (href) {
            anchor.setAttribute('href', href.replace(/([^:]\/)\/+/g, "$1"));
          }
        });

        document.querySelectorAll('a.product-item-link').forEach(element => {
          // Get the current href attribute of the element
          let url = element.getAttribute('href');

          // Replace double slashes with a single slash, excluding the protocol part (e.g., http:// or https://)
          let updatedUrl = url.replace(/([^:])\/\//g, '$1/');

          // Update the href attribute with the corrected URL
          element.setAttribute('href', updatedUrl);
        });
      }
    } catch (e) {
    }
  }
  if (options && options.provider && options.provider != 'Custom') {

    if (options.provider.toUpperCase() == 'MAGENTO') {
      try {
        require('../providers/magentoV2').install(options)
      } catch (e) {
        window.gsLog("Error installing Provider", e);
      }
    }

    // if (options.provider.toUpperCase() == 'VTEX') {
    //   options.singlePage = true;
    // }

    const context = getPageType(options.provider);
    if (context) {
      let { pageType, ...contentWithoutPageType } = context;
      contentWithoutPageType.singlePage = options.singlePage == true;
      getContentByContext(pageType, contentWithoutPageType);
      return;
    }

  }

  window.gsLog('session.channelConfig4', session.channelConfig);

  if (session.channelConfig) {
    const channelConfig = session.channelConfig.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

    // Extract the function body from the string
    const functionBody = channelConfig.slice(channelConfig.indexOf("{") + 1, channelConfig.lastIndexOf("}"));
    // Create a new function using the extracted body
    const determinePageType = new Function(functionBody);
    // Call the function and get the result
    const context = determinePageType();

    const { pageType, ...contentWithoutPageType } = context;
    const result = await getContentByContext(pageType, contentWithoutPageType);
    return;
  } else if (options.context) {
    // TODO implement this
    const { pageType, ...contentWithoutPageType } = options.context;
    const result = await getContentByContext(pageType, contentWithoutPageType);
  } else {
    // assume context 'other'
    if (!options.noDefaultContext) {
      const result = await getContentByContext('other', {});
    }
  }

};

function getUrlFromState(event) {
  // Dynamically construct the base URL from the current location
  const protocol = window.location.protocol;
  const host = window.location.host; // Includes hostname and port if present
  const basePath = `${protocol}//${host}`;

  // Initialize default values
  let path = '/';
  let hash = '';

  // Check if the navigationRoute or similar property is available in the state
  const navigationRoute = event.state?.navigationRoute;
  if (navigationRoute) {
    // Assuming the path might sometimes include a hash
    const pathAndHash = navigationRoute.path.split('#');
    path = pathAndHash[0] || '/';
    hash = pathAndHash[1] ? `#${pathAndHash[1]}` : '';
  }

  // Construct the full URL
  const fullUrl = basePath + path + hash;

  // Return an object with the constructed URL, path, and hash
  return {
    url: fullUrl,
    path: path,
    hash: hash
  };
}


function getPageType(provider) {
  if (provider && provider.toUpperCase() === 'VTEX') {

    window.gsLog('Init Vendor VTEX');

    let path = window.location.pathname;
    let hash = window.location.hash; // Added to consider the hash in the URL
    let url = window.location.href;

    // New regex pattern to match paths ending with "/p" before query parameters
    const productDetailRegex = /\/[^/]+\/p$/;
    if (productDetailRegex.test(path)) {
      return { pageType: 'product_detail', url };
    }

    // Adjusted to check for both the pathname and hash for the checkout page
    if (path.startsWith('/checkout/') && hash.includes('#/cart')) {
      return { pageType: 'checkout' }; // Changed 'cart' to 'checkout' to match your requirement
    }

    // Default case if none of the above conditions are met
    return { pageType: 'unknown' };
  }

  return undefined;
}

export const clearSharedSession = (clientId) => {
  clearToken(clientId);
}

export const login = (id, data = {}) => {
  addDataToSession('customer_id', id);
  if (data.email) {
    addDataToSession('customer_email', data.email);
  }
  data.customerId = id;
  return httpPost(`/channel/login`, data);
};

export const getCustomerSession = () => {
  return getSession();
};

export const loginEmail = (email) => {
  return httpPost(`/channel/login`, { email: email });
};

export const addInteraction = (interactionData) => {
  window.gsStore.interactionCount++;
  // ev.emit('interaction', interactionData);
  const now = new Date().getTime();
  const expirationDate = now + 24 * 60 * 60 * 1000; // Add 24 hours
  const type = 'interaction-' + interactionData.event;
  addToQueue({
    expirationDate,
    type
  });

  return httpPost(`/interaction`, interactionData);
};

export const addInteractionState = (state, options = {}) => {
  window.gsStore.interactionCount++;
  let event = '';
  if (state == 'cart') {
    event = 'purchase';
  }
  const now = new Date().getTime();
  const expirationDate = now + 24 * 60 * 60 * 1000; // Add 24 hours
  const type = 'interaction-' + event;
  addToQueue({
    expirationDate,
    type
  });

  return httpPost(`/interaction/state/${state}`, options);
};

export const findState = () => {
  return httpGet(`/channel/state`);
};

export const findLastInteractions = (limit = 10) => {
  return httpGet(`/channel/last-interactions?limit=${limit}`);
};

export const reorderCategories = (interactions, categories) => {
  const categoryCounts = new Map();

  interactions.forEach(interaction => {
    // Check if data and itemData exist
    if (interaction.data && interaction.data.itemData) {
      const categoryIds = interaction.data.itemData.category_ids;
      // Check if category_ids exists and is a string
      if (typeof categoryIds === 'string') {
        categoryIds.split(',').forEach(categoryId => {
          const trimmedId = categoryId.trim();
          if (trimmedId) {
            categoryCounts.set(trimmedId, (categoryCounts.get(trimmedId) || 0) + 1);
          }
        });
      }
    }
  });

  const updatedCategories = categories.map(category => ({
    ...category,
    interactionCount: categoryCounts.get(String(category.id)) || 0
  }));

  updatedCategories.sort((a, b) => b.interactionCount - a.interactionCount);

  return updatedCategories;
}

export const updateState = (obj) => {
  return httpPut(`/channel/state`, obj);
};

export const addBulkInteractions = (interactions) => {
  if (interactions.length == 0) {
    return;
  }

  const id = generateUniqueId();
  const interactionData = interactions[0];
  const now = new Date().getTime();
  const expirationDate = now + 24 * 60 * 60 * 1000; // Add 24 hours
  const type = 'interaction-' + interactionData.event;
  addToQueue({
    expirationDate,
    type
  });

  return httpPost(`/interaction/bulk`, {
    transactionId: id,
    events: interactions
  });
};

export const addFeedback = (feedbackData) => {
  // Implementation of logout will depend on your specific API
  return httpPost(`/feedback`, feedbackData);
};

export const triggerJourney = (data) => {
  // Implementation of logout will depend on your specific API
  return httpPost(`/journey/trigger`, data);
};

export const logout = (clientId) => {
  const session = getSession();
  if (session['customer_id']) {
    clearSession();
    window.gsResetSession();
  } else {
    return;
  }
  return httpPost(`/channel/logout`, { clientId });
};

export const getItems = async (params) => {
  const limit = params.limit || 20;
  const offset = params.offset || 0;
  let q = `?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;

  if (params.where) {
    const whereString = JSON.stringify(params.where);
    q += `&where=${encodeURIComponent(whereString)}`;
  }

  if (params.sortBy) {
    const sortByString = JSON.stringify(params.sortBy);
    q += `&sortBy=${encodeURIComponent(sortByString)}`;
  }

  return httpGet(`/item${q}`);
};

export const search = async (input, params) => {
  let q = `?query=${input}`;

  if (params.insta) {
    q += `&insta=1`;
  }
  if (params.limit) {
    q += `&limit=${params.limit}`;
  }

  if (window.gsSearchOptions && window.gsSearchOptions.hasRetrievalQA) {
    q += `&hasRetrievalQA=${window.gsSearchOptions.hasRetrievalQA}`
  }

  if (params.ignoreMetrics) {
    q += `&ignoreMetrics=true`;
  }

  if (params.type) {
    q += `&typeOverride=${params.type}`;
  }

  return httpGet(`/item/search${q}`);
};

export const searchRedirect = async (input, params) => {
  let q = `?query=${input}`;

  if (params.searchResultId) {
    q += `&searchResultId=${params.searchResultId}`;
  }

  return httpGet(`/item/search-redirect${q}`);
};

export const searchResult = async (payload) => {
  return httpPost(`/item/search-result`, payload);
};

export const updateSearchResult = async (id, payload) => {
  payload.id = id;
  return httpPatch(`/item/search-interaction`, payload);
};

export const imageSearch = async (formData, params) => {

  let q = `?sdk=1`;
  if (params.text && params.text.length > 0) {
    q = `&text=${params.text}`
  }
  if (window.gsSearchOptions && window.gsSearchOptions.hasMultimodal) {
    q += `&hasMultimodal=${window.gsSearchOptions.hasMultimodal}`
    q += `&ignoreRanking=${window.gsSearchOptions.hasMultimodal}`
  }

  if (params.ignoreMetrics) {
    q += `&ignoreMetrics=true`;
  }

  if (params.limit) {
    q += `&maxItems=${params.limit}`;
  }

  return httpPostFormData(`/item/image-search${q}`, formData);
};

export const voiceSearch = async (formData, params) => {

  let q = `?sdk=1`;
  if (params.text && params.text.length > 0) {
    q = `&text=${params.text}`
  }
  if (window.gsSearchOptions && window.gsSearchOptions.hasMultimodal) {
    q += `&hasMultimodal=${window.gsSearchOptions.hasMultimodal}`
    q += `&ignoreRanking=${window.gsSearchOptions.hasMultimodal}`
  }

  if (params.ignoreMetrics) {
    q += `&ignoreMetrics=true`;
  }

  return httpPostFormData(`/item/voice-search${q}`, formData);
};

export const uploadImage = async (formData, params) => {
  return httpPostFormData(`/item/upload`, formData);
};

export const getCount = async (params) => {
  let q = ``;

  if (params.where) {
    const whereString = JSON.stringify(params.where);
    q += `?where=${encodeURIComponent(whereString)}`;
  }

  return httpGet(`/item/count${q}`);
};

export const getItemById = async (id) => {
  return httpGet(`/item/${id}`);
};

export const getRanking = async (ranking, params) => {
  const q = jsonToQueryString(params || {});
  return httpGet(`/item/ranking/${ranking}/${q}`);
};

export const reRank = async (ranking, params) => {
  const affinityField = params.affinityField;
  const items = params.items;
  return httpPost(`/item/rerank/${ranking}/?affinityField=${affinityField}`, { items });
};

export const getFieldValues = async (params) => {
  const field = params.field || 'category';
  return httpGet(`/item/custom-attributes/${field}`);
};

export const setPreferences = (params) => {
  return httpPut(`/channel/preferences`, params);
};

export const getState = (params = {}) => {
  return httpGet(`/channel/state`);
}

export const getAffinity = (params = {}) => {
  return httpGet(`/channel/whoiam/affinity`);
}

function generateUniqueId() {
  let array = new Uint8Array(16);
  window.crypto.getRandomValues(array);
  const time = new Date().getTime();
  return time + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const getCurrentSession = () => {
  const session = getSession();
  return session;
}