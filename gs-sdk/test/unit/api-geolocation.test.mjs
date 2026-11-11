import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, mockFetch, jsonResponse } from './helpers/env.mjs';
import { getCurrentGeoIPLocation } from '../../src/api/geolocation.js';

const PRIMARY = 'https://ipapi.co/json';
const FALLBACK = 'https://gopersonal-ip-geolocation.fly.dev/myip';
const CACHE_MS = 3 * 60 * 60 * 1000;

let now;

beforeEach(() => {
  resetDom();
  now = Date.now();
  mock.timers.enable({ apis: ['Date'], now });
});

afterEach(() => {
  mock.timers.reset();
});

test('getCurrentGeoIPLocation fetches the location and caches it in localStorage', async () => {
  const calls = mockFetch(() => ({ country: 'UY', city: 'Montevideo' }));

  assert.deepEqual(await getCurrentGeoIPLocation(), { country: 'UY', city: 'Montevideo' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, PRIMARY);
  assert.deepEqual(JSON.parse(localStorage.getItem('gs_geoip_location')), { country: 'UY', city: 'Montevideo' });
  assert.equal(localStorage.getItem('gs_geoip_location_expiry'), String(now + CACHE_MS));
});

test('getCurrentGeoIPLocation answers from the cache until it expires', async () => {
  let country = 'UY';
  const calls = mockFetch(() => ({ country }));
  await getCurrentGeoIPLocation();

  country = 'AR';
  mock.timers.tick(CACHE_MS - 1);
  assert.deepEqual(await getCurrentGeoIPLocation(), { country: 'UY' });
  assert.equal(calls.length, 1);

  mock.timers.tick(1);
  assert.deepEqual(await getCurrentGeoIPLocation(), { country: 'AR' });
  assert.equal(calls.length, 2);
});

test('getCurrentGeoIPLocation ignores a cached value without expiry', async () => {
  localStorage.setItem('gs_geoip_location', JSON.stringify({ country: 'old' }));
  const calls = mockFetch(() => ({ country: 'new' }));
  assert.deepEqual(await getCurrentGeoIPLocation(), { country: 'new' });
  assert.equal(calls.length, 1);
});

test('getCurrentGeoIPLocation falls back to the secondary endpoint when the primary fails', async () => {
  const calls = mockFetch((url) => (url === PRIMARY ? jsonResponse({}, { status: 429 }) : { country: 'UY' }));
  assert.deepEqual(await getCurrentGeoIPLocation(), { country: 'UY' });
  assert.deepEqual(calls.map((call) => call.url), [PRIMARY, FALLBACK]);
});

test('getCurrentGeoIPLocation resolves to an empty object when the lookup cannot be made', async () => {
  mockFetch(() => { throw new Error('offline'); });
  assert.deepEqual(await getCurrentGeoIPLocation(), {});
});

test('getCurrentGeoIPLocation also falls back on a network error, and caches the fallback answer', async () => {
  const calls = mockFetch((url) => {
    if (url === PRIMARY) throw new Error('offline');
    return { country: 'AR' };
  });
  assert.deepEqual(await getCurrentGeoIPLocation(), { country: 'AR' });
  assert.deepEqual(await getCurrentGeoIPLocation(), { country: 'AR' });
  assert.deepEqual(calls.map((call) => call.url), [PRIMARY, FALLBACK]);
});

test('getCurrentGeoIPLocation resolves to an empty object when both endpoints answer with an error', async () => {
  const calls = mockFetch(() => jsonResponse({}, { status: 500 }));
  assert.deepEqual(await getCurrentGeoIPLocation(), {});
  assert.deepEqual(calls.map((call) => call.url), [PRIMARY, FALLBACK]);
});
