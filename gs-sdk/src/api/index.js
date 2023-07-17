import { httpGet, httpPost } from '../utils/http';
import { setSession } from '../utils/storage';
import { injectCSS, addHTMLToDiv } from '../utils/dom';
import { previewVariant } from '../utils/urlParam';

export const init = async (clientId) => {
  // Implementation of login will depend on your specific API
  const obj = await httpPost(`/channel/init`, { clientId, firstURL: window.location.href });
  console.log(obj)
  setSession(obj);
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

export const getContent = async (clientId, contentId) => {

  // we need to check if we are on preview or not. 

  const prevVarId = previewVariant();
  console.log('Preview Variant Id', prevVarId);
  let content;
  if (prevVarId === undefined){
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
    content = await httpGet(`/personal/content/${contentId}/variant/${previewVariant}`);
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

