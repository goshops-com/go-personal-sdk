import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { flush, mockFetch, resetDom, seedSession } from './helpers/env.mjs';
import { executeActions } from '../../src/actions/search.js';

beforeEach(() => resetDom());

test('reports the clicked search result and strips _gsSearchCTR from the URL', async () => {
  resetDom({ url: 'https://shop.example/producto/p?color=red&_gsSearchCTR=sr-123#reviews' });
  seedSession({ token: 'tok-9' });
  const calls = mockFetch();
  window.history.replaceState({ router: 'state' }, '', window.location.href);

  executeActions('VTEX');
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.ok(calls[0].url.endsWith('/item/search-interaction'), calls[0].url);
  assert.deepEqual(calls[0].body, { status: 'clicked', id: 'sr-123' });
  assert.equal(calls[0].headers.Authorization, 'Bearer tok-9');
  assert.equal(window.location.href, 'https://shop.example/producto/p?color=red#reviews');
  assert.deepEqual(window.history.state, { router: 'state' }, 'the host router state is kept');
});

test('does nothing without _gsSearchCTR', async () => {
  resetDom({ url: 'https://shop.example/producto/p?color=red' });
  seedSession();
  const calls = mockFetch();

  executeActions();
  await flush();

  assert.equal(calls.length, 0);
  assert.equal(window.location.href, 'https://shop.example/producto/p?color=red');
});
