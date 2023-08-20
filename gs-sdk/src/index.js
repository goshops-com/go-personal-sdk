import { login, addInteraction, logout, getItems, search, imageSearch, getCount, getFieldValues,
   getRanking, reRank, setPreferences, getItemById, init } from './api';

import { getContent, getContentByContext } from './api/content';

window.gsConfig = {};
window.gsLog = function(s){
  if (window.gsConfig.log){
    console.log(s);
  }
}
const GSSDK = async (clientId, options = {}) => {

  if (options.log){
    window.gsConfig.log = true;
  }
  
  window.gsLog(`GSSDK: ${clientId}`);
  
  if (!clientId) {
    throw new Error('Client ID is required to initialize the SDK');
  }

  window.gsLog('Calling Init:')
  await init(clientId, options);

  // Event handlers object
  const gsEventHandlers = {};

  // Function to register an event handler
  const on = function (event, handler) {
    if (!gsEventHandlers[event]) {
      gsEventHandlers[event] = [];
    }

    gsEventHandlers[event].push(handler);
  };

  // Function to trigger an event
  const emit = function (event, data) {
    const handlers = gsEventHandlers[event];

    if (!handlers || !handlers.length) {
      return;
    }

    handlers.forEach(handler => handler(data));
  };

  return {
    login: (username) => login(username),
    logout: () => logout(clientId),
    setPreferences: (params) => setPreferences(params),
    addInteraction: (interactionData) => addInteraction(clientId, interactionData),
    getItems: (params) => getItems(params),
    search: (input, params) => search(input, params),
    imageSearch: (formData, params) => imageSearch(formData, params),
    getCount: (params) => getCount(params),
    getItemById: (id) => getItemById(id),
    getRanking: (ranking, params) => getRanking(ranking, params),
    reRank: (ranking, params) => reRank(ranking, params),
    getFieldValues: (params) => getFieldValues(params),
    getContent: (contentId) => getContent(clientId, contentId),
    getContentByContext: (context, options) => getContentByContext(context, options),
    on: on,
    emit: emit,
  };
};

export default GSSDK;