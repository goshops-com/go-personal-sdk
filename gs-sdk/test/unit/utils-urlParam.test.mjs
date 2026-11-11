import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resetDom, setUrl } from './helpers/env.mjs';
import { previewVariant, getParam, jsonToQueryString, isSearchReferral } from '../../src/utils/urlParam.js';

beforeEach(() => resetDom());

test('getParam reads the current query string', () => {
  setUrl('https://shop.example/p?gsDebug=true&name=a%20b');
  assert.equal(getParam('gsDebug'), 'true');
  assert.equal(getParam('name'), 'a b');
  assert.equal(getParam('missing'), null);
});

test('getParam follows the URL when it changes (SPA navigation)', () => {
  setUrl('https://shop.example/?gsVariantId=v1');
  assert.equal(getParam('gsVariantId'), 'v1');
  setUrl('https://shop.example/?gsVariantId=v2');
  assert.equal(getParam('gsVariantId'), 'v2');
  setUrl('https://shop.example/');
  assert.equal(getParam('gsVariantId'), null);
});

test('previewVariant returns gsPreviewVariant or null', () => {
  assert.equal(previewVariant(), null);
  setUrl('https://shop.example/?gsPreviewVariant=abc');
  assert.equal(previewVariant(), 'abc');
});

test('jsonToQueryString encodes keys and values', () => {
  assert.equal(jsonToQueryString({ a: 1, 'b c': 'x&y' }), '?a=1&b%20c=x%26y');
  assert.equal(jsonToQueryString({}), '?');
});

test('isSearchReferral looks for _gsSearchId in the referrer', () => {
  const setReferrer = (value) => Object.defineProperty(document, 'referrer', { configurable: true, get: () => value });
  setReferrer('');
  assert.equal(isSearchReferral(), false);
  setReferrer('q=tv&_gsSearchId=123');
  assert.equal(isSearchReferral(), true);
  setReferrer('q=tv');
  assert.equal(isSearchReferral(), false);
  delete document.referrer;
});
