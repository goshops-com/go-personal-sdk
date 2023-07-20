import { login, addInteraction, logout, getContent, getItems, getFieldValues, setPreferences, init } from './api';

const GSSDK = (clientId) => {
  console.log(`GSSDK: ${clientId}`);
  
  if (!clientId) {
    throw new Error('Client ID is required to initialize the SDK');
  }

  console.log('Calling Init:')
  init(clientId);

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
    login: (username) => login(clientId, username),
    addInteraction: (interactionData) => addInteraction(clientId, interactionData),
    logout: () => logout(clientId),
    getContent: (contentId) => getContent(clientId, contentId),
    getItems: (params) => getItems(params),
    getFieldValues: (params) => getFieldValues(params),
    setPreferences: (params) => setPreferences(params),
    on: on,
    emit: emit,
  };
};

export default GSSDK;