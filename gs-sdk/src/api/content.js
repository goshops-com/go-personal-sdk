import { httpGet, httpPost, httpPatch, httpPublicGet } from "../utils/http";
import {
  injectCSS,
  addHTMLToDiv,
  addHTMLToBody,
  addJavaScriptToBody,
  deleteGoPersonalElements,
} from "../utils/dom";
import { previewVariant, getParam } from "../utils/urlParam";
import { suscribe } from "../utils/trigger";
import {
  getSession,
  getContentImpression,
  setContentImpression,
} from "../utils/storage";
import { sendEvent } from "../utils/custom";
import { renderTemplate, renderRaw } from "../utils/handlebars";
import {
  getCachedContent,
  setCachedContent,
  invalidateContentCache,
  purgeContentCache,
} from "../utils/contentCache";

const ENABLE_CONTENT_POST_CACHE = true;

window.gsStore = {
  context: {},
  interactionCount: 0,
};

async function obtainContentByContext(
  url,
  payload,
  context,
  includeDraft = false,
) {
  const locationHref =
    payload?.context?.currentPage?.location || window.location.href || "";
  const cacheKey = `gs_content_cache_${context}_${includeDraft}_${encodeURIComponent(locationHref)}`;
  const now = Date.now();
  const CACHE_TTL = 5000;

  let cachedData = localStorage.getItem(cacheKey);

  if (cachedData) {
    cachedData = JSON.parse(cachedData);
    if (now - cachedData.timestamp < CACHE_TTL) {
      return cachedData.data;
    }

    const result = cachedData.data;

    httpPost(url, payload)
      .then((freshData) => {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            data: freshData,
            timestamp: Date.now(),
          }),
        );
      })
      .catch((error) => {
        console.error("Error updating cached content:", error);
      });

    return result;
  }

  const result = await httpPost(url, payload);

  localStorage.setItem(
    cacheKey,
    JSON.stringify({
      data: result,
      timestamp: now,
    }),
  );

  return result;
}

export const getContentByContext = async (context, options = {}) => {
  const sessionObj = getSession();
  const onlyForcedProjects = [
    "67374d510dfcc232a627662e",
    "67374d2d0dfcc28c73276534",
    "67374d240dfcc2a4ff2764e8",
    "67374d1d0dfcc2ee482764c2",
    "671143e6fc0d0c3bb6ab89c5",
  ];
  if (!options.force && onlyForcedProjects.includes(sessionObj?.project)) {
    return;
  }

  window.gsLog("getContentByContext", context, options);
  try {
    window.__gsLastContentContext = { context, ts: Date.now(), url: window.location.href };
  } catch (e) { /* noop */ }
  if (!options) {
    options = {};
  }
  options.type = context;

  const includeDraft = window.gsConfig.includeDraft;
  const includeDraftParam = getParam("gsIncludeDraft");
  const gsDebug = getParam("gsDebug") == "true";
  let url = `/personal/content-page?pageType=${context}`;
  if (includeDraft || (includeDraftParam && includeDraftParam == "true")) {
    url += "&includeDraft=true";
  }

  if (!sessionObj || !sessionObj.project) {
    console.log("No session or project found");
    return;
  }

  let result;

  if (gsDebug || includeDraft || (includeDraftParam && includeDraftParam == "true")) {
    const payload = buildContextPayload(options);
    result = await obtainContentByContext(
      url,
      payload,
      context,
      includeDraftParam,
    );
  } else {
    try {
      let getURL = `/public/cached-content/${sessionObj.project}/?pageType=${context}`;
      result = await httpPublicGet(getURL);
    } catch (e) {
      console.error("Error fetching cached content:", e);
      const payload = buildContextPayload(options);
      result = await obtainContentByContext(
        url,
        payload,
        context,
        includeDraftParam,
      );
    }
  }

  const contents = result.loadNowContent;

  try {
    if (options.singlePage) {
      deleteGoPersonalElements();
    }
  } catch (e) {
    console.log(e);
  }

  try {
    window.gsLog("LoadNowContent " + contents.length);
    Promise.all(
      contents.map((content) => addContentToWebsite(content, options)),
    );
  } catch (e) {
    console.error(e);
  }

  try {
    const lazyLoadContent = result.lazyLoadContent;
    window.gsLog("LazyLoadContent " + lazyLoadContent.length);
    await Promise.all(
      lazyLoadContent.map((content) =>
        getContent(content.key, { ...options, cache: content.cache || 0 }),
      ),
    );
  } catch (e) {
    console.error(e);
  }
};

