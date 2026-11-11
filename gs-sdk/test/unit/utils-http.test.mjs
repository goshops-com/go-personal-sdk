import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resetDom, seedSession, mockFetch, jsonResponse, flush } from './helpers/env.mjs';
import * as http from '../../src/utils/http.js';

let resets;

beforeEach(() => {
  resetDom();
  seedSession({ token: 'tok' });
  resets = 0;
  window.gsResetSession = async () => { resets++; };
  http.configure('BR-client');
});

test('configure picks the API by region prefix and returns the bare client id', () => {
  assert.equal(http.configure('BR-abc'), 'abc');
  assert.equal(http.getApiBaseURL(), 'https://discover.gopersonal.ai');
  assert.equal(http.configure('LOCAL-abc'), 'abc');
  assert.equal(http.getApiBaseURL(), 'http://localhost:3000');
  // Other prefixes and plain ids keep whatever base was set before.
  assert.equal(http.configure('XX-abc-def'), 'abc-def');
  assert.equal(http.configure('plain'), 'plain');
  assert.equal(http.getApiBaseURL(), 'http://localhost:3000');
  // Bypassed client id: production API although it has no prefix.
  assert.equal(http.configure('ar0EwoNiXkGDpng2'), 'ar0EwoNiXkGDpng2');
  assert.equal(http.getApiBaseURL(), 'https://discover.gopersonal.ai');
});

test('configure accepts an https apiBaseURL override and rejects unsafe ones', () => {
  assert.equal(http.configure('BR-abc', 'https://api.example.com/some/path'), 'abc');
  assert.equal(http.getApiBaseURL(), 'https://api.example.com');
  http.configure('plain', 'http://localhost:4000');
  assert.equal(http.getApiBaseURL(), 'http://localhost:4000');
  assert.throws(() => http.configure('plain', 'http://api.example.com'), /HTTPS/);
  assert.throws(() => http.configure('BR-abc', 'https://user:pass@api.example.com'), /HTTPS/);
});

test('httpGet sends the token, appends params and no Content-Type', async () => {
  const calls = mockFetch(() => ({ ok: 1 }));
  const data = await http.httpGet('/item', { limit: 5, q: 'a b' });
  assert.deepEqual(data, { ok: 1 });
  assert.equal(calls[0].url, 'https://discover.gopersonal.ai/item?limit=5&q=a+b');
  assert.equal(calls[0].method, 'GET');
  assert.deepEqual(calls[0].headers, { Authorization: 'Bearer tok' });
});

test('httpGet can return the response headers', async () => {
  mockFetch(() => jsonResponse({ ok: 1 }, { headers: { 'x-total': '7' } }));
  const { data, headers } = await http.httpGet('/item', {}, true);
  assert.deepEqual(data, { ok: 1 });
  assert.equal(headers.get('x-total'), '7');
});

test('httpGet resets the session on 401 and throws on any failure', async () => {
  mockFetch(() => jsonResponse({}, { status: 401 }));
  await assert.rejects(http.httpGet('/x'), /GET request failed: 401/);
  assert.equal(resets, 1);
  assert.equal(localStorage.getItem('gs-v-1'), null);

  mockFetch(() => jsonResponse({}, { status: 500 }));
  await assert.rejects(http.httpGet('/x'), /GET request failed: 500/);
  assert.equal(resets, 1);
});

test('httpPublicGet is a CORS simple request: no headers at all', async () => {
  const calls = mockFetch(() => ({ a: 1 }));
  assert.deepEqual(await http.httpPublicGet('/public/x', { pageType: 'home' }), { a: 1 });
  assert.equal(calls[0].url, 'https://discover.gopersonal.ai/public/x?pageType=home');
  assert.equal(calls[0].init.headers, undefined);

  mockFetch(() => jsonResponse({}, { status: 404 }));
  await assert.rejects(http.httpPublicGet('/public/x'), /GET request failed: 404/);
  assert.equal(resets, 0);
});

for (const [name, method, label] of [['httpPost', 'POST', 'POST'], ['httpPut', 'PUT', 'POST'], ['httpPatch', 'PATCH', 'PATCH']]) {
  test(`${name} sends JSON with the token, resets on 401 and throws on failure`, async () => {
    const calls = mockFetch(() => ({ saved: true }));
    assert.deepEqual(await http[name]('/thing', { a: 1 }), { saved: true });
    assert.equal(calls[0].url, 'https://discover.gopersonal.ai/thing');
    assert.equal(calls[0].method, method);
    assert.deepEqual(calls[0].body, { a: 1 });
    assert.deepEqual(calls[0].headers, { 'Content-Type': 'application/json', Authorization: 'Bearer tok' });

    const empty = mockFetch(() => ({}));
    await http[name]('/thing');
    assert.deepEqual(empty[0].body, {});

    mockFetch(() => jsonResponse({}, { status: 401 }));
    await assert.rejects(http[name]('/thing', {}), new RegExp(`${label} request failed: 401`));
    await flush();
    assert.equal(resets, 1);

    mockFetch(() => jsonResponse({}, { status: 503 }));
    await assert.rejects(http[name]('/thing', {}), new RegExp(`${label} request failed: 503`));
  });
}

test('httpPostFormData sends the form untouched, without Content-Type', async () => {
  const form = new FormData();
  form.append('file', 'data');
  const calls = mockFetch(() => ({ id: 9 }));
  assert.deepEqual(await http.httpPostFormData('/item/upload', form), { id: 9 });
  assert.equal(calls[0].init.body, form);
  assert.deepEqual(calls[0].headers, { Authorization: 'Bearer tok' });

  mockFetch(() => jsonResponse({}, { status: 401 }));
  await assert.rejects(http.httpPostFormData('/item/upload', form), /POST request failed: 401/);
  await flush();
  assert.equal(resets, 1);
});
