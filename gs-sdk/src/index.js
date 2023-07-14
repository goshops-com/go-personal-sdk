import { login, addInteraction, logout, getContent } from './api';

const GSSDK = (clientId) => {
  if (!clientId) {
    throw new Error('Client ID is required to initialize the SDK');
  }

  return {
    login: (username, password) => login(clientId, username, password),
    addInteraction: (interactionData) => addInteraction(clientId, interactionData),
    logout: () => logout(clientId),
    getContent: (contentId) => getContent(clientId, contentId),
  };
};

export default GSSDK;