export const getContent = async (contentId, options) => {
  if (!options) {
    options = {};
  }
  if (!options.type) {
    options.type = "Home";
  }
  let includeDraft = window.gsConfig.includeDraft;
  const includeDraftParam = getParam("gsIncludeDraft");
  const gsDebug = getParam("gsDebug") == "true";
  if (includeDraftParam == "true") {
    includeDraft = true;
  }
  const gsElementSelector = getParam("gsElementSelector");
  if (gsElementSelector != null) {
    return;
  }

  // we need to check if we are on preview or not.
  const prevVarId = previewVariant();

  let content;

  const sessionObj = getSession();

  if (options.cache && sessionObj.project && !gsDebug) {
    content = await httpPublicGet(
      `/public/cached-content/${sessionObj.project}/${contentId}`,
    );
  } else {
    if (prevVarId === null) {
      const payload = buildContextPayload(options);

      let url = `/personal/content/${contentId}`;
      const params = new URLSearchParams();
      if (includeDraft) {
        params.append("includeDraft", "true");
      }
      if (options.impressionStatus) {
        params.append("impressionStatus", options.impressionStatus);
      }

      if (sessionObj && sessionObj.project) {
        params.append("project", sessionObj.project);
      }

      const useClientSideRender = !includeDraft && !gsDebug;
      if (useClientSideRender) {
        params.append("onlyData", "true");
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      if (useClientSideRender) {
        let data;
        const cached = ENABLE_CONTENT_POST_CACHE
          ? getCachedContent(contentId, options)
          : null;

        if (cached) {
          data = cached;
        } else {
          const result = await httpPost(url, payload);
          data = result.data;
          if (ENABLE_CONTENT_POST_CACHE && data?.variantId) {
            setCachedContent(contentId, options, data);
          }
        }

        if (!data?.variantId) {
          return;
        }

        // Get variant template
        const variantResponse = await httpPublicGet(
          `/public/cached-content/${data.project || sessionObj.project}/variant/${data.variantId}`,
        );
        const templateValue = variantResponse.variant.templateValue;
        const variables = templateValue.variables || [];

        // Render templates with Handlebars
        const renderedHtml = templateValue.html
          ? renderTemplate(templateValue.html, variables, data)
          : "";
        const renderedCss = templateValue.css
          ? renderTemplate(templateValue.css, variables, data)
          : "";
        const renderedJs = templateValue.js
          ? renderTemplate(templateValue.js, variables, data)
          : "";

        content = {
          key: variantResponse.contentKey || contentId,
          contentValue: {
            html: renderedHtml,
            css: renderedCss,
            js: renderedJs,
          },
          selector: variantResponse.selector,
          selectorPosition: variantResponse.selectorPosition,
          mobileSelector: variantResponse.mobileSelector,
          type: variantResponse.type,
          frequency: variantResponse.frequency,
          notAutomatic: variantResponse.notAutomatic,
          experienceId: variantResponse.experienceId,
          trigger: variantResponse.trigger,
        };
      } else {
        content = await httpPost(url, payload);
      }
    } else {
      content = await httpGet(
        `/personal/content/${contentId}/variant/${prevVarId}`,
      );
    }
  }

  if (!content.key) {
    content.key = contentId;
  }
  if (content.delay) {
    await new Promise((resolve) => setTimeout(resolve, content.delay));
  }
  addContentToWebsite(content, options);

  if (content.type == "API") {
    return content;
  }
};

function buildContextPayload(options) {
  let download;
  let effectiveType;
  try {
    download = navigator.connection.downlink;
    effectiveType = navigator.connection.effectiveType;
  } catch (e) {}
  let currentPage = {
    ...options,
    provider: window?.gsConfig?.options?.provider || null,
    location: window.location.href,
    referrer:
      typeof document !== "undefined" ? document.referrer || "" : "",
  };
  //exclude project with own sku resolution - for Luna projects, use preProcess to resolve item by sku_list instead of product_id
  if (window.gsConfig?.options?.provider === "Luna" && getSession()?.project !== "672154a195567b6f32f56407" && currentPage.product_id) {
    const { product_id, ...rest } = currentPage;
    currentPage = { ...rest, preProcess: { field: "sku_list", fieldValue: String(product_id) } };
  }
  return {
    context: {
      network: {
        downlink: download,
        effectiveType: effectiveType,
      },
      screen: {
        width:
          window.innerWidth ||
          document.documentElement.clientWidth ||
          document.body.clientWidth,
        height:
          window.innerHeight ||
          document.documentElement.clientHeight ||
          document.body.clientHeight,
      },
      settings: {
        locale: navigator.language || navigator.userLanguage,
        timezoneOffset: new Date().getTimezoneOffset(),
      },
      currentPage,
    },
  };
}
async function addContentToWebsite(content, options) {
  window.gsLog("addContentToWebsite", content.key);

  if (content && content.contentValue) {
    const skipKeys = Array.isArray(window.gsConfig?.options?.skipContents)
      ? window.gsConfig.options.skipContents
      : [];
    if (
      skipKeys.length > 0 &&
      content &&
      typeof content.key === "string" &&
      skipKeys.includes(content.key)
    ) {
      // skip this content
      return;
    }
    const css = content.contentValue.css;
    const html = content.contentValue.html;
    const js = content.contentValue.js;
    const notAutomatic = content.notAutomatic || false;

    if (!css && !html && !js) {
      window.gsLog("skip");
      return; //nothing to inyect
    }

    const proceed = async () => {
      injectCSS(css, content.key);

      const types = ["custom_code", "pop_up", "notifications"];

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
            });
          }
        }
      } else {
        // web content
        let selector = content.selector;
        let selectorPosition = content.selectorPosition;
        if (!selector) {
          selector = "body";
          selectorPosition = "after";
        }
        window.gsLog("adding to dom", selector);

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
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", proceed); // Wait for DOM ready
    } else {
      await proceed(); // Proceed immediately
    }
  }

  window.gsLog("end addContentToWebsite", content.key);
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
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
      case "once_page":
        return true;
      case "once_sesion":
        if (period !== "once_sesion" || now - lastSeen > 24 * 3600 * 1000) {
          nextTime = true;
        }
        break;
      case "once_day":
        if (period !== "once_day" || now - lastSeen > 24 * 3600 * 1000) {
          nextTime = true;
        }
        break;
      case "once_week":
        if (period !== "once_week" || now - lastSeen > 7 * 24 * 3600 * 1000) {
          nextTime = true;
        }
        break;
      case "once_month":
        if (period !== "once_month" || now - lastSeen > 30 * 24 * 3600 * 1000) {
          nextTime = true;
        }
        break;
      case "once":
        if (period !== "once") {
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
    if (!impressionId || typeof impressionId !== "string") {
      return;
    }

    window.gsImpressionIds.push(impressionId);
    return await httpPatch(`/personal/impression/${impressionId}`, {
      status: "opened",
    });
  } catch (error) {
    console.error("Error:", error);
    return;
  }
};

