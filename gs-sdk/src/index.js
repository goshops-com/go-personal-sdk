import { login, addInteraction, logout, getContent } from './api';

const GSSDK = (clientId) => {
  if (!clientId) {
    throw new Error('Client ID is required to initialize the SDK');
  }

  return {
    login: (username) => login(clientId, username),
    addInteraction: (interactionData) => addInteraction(clientId, interactionData),
    logout: () => logout(clientId),
    getContent: (contentId) => getContent(clientId, contentId),
  };
};

export default GSSDK;

