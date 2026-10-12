let BASE_URL = 'https://go-discover-dev.goshops.ai';

// Public base only; credentials continue to be handled by the existing SDK.
export const getApiBaseURL = () => BASE_URL;

import { getToken, clearSession } from './storage';

export const configure = (clientId, apiBaseURL) => {
  // Check if clientId contains a hyphen
  if (clientId.includes('-')) {
    // Split the clientId at the hyphen
    const separator = clientId.indexOf('-');
    const region = clientId.slice(0, separator);
    const secondPart = clientId.slice(separator + 1);

    if (region == 'BR') {
      BASE_URL = 'https://discover.gopersonal.ai';
    }else if (region == 'LOCAL') {
      BASE_URL = 'http://localhost:3000';
    }
    if (apiBaseURL) setApiBaseURL(apiBaseURL);
    return secondPart;
  } else {
    if (apiBaseURL) setApiBaseURL(apiBaseURL);
    return clientId;
  }
}

function setApiBaseURL(value) {
  const url = new URL(value);
  if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('apiBaseURL must use HTTPS');
  }
  BASE_URL = url.origin;
}

async function handleInvalidAuth() {
  clearSession();
  await window.gsResetSession();
}


export const httpGet = async (endpoint, params = {}, includeHeaders = false) => {
  const obj = getToken();
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${obj.token}`
    },
  });

  if (response.status === 401) {
    await handleInvalidAuth();
  }

  if (!response.ok) {
    throw new Error(`GET request failed: ${response.status}`);
  }

  const data = await response.json();

  if (includeHeaders) {
    response.headers.forEach((value, name) => {
    });
    const headers = response.headers;
    return { headers, data };
  }

  return data;
};

export const httpPublicGet = async (endpoint, params = {}) => {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`GET request failed: ${response.status}`);
  }

  return await response.json();
};


export const httpPost = async (endpoint, body = {}) => {
  const obj = getToken();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${obj.token}`
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    handleInvalidAuth();
  }

  if (!response.ok) {
    throw new Error(`POST request failed: ${response.status}`);
  }

  return response.json();
};

export const httpPostFormData = async (endpoint, formData) => {
  const obj = getToken();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${obj.token}`
    },
    body: formData
  });

  if (response.status === 401) {
    handleInvalidAuth();
  }

  if (!response.ok) {
    throw new Error(`POST request failed: ${response.status}`);
  }

  return response.json();
};

export const httpPut = async (endpoint, body = {}) => {
  const obj = getToken();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${obj.token}`
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    handleInvalidAuth();
  }

  if (!response.ok) {
    throw new Error(`POST request failed: ${response.status}`);
  }

  return response.json();
};

export const httpPatch = async (endpoint, body = {}) => {
  const obj = getToken();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'PATCH', // Changed from PUT to PATCH
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${obj.token}`
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401) {
    handleInvalidAuth();
  }

  if (!response.ok) {
    throw new Error(`PATCH request failed: ${response.status}`); // Changed POST to PATCH in the error message
  }

  return response.json();
};
