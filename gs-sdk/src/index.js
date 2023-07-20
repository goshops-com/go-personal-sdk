import { login, addInteraction, logout, getContent, getItems, getFieldValues,  init } from './api';

const GSSDK = (clientId) => {
  console.log(`GSSDK: ${clientId}`);
  
  if (!clientId) {
    throw new Error('Client ID is required to initialize the SDK');
  }

  console.log('Calling Init:')
  init(clientId);

  return {
    login: (username) => login(clientId, username),
    addInteraction: (interactionData) => addInteraction(clientId, interactionData),
    logout: () => logout(clientId),
    getContent: (contentId) => getContent(clientId, contentId),
    getItems: (params) => getItems(params),
    getFieldValues: (params) => getFieldValues(params),
  };
};

export default GSSDK;
