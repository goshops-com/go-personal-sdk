import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { flush, jsonResponse, mockFetch, resetDom, seedSession } from './helpers/env.mjs';
import { onVtexEmbeddedInit } from '../../src/vendors/vtexEmbedded.js';

const EMPTY_PAGE = { loadNowContent: [], lazyLoadContent: [] };
// One of the projects that only load contents when asked with `force`.
const FORCED_ONLY_PROJECT = '67374d510dfcc232a627662e';

let resets;

// What the VTEX IO pixel app does: window.postMessage with the event.
async function pixel(data) {
  window.dispatchEvent(new window.MessageEvent('message', { data }));
  await flush();
}

const byPath = (calls, path, method) => calls.filter((call) => new URL(call.url).pathname === path && (!method || call.method === method));
const contentPages = (calls) => calls
  .filter((call) => call.url.includes('/public/cached-content/'))
  .map((call) => new URL(call.url).searchParams.get('pageType'));

beforeEach(() => {
  resetDom();
  window.gsStore = { interactionCount: 0 };
  window.gsConfig = { clientId: 'client-1', options: { provider: 'VTEX' } };
  resets = 0;
  window.gsResetSession = async () => { resets++; };
  seedSession();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  onVtexEmbeddedInit();
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('listens to window messages only once', () => {
  assert.equal(window.__gsIntegrationListener, true);
  const added = mock.method(window, 'addEventListener');
  onVtexEmbeddedInit();
  assert.equal(added.mock.calls.length, 0);

  delete window.__gsIntegrationListener;
  onVtexEmbeddedInit();
  assert.deepEqual(added.mock.calls.map((call) => call.arguments[0]), ['message']);
});

test('ignores messages that are not VTEX pixel events', async () => {
  const calls = mockFetch();
  await pixel(undefined);
  await pixel('plain string');
  await pixel({ foo: 'bar' });
  await pixel({ eventName: 'vtex:somethingElse' });
  assert.equal(calls.length, 0);
});

test('productView loads the product_detail contents and tracks the view', async () => {
  seedSession({ project: FORCED_ONLY_PROJECT });
  const calls = mockFetch(() => EMPTY_PAGE);

  await pixel({ eventName: 'vtex:productView', product: { productId: '1001' } });

  assert.deepEqual(contentPages(calls), ['product_detail'], 'contents are forced even on forced-only projects');
  const [view] = byPath(calls, '/interaction');
  assert.equal(view.method, 'POST');
  assert.deepEqual(view.body, { event: 'view', item: '1001', provider: 'vtex' });
});

test('productView without a product id does nothing', async () => {
  const calls = mockFetch(() => EMPTY_PAGE);
  await pixel({ eventName: 'vtex:productView', product: {} });
  await pixel({ eventName: 'vtex:productView' });
  assert.equal(calls.length, 0);
});

test('userData with an email logs the customer in with their profile and shares the session', async () => {
  const calls = mockFetch();

  await pixel({
    eventName: 'vtex:userData',
    id: 'vtex-user-1',
    email: 'ada@example.com',
    firstName: ' Ada ',
    lastName: ' Lovelace ',
    phone: ' 555 0100 ',
  });

  const logins = byPath(calls, '/channel/login');
  assert.equal(logins.length, 1);
  assert.equal(logins[0].method, 'POST');
  assert.deepEqual(logins[0].body, {
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    phone: '555 0100',
    param_updateCartFromCustomer: true,
    customerId: 'vtex-user-1',
    provider: 'vtex',
  });

  const session = JSON.parse(localStorage.getItem('gs-v-1'));
  assert.equal(session.customer_id, 'vtex-user-1');
  assert.equal(session.customer_email, 'ada@example.com');

  const iframe = document.getElementById('gs_sessionTokenIframe');
  assert.ok(iframe, 'the session is shared through the SDK iframe after the login');
  assert.match(iframe.src, /^https:\/\/sdk\.gopersonal\.ai\/iframe\.html\?clientOrigin=https%3A%2F%2Fshop\.example&clientId=client-1$/);
});

test('userData leaves out a profile that is missing or not text', async () => {
  const calls = mockFetch();

  await pixel({ eventName: 'vtex:userData', id: 'u2', email: 'bob@example.com', firstName: 'Bob', lastName: null, phone: 5550100 });
  await pixel({ eventName: 'vtex:userData', id: 'u3', email: 'eve@example.com', firstName: '  ', phone: '' });

  const bodies = byPath(calls, '/channel/login').map((call) => call.body);
  assert.deepEqual(bodies, [
    { email: 'bob@example.com', name: 'Bob', param_updateCartFromCustomer: true, customerId: 'u2', provider: 'vtex' },
    { email: 'eve@example.com', param_updateCartFromCustomer: true, customerId: 'u3', provider: 'vtex' },
  ]);
});

test('a failed login is retried every 100ms, three times at most', async () => {
  let failures = 2;
  const calls = mockFetch((url) => {
    if (url.endsWith('/channel/login') && failures-- > 0) return jsonResponse({}, { status: 500 });
    return {};
  });
  const logins = () => byPath(calls, '/channel/login').length;

  await pixel({ eventName: 'vtex:userData', id: 'u1', email: 'ada@example.com' });
  assert.equal(logins(), 1);
  mock.timers.tick(99);
  await flush();
  assert.equal(logins(), 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(logins(), 2);
  assert.equal(document.getElementById('gs_sessionTokenIframe'), null);
  mock.timers.tick(100);
  await flush();
  assert.equal(logins(), 3);
  assert.ok(document.getElementById('gs_sessionTokenIframe'), 'shared once the login went through');

  // Always failing: gives up after the third try.
  resetDom();
  window.gsConfig = { clientId: 'client-1', options: { provider: 'VTEX' } };
  seedSession();
  const failing = mockFetch(() => jsonResponse({}, { status: 500 }));
  await pixel({ eventName: 'vtex:userData', id: 'u1', email: 'ada@example.com' });
  for (let i = 0; i < 5; i++) {
    mock.timers.tick(100);
    await flush();
  }
  assert.equal(byPath(failing, '/channel/login').length, 3);
  assert.equal(document.getElementById('gs_sessionTokenIframe'), null);
});

test('userData without an email logs out the identified customer', async () => {
  seedSession({ customer_id: 'vtex-user-1' });
  const calls = mockFetch();

  await pixel({ eventName: 'vtex:userData' });

  const [logout] = byPath(calls, '/channel/logout');
  assert.equal(logout.method, 'POST');
  assert.deepEqual(logout.body, { clientId: 'client-1' });
  assert.equal(localStorage.getItem('gs-v-1'), null, 'the session is dropped');
  assert.equal(resets, 1, 'and a new one is requested');
});

test('userData without an email does nothing when the SDK has no client id', async () => {
  seedSession({ customer_id: 'vtex-user-1' });
  window.gsConfig = { options: { provider: 'VTEX' } };
  const calls = mockFetch();

  await pixel({ eventName: 'vtex:userData' });

  assert.equal(calls.length, 0);
  assert.notEqual(localStorage.getItem('gs-v-1'), null);
});

test('a failed logout is logged, not thrown', async () => {
  seedSession({ customer_id: 'vtex-user-1' });
  const logged = [];
  window.gsLog = (...args) => logged.push(args);
  mockFetch(() => jsonResponse({}, { status: 500 }));

  await pixel({ eventName: 'vtex:userData', email: '' });

  const entry = logged.find(([message]) => message === 'Error logging out client');
  assert.ok(entry);
  assert.match(entry[1].message, /POST request failed: 500/);
});

test('addToWishlist tracks a like', async () => {
  const calls = mockFetch();

  await pixel({ eventName: 'vtex:addToWishlist', items: { product: { productId: '77' } } });
  await pixel({ eventName: 'vtex:addToWishlist', items: {} });

  assert.deepEqual(byPath(calls, '/interaction').map((call) => call.body), [{ event: 'like', item: '77', provider: 'vtex' }]);
});

test('addToCart and removeFromCart track the first item with the vtex provider', async () => {
  const calls = mockFetch();

  await pixel({ eventName: 'vtex:addToCart', items: [{ productId: '10', quantity: 2, price: 159900 }, { productId: '11', quantity: 1, price: 100 }] });
  await pixel({ eventName: 'vtex:removeFromCart', items: [{ productId: '10', quantity: 1, price: 159900 }] });
  await pixel({ eventName: 'vtex:addToCart', items: [] });
  await pixel({ eventName: 'vtex:removeFromCart', items: [{ quantity: 1 }] });
  await pixel({ eventName: 'vtex:addToCart' });

  assert.deepEqual(byPath(calls, '/interaction', 'POST').map((call) => call.body), [
    { event: 'cart', item: '10', quantity: 2, price: 159900, provider: 'vtex' },
    { event: 'remove-cart', item: '10', quantity: 1, price: 159900, provider: 'vtex' },
  ]);
});

test('cartChanged replaces the session cart with the VTEX cart', async () => {
  const calls = mockFetch();

  await pixel({
    eventName: 'vtex:cartChanged',
    items: [
      { productId: '10', price: 1000, quantity: 2, imageUrl: 'https://img/10.jpg' },
      { productId: '20', price: 250, quantity: 1, imageUrl: 'https://img/20.jpg' },
      { productId: '30' },
    ],
  });

  const [update] = byPath(calls, '/channel/state', 'PUT');
  assert.deepEqual(update.body, {
    cart: {
      amountOfProducts: 3,
      totalAmount: 2250,
      products: [
        { id: '10', price: 1000, quantity: 2, image_url: 'https://img/10.jpg' },
        { id: '20', price: 250, quantity: 1, image_url: 'https://img/20.jpg' },
        { id: '30' },
      ],
    },
  });
  assert.equal(byPath(calls, '/interaction').length, 0);
});

test('cartChanged with an empty cart cleans the session cart', async () => {
  const calls = mockFetch();

  await pixel({ eventName: 'vtex:cartChanged', items: [] });
  await pixel({ eventName: 'vtex:cartChanged' });

  assert.deepEqual(byPath(calls, '/interaction', 'POST').map((call) => call.body), [
    { event: 'clean-cart', provider: 'vtex' },
    { event: 'clean-cart', provider: 'vtex' },
  ]);
  assert.equal(byPath(calls, '/channel/state', 'PUT').length, 0);
});

test('orderPlaced turns the cart into a purchase', async () => {
  const calls = mockFetch();

  await pixel({ eventName: 'vtex:orderPlaced', transactionId: 'order-1' });
  await pixel({ eventName: 'vtex:orderPlaced' });

  const purchases = byPath(calls, '/interaction/state/cart');
  assert.deepEqual(purchases.map((call) => [call.method, call.body]), [
    ['POST', { transactionId: 'order-1', provider: 'vtex' }],
    ['POST', { provider: 'vtex' }],
  ]);
});

test('pageView loads the contents of the page type, forcing them', async () => {
  seedSession({ project: FORCED_ONLY_PROJECT });
  const calls = mockFetch(() => EMPTY_PAGE);
  const visit = async (url) => {
    resetDom({ url });
    window.gsConfig = { clientId: 'client-1', options: { provider: 'VTEX' } };
    seedSession({ project: FORCED_ONLY_PROJECT });
    await pixel({ eventName: 'vtex:pageView' });
  };

  await visit('https://shop.example/');
  await visit('https://shop.example/checkout/#/cart');
  await visit('https://shop.example/checkout/#/payment');
  await visit('https://shop.example/zapatillas?page=2');

  assert.deepEqual(contentPages(calls), ['home', 'checkout', 'unknown', 'unknown']);
});

test('pageView on a product page is left to productView', async () => {
  resetDom({ url: 'https://shop.example/zapatilla-roja/p' });
  seedSession();
  const calls = mockFetch(() => EMPTY_PAGE);

  await pixel({ eventName: 'vtex:pageView' });

  assert.equal(calls.length, 0);
});

test('pageView retries failing contents every 100ms and gives up after three tries', async () => {
  const logged = [];
  window.gsLog = (...args) => logged.push(args);
  mock.method(console, 'error', () => {});
  const calls = mockFetch(() => { throw new Error('network down'); });
  const failed = () => logged.filter(([message]) => message === 'retryContentByContext failed');

  await pixel({ eventName: 'vtex:pageView' });
  assert.equal(contentPages(calls).length, 1);
  mock.timers.tick(100);
  await flush();
  assert.equal(contentPages(calls).length, 2);
  assert.equal(failed().length, 0);
  mock.timers.tick(100);
  await flush();
  assert.equal(contentPages(calls).length, 3);
  assert.equal(failed().length, 1);
  assert.match(failed()[0][1].message, /network down/);

  mock.timers.tick(1000);
  await flush();
  assert.equal(contentPages(calls).length, 3);
});
