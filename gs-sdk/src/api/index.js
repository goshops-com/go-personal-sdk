import { httpGet, httpPost, httpPut } from '../utils/http';
import { setSession, clearSession } from '../utils/storage';
import { injectCSS, addHTMLToDiv } from '../utils/dom';
import { previewVariant, jsonToQueryString, getParam } from '../utils/urlParam';

export const init = async (clientId) => {
  
  const reset = await getParam('gsReset');
  if (reset){
    await clearSession();
    console.log('Removed session')
  }
  const obj = await httpPost(`/channel/init`, { clientId, firstURL: window.location.href });
  console.log(obj)
  await setSession(obj);
  console.log('Set session')
  return obj;
};

export const login = (clientId, username) => {
  // Implementation of login will depend on your specific API
  return httpPost(`/login`, { clientId, username });
};

export const addInteraction = (clientId, interactionData) => {
  // Implementation of addInteraction will depend on your specific API
  return httpPost(`/interaction`, { clientId, ...interactionData });
};

export const logout = (clientId) => {
  // Implementation of logout will depend on your specific API
  return httpPost(`/logout`, { clientId });
};

export const getItems = async (params) => {
  const limit = params.limit || 20;
  const offset = params.offset || 0;
  let q = `?limit=${limit}&offset=${offset}`;
  if (params.where){
    q += `&where=${JSON.stringify(params.where)}`
  }
  if (params.sortBy){
    q += `?sortBy=${JSON.stringify(params.sortBy)}`
  }
  return httpGet(`/item${q}`);
};

export const getRanking = async (ranking, params) => {
  const q = jsonToQueryString(params || {});
  return httpGet(`/item/ranking/${ranking}/${q}`);
};

export const getFieldValues = async (params) => {
  const field = params.field || 'category';
  return httpGet(`/item/custom-attributes/${field}`);
};

export const setPreferences = (params) => {
  return httpPut(`/channel/preferences`, params);
};

export const getContent = async (clientId, contentId) => {

  // we need to check if we are on preview or not. 
  const prevVarId = previewVariant();
  console.log('[DEBUG] Preview Variant Id', prevVarId);
  let content;
  if (prevVarId === null){
    const payload = {
      context: {
        network: {
          downlink: navigator.connection.downlink,
          effectiveType: navigator.connection.effectiveType,
        },
        screen: {
          width: window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth,
          height: window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight,
        },
        settings: {
          locale: navigator.language || navigator.userLanguage,
          timezoneOffset: new Date().getTimezoneOffset(),
        },
        currentPage: {
          type: "Home", // This should be updated based on the page type
          location: window.location.href,
        },
      },
    };
    content = await httpPost(`/personal/content/${contentId}?byPassCache=true`, payload);
  }else{
    content = await httpGet(`/personal/content/${contentId}/variant/${prevVarId}`);
  }
  
  console.log('Content found', content);

  if (content && content.contentValue){
    const css = content.contentValue.css;
    const html = content.contentValue.html;
    const selector = content.selector;

    injectCSS(css);
    addHTMLToDiv(html, selector);
  }
};

