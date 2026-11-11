import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, mockFetch, seedSession, flush, jsonResponse } from './helpers/env.mjs';
import { getCart, onCartChange, notifyCartInteraction, CART_UPDATED_EVENT } from '../../src/api/cart.js';

// Waits between reads used by notifyCartInteraction (ms).
const RETRY_DELAYS = [700, 1000, 1500, 2500, 5000];

const pathOf = (call) => {
  const url = new URL(call.url);
  return url.pathname + url.search;
};

const advance = async (ms) => {
  mock.timers.tick(ms);
  await flush();
};

let unsubscribers = [];
const collectCarts = () => {
  const carts = [];
  unsubscribers.push(onCartChange((cart) => carts.push(cart)));
  return carts;
};

beforeEach(() => {
  resetDom();
  seedSession();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
});

afterEach(() => {
  unsubscribers.forEach((off) => off());
  unsubscribers = [];
  mock.timers.reset();
  mock.restoreAll();
});

// Must run first: it relies on the module never having read the cart before.
test('notifyCartInteraction reads the cart first when it has no baseline, then polls until updatedAt changes', async () => {
  let state = { cart: { updatedAt: 't1', products: [{ id: 'a' }] } };
  const calls = mockFetch(() => state);
  const carts = collectCarts();

  await notifyCartInteraction('cart');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(pathOf(calls[0]), '/channel/state');
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');

  await advance(699);
  assert.equal(calls.length, 1);
  await advance(1);
  assert.equal(calls.length, 2);
  assert.deepEqual(carts, [], 'the cart did not change yet');

  state = { cart: { updatedAt: 't2', products: [{ id: 'a' }, { id: 'b' }] } };
  await advance(999);
  assert.equal(calls.length, 2);
  await advance(1);
  assert.equal(calls.length, 3);
  assert.deepEqual(carts, [{ updatedAt: 't2', products: [{ id: 'a' }, { id: 'b' }] }]);

  await advance(60000);
  assert.equal(calls.length, 3, 'polling stops once the change was announced');
  assert.equal(carts.length, 1);
});

test('getCart returns the cart of /channel/state', async () => {
  const calls = mockFetch(() => ({ cart: { updatedAt: 'x1', totalAmount: 10 } }));
  assert.deepEqual(await getCart(), { updatedAt: 'x1', totalAmount: 10 });
  assert.equal(pathOf(calls[0]), '/channel/state');
});

test('getCart returns null when the state has no cart', async () => {
  mockFetch(() => ({}));
  assert.equal(await getCart(), null);
  mockFetch(() => null);
  assert.equal(await getCart(), null);
});

test('getCart keeps the last known cart and logs when the request fails', async () => {
  mockFetch(() => ({ cart: { updatedAt: 'x2' } }));
  await getCart();

  const log = mock.fn();
  window.gsLog = log;
  mockFetch(() => jsonResponse({}, { status: 500 }));
  assert.deepEqual(await getCart(), { updatedAt: 'x2' });
  assert.equal(log.mock.calls.length, 1);
  assert.equal(log.mock.calls[0].arguments[0], 'getCart error');
  assert.match(log.mock.calls[0].arguments[1].message, /GET request failed: 500/);
});

test('onCartChange ignores a non-function callback', () => {
  const add = mock.method(window, 'addEventListener');
  const off = onCartChange('nope');
  assert.equal(typeof off, 'function');
  assert.equal(off(), undefined);
  assert.equal(add.mock.calls.length, 0);
});

test('onCartChange calls back with the cart until it is unsubscribed', () => {
  const carts = [];
  const off = onCartChange((cart) => carts.push(cart));
  window.dispatchEvent(new window.CustomEvent(CART_UPDATED_EVENT, { detail: { updatedAt: 'a' } }));
  off();
  window.dispatchEvent(new window.CustomEvent(CART_UPDATED_EVENT, { detail: { updatedAt: 'b' } }));
  assert.deepEqual(carts, [{ updatedAt: 'a' }]);
});

test('onCartChange swallows and logs errors thrown by the callback', () => {
  const log = mock.fn();
  window.gsLog = log;
  const boom = new Error('boom');
  const off = onCartChange(() => { throw boom; });
  const others = collectCarts();
  window.dispatchEvent(new window.CustomEvent(CART_UPDATED_EVENT, { detail: { updatedAt: 'a' } }));
  off();
  assert.deepEqual(log.mock.calls[0].arguments, ['onCartChange callback error', boom]);
  assert.deepEqual(others, [{ updatedAt: 'a' }], 'other subscribers still get the cart');
});

test('notifyCartInteraction does nothing for events that do not touch the cart', async () => {
  const calls = mockFetch(() => ({ cart: { updatedAt: 'n1' } }));
  const carts = collectCarts();
  await notifyCartInteraction('view');
  await notifyCartInteraction(['view', 'search']);
  await advance(20000);
  assert.equal(calls.length, 0);
  assert.deepEqual(carts, []);
});

test('notifyCartInteraction emits the window event with the new cart in detail', async () => {
  mockFetch(() => ({ cart: { updatedAt: 'w1' } }));
  await getCart();
  mockFetch(() => ({ cart: { updatedAt: 'w2', amountOfProducts: 3 } }));

  const details = [];
  const listener = (event) => details.push(event.detail);
  window.addEventListener('gopersonal:cart-updated', listener);
  try {
    await notifyCartInteraction(['view', 'purchase']);
    await advance(700);
    assert.deepEqual(details, [{ updatedAt: 'w2', amountOfProducts: 3 }]);
  } finally {
    window.removeEventListener('gopersonal:cart-updated', listener);
  }
});

test('notifyCartInteraction announces the last cart after exhausting every retry', async () => {
  mockFetch(() => ({ cart: { updatedAt: 'same' } }));
  await getCart();
  const calls = mockFetch(() => ({ cart: { updatedAt: 'same' } }));
  const carts = collectCarts();

  await notifyCartInteraction('clean-cart');
  assert.equal(calls.length, 0, 'the baseline is already known');

  for (let i = 0; i < RETRY_DELAYS.length; i++) {
    assert.deepEqual(carts, []);
    await advance(RETRY_DELAYS[i]);
    assert.equal(calls.length, i + 1);
  }
  assert.deepEqual(carts, [{ updatedAt: 'same' }]);

  await advance(60000);
  assert.equal(calls.length, RETRY_DELAYS.length);
  assert.equal(carts.length, 1);
});

test('notifyCartInteraction announces an emptied cart (null) as a change', async () => {
  mockFetch(() => ({ cart: { updatedAt: 'full' } }));
  await getCart();
  mockFetch(() => ({}));
  const carts = collectCarts();
  await notifyCartInteraction('remove-cart');
  await advance(700);
  assert.deepEqual(carts, [null]);
});

test('a newer cart interaction supersedes the previous wait: only the last one announces', async () => {
  mockFetch(() => ({ cart: { updatedAt: 's1' } }));
  await getCart();
  const calls = mockFetch(() => ({ cart: { updatedAt: 's2' } }));
  const carts = collectCarts();

  await notifyCartInteraction('cart');
  await notifyCartInteraction('cart');
  await advance(700);

  assert.equal(calls.length, 1);
  assert.deepEqual(carts, [{ updatedAt: 's2' }]);
});
