import { httpGet, httpPost, httpPut } from '../utils/http';
import { setSession, clearSession } from '../utils/storage';
import { injectCSS, addHTMLToDiv, addHTMLToBody, addJavaScriptToBody } from '../utils/dom';
import { previewVariant, jsonToQueryString, getParam } from '../utils/urlParam';
import { setupContentSelector } from '../utils/configure';

window.gsStore = {
  interactionCount: 0
};

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

  const gsElementSelector = await getParam('gsElementSelector');
  const gsContentKey = await getParam('gsContentKey');
  console.log('gsElementSelector', gsElementSelector);
  console.log('gsContentKey', gsContentKey);

  if (gsElementSelector != null && gsContentKey != null){
    await setupContentSelector(gsContentKey);
  }
  return obj;
};

export const login = (clientId, username) => {
  // Implementation of login will depend on your specific API
  return httpPost(`/login`, { clientId, username });
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

export const getContent = async (clientId, contentId) => {

  const gsElementSelector = await getParam('gsElementSelector');

  if (gsElementSelector != null){
    return;
  }
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
    const js = content.contentValue.js;
    const variables = content.contentValue.variables || [];

    await injectCSS(css);

    if (js && js.length > 0){
      addHTMLToBody(html);

      const delay = filterAndParseInt(variables, 'Delay no interaction');
      console.log('Delay', delay)
      if (delay.length > 0){
        setTimeout(async function(){
          console.log('Adding JS')
          if (!window.gsStore.interactionCount){
            addJavaScriptToBody(js);
          }else{
            console.log('Interacted, cancelling JS');
          }
          
        },delay[0].value * 1000)
      }else{
        addJavaScriptToBody(js);
      }
    }else{
      const selector = content.selector;
      addHTMLToDiv(html, selector);
    }
    
  }
};

function filterAndParseInt(variables, name) {
  const filteredVariables = variables.filter((variable) => variable.name === name);

  const parsedVariables = filteredVariables.map((variable) => {
    if (variable.type.id === "number") {
      variable.value = parseInt(variable.value);
    }
    return variable;
  });

  return parsedVariables;
}