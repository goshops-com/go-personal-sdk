import {
  login, loginEmail, addInteraction, addInteractionState, logout, getCustomerSession, findState, findLastInteractions, reorderCategories, getItems, search, searchAnswer, searchRedirect, imageSearch, voiceSearch, searchResult, updateSearchResult, uploadImage, getCount, getFieldValues,
  getRanking, reRank, setPreferences, updateState, getItemById, init, triggerJourney, clearSharedSession, getState, getAffinity, getAffinityCustomer, addBulkInteractions, addFeedback, getCurrentSession, downloadSearchAutocompleteIndex, searchFilterFacelets, searchAutoFilter, searchChat, searchBulk, isSearch, setCustomerCookies, updateCustomerData
} from './api';
import { getContent, getContentByContext, observeElementInView, openImpression as openImpressionForContent, trackURLClicked, sendContentEvent } from './api/content';
import { bestProducts, byContext, openImpression as openImpressionForRecommendation } from './api/recommendation';
import { executeActions } from './actions/addToCart';
import { executeActions as executeSearchActions } from './actions/search';
import { executeActions as executeSessionActions, debugSession } from './actions/sessionAction';
import { checkURLEvents, trackGopersonalProductImpression, trackGopersonalProductClick, trackGopersonalBannerImpression, trackGopersonalBannerClick } from './utils/ga';
import { loadPlugin } from './api/plugins';
import { getUrlParameter, removeParamFromUrl } from './utils/dom';
import { getCurrentGeoIPLocation } from './api/geolocation';
import { liveGetVideo, liveLikeVideo, liveUnlikeVideo, liveTrackVideoTime } from './api/live';
import { installFenicio } from './providers/fenicio';
import { setSharedToken, getSharedToken } from './utils/session';
import { onVtexEmbeddedInit } from './vendors/vtexEmbedded';

//plugins

import { install as installBrowse } from './api/browse';

window.gsLog = function (...args) {
  if (window.gsConfig.log) {
    console.log(...args);
  }
}

window.gsResetSession = async function () {
  // Key for accessing data directly from the window object
  const resetData = window.gsResetData;
  // Get current time in milliseconds
  const now = Date.now();
  // Duration for counting resets (1 hour in milliseconds)
  const duration = 60 * 60 * 1000;

  // Check if the current timestamp is within 1 hour of the stored timestamp
  if (now - resetData.timestamp < duration) {
    // If within the same hour and count is 10 or more, cancel reset
    if (resetData.count >= 10) {
      console.log('Reset limit reached. Function will not proceed.');
      return; // Exit the function without executing init
    } else {
      // Increment count since we're within the same hour
      resetData.count += 1;
    }
  } else {
    // If more than an hour has passed, reset count and timestamp
    resetData.count = 1;
    resetData.timestamp = now;
  }

  // Update the window object with new count and timestamp
  window.gsResetData = resetData;

  // Proceed to execute the init function as count is below 10
  await init(window.gsConfig.clientId, window.gsConfig.options);
};

function hasPlugin(option, id) {
  if (!option.plugins) {
    return { exists: false };
  }
  const plugin = option.plugins.find(plugin => plugin.id === id);
  if (plugin) {
    return { exists: true, options: plugin.options };
  }
  return { exists: false, options: null };
}

function hasActions(option) {
  const urlParams = new URLSearchParams(window.location.search);
  for (const key of urlParams.keys()) {
    if (key.startsWith('_gs')) {
      return true;
    }
    if (key == 'ev_name') {
      return true;
    }
  }
  return false;
}

