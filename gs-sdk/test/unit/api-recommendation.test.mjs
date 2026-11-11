import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, setUrl, mockFetch, seedSession, jsonResponse } from './helpers/env.mjs';
import { bestProducts, byContext, openImpression } from '../../src/api/recommendation.js';

// Project that resolves the product variant by page URL (src/utils/productLookup.js).
const URL_LOOKUP_PROJECT = '69f9fd15bcb8468256ba4565';

const pathOf = (call) => {
  const url = new URL(call.url);
  return url.pathname + url.search;
};

const variable = (call, id) => call.body.variables.find((v) => v.type.id === id);

beforeEach(() => {
  resetDom();
  seedSession();
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.restoreAll();
});

test('bestProducts requests the best products', async () => {
  const calls = mockFetch(() => [{ id: 'p1' }]);
  assert.deepEqual(await bestProducts(), [{ id: 'p1' }]);
  assert.equal(calls[0].method, 'GET');
  assert.equal(pathOf(calls[0]), '/recommendations/best-products');
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');
});

test('bestProducts can ask for the impression id', async () => {
  const calls = mockFetch(() => []);
  await bestProducts({ includeImpressionId: true });
  assert.equal(pathOf(calls[0]), '/recommendations/best-products?includeImpressionId=true');
});

test('byContext sends the given context with the default strategy and count', async () => {
  const calls = mockFetch(() => ({ items: [{ id: 'p1' }] }));
  const context = { currentPage: { productId: '10' } };

  assert.deepEqual(await byContext({ context }), { items: [{ id: 'p1' }] });

  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/recommendations/by-context');
  assert.deepEqual(calls[0].body, {
    context,
    variables: [
      { type: { id: 'gs_recoStrategy' }, value: { id: 'similarity' } },
      { type: { id: 'gs_recoCount' }, value: '10' },
    ],
  });
});

test('byContext sends strategy, count, filter, options, custom strategy and impression flag', async () => {
  const calls = mockFetch(() => ({}));
  await byContext({
    strategy: 'bought-together',
    count: 4,
    filter: 'brand = "ACME"',
    options: { diversify: true },
    gs_recoStrategyCustom: 'custom-1',
    includeImpressionId: true,
  });

  assert.equal(pathOf(calls[0]), '/recommendations/by-context?includeImpressionId=true');
  assert.deepEqual(variable(calls[0], 'gs_recoStrategy').value, { id: 'bought-together' });
  assert.equal(variable(calls[0], 'gs_recoCount').value, '4');
  assert.deepEqual(variable(calls[0], 'recoOptions').value, { options: { diversify: true }, filter_string: 'brand = "ACME"' });
  assert.deepEqual(variable(calls[0], 'gs_recoStrategyCustom').value, { _id: 'custom-1' });
});

test('byContext sends only the filter or only the options when just one is given', async () => {
  const calls = mockFetch(() => ({}));
  await byContext({ filter: 'price < 10' });
  await byContext({ options: { a: 1 } });
  assert.deepEqual(variable(calls[0], 'recoOptions').value, { filter_string: 'price < 10' });
  assert.deepEqual(variable(calls[1], 'recoOptions').value, { options: { a: 1 } });
});

test('byContext uses the product of the page on a product detail page', async () => {
  window.gsConfig.options.context = { pageType: 'product_detail', product_id: 77 };
  const calls = mockFetch(() => ({}));
  await byContext({ context: { currentPage: { productId: 'ignored' } } });
  assert.deepEqual(calls[0].body.context, { currentPage: { productId: '77' } });
});

test('byContext keeps the given context with forceContext, or outside a product detail page', async () => {
  const calls = mockFetch(() => ({}));
  const context = { currentPage: { productId: 'mine' } };

  window.gsConfig.options.context = { pageType: 'product_detail', product_id: 77 };
  await byContext({ context, forceContext: true });
  assert.deepEqual(calls[0].body.context, context);

  window.gsConfig.options.context = { pageType: 'home', product_id: 77 };
  await byContext({ context });
  assert.deepEqual(calls[1].body.context, context);

  window.gsConfig.options.context = { pageType: 'product_detail' };
  await byContext({ context });
  assert.deepEqual(calls[2].body.context, context);
});

test('byContext adds the page URL lookup for projects that resolve the variant by URL', async () => {
  seedSession({ project: URL_LOOKUP_PROJECT });
  setUrl('https://shop.example/sabana-roja.html?utm=1#reviews');
  window.gsConfig.options.context = { pageType: 'product_detail', product_id: 'parent-1' };
  const calls = mockFetch(() => ({}));

  await byContext();

  assert.deepEqual(calls[0].body.context, {
    currentPage: {
      productId: 'parent-1',
      preProcess: { field: 'url', fieldValue: 'https://shop.example/sabana-roja.html' },
    },
  });
});

test('byContext resolves to an empty list when the request fails', async () => {
  mockFetch(() => jsonResponse({}, { status: 500 }));
  assert.deepEqual(await byContext({ context: {} }), []);
  assert.equal(console.error.mock.calls.length, 1);
  assert.equal(console.error.mock.calls[0].arguments[0], 'Error fetching recommendations by context:');
});

test('openImpression marks the impression as opened only once', async () => {
  window.gsImpressionIds = [];
  const calls = mockFetch(() => ({ ok: true }));

  assert.deepEqual(await openImpression('imp-1'), { ok: true });
  assert.equal(await openImpression('imp-1'), undefined);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(pathOf(calls[0]), '/recommendations/impression/imp-1');
  assert.deepEqual(calls[0].body, { status: 'opened' });
  assert.deepEqual(window.gsImpressionIds, ['imp-1']);
});

test('openImpression ignores missing or non-string ids', async () => {
  window.gsImpressionIds = [];
  const calls = mockFetch();
  assert.equal(await openImpression(), undefined);
  assert.equal(await openImpression(''), undefined);
  assert.equal(await openImpression(123), undefined);
  assert.equal(calls.length, 0);
  assert.deepEqual(window.gsImpressionIds, []);
});

test('openImpression resolves to undefined when the request fails', async () => {
  window.gsImpressionIds = [];
  mockFetch(() => jsonResponse({}, { status: 500 }));
  assert.equal(await openImpression('imp-2'), undefined);
  assert.equal(console.error.mock.calls.length, 1);
});