/**
 * Creates a content impression (status "opened" by default).
 * The impressionId is the one already resolved when the content was obtained.
 * The session, customer and project are resolved server side from the token.
 *
 * Only one impression is created per content and session: the content gets a
 * new impressionId on every request, so the first one is kept on storage and
 * reused (and returned) for the rest of the session.
 */
export const createContentImpression = async (impressionId, impression = {}) => {
  try {
    if (!impressionId || typeof impressionId !== "string") {
      return;
    }

    const contentKey = impression.content || impression.variantId || impressionId;

    const sessionImpressionId = getContentImpression(contentKey);
    if (sessionImpressionId) {
      window.gsLog(
        "Content impression already created on this session",
        contentKey,
        sessionImpressionId,
      );
      return { success: true, impressionId: sessionImpressionId, skipped: true };
    }

    const payload = {
      impressionId,
      content: impression.content,
      target: impression.target,
      variantId: impression.variantId,
      status: impression.status || "opened",
      tags: impression.tags,
      date: impression.date,
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    setContentImpression(contentKey, impressionId);

    if (
      Array.isArray(window.gsImpressionIds) &&
      !window.gsImpressionIds.includes(impressionId)
    ) {
      window.gsImpressionIds.push(impressionId);
    }

    return await httpPost(`/personal/impression`, payload);
  } catch (error) {
    console.error("Error creating content impression:", error);
    return;
  }
};

/**
 * Returns the impressionId created for that content on the current session,
 * which is the one the click has to be reported against.
 */
export const getContentImpressionId = (content) => {
  return getContentImpression(content);
};

/**
 * Marks a content impression as clicked.
 *
 * The content is sent along with the impressionId because only one impression
 * exists per content and session, while the impressionId of the page changes on
 * every content request: the server resolves the impression by
 * project + session + content.
 */
export const clickContentImpression = async (impressionId, impression = {}) => {
  try {
    if (!impressionId || typeof impressionId !== "string") {
      return;
    }

    const payload = {
      content: impression.content,
      tags: impression.tags,
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    return await httpPatch(`/personal/impression/${impressionId}`, payload);
  } catch (error) {
    console.error("Error clicking content impression:", error);
    return;
  }
};

export const trackURLClicked = (executionId) => {
  return httpPatch(`/public/track`, { executionId: executionId });
};

export const observeElementInView = (elementId, impressionId, callback) => {
  // Function that will be called when the div is in the viewport
  function internalCallback(entries, observer) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        // The div is now in the viewport
        callback(elementId, impressionId);
        observer?.disconnect();
      }
    });
  }

  // Create an instance of the Intersection Observer
  let observer = new IntersectionObserver(internalCallback);

  // Target the div element you want to observe
  let target = document.getElementById(elementId);

  // Start observing the target element
  observer.observe(target);
};

