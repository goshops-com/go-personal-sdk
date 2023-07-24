import { httpGet, httpPost, httpPut } from '../utils/http';
import { injectCSS, addHTMLToDiv, addHTMLToBody, addJavaScriptToBody } from '../utils/dom';
import { previewVariant, getParam } from '../utils/urlParam';

window.gsStore = {
  interactionCount: 0
};


export const getContentByContext = async (context) => {
  const contentKeys = await httpGet(`/personal/content?pageType=${context}`);
  // Iterate over the contentKeys array and call getContent for each key
  for (const key of contentKeys) {
    await getContent(undefined, key.key);
  }
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
      await addHTMLToDiv(html, selector);
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