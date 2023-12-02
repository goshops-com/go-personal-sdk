import { login, loginEmail, addInteraction, addInteractionState, logout, getCustomerSession, findState, getItems, search, imageSearch, uploadImage, getCount, getFieldValues,
   getRanking, reRank, setPreferences,updateState,  getItemById, init, clearSharedSession, getState, addBulkInteractions, addFeedback } from './api';
import { getContent, getContentByContext, observeElementInView, openImpression as openImpressionForContent } from './api/content';
import { bestProducts, byContext, openImpression as openImpressionForRecommendation } from './api/recommendation';

//plugins

import { install as installBrowse } from './api/browse';

window.gsLog = function(...args) {
  if (window.gsConfig.log) {
    console.log(...args);
  }
}

function hasPlugin(option, id) {
  if (!option.plugins){
    return { exists: false };
  }
  const plugin = option.plugins.find(plugin => plugin.id === id);
  if (plugin) {
      return { exists: true, options: plugin.options };
  }
  return { exists: false, options: null };
}

const GSSDK = async (clientId, options = {}) => {

  window.gsConfig = {};
  window.gsEventHandlers = {};
  window.gsImpressionIds = [];
  if (options.log){
    window.gsConfig.log = true;
  }
  
  window.gsLog(`GSSDK: ${clientId}`);
  if (!clientId) {
    throw new Error('Client ID is required to initialize the SDK');
  }

  window.gsConfig.clientId = clientId;
  window.gsConfig.options = options;
  window.gsLog('Calling Init:', options);
  window.gsResetSession = async function(){
    await init(window.gsConfig.clientId, window.gsConfig.options);
  };

  clientId = await init(clientId, options);

  const browsePlugin = hasPlugin(options, 'browse');
  if (browsePlugin.exists){
    window.gsLog('installing plugin')
    installBrowse(browsePlugin.options)
  }

  return {
    login: (username) => login(username),
    loginEmail: (email) => loginEmail(email),
    logout: () => logout(clientId),
    getSession: () => getCustomerSession(),
    setPreferences: (params) => setPreferences(params),
    addInteraction: (interactionData) => addInteraction(interactionData),
    addInteractionState: (state) => addInteractionState(state),
    getItems: (params) => getItems(params),
    findState: () => findState(),
    updateState: (obj) => updateState(obj),
    search: (input, params) => search(input, params),
    imageSearch: (formData, params) => imageSearch(formData, params),
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
    addBulkInteractions: (interactions) => addBulkInteractions(interactions),
    addFeedback: (feedbackData) => addFeedback(feedbackData),
    observeElementInView: (elementId, impressionId, cb) => observeElementInView(elementId, impressionId, cb),
    openImpression: (impressionId) => openImpressionForRecommendation(impressionId),
    openImpressionContent: (impressionId) => openImpressionForContent(impressionId)
  };
};

export default GSSDK;