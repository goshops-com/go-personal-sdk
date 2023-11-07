import { login, loginEmail, addInteraction, logout, findState, getItems, search, imageSearch, getCount, getFieldValues,
   getRanking, reRank, setPreferences,updateState,  getItemById, init, clearSharedSession, getState, addBulkInteractions, addFeedback } from './api';
import { getContent, getContentByContext } from './api/content';

//plugins

import { install as installBrowse } from './api/browse';

window.gsLog = function(s){
  if (window.gsConfig.log){
    console.log(s);
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
  if (options.log){
    window.gsConfig.log = true;
  }
  
  window.gsLog(`GSSDK: ${clientId}`);
  if (!clientId) {
    throw new Error('Client ID is required to initialize the SDK');
  }

  window.gsConfig.clientId = clientId;
  window.gsLog('Calling Init:', options)
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
    setPreferences: (params) => setPreferences(params),
    addInteraction: (interactionData) => addInteraction(interactionData),
    getItems: (params) => getItems(params),
    findState: () => findState(),
    updateState: (obj) => updateState(obj),
    search: (input, params) => search(input, params),
    imageSearch: (formData, params) => imageSearch(formData, params),
    getCount: (params) => getCount(params),
    getItemById: (id) => getItemById(id),
    getRanking: (ranking, params) => getRanking(ranking, params),
    reRank: (ranking, params) => reRank(ranking, params),
    getFieldValues: (params) => getFieldValues(params),
    getContent: (contentId, options = {}) => getContent(contentId, options),
    getContentByContext: (context, options) => getContentByContext(context, options),
    clearSharedSession: () => clearSharedSession(clientId),
    getState: (params = {}) => getState(params),
    addBulkInteractions: (interactions) => addBulkInteractions(interactions),
    addFeedback: (feedbackData) => addFeedback(feedbackData)
  };
};

export default GSSDK;

// window.GSSDK = GSSDK;
