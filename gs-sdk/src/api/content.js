import { httpGet, httpPost, httpPut } from '../utils/http';
import { injectCSS, addHTMLToDiv, addHTMLToBody, addJavaScriptToBody } from '../utils/dom';
import { previewVariant, getParam } from '../utils/urlParam';

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
  await Promise.all(contents.map(content => addContentToWebsite(content)));
  const lazyLoadContent = result.lazyLoadContent;
  await Promise.all(lazyLoadContent.map(content => getContent(clientId, content.key, options)));

};

export const getContent = async (clientId, contentId, options) => {
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

  addContentToWebsite(content);
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
async function addContentToWebsite(content){
  if (content && content.contentValue){
    const css = content.contentValue.css;
    const html = content.contentValue.html;
    const js = content.contentValue.js;
    const variables = content.contentValue.variables || [];

    if (!css && !html && !js){
      return; //nothing to inyect
    }

    const proceed = async () => {
      injectCSS(css);
      if (content.key == 'popup'){
        addHTMLToBody(html);
        const delay = filterAndParseInt(variables, 'Delay no interaction');
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