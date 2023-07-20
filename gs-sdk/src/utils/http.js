// const BASE_URL = 'http://localhost:3000';
const BASE_URL = 'https://go-discover-dev.goshops.ai';

import { getToken } from './storage';


export const httpGet = async (endpoint, params = {}) => {
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

  if (!response.ok) {
    throw new Error(`GET request failed: ${response.status}`);
  }

  return response.json();
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

  if (!response.ok) {
    throw new Error(`POST request failed: ${response.status}`);
  }

  return response.json();
};