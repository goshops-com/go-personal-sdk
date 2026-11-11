import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { flush, getDom, jsonResponse, mockFetch, resetDom } from './helpers/env.mjs';
import { executeActions } from '../../src/actions/addToCart.js';

// jsdom cannot navigate: assigning location.href to another document only
// reports "not implemented" on the virtual console, which is what we observe.
const navigations = [];
getDom().virtualConsole.on('jsdomError', (error) => {
  if (/navigation/i.test(error.message)) navigations.push(error.message);
});

const overlay = () => [...document.body.children].find((el) => el.style.position === 'fixed');

beforeEach(() => {
  resetDom();
  navigations.length = 0;
});

afterEach(() => mock.restoreAll());

test('does nothing for providers other than WooCommerce', async () => {
  resetDom({ url: 'https://shop.example/?_gsAdd=1,2' });
  const calls = mockFetch();
  executeActions('Shopify');
  executeActions(undefined);
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(document.body.children.length, 0);
});

test('does nothing on WooCommerce without the _gsAdd param', async () => {
  resetDom({ url: 'https://shop.example/?_gsRedirect=cart' });
  const calls = mockFetch();
  executeActions('WooCommerce');
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(document.body.children.length, 0);
});

test('posts the product ids to admin-ajax, shows the popup and removes it on success', async () => {
  resetDom({ url: 'https://shop.example/?utm=x&_gsAdd=12,34' });
  const calls = mockFetch(() => ({ success: true }));

  executeActions('WooCommerce');

  const popup = overlay();
  assert.ok(popup, 'popup is shown while the request is in flight');
  assert.equal(popup.style.position, 'fixed');
  assert.equal(popup.firstChild.innerText, 'Agregando tus productos al carrito...');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/wp-admin/admin-ajax.php');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].body.get('action'), 'add_products_to_cart');
  assert.equal(calls[0].body.get('product_ids'), '[12,34]');

  await flush();
  assert.equal(overlay(), undefined);
  assert.deepEqual(navigations, [], 'no redirect without _gsRedirect');
});

test('redirects to _gsRedirect after the products were added', async () => {
  resetDom({ url: 'https://shop.example/?_gsAdd=7&_gsRedirect=checkout%2Fcart+page' });
  mockFetch(() => ({ success: true }));

  executeActions('WooCommerce');
  await flush();

  assert.equal(overlay(), undefined);
  assert.equal(navigations.length, 1);
});

test('logs the server error and removes the popup when WooCommerce rejects the products', async () => {
  resetDom({ url: 'https://shop.example/?_gsAdd=7&_gsRedirect=cart' });
  mockFetch(() => ({ success: false, data: { message: 'out of stock' } }));
  const errors = mock.method(console, 'error', () => {});

  executeActions('WooCommerce');
  await flush();

  assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [['Error:', 'out of stock']]);
  assert.equal(overlay(), undefined);
  assert.deepEqual(navigations, []);
});

test('removes the popup when the request fails', async () => {
  resetDom({ url: 'https://shop.example/?_gsAdd=7' });
  const failure = new Error('network down');
  mockFetch(() => { throw failure; });
  const errors = mock.method(console, 'error', () => {});

  executeActions('WooCommerce');
  assert.ok(overlay());
  await flush();

  assert.deepEqual(errors.mock.calls[0].arguments, ['Fetch Error:', failure]);
  assert.equal(overlay(), undefined);
});

test('a non JSON answer is handled like a failed request', async () => {
  resetDom({ url: 'https://shop.example/?_gsAdd=7' });
  mockFetch(() => ({ ...jsonResponse({}), json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  const errors = mock.method(console, 'error', () => {});

  executeActions('WooCommerce');
  await flush();

  assert.equal(errors.mock.calls[0].arguments[0], 'Fetch Error:');
  assert.equal(overlay(), undefined);
});
