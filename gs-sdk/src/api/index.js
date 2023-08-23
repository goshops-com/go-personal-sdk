import { httpGet, httpPost, httpPut, httpPostFormData } from '../utils/http';
import { setSession, clearSession, isTokenValid, getToken, checkSameClientId, setClientId } from '../utils/storage';
import { jsonToQueryString, getParam } from '../utils/urlParam';
import { setupContentSelector } from '../utils/configure';
import { getContentByContext } from './content';

window.gsStore = {
  interactionCount: 0
};

export const init = async (clientId, options) => {
  
  window.gsLog('Init Options', options);
  window.gsConfig.includeDraft = options.includeDraft;

  const sameClientId = checkSameClientId(clientId);
  const reset = getParam('gsReset');
  if (reset || !sameClientId){
    clearSession();
    setClientId(clientId);
  }

  if (isTokenValid()){
    const obj = getToken();
    executeInitialLoad(clientId, options);
    return obj;
  }
  const obj = await httpPost(`/channel/init`, { clientId, firstURL: window.location.href });
  console.log(obj)
  setSession(obj);

  const gsElementSelector = getParam('gsElementSelector');
  const gsContentKey = getParam('gsContentKey');
  console.log('gsElementSelector', gsElementSelector);
  console.log('gsContentKey', gsContentKey);

  if (gsElementSelector != null && gsContentKey != null){
    await setupContentSelector(gsContentKey);
  }
  executeInitialLoad(clientId, options);
  return obj;
};

async function executeInitialLoad(clientId, options){
  if (options && options.provider){
    const context = getPageType(options.provider);
    if (context){
      const { pageType, ...contentWithoutPageType } = context;
      const result = await getContentByContext(pageType, contentWithoutPageType);
      console.log('content result', result);
    }
  }
};

function getPageType(provider) {
  if (provider && provider.toUpperCase() === 'FENICIO') {
    const path = window.location.pathname;

    if (path === '/') {
      return { pageType: 'home' };
    }

    if (path.startsWith('/catalogo/')) {
      const parts = path.split('_');
      const productId = parts[parts.length - 1].split('-')[0];
      return { pageType: 'product_detail', productId: productId };
    }

    if (path === '/checkout/') {
      return { pageType: 'cart' };
    }
  }

  return undefined;
}

export const login = (username) => {
  // Implementation of login will depend on your specific API
  return httpPost(`/channel/login`, { customerId: username });
};

export const addInteraction = (clientId, interactionData) => {
  window.gsStore.interactionCount++;

  return httpPost(`/interaction`, interactionData);
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