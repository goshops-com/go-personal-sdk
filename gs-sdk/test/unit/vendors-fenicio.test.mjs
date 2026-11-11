import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { resetDom } from './helpers/env.mjs';
import { initVendorFenicio } from '../../src/vendors/fenicio.js';

const originalOpen = window.XMLHttpRequest.prototype.open;
let sdk;

// What the browser does when the request finishes.
function complete(xhr, status = 200) {
  Object.defineProperty(xhr, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(xhr, 'status', { configurable: true, value: status });
  xhr.dispatchEvent(new window.Event('readystatechange'));
}

function request(url, status) {
  const xhr = new window.XMLHttpRequest();
  xhr.open('GET', url);
  const opened = xhr.readyState;
  complete(xhr, status);
  return { xhr, opened };
}

beforeEach(() => {
  resetDom();
  sdk = { interactions: [], contents: [] };
  window.gsSDK = {
    addInteraction: (data) => sdk.interactions.push(data),
    getContentByContext: (...args) => sdk.contents.push(args),
  };
  mock.method(console, 'log', () => {});
  initVendorFenicio();
});

afterEach(() => {
  window.XMLHttpRequest.prototype.open = originalOpen;
  mock.restoreAll();
});

test('wraps XMLHttpRequest.open and still opens the request', () => {
  assert.notEqual(window.XMLHttpRequest.prototype.open, originalOpen);
  const { opened } = request('/ajax?service=mi-compra&op=agregar&sku=1&qty=1');
  assert.equal(opened, 1, 'the original open ran (readyState OPENED)');
  const other = request('/otra/cosa');
  assert.equal(other.opened, 1);
});

test('adding to the Fenicio cart reports a cart interaction with sku and quantity', () => {
  request('/ajax?service=mi-compra&op=agregar&sku=1:ABC:ROJO:U:1&qty=3');
  assert.deepEqual(sdk.interactions, [{ event: 'cart', sku: '1:ABC:ROJO:U:1', quantity: '3' }]);
  assert.deepEqual(sdk.contents, []);
});

test('removing from the Fenicio cart reports remove-cart with the cod param and quantity 1', () => {
  request('/ajax?service=mi-compra&op=quitar&cod=1:ABC:ROJO:U:1');
  assert.deepEqual(sdk.interactions, [{ event: 'remove-cart', sku: '1:ABC:ROJO:U:1', quantity: 1 }]);
});

test('other cart operations, failed requests and unrelated URLs report nothing', () => {
  request('/ajax?service=mi-compra&op=listar');
  request('/ajax?service=mi-compra&op=agregar&sku=S&qty=1', 500);
  request('/catalogo/cargar?codigoProducto=P1&codigoVariante=V1', 404);
  request('/ajax?service=otro&op=agregar&sku=S&qty=1');
  request('/checkout/agregar?sku=S&qty=1');
  assert.deepEqual(sdk.interactions, []);
  assert.deepEqual(sdk.contents, []);
});

test('nothing is reported before the request is done', () => {
  const xhr = new window.XMLHttpRequest();
  xhr.open('GET', '/ajax?service=mi-compra&op=agregar&sku=S&qty=1');
  // open() itself fires readystatechange with readyState 1.
  assert.deepEqual(sdk.interactions, []);
  complete(xhr);
  assert.equal(sdk.interactions.length, 1);
});

test('cart requests are ignored while the SDK is not ready', () => {
  delete window.gsSDK;
  assert.doesNotThrow(() => request('/ajax?service=mi-compra&op=agregar&sku=S&qty=1'));
  assert.doesNotThrow(() => request('/ajax?service=mi-compra&op=quitar&cod=S'));
  window.gsSDK = {};
  assert.doesNotThrow(() => request('/ajax?service=mi-compra&op=agregar&sku=S&qty=1'));
  assert.deepEqual(sdk.interactions, []);
});

test('a catalog variant request reports a view and asks for the product_detail contents', () => {
  request('/catalogo/cargar-variante?codigoProducto=P100&codigoVariante=AZUL');
  const sku = '1:P100:AZUL:U:1';
  assert.deepEqual(sdk.interactions, [{ event: 'view', sku }]);
  assert.deepEqual(sdk.contents, [['product_detail', { sku }]]);
});

test('a catalog request without the SDK is logged, not thrown', () => {
  delete window.gsSDK;
  assert.doesNotThrow(() => request('/catalogo/cargar-variante?codigoProducto=P100&codigoVariante=AZUL'));
  const logged = console.log.mock.calls.map((call) => call.arguments[0]);
  assert.ok(logged.some((value) => value instanceof TypeError));
});

test('an error thrown by the SDK while tracking the cart does not reach the page', () => {
  const failure = new Error('sdk failed');
  window.gsSDK = { addInteraction: () => { throw failure; } };
  const errors = mock.method(console, 'error', () => {});
  assert.doesNotThrow(() => request('/ajax?service=mi-compra&op=agregar&sku=S&qty=1'));
  assert.deepEqual(errors.mock.calls[0].arguments, ['Error processing the intercepted request:', failure]);
});
