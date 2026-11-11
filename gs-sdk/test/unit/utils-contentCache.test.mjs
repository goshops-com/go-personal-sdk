import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom } from './helpers/env.mjs';
import { getCachedContent, setCachedContent, invalidateContentCache, purgeContentCache } from '../../src/utils/contentCache.js';

const KEY = 'gs_content_post_cache';
const MINUTE = 60 * 1000;

beforeEach(() => {
  resetDom();
  mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('returns null on a miss and the stored data on a hit', () => {
  assert.equal(getCachedContent('c1', { type: 'home' }), null);
  setCachedContent('c1', { type: 'home' }, { variantId: 'v1', recommendations: [{ id: 1 }] });
  assert.deepEqual(getCachedContent('c1', { type: 'home' }), { variantId: 'v1', recommendations: [{ id: 1 }] });
});

test('the key covers content, page type, category, product and product url', () => {
  setCachedContent('c1', { type: 'product_detail', product_id: '1' }, { variantId: 'a' });
  assert.equal(getCachedContent('c1', { type: 'product_detail', product_id: '2' }), null);
  assert.equal(getCachedContent('c1', { type: 'home', product_id: '1' }), null);
  assert.equal(getCachedContent('c1', { type: 'product_detail', product_id: '1', category_id: '9' }), null);
  assert.equal(getCachedContent('c1', { type: 'product_detail', product_id: '1', product_url: '/p' }), null);
  assert.equal(getCachedContent('c2', { type: 'product_detail', product_id: '1' }), null);
  assert.deepEqual(getCachedContent('c1', { type: 'product_detail', product_id: '1' }), { variantId: 'a' });
  setCachedContent('c3', undefined, { variantId: 'n' });
  assert.deepEqual(getCachedContent('c3'), { variantId: 'n' });
});

test('callers get copies: mutating what goes in or comes out does not change the cache', () => {
  const data = { variantId: 'v1', recommendations: [{ id: 1 }] };
  setCachedContent('c1', {}, data);
  data.recommendations[0].name = 'added after caching';

  const first = getCachedContent('c1', {});
  assert.deepEqual(first, { variantId: 'v1', recommendations: [{ id: 1 }] });
  first.recommendations[0].title = 'added by the render';

  assert.deepEqual(getCachedContent('c1', {}), { variantId: 'v1', recommendations: [{ id: 1 }] });
});

test('copies also work without structuredClone, and when it cannot clone', () => {
  const original = globalThis.structuredClone;
  try {
    globalThis.structuredClone = undefined;
    setCachedContent('c1', {}, { variantId: 'v1' });
    assert.deepEqual(getCachedContent('c1', {}), { variantId: 'v1' });
    globalThis.structuredClone = () => { throw new Error('DataCloneError'); };
    assert.deepEqual(getCachedContent('c1', {}), { variantId: 'v1' });
  } finally {
    globalThis.structuredClone = original;
  }
});

test('entries expire after 5 minutes by default, or after gsConfig.contentCacheTTL', () => {
  setCachedContent('c1', {}, { variantId: 'v1' });
  mock.timers.tick(5 * MINUTE - 1);
  assert.notEqual(getCachedContent('c1', {}), null);
  mock.timers.tick(2);
  assert.equal(getCachedContent('c1', {}), null);
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY)), {});

  window.gsConfig.contentCacheTTL = MINUTE;
  setCachedContent('c2', {}, { variantId: 'v2' });
  mock.timers.tick(MINUTE + 1);
  assert.equal(getCachedContent('c2', {}), null);
});

test('reads follow storage: invalidation and writes from another tab are seen', () => {
  setCachedContent('c1', {}, { variantId: 'v1' });
  invalidateContentCache();
  assert.equal(localStorage.getItem(KEY), null);
  assert.equal(getCachedContent('c1', {}), null);

  localStorage.setItem(KEY, JSON.stringify({ 'c9::::::::': { data: { variantId: 'other-tab' }, ts: Date.now() } }));
  assert.deepEqual(getCachedContent('c9', {}), { variantId: 'other-tab' });
});

test('broken storage is dropped instead of throwing', () => {
  localStorage.setItem(KEY, '{broken');
  assert.equal(getCachedContent('c1', {}), null);
  assert.equal(localStorage.getItem(KEY), null);
});

test('setCachedContent purges expired entries and keeps at most 50, newest first', () => {
  setCachedContent('old', {}, { variantId: 'old' });
  mock.timers.tick(6 * MINUTE);
  setCachedContent('new', {}, { variantId: 'new' });
  assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(KEY))), ['new::::::::']);

  for (let i = 0; i < 55; i++) {
    mock.timers.tick(10);
    setCachedContent(`c${i}`, {}, { variantId: `v${i}` });
  }
  const keys = Object.keys(JSON.parse(localStorage.getItem(KEY)));
  assert.equal(keys.length, 51);
  assert.equal(keys.includes('new::::::::'), false);
  assert.equal(getCachedContent('c54', {}).variantId, 'v54');
});

test('purgeContentCache removes only what expired and writes only when something changed', () => {
  setCachedContent('a', {}, { variantId: 'a' });
  mock.timers.tick(4 * MINUTE);
  setCachedContent('b', {}, { variantId: 'b' });

  const setItem = mock.method(window.Storage.prototype, 'setItem');
  purgeContentCache();
  assert.equal(setItem.mock.callCount(), 0);

  mock.timers.tick(2 * MINUTE);
  purgeContentCache();
  assert.equal(setItem.mock.callCount(), 1);
  setItem.mock.restore();
  assert.equal(getCachedContent('a', {}), null);
  assert.deepEqual(getCachedContent('b', {}), { variantId: 'b' });
});

test('when storage is full it drops the older entries and retries; if that fails too nothing stale is served', () => {
  setCachedContent('a', {}, { variantId: 'a' });
  const realSetItem = window.Storage.prototype.setItem;

  // First write fails, the retry (after purging all entries) works.
  let failures = 1;
  mock.method(window.Storage.prototype, 'setItem', function (...args) {
    if (failures-- > 0) throw new Error('QuotaExceededError');
    return realSetItem.apply(this, args);
  });
  mock.timers.tick(1);
  setCachedContent('b', {}, { variantId: 'b' });
  assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(KEY))), ['b::::::::']);
  mock.restoreAll();

  // Both writes fail: storage keeps the old value and reads still match it.
  setCachedContent('c', {}, { variantId: 'c' });
  mock.method(window.Storage.prototype, 'setItem', () => { throw new Error('QuotaExceededError'); });
  setCachedContent('d', {}, { variantId: 'd' });
  mock.restoreAll();
  assert.equal(getCachedContent('d', {}), null);
  assert.deepEqual(getCachedContent('c', {}), { variantId: 'c' });
});
