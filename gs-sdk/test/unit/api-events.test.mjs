import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, mockFetch, seedSession, flush } from './helpers/env.mjs';
import { track, flushEvents } from '../../src/api/events.js';

const DEFAULT_URL = 'https://events.gopersonal.ai/events';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let now;

const setVisibility = (value) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
};

const installBeacon = (impl) => {
  const beacon = mock.fn(impl);
  window.navigator.sendBeacon = beacon;
  return beacon;
};

beforeEach(() => {
  resetDom();
  seedSession();
  now = Date.now();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
});

afterEach(() => {
  // The module keeps its queue and timer between tests: drain them.
  seedSession();
  mockFetch();
  flushEvents();
  delete window.navigator.sendBeacon;
  delete document.visibilityState;
  mock.timers.reset();
  mock.restoreAll();
});

test('track batches events and sends them after 5 seconds', async () => {
  const calls = mockFetch();
  localStorage.setItem('gs_vuuid', 'vuuid-1');

  track('ac_click', { column: 'marcas', pos: 1 });
  track('ac_view');
  mock.timers.tick(4999);
  assert.equal(calls.length, 0);
  mock.timers.tick(1);
  assert.equal(calls.length, 1);

  const [call] = calls;
  assert.equal(call.url, DEFAULT_URL);
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.headers, { 'Content-Type': 'text/plain' });
  assert.equal(call.init.keepalive, true);
  assert.equal(call.body.token, 'token-1');
  assert.equal(call.body.vuuid, 'vuuid-1');
  assert.equal(typeof call.body.sdk_version, 'string');
  assert.equal(call.body.events.length, 2);

  const [first, second] = call.body.events;
  assert.match(first.id, UUID_V4);
  assert.notEqual(first.id, second.id);
  assert.equal(first.event, 'ac_click');
  assert.equal(first.ts, now);
  assert.equal(first.url, 'https://shop.example/');
  assert.deepEqual(first.props, { column: 'marcas', pos: 1 });
  assert.equal(second.event, 'ac_view');
  assert.deepEqual(second.props, {});

  // Nothing left to send afterwards.
  mock.timers.tick(20000);
  assert.equal(calls.length, 1);
});

test('track takes content, variant and pageType from options, and pageType from the SDK context otherwise', () => {
  window.gsConfig.options = { eventsUrl: 'https://events.test/in', context: { pageType: 'home' } };
  const calls = mockFetch();

  track(123, { a: 1 }, { content: 'content-1', variant: 'variant-1', pageType: 'search' });
  track('other');
  flushEvents();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://events.test/in');
  const [first, second] = calls[0].body.events;
  assert.equal(first.event, '123');
  assert.equal(first.content, 'content-1');
  assert.equal(first.variant, 'variant-1');
  assert.equal(first.page_type, 'search');
  assert.equal(second.page_type, 'home');
  assert.equal('content' in second, false);
});

test('track sends the url given in options instead of the one of the page', () => {
  const calls = mockFetch();

  track('internal', {}, { url: 'https://shop.example/sale' });
  track('default');
  flushEvents();

  assert.deepEqual(calls[0].body.events.map((event) => event.url), ['https://shop.example/sale', 'https://shop.example/']);
});

test('track ignores calls without an event name', () => {
  const calls = mockFetch();
  track('');
  track(null, { a: 1 });
  mock.timers.tick(10000);
  assert.equal(calls.length, 0);
});

test('track never throws: errors are logged', () => {
  const log = mock.fn();
  window.gsLog = log;
  const calls = mockFetch();
  const boom = new Error('boom');

  assert.doesNotThrow(() => track({ toString() { throw boom; } }));

  assert.deepEqual(log.mock.calls[0].arguments, ['track error', boom]);
  mock.timers.tick(10000);
  assert.equal(calls.length, 0);
});

test('track flushes right away when the batch reaches 20 events', () => {
  const calls = mockFetch();
  for (let i = 0; i < 19; i++) track('e' + i);
  assert.equal(calls.length, 0);
  track('e19');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.events.map((e) => e.event), Array.from({ length: 20 }, (_, i) => 'e' + i));

  // The pending timer was cancelled by that flush.
  mock.timers.tick(10000);
  assert.equal(calls.length, 1);
});

