import { httpGet, httpPost, httpPatch, httpPublicGet } from '../utils/http';
import { injectCSS, addHTMLToDiv, addHTMLToBody, addJavaScriptToBody, deleteGoPersonalElements } from '../utils/dom';
import { previewVariant, getParam } from '../utils/urlParam';
import { suscribe } from '../utils/trigger';
import { getSession } from '../utils/storage';
import { sendEvent } from '../utils/custom';
window.gsStore = {
  context: {

  },
  interactionCount: 0
};

async function obtainContentByContext(url, payload, context, includeDraft = false) {
  const cacheKey = `gs_content_cache_${context}_${includeDraft}`;
  const now = Date.now();
  const CACHE_TTL = 5000;
  
  let cachedData = localStorage.getItem(cacheKey);
  
  if (cachedData) {
    cachedData = JSON.parse(cachedData);
    
    if (now - cachedData.timestamp < CACHE_TTL) {
      return cachedData.data;
    }
    
    const result = cachedData.data;
    
    httpPost(url, payload).then(freshData => {
      localStorage.setItem(cacheKey, JSON.stringify({
        data: freshData,
        timestamp: Date.now()
      }));
    }).catch(error => {
      console.error('Error updating cached content:', error);
    });
    
    return result;
  }
  
  const result = await httpPost(url, payload);
  
  localStorage.setItem(cacheKey, JSON.stringify({
    data: result,
    timestamp: now
  }));
  
  return result;
}

export const getContentByContext = async (context, options) => {

  window.gsLog('getContentByContext', context, options)
  if (!options) {
    options = {}
  }
  options.type = context;

  const includeDraft = window.gsConfig.includeDraft;
  const includeDraftParam = getParam('gsIncludeDraft');
  let url = `/personal/content-page?pageType=${context}`;
  if (includeDraft || (includeDraftParam && includeDraftParam == 'true')) {
    url += '&includeDraft=true';
  }

  const payload = buildContextPayload(options);
  const result = await obtainContentByContext(url, payload, context, includeDraftParam);
  const contents = result.loadNowContent;

  try {
    if (options.singlePage) {
      deleteGoPersonalElements();
    }
  } catch (e) {
    console.log(e);
  }

  try {
    window.gsLog('LoadNowContent ' + contents.length);
    Promise.all(contents.map(content => addContentToWebsite(content, options)));
  } catch (e) {
    console.error(e);
  }

  try {
    const lazyLoadContent = result.lazyLoadContent;
    window.gsLog('LazyLoadContent ' + lazyLoadContent.length);
    await Promise.all(lazyLoadContent.map(content => getContent(content.key, { ...options, cache: content.cache || 0 })));
  } catch (e) {
    console.error(e);
  }


};

export const getContent = async (contentId, options) => {
  if (!options) {
    options = {}
  }
  if (!options.type) {
    options.type = "Home"
  }
  let includeDraft = window.gsConfig.includeDraft;
  const includeDraftParam = getParam('gsIncludeDraft');
  if (includeDraftParam == 'true') {
    includeDraft = true;
  }
  const gsElementSelector = getParam('gsElementSelector');
  if (gsElementSelector != null) {
    return;
  }

  // we need to check if we are on preview or not. 
  const prevVarId = previewVariant();

  let content;

  const sessionObj = getSession();

  if (options.cache && sessionObj.project){
    content = await httpPublicGet(`/public/cached-content/${sessionObj.project}/${contentId}`);
  }else{
    if (prevVarId === null) {
      const payload = buildContextPayload(options)
  
      let url = `/personal/content/${contentId}`;
      const params = new URLSearchParams();
      if (includeDraft) {
        params.append('includeDraft', 'true');
      }
      if (options.impressionStatus) {
        params.append('impressionStatus', options.impressionStatus);
      }
      
      if (sessionObj &&sessionObj.project) {
        params.append('project', sessionObj.project);
      }
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      content = await httpPost(url, payload);
    } else {
      content = await httpGet(`/personal/content/${contentId}/variant/${prevVarId}`);
    }
  }

  if (!content.key) {
    content.key = contentId;
  }
  if (content.delay){
    await new Promise(resolve => setTimeout(resolve, content.delay));
  }
  addContentToWebsite(content, options);

  if (content.type == 'API'){
    return content;
  }
};

