import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resetDom, mockFetch, seedSession, jsonResponse } from './helpers/env.mjs';
import { sendEvent } from '../../src/utils/custom.js';

beforeEach(() => {
  resetDom();
  seedSession();
});

test('sendEvent posts the key, the value and the customer to the custom events service', async () => {
  const calls = mockFetch();

  await sendEvent('target-1', 'variant-1', 'session-1');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  // Its own service, not a path of the discover API.
  assert.equal(calls[0].url, 'https://custom-events.gopersonal.ai/event');
  assert.deepEqual(calls[0].body, { key: 'target-1', value: 'variant-1', customer: 'session-1' });
  // The service only allows Content-Type on CORS: no token goes along.
  assert.deepEqual(calls[0].headers, { 'Content-Type': 'application/json' });
});

test('sendEvent rejects when the request fails, without touching the session', async () => {
  let resets = 0;
  window.gsResetSession = () => { resets++; };
  mockFetch(() => jsonResponse({}, { status: 401 }));
  await assert.rejects(sendEvent('target-1', 'variant-1', 'session-1'), /POST request failed: 401/);
  assert.equal(resets, 0);
  assert.notEqual(localStorage.getItem('gs-v-1'), null);
});
