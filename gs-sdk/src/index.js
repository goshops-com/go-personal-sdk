import {
  login, loginEmail, addInteraction, addInteractionState, logout, getCustomerSession, findState, getItems, search, imageSearch, voiceSearch, searchResult, updateSearchResult, uploadImage, getCount, getFieldValues,
  getRanking, reRank, setPreferences, updateState, getItemById, init, triggerJourney, clearSharedSession, getState, getAffinity, addBulkInteractions, addFeedback, getCurrentSession
} from './api';
import { getContent, getContentByContext, observeElementInView, openImpression as openImpressionForContent } from './api/content';
import { bestProducts, byContext, openImpression as openImpressionForRecommendation } from './api/recommendation';
import { executeActions } from './actions/addToCart';
import { executeActions as executeSearchActions } from './actions/search';

import { getUrlParameter, removeParamFromUrl } from './utils/dom';

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
  }
  return false;
}

const GSSDK = async (clientId, options = {}) => {

  window.gsConfig = {};
  window.gsEventHandlers = {};
  window.gsImpressionIds = [];
  if (options.log) {
    window.gsConfig.log = true;
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
    executeActions(options.provider);
    executeSearchActions(options.provider);
  }

  console.log('[go personal]', '1.0.0');

  if (options.provider)
    return {
      login: (username, data = {}) => login(username, data),
      loginEmail: (email) => loginEmail(email),
      logout: () => logout(clientId),
      getSession: () => getCustomerSession(),
      setPreferences: (params) => setPreferences(params),
      addInteraction: (interactionData) => addInteraction(interactionData),
      addInteractionState: (state, options = {}) => addInteractionState(state, options),
      getItems: (params) => getItems(params),
      findState: () => findState(),
      updateState: (obj) => updateState(obj),
      search: (input, params) => search(input, params),
      imageSearch: (formData, params) => imageSearch(formData, params),
      voiceSearch: (formData, params) => voiceSearch(formData, params),
      searchResult: (payload) => searchResult(payload),
      updateSearchResult: (id, payload) => updateSearchResult(id, payload),
      uploadImage: (formData) => uploadImage(formData),
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
      addBulkInteractions: (interactions) => addBulkInteractions(interactions),
      addFeedback: (feedbackData) => addFeedback(feedbackData),
      observeElementInView: (elementId, impressionId, cb) => observeElementInView(elementId, impressionId, cb),
      openImpression: (impressionId) => openImpressionForRecommendation(impressionId),
      openImpressionContent: (impressionId) => openImpressionForContent(impressionId),
      getCurrentSession: () => getCurrentSession(),
      trackError: (e) => console.log(e),
      triggerJourney: (data) => triggerJourney(data)
    };
};

export default GSSDK;