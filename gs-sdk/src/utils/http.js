let BASE_URL = 'https://go-discover-dev.goshops.ai';

import { getToken, clearSession } from './storage';

export const configure = (clientId) => {
  // Check if clientId contains a hyphen
  if (clientId.includes('-')) {
    // Split the clientId at the hyphen
    const [region, secondPart] = clientId.split('-');

    if (region == 'BR') {
      BASE_URL = 'https://discover.gopersonal.ai';
    }else if (region == 'LOCAL') {
      BASE_URL = 'http://localhost:3000';
    }
    return secondPart;
  } else {
    return clientId;
  }
}

async function handleInvalidAuth() {
  clearSession();
  await window.gsResetSession();
}


export const httpGet = async (endpoint, params = {}, includeHeaders = false) => {
  const obj = getToken();
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  const response = await fetch(url, {
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

  const response = await fetch(url, {
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