export const cleanContent = () => {
  deleteGoPersonalElements();
};

export { invalidateContentCache, purgeContentCache };

export const sendContentEvent = (key, value) => {
  const sessionObj = getSession();
  sendEvent(key, value, sessionObj.sessionId);
};

export const initPreviewListener = () => {
  window.addEventListener("message", (event) => {
    if (event.origin !== "https://admin.gopersonal.ai") return;
    const msg = event.data;

    if (msg?.namespace !== "gopersonal") return;
    if (msg.source !== "editor") return;

    if (msg.type === "update") {
      renderContentPreview(msg.payload);
    }
  });
};

async function renderContentPreview(payload) {
  try {
    deleteGoPersonalElements();

    const css = payload.css;
    const html = payload.html;
    const js = payload.js;

    if (css) {
      injectCSS(css, "gs-preview");
    }

    let selector = payload.previewObject.selector;
    let selectorPosition = payload.previewObject.selectorPosition;
    if (!selector) {
      selector = "body";
      selectorPosition = "after";
    }

    const isMobile = isMobileDevice();
    const hasMobileSelector = isNotEmpty(payload.previewObject.mobileSelector);

    if (isMobile && hasMobileSelector) {
      selector = payload.previewObject.mobileSelector;
    }
    if (html) {
      await addHTMLToDiv(html, selector, selectorPosition, {});
    }
    if (js) {
      addJavaScriptToBody(js, "gs-preview");
    }
  } catch (error) {
    console.error("Error rendering content preview:", error);
  }
}
