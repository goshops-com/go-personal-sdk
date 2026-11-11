import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { flush, resetDom, setUrl } from './helpers/env.mjs';
import {
  installFenicio,
  installFenicioNavigationMonitor,
  processFenicioNavigation,
} from '../../src/providers/fenicio.js';

let contentCalls;
let pending;

// A gsSDK whose getContentByContext stays pending until the test settles it.
function fakeSdk() {
  contentCalls = [];
  pending = [];
  return {
    getContentByContext(pageType, options) {
      contentCalls.push([pageType, options]);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  };
}

async function settleContent() {
  pending.splice(0).forEach(({ resolve }) => resolve());
  await flush();
}

beforeEach(() => {
  resetDom();
  window.gsSDK = fakeSdk();
  mock.method(console, 'log', () => {});
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  // The monitor patches the history instance: go back to the prototype methods.
  delete window.history.pushState;
  delete window.history.replaceState;
});

test('processFenicioNavigation does nothing until the SDK is ready', async () => {
  delete window.gsSDK;
  assert.equal(await processFenicioNavigation(), undefined);
  window.gsSDK = {};
  assert.equal(await processFenicioNavigation({ pageType: 'home' }), undefined);
  assert.equal(window.__gsFenicioNavigationState, undefined);
});

test('processFenicioNavigation derives the page type from the path', async () => {
  const expectations = [
    ['https://shop.example/', 'home', { pageType: 'home', singlePage: true }],
    ['https://shop.example/catalogo/remera-azul_123', 'product_detail', {
      pageType: 'product_detail', product_url: 'https://shop.example/catalogo/remera-azul_123', singlePage: true,
    }],
    ['https://shop.example/checkout/envio', 'checkout', { pageType: 'checkout', singlePage: true }],
    ['https://shop.example/mujer/remeras', 'category', { pageType: 'category', singlePage: true }],
  ];

  for (const [url, pageType, options] of expectations) {
    setUrl(url);
    const done = processFenicioNavigation();
    assert.deepEqual(contentCalls.at(-1), [pageType, options], url);
    const { singlePage, ...context } = options;
    assert.deepEqual(window.gsConfig.options.context, context, 'the SDK context follows the page');
    await settleContent();
    await done;
  }
  assert.equal(contentCalls.length, expectations.length);
});

test('processFenicioNavigation honours an explicit context and completes product_url', async () => {
  setUrl('https://shop.example/catalogo/remera?color=azul');
  let done = processFenicioNavigation({ pageType: 'product_detail', product_id: 'P1' });
  assert.deepEqual(contentCalls[0], ['product_detail', {
    pageType: 'product_detail',
    product_id: 'P1',
    product_url: 'https://shop.example/catalogo/remera?color=azul',
    singlePage: true,
  }]);
  await settleContent();
  await done;

  setUrl('https://shop.example/catalogo/otra');
  done = processFenicioNavigation({ pageType: 'product_detail', product_url: 'https://shop.example/canonical' });
  assert.equal(contentCalls[1][1].product_url, 'https://shop.example/canonical');
  await settleContent();
  await done;

  setUrl('https://shop.example/landing');
  done = processFenicioNavigation({ pageType: 'landing', campaign: 'x' });
  assert.deepEqual(contentCalls[2], ['landing', { pageType: 'landing', campaign: 'x', singlePage: true }]);
  await settleContent();
  await done;
});

test('processFenicioNavigation loads each path once, and shares the request in flight', async () => {
  setUrl('https://shop.example/mujer');
  const first = processFenicioNavigation();
  const second = processFenicioNavigation();
  assert.equal(contentCalls.length, 1, 'the second call reuses the request in flight');
  assert.equal(window.__gsFenicioNavigationState.inFlight.key, '/mujer');

  await settleContent();
  await Promise.all([first, second]);
  assert.equal(window.__gsFenicioNavigationState.lastKey, '/mujer');
  assert.equal(window.__gsFenicioNavigationState.inFlight, null);

  await processFenicioNavigation();
  setUrl('https://shop.example/mujer?orden=precio');
  await processFenicioNavigation();
  assert.equal(contentCalls.length, 1, 'same path: nothing is requested again');
});

test('processFenicioNavigation does not mark a path as loaded if the shopper left meanwhile', async () => {
  setUrl('https://shop.example/mujer');
  const done = processFenicioNavigation();
  setUrl('https://shop.example/hombre');
  await settleContent();
  await done;

  assert.equal(window.__gsFenicioNavigationState.lastKey, undefined);
  assert.equal(window.__gsFenicioNavigationState.inFlight, null);
});

test('processFenicioNavigation rejects when the content fails and lets the path be retried', async () => {
  setUrl('https://shop.example/mujer');
  const done = processFenicioNavigation();
  const failure = new Error('content failed');
  pending.splice(0).forEach(({ reject }) => reject(failure));

  await assert.rejects(done, failure);
  assert.equal(window.__gsFenicioNavigationState.inFlight, null);

  const retry = processFenicioNavigation();
  assert.equal(contentCalls.length, 2);
  await settleContent();
  await retry;
});

test('the navigation monitor reloads the contents one second after a pushState to another path', async () => {
  setUrl('https://shop.example/');
  installFenicioNavigationMonitor({ pageType: 'home' });
  assert.equal(window.__gsFenicioNavigationMonitorInstalled, true);
  assert.equal(window.__gsFenicioNavigationState.lastKey, '/');

  window.history.pushState({ a: 1 }, '', '/mujer/remeras');
  assert.equal(window.location.pathname, '/mujer/remeras', 'the original pushState still runs');
  assert.deepEqual(window.history.state, { a: 1 });
  mock.timers.tick(999);
  assert.equal(contentCalls.length, 0);
  mock.timers.tick(1);
  assert.deepEqual(contentCalls, [['category', { pageType: 'category', singlePage: true }]]);
  await settleContent();
  assert.equal(window.__gsFenicioNavigationState.lastKey, '/mujer/remeras');
});

test('the navigation monitor ignores navigations that keep the path', async () => {
  setUrl('https://shop.example/mujer');
  installFenicioNavigationMonitor();

  window.history.pushState({}, '', '/mujer?pagina=2');
  window.history.replaceState({}, '', '/mujer?pagina=3#grid');
  mock.timers.tick(1000);

  assert.equal(contentCalls.length, 0);
});

test('the navigation monitor debounces quick navigations and follows replaceState and popstate', async () => {
  setUrl('https://shop.example/');
  installFenicioNavigationMonitor();

  window.history.pushState({}, '', '/mujer');
  mock.timers.tick(500);
  window.history.replaceState({}, '', '/catalogo/remera_1');
  mock.timers.tick(999);
  assert.equal(contentCalls.length, 0, 'the first timer was cancelled');
  mock.timers.tick(1);
  assert.equal(contentCalls.length, 1);
  assert.equal(contentCalls[0][0], 'product_detail');
  await settleContent();

  // Back button: the browser changes the URL and fires popstate.
  setUrl('https://shop.example/checkout');
  window.dispatchEvent(new window.Event('popstate'));
  mock.timers.tick(1000);
  assert.equal(contentCalls.length, 2);
  assert.equal(contentCalls[1][0], 'checkout');
  await settleContent();
});

test('the navigation monitor is installed once and logs a failed reload', async () => {
  setUrl('https://shop.example/');
  installFenicioNavigationMonitor();
  const patched = window.history.pushState;
  const state = window.__gsFenicioNavigationState;
  installFenicioNavigationMonitor({ pageType: 'category' });
  assert.equal(window.history.pushState, patched);
  assert.equal(window.__gsFenicioNavigationState, state);

  const errors = mock.method(console, 'error', () => {});
  window.history.pushState({}, '', '/mujer');
  mock.timers.tick(1000);
  const failure = new Error('content failed');
  pending.splice(0).forEach(({ reject }) => reject(failure));
  await flush();
  assert.deepEqual(errors.mock.calls.map((call) => call.arguments[0]), [failure]);
});

test('installFenicio resolves cart interactions by sku_list and passes the rest through', async () => {
  const sent = [];
  window.gsSDK = { addInteraction: (data) => { sent.push(data); } };
  window.gsConfig.options.context = { pageType: 'home' };

  const installed = installFenicio({});
  assert.notEqual(window.gsSDK.addInteraction, undefined);
  window.gsSDK.addInteraction({ event: 'cart', item: '1:ABC:ROJO:U:1', quantity: 2, price: 10 });
  window.gsSDK.addInteraction({ event: 'remove-cart', item: 'SKU-9', quantity: 1 });
  window.gsSDK.addInteraction({ event: 'view', item: 'P1' });

  assert.deepEqual(sent, [
    { event: 'cart', preProcess: ['findItemByField:sku_list'], fieldValue: '1:ABC:ROJO:U:1', quantity: 2 },
    { event: 'remove-cart', preProcess: ['findItemByField:sku_list'], fieldValue: 'SKU-9', quantity: 1 },
    { event: 'view', item: 'P1' },
  ]);

  mock.timers.tick(200);
  await installed;
  assert.equal(sent.length, 3, 'nothing else is sent outside a product page');
});

test('installFenicio tracks the product view by URL 200ms later', async () => {
  setUrl('https://shop.example/catalogo/remera_1?color=azul');
  const sent = [];
  window.gsSDK = { addInteraction: (data) => { sent.push(data); } };

  window.gsConfig.options.context = { pageType: 'product_detail' };
  let installed = installFenicio({});
  await flush();
  assert.deepEqual(sent, []);
  mock.timers.tick(200);
  await installed;
  assert.deepEqual(sent, [{
    event: 'view',
    preProcess: ['findItemByField:url'],
    fieldValue: 'https://shop.example/catalogo/remera_1',
  }]);

  // The context product_url wins over the address bar, without its query string.
  sent.length = 0;
  window.gsSDK = { addInteraction: (data) => { sent.push(data); } };
  window.gsConfig.options.context = { pageType: 'product_detail', product_url: 'https://shop.example/catalogo/canonica?utm=1' };
  installed = installFenicio({});
  mock.timers.tick(200);
  await installed;
  assert.equal(sent[0].fieldValue, 'https://shop.example/catalogo/canonica');
});

test('installFenicio logs in the shopper with the email shown on the billing step', async () => {
  setUrl('https://shop.example/checkout/facturacion');
  document.body.innerHTML = '<span class="email">ada@example.com</span>';
  const logins = [];
  window.gsSDK = { addInteraction() {}, login: (...args) => logins.push(args) };
  window.gsConfig.options.context = { pageType: 'checkout' };

  const installed = installFenicio({});
  mock.timers.tick(200);
  await installed;

  assert.deepEqual(logins, [['ada@example.com', { email: 'ada@example.com', param_updateCartFromCustomer: true }]]);
});

test('installFenicio does not log in without a real email on the billing step', async () => {
  setUrl('https://shop.example/checkout/facturacion');
  document.body.innerHTML = '<span class="email">Invitado</span>';
  const logins = [];
  window.gsSDK = { addInteraction() {}, login: (...args) => logins.push(args) };
  window.gsConfig.options.context = { pageType: 'checkout' };

  const installed = installFenicio({});
  mock.timers.tick(200);
  await installed;

  assert.deepEqual(logins, []);
});

test('installFenicio never throws: errors are logged', async () => {
  const errors = mock.method(console, 'error', () => {});

  // No page context configured.
  window.gsSDK = { addInteraction() {} };
  window.gsConfig = { options: {} };
  let installed = installFenicio({});
  mock.timers.tick(200);
  await installed;
  assert.equal(errors.mock.calls.length, 1);
  assert.equal(errors.mock.calls[0].arguments[0], 'Error in tracking script:');
  assert.ok(errors.mock.calls[0].arguments[1] instanceof TypeError);

  // SDK not ready yet.
  delete window.gsSDK;
  installed = installFenicio({});
  await installed;
  assert.equal(errors.mock.calls.length, 2);
});