const GSSDK = async (clientId, options = {}) => {

  if (options && options.provider == 'Fenicio') {
    
    if (window.gsSDK != undefined) {

      if (options?.context?.pageType === window?.gsConfig?.options?.context?.pageType) {
        return window.gsSDK;
      }else{
        if (options?.context?.pageType == 'product_detail'){

          if (window.gsConfig?.options?.context) {
            window.gsConfig.options.context.pageType = 'product_detail';
            window.gsConfig.options.context.product_url = window.location.href;
          }
        
          await window.gsSDK.getContentByContext('product_detail', {
              product_url: window.location.href
          });

        }
      }

      return window.gsSDK;
    }
  }

  window.gsConfig = {};
  window.gsEventHandlers = {};
  window.gsImpressionIds = [];
  if (options.log) {
    window.gsConfig.log = true;
  }else{
    window.gsConfig.log = getUrlParameter('_gsLog');
  }

  const playgroundToken = getUrlParameter('_gsPlaygroundToken');
  if (playgroundToken) {
    const env = getUrlParameter('_gsPlaygroundEnv') || 'BR';
    clientId = `${env}-playground`;
    options.playgroundToken = playgroundToken;
  }

  window.gsLog(`GSSDK: ${clientId}`);
  if (!clientId) {
    throw new Error('Client ID is required to initialize the SDK');
  }

  window.gsConfig.clientId = clientId;
  window.gsConfig.options = options;
  window.gsLog('Calling Init:', options);
  if (!window.gsResetData) {
    window.gsResetData = { count: 0, timestamp: Date.now() };
  }

  clientId = await init(clientId, options);

  const browsePlugin = hasPlugin(options, 'browse');
  if (browsePlugin.exists) {
    window.gsLog('installing plugin')
    installBrowse(browsePlugin.options)
  }

  // check actions
  if (hasActions(options)) {
    checkURLEvents();
    executeActions(options.provider);
    executeSearchActions(options.provider);
    executeSessionActions(options.provider);
    // debugSession();
    const trackURL = getUrlParameter('_gsTrackExecutionId');
    if (trackURL) {
      trackURLClicked(trackURL);
    }
  }

  console.log('[go personal]', '1.0.1');

  if (options && options.provider == 'Fenicio'){
    setTimeout(() => {
      installFenicio(options);
    }, 100);
  }

  const sessionObj = getCustomerSession();
  const onlyForcedProjects = ["67374d510dfcc232a627662e", "67374d2d0dfcc28c73276534", "67374d240dfcc2a4ff2764e8", "67374d1d0dfcc2ee482764c2"];
  if (onlyForcedProjects.includes(sessionObj?.project)) {
    queueMicrotask(() => {
      try {
        onVtexEmbeddedInit();
      } catch (error) {
        window.gsLog?.('Error executing onVtexEmbeddedInit', error);
      }
    });
  }

  if (options.provider)
    return {
      login: (username, data = {}) => login(username, data),
      loginEmail: (email) => loginEmail(email),
      logout: () => logout(clientId),
      updateCustomerData: (data) => updateCustomerData(data),
      getSession: () => getCustomerSession(),
      setCookies: (status) => setCustomerCookies(status),
      setPreferences: (params) => setPreferences(params),
      addInteraction: (interactionData) => addInteraction(interactionData),
      addInteractionState: (state, options = {}) => addInteractionState(state, options),
      getItems: (params) => getItems(params),
      findState: () => findState(),
      findLastInteractions: (limit = 10) => findLastInteractions(limit),
      reorderCategories: (interactions, categories) => reorderCategories(interactions, categories),
      updateState: (obj) => updateState(obj),
      search: (input, params) => search(input, params),
      searchAnswer: (input, params) => searchAnswer(input, params),
      searchChat: (payload) => searchChat(payload),
      isSearch: (payload) => isSearch(payload),
      searchRedirect: (input, params) => searchRedirect(input, params),
      searchBulk: (payload) => searchBulk(payload),
      searchAutoFilter: (filters, input) => searchAutoFilter(filters, input),
      downloadSearchAutocompleteIndex: () => downloadSearchAutocompleteIndex(),
      searchFilterFacelets: (query = undefined) => searchFilterFacelets(query),
      imageSearch: (formData, params) => imageSearch(formData, params),
      voiceSearch: (formData, params) => voiceSearch(formData, params),
      searchResult: (payload) => searchResult(payload),
      updateSearchResult: (id, payload) => updateSearchResult(id, payload),
      uploadImage: (formData) => uploadImage(formData),
      loadPlugin: (name, external = true) => loadPlugin(name, external),
      getCount: (params) => getCount(params),
      getItemById: (id) => getItemById(id),
      getRanking: (ranking, params) => getRanking(ranking, params),
      reRank: (ranking, params) => reRank(ranking, params),
      getFieldValues: (params) => getFieldValues(params),
      bestProducts: (params) => bestProducts(params),
      recommendationByContex: (params) => byContext(params),
      getContent: (contentId, options = {}) => getContent(contentId, options),
      getContentByContext: (context, options) => getContentByContext(context, options),
      clearSharedSession: () => clearSharedSession(clientId),
      getState: (params = {}) => getState(params),
      getAffinity: () => getAffinity(),
      getAffinityCustomer: () => getAffinityCustomer(),
      addBulkInteractions: (interactions) => addBulkInteractions(interactions),
      addFeedback: (feedbackData) => addFeedback(feedbackData),
      observeElementInView: (elementId, impressionId, cb) => observeElementInView(elementId, impressionId, cb),
      openImpression: (impressionId) => openImpressionForRecommendation(impressionId),
      openImpressionContent: (impressionId) => openImpressionForContent(impressionId),
      getCurrentSession: () => getCurrentSession(),
      getCurrentGeoIPLocation: () => getCurrentGeoIPLocation(),
      trackError: (e) => console.log(e),
      triggerJourney: (data) => triggerJourney(data),
      trackURLClicked: (executionId) => trackURLClicked(executionId),
      liveGetVideo: (videoId) => liveGetVideo(videoId),
      liveLikeVideo: (videoId) => liveLikeVideo(videoId),
      liveUnlikeVideo: (videoId) => liveUnlikeVideo(videoId),
      liveTrackVideoTime: (videoId, time, videoViewId) => liveTrackVideoTime(videoId, time, videoViewId),
      setSharedToken: () => setSharedToken(),
      getSharedToken: () => getSharedToken(),
      sendContentEvent: (key, value) => sendContentEvent(key, value),
      trackGopersonalProductImpression: (items, listName) => trackGopersonalProductImpression(items, listName),
      trackGopersonalProductClick: (item, listName, index) => trackGopersonalProductClick(item, listName, index),
      trackGopersonalBannerImpression: (promotions) => trackGopersonalBannerImpression(promotions),
      trackGopersonalBannerClick: (promotion) => trackGopersonalBannerClick(promotion),
    };
    
};

export default GSSDK;