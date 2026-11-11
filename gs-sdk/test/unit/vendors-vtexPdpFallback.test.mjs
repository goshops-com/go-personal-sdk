import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { flush, mockFetch, resetDom, seedSession } from './helpers/env.mjs';
import { scheduleVtexPdpFallback } from '../../src/vendors/vtexPdpFallback.js';

const PDP_URL = 'https://shop.example/zapatilla-roja/p';
const EMPTY_PAGE = { loadNowContent: [], lazyLoadContent: [] };

const contentCalls = (calls) => calls.filter((call) => call.url.includes('/public/cached-content/'));
const interactionCalls = (calls) => calls.filter((call) => call.url.endsWith('/interaction'));

beforeEach(() => {
  resetDom({ url: PDP_URL });
  window.gsStore = { interactionCount: 0 };
  seedSession({ project: 'project-1' });
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  delete window.__RUNTIME__;
});

test('waits for the delay before resolving the PDP, and is only scheduled once per page', async () => {
  const calls = mockFetch(() => EMPTY_PAGE);

  scheduleVtexPdpFallback();
  assert.equal(window.__gsVtexPdpFallbackScheduled, true);
  scheduleVtexPdpFallback(10);
  mock.timers.tick(1999);
  await flush();
  assert.equal(calls.length, 0);

  mock.timers.tick(1);
  await flush();
  assert.equal(contentCalls(calls).length, 1);
});

test('resolves the product by the VTEX runtime id and tracks the view', async () => {
  window.__RUNTIME__ = { route: { pageContext: { type: 'product', id: 4321 } } };
  window.gsConfig.options.context = { pageType: 'unknown' };
  const calls = mockFetch(() => EMPTY_PAGE);

  scheduleVtexPdpFallback(50);
  mock.timers.tick(50);
  await flush();

  const [content] = contentCalls(calls);
  assert.ok(content.url.endsWith('/public/cached-content/project-1/?pageType=product_detail'), content.url);
  assert.deepEqual(window.__gsLastContentContext.context, 'product_detail');
  assert.deepEqual(window.gsConfig.options.context, { pageType: 'product_detail', product_url: PDP_URL });

  const [view] = interactionCalls(calls);
  assert.equal(view.method, 'POST');
  assert.deepEqual(view.body, { event: 'view', item: '4321' });
});

test('without a runtime product id it resolves by URL and sends no view', async () => {
  window.__RUNTIME__ = { route: { pageContext: { type: 'category', id: 9 } } };
  // The cached page is not available: the personalised request carries the lookup.
  const calls = mockFetch((url) => {
    if (url.includes('/public/cached-content/')) throw new Error('cache miss');
    return EMPTY_PAGE;
  });
  mock.method(console, 'error', () => {});

  scheduleVtexPdpFallback(0);
  mock.timers.tick(0);
  await flush();

  const page = calls.find((call) => call.url.includes('/personal/content-page?pageType=product_detail'));
  assert.ok(page, 'falls back to the personalised page request');
  assert.equal(page.method, 'POST');
  assert.equal(JSON.stringify(page.body).includes(PDP_URL), true);
  assert.equal(interactionCalls(calls).length, 0);
});

test('does nothing outside a product page', async () => {
  resetDom({ url: 'https://shop.example/categoria/zapatillas' });
  seedSession();
  const calls = mockFetch(() => EMPTY_PAGE);

  scheduleVtexPdpFallback(0);
  mock.timers.tick(0);
  await flush();

  assert.equal(calls.length, 0);
});

test('does nothing when the VTEX app already asked for product_detail', async () => {
  window.__gsLastContentContext = { context: 'product_detail', ts: Date.now() };
  const calls = mockFetch(() => EMPTY_PAGE);

  scheduleVtexPdpFallback(0);
  mock.timers.tick(0);
  await flush();

  assert.equal(calls.length, 0);
});

test('does nothing when GoPersonal widgets are already on the page', async () => {
  window.__gsLastContentContext = { context: 'home', ts: Date.now() };
  document.body.innerHTML = '<div id="gs_main_container_abc"></div>';
  const calls = mockFetch(() => EMPTY_PAGE);

  scheduleVtexPdpFallback(0);
  mock.timers.tick(0);
  await flush();

  assert.equal(calls.length, 0);
});

test('a failing content request is logged and never thrown', async () => {
  const logged = [];
  window.gsLog = (...args) => logged.push(args);
  mock.method(console, 'error', () => {});
  mockFetch(() => { throw new Error('network down'); });

  scheduleVtexPdpFallback(0);
  mock.timers.tick(0);
  await flush(10);

  const entry = logged.find(([message]) => message === '[vtex-pdp-fallback] content error');
  assert.ok(entry, 'the rejection is caught and logged');
  assert.match(entry[1].message, /network down/);
});

test('a blocked storage is logged through gsLog, never thrown', async () => {
  const logged = [];
  window.gsLog = (...args) => logged.push(args);
  const failure = new Error('storage blocked');
  mock.method(window.Storage.prototype, 'getItem', () => { throw failure; });
  const calls = mockFetch(() => EMPTY_PAGE);

  scheduleVtexPdpFallback(0);
  mock.timers.tick(0);
  await flush();

  assert.equal(calls.length, 0);
  assert.ok(logged.some(([message, error]) => /^\[vtex-pdp-fallback\]/.test(message) && error === failure));
});
