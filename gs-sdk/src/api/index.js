import { httpGet, httpPost } from '../utils/http';

export const login = (clientId, username, password) => {
  // Implementation of login will depend on your specific API
  return httpPost(`/login`, { clientId, username, password });
};

export const addInteraction = (clientId, interactionData) => {
  // Implementation of addInteraction will depend on your specific API
  return httpPost(`/interaction`, { clientId, ...interactionData });
};

export const logout = (clientId) => {
  // Implementation of logout will depend on your specific API
  return httpPost(`/logout`, { clientId });
};

export const getContent = (clientId, contentId) => {
  // Implementation of getContent will depend on your specific API
  return httpGet(`/content/${contentId}`, { clientId });
};

