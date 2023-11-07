import { httpGet, httpPost, httpPut, httpPostFormData, configure } from '../utils/http';
import { setSession, clearSession, isTokenValid, getToken, checkSameClientId, setClientId, getSession } from '../utils/storage';
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
  
  window.gsLog('Init Options', JSON.stringify(options));
  window.gsConfig.includeDraft = options.includeDraft;

  clientId = configure(clientId);
  const clientOrigin = window.location.origin;

  const sameClientId = checkSameClientId(clientId);
  const reset = getParam('gsReset');
  if (reset || !sameClientId){
    clearSession();
    setClientId(clientId);
  }

  if (isTokenValid()){
    const obj = getToken();
    const session = getSession();
    executeInitialLoad(clientId, session, options);
    subscribeQueue();
    return obj;
  }

  let q = '?';
  if (options.byPassCache){
    q += 'byPassCache=true';
  }

  let externalSessionId;
  if (options.multipleDomains){
    externalSessionId = await getSharedToken(clientId, clientOrigin);
  }
  
  const obj = await httpPost(`/channel/init${q}`, { clientId, externalSessionId, firstURL: window.location.href });
  console.log(obj)
  setSession(obj);

  const gsElementSelector = getParam('gsElementSelector');
  const gsContentKey = getParam('gsContentKey');
  console.log('gsElementSelector', gsElementSelector);
  console.log('gsContentKey', gsContentKey);

  if (gsElementSelector != null && gsContentKey != null){
    await setupContentSelector(gsContentKey);
  }
  executeInitialLoad(clientId, obj, options);
  subscribeQueue();
  return clientId;
};


async function executeInitialLoad(clientId, session, options){
  if (options && options.provider && options.provider != 'Custom'){
    const context = getPageType(options.provider);
    if (context){
      const { pageType, ...contentWithoutPageType } = context;
      const result = await getContentByContext(pageType, contentWithoutPageType);
      console.log('content result', result);

      if (context.pageType == 'product_detail'){
        let eventData = {
          ...contentWithoutPageType,
          event: "view"
        };
        eventData['type'] = undefined;
        await window.gsSDK.addInteraction(eventData);
      }
      return;
    }
  }

  console.log('session.channelConfig4', session.channelConfig);

  if (session.channelConfig){
    const channelConfig = session.channelConfig.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

    // Extract the function body from the string
    const functionBody = channelConfig.slice(channelConfig.indexOf("{") + 1, channelConfig.lastIndexOf("}"));
    // Create a new function using the extracted body
    const determinePageType = new Function(functionBody);
    // Call the function and get the result
    const context = determinePageType();

    console.log('context', context);

    const { pageType, ...contentWithoutPageType } = context;
    const result = await getContentByContext(pageType, contentWithoutPageType);
    console.log('content result', result);
    return;
  }
};

function getPageType(provider) {
  if (provider && provider.toUpperCase() === 'FENICIO') {

    window.gsLog('Init Vendor 2');
    initVendorFenicio({});

    const path = window.location.pathname;

    if (path === '/') {
      return { pageType: 'home' };
    }

    if (path.startsWith('/catalogo/')) {
      try{
        const parts = path.split('_');
        let sku = `1:${parts[1]}:${parts[2]}:U:1`;
        return { pageType: 'product_detail', sku: sku };
      }catch(e){
        console.error(e)
      }
    }

    if (path === '/checkout/') {
      return { pageType: 'cart' };
    }
  }

  return undefined;
}

export const clearSharedSession = (clientId) => {
  clearToken(clientId);
}

export const login = (id) => {
  return httpPost(`/channel/login`, { customerId: id });
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

export const findState = () => {
  return httpGet(`/channel/state`);
};

export const addBulkInteractions = (interactions) => {
  if (interactions.length == 0){
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

export const logout = (clientId) => {
  // Implementation of logout will depend on your specific API
  return httpPost(`/logout`, { clientId });
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

  if (window.gsSearchOptions && window.gsSearchOptions.hasRetrievalQA){
    q += `&hasRetrievalQA=${window.gsSearchOptions.hasRetrievalQA}`
  }

  return httpGet(`/item/search${q}`);
};

export const imageSearch = async (formData, params) => {

  let q = `?sdk=1`;
  if (params.text && params.text.length > 0){
    q = `&text=${params.text}`
  }
  if (window.gsSearchOptions && window.gsSearchOptions.hasMultimodal){
    q += `&hasMultimodal=${window.gsSearchOptions.hasMultimodal}`
    q += `&ignoreRanking=${window.gsSearchOptions.hasMultimodal}`
  }

  return httpPostFormData(`/item/image-search${q}`, formData);
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

function generateUniqueId() {
  let array = new Uint8Array(16);
  window.crypto.getRandomValues(array);
  const time = new Date().getTime();
  return time + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}