test('events wait in the queue while there is no session token', () => {
  localStorage.removeItem('gs-v-1');
  const calls = mockFetch();
  track('early');
  mock.timers.tick(5000);
  assert.equal(calls.length, 0);

  seedSession({ token: 'token-late' });
  flushEvents();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.token, 'token-late');
  assert.deepEqual(calls[0].body.events.map((e) => e.event), ['early']);
});

test('the queue keeps only the newest 200 events and sends them in requests of 50', () => {
  localStorage.removeItem('gs-v-1');
  const calls = mockFetch();
  for (let i = 0; i < 205; i++) track('q' + i);
  assert.equal(calls.length, 0);

  seedSession();
  flushEvents();
  assert.equal(calls.length, 4);
  const sent = calls.flatMap((call) => call.body.events.map((e) => e.event));
  assert.deepEqual(calls.map((call) => call.body.events.length), [50, 50, 50, 50]);
  assert.equal(sent[0], 'q5');
  assert.equal(sent[199], 'q204');
});

test('flushEvents without queued events sends nothing', () => {
  const calls = mockFetch();
  flushEvents();
  flushEvents({ beacon: true });
  assert.equal(calls.length, 0);
});

test('hiding the tab sends the queue with sendBeacon as text/plain', async () => {
  const calls = mockFetch();
  const beacon = installBeacon(() => true);

  track('leaving', { a: 1 });
  setVisibility('visible');
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(beacon.mock.calls.length, 0, 'nothing is sent while the tab is visible');

  setVisibility('hidden');
  document.dispatchEvent(new window.Event('visibilitychange'));

  assert.equal(beacon.mock.calls.length, 1);
  assert.equal(calls.length, 0);
  const [url, blob] = beacon.mock.calls[0].arguments;
  assert.equal(url, DEFAULT_URL);
  assert.equal(blob.type, 'text/plain');
  const body = JSON.parse(await blob.text());
  assert.equal(body.token, 'token-1');
  assert.deepEqual(body.events.map((e) => e.event), ['leaving']);

  // The 5 s timer was cancelled and the queue is empty.
  mock.timers.tick(10000);
  assert.equal(calls.length, 0);
  assert.equal(beacon.mock.calls.length, 1);
});

test('pagehide falls back to fetch when sendBeacon refuses the payload', () => {
  const calls = mockFetch();
  const beacon = installBeacon(() => false);
  track('bye');
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(beacon.mock.calls.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.events.map((e) => e.event), ['bye']);
});

test('a sendBeacon that throws falls back to fetch', () => {
  const calls = mockFetch();
  installBeacon(() => { throw new Error('beacon blocked'); });
  track('bye-2');
  flushEvents({ beacon: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.events.map((e) => e.event), ['bye-2']);
});

test('without sendBeacon the page-exit flush uses fetch', () => {
  const calls = mockFetch();
  assert.equal(window.navigator.sendBeacon, undefined);
  track('bye-3');
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(calls.length, 1);
});

test('a failed flush request is logged and does not reject', async () => {
  const log = mock.fn();
  window.gsLog = log;
  const boom = new Error('network down');
  mockFetch(() => { throw boom; });
  track('lost');
  flushEvents();
  await flush();
  assert.deepEqual(log.mock.calls.at(-1).arguments, ['track flush error', boom]);
});

test('event ids are still v4 uuids when crypto.randomUUID is not available', () => {
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: undefined });
  try {
    const calls = mockFetch();
    track('legacy-a');
    track('legacy-b');
    flushEvents();
    const ids = calls[0].body.events.map((e) => e.id);
    assert.match(ids[0], UUID_V4);
    assert.match(ids[1], UUID_V4);
    assert.notEqual(ids[0], ids[1]);
  } finally {
    delete window.crypto.randomUUID;
  }
  assert.equal(typeof window.crypto.randomUUID, 'function');
});
