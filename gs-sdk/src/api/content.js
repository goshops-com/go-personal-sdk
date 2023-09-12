
import { httpGet, httpPost } from '../utils/http';
import { injectCSS, addHTMLToDiv, addHTMLToBody, addJavaScriptToBody } from '../utils/dom';
import { previewVariant, getParam } from '../utils/urlParam';
import { suscribe } from '../utils/trigger';


window.gsStore = {
  context: {

  },
  interactionCount: 0
};

export const getContentByContext = async (context, options) => {

  console.log('getContentByContext', context, options)
  if (!options){
    options = {}
  }
  options.type = context;

  const includeDraft = window.gsConfig.includeDraft;
  let url = `/personal/content-page?pageType=${context}`;
  if (includeDraft){
    url += '&includeDraft=true';
  }

  const payload = buildContextPayload(options);
  const result = await httpPost(url, payload);
  const contents = result.loadNowContent;
  await Promise.all(contents.map(content => addContentToWebsite(content, options)));
  const lazyLoadContent = result.lazyLoadContent;
  await Promise.all(lazyLoadContent.map(content => getContent(content.key, options)));

};

export const getContent = async (contentId, options) => {
  console.log('Content', contentId, options);
  if (!options){
    options = {}
  }
  if (!options.type){
    options.type = "Home"
  }
  const includeDraft = window.gsConfig.includeDraft;

  const gsElementSelector = getParam('gsElementSelector');
  if (gsElementSelector != null){
    return;
  }
  
  // we need to check if we are on preview or not. 
  const prevVarId = previewVariant();
  console.log('[DEBUG] Preview Variant Id', prevVarId);
  let content;
  if (prevVarId === null){
    const payload = buildContextPayload(options)

    let url = `/personal/content/${contentId}?byPassCache=true`;
    if (includeDraft){
      url += '&includeDraft=true';
    }
    content = await httpPost(url, payload);
  }else{
    content = await httpGet(`/personal/content/${contentId}/variant/${prevVarId}`);
  }
  
  console.log('Content found', content);
  if (!content.key){
    content.key = contentId;
  }
  addContentToWebsite(content, options);
};

function buildContextPayload(options){
  return {
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
        ...options,
        location: window.location.href,
      },
    },
  };
}
async function addContentToWebsite(content, options){
  console.log('addContentToWebsite');

  if (content && content.contentValue){
    const css = content.contentValue.css;
    const html = content.contentValue.html;
    const js = content.contentValue.js;
    
    if (!css && !html && !js){
      return; //nothing to inyect
    }

    const proceed = async () => {
      injectCSS(css);

      const types = ['custom_code', 'pop_up', 'notifications'];

      if (types.includes(content.type)){

        const canShow = canShowContent(content.frequency, content.experienceId);
        console.log('canShow by frecuency', canShow, options.forceShow);

        if (options.forceShow){
          console.log('showing')
          addHTMLToBody(html);
          addJavaScriptToBody(js);
        }else{
          if (canShow){
            console.log('suscribe')
            suscribe(content, function(html, js){
              console.log('callback', html, js)
              addHTMLToBody(html);
              addJavaScriptToBody(js);
            })  
          }
        }
      }else{
        // web content
        const selector = content.selector;
        const selectorPosition = content.selectorPosition;
        await addHTMLToDiv(html, selector, selectorPosition);
        if (js){
          addJavaScriptToBody(js);
        }
      }
    };
    
    // Check if the DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', proceed); // Wait for DOM ready
    } else {
      await proceed(); // Proceed immediately
    }

  }
}

function canShowContent(frequency, contentId) {

  if (!frequency){
    return true;
  }

  const now = new Date().getTime();
  const storageKey = `gs_content_seen`;
  let contentData = localStorage.getItem(storageKey);
  contentData = contentData ? JSON.parse(contentData) : {};
  let entry = contentData[contentId];
  let nextTime;

  if (entry) {
    const { lastSeen, period } = entry;

    switch (frequency) {
      case 'once_page':
        return true;
      case 'once_sesion':
        if (period !== 'once_sesion' || now - lastSeen > 24 * 3600 * 1000) {
          nextTime = true;
        }
        break;
      case 'once_day':
        if (period !== 'once_day' || now - lastSeen > 24 * 3600 * 1000) {
          nextTime = true;
        }
        break;
      case 'once_week':
        if (period !== 'once_week' || now - lastSeen > 7 * 24 * 3600 * 1000) {
          nextTime = true;
        }
        break;
      case 'once_month':
        if (period !== 'once_month' || now - lastSeen > 30 * 24 * 3600 * 1000) {
          nextTime = true;
        }
        break;
      case 'once':
        if (period !== 'once') {
          nextTime = true;
        }
        break;
      default:
        return false;
    }
  } else {
    nextTime = true;
  }

  if (nextTime) {
    contentData[contentId] = { lastSeen: now, period: frequency };
    localStorage.setItem(storageKey, JSON.stringify(contentData));
    return true;
  }

  return false;
}