function buildContextPayload(options) {

  let download;
  let effectiveType;
  try {
    download = navigator.connection.downlink;
    effectiveType = navigator.connection.effectiveType;
  } catch (e) {

  }
  return {
    context: {
      network: {
        downlink: download,
        effectiveType: effectiveType,
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
        provider: window?.gsConfig?.options?.provider || null,
        location: window.location.href,
        referrer: typeof document !== 'undefined' ? document.referrer || '' : '',
      },
    },
  };
}
async function addContentToWebsite(content, options) {
  window.gsLog('addContentToWebsite', content.key);

  
  if (content && content.contentValue) {

    const skipKeys = Array.isArray(window.gsConfig?.options?.skipContents) ? window.gsConfig.options.skipContents : [];
    if (skipKeys.length > 0 && content && typeof content.key === 'string' && skipKeys.includes(content.key)) {
      // skip this content
      return;
    }
    const css = content.contentValue.css;
    const html = content.contentValue.html;
    const js = content.contentValue.js;
    const notAutomatic = content.notAutomatic || false;

    if (!css && !html && !js) {
      window.gsLog('skip')
      return; //nothing to inyect
    }

    const proceed = async () => {
      injectCSS(css, content.key);

      const types = ['custom_code', 'pop_up', 'notifications'];

      if (types.includes(content.type)) {

        const canShow = canShowContent(content.frequency, content.experienceId);

        if (options.forceShow) {
          addHTMLToBody(html);
          addJavaScriptToBody(js, content.key);
        } else {
          if (canShow && !notAutomatic) {
            suscribe(content, function (html, js) {
              addHTMLToBody(html);
              addJavaScriptToBody(js, content.key);
            })
          }
        }
      } else {
        // web content
        let selector = content.selector;
        let selectorPosition = content.selectorPosition;
        if (!selector) {
          selector = 'body';
          selectorPosition = 'after'
        }
        window.gsLog('adding to dom', selector)

        const isMobile = isMobileDevice();
        const hasMobileSelector = isNotEmpty(content.mobileSelector);

        if (isMobile && hasMobileSelector) {
          selector = content.mobileSelector;
        }

        await addHTMLToDiv(html, selector, selectorPosition, options);
        if (js) {
          addJavaScriptToBody(js, content.key);
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

  window.gsLog('end addContentToWebsite', content.key);
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isNotEmpty(str) {
  return str !== null && str !== "";
}
function canShowContent(frequency, contentId) {

  if (!frequency) {
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

export const openImpression = async (impressionId) => {
  try {
    if (!impressionId || typeof impressionId !== 'string' || window.gsImpressionIds.includes(impressionId)) {
      return;
    }

    window.gsImpressionIds.push(impressionId);
    return await httpPatch(`/personal/impression/${impressionId}`, { status: 'opened' });
  } catch (error) {
    console.error('Error:', error);
    return;
  }
};

export const trackURLClicked = (executionId) => {
  return httpPatch(`/public/track`, { executionId: executionId });
};


export const observeElementInView = (elementId, impressionId, callback) => {

  // Function that will be called when the div is in the viewport
  function internalCallback(entries, observer) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // The div is now in the viewport
        callback(elementId, impressionId);
      }
    });
  }

  // Create an instance of the Intersection Observer
  let observer = new IntersectionObserver(internalCallback);

  // Target the div element you want to observe
  let target = document.getElementById(elementId);

  // Start observing the target element
  observer.observe(target);
}

export const cleanContent = () => {
  deleteGoPersonalElements();
}

export const sendEvent = (key, value) => {
  const sessionObj = getSession();
  sendEvent(key, value, sessionObj.vuuid);
}