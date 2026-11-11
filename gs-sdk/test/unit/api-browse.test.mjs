import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, mockFetch, seedSession, flush } from './helpers/env.mjs';
import { install } from '../../src/api/browse.js';

const RRWEB_SRC = 'https://cdn.jsdelivr.net/npm/rrweb@latest/dist/record/rrweb-record.min.js';
const ENDPOINT = 'https://browse.go-shops.workers.dev';
const SAVE_EVERY = 10 * 1000;

let recorders;

const advance = async (ms) => {
  mock.timers.tick(ms);
  await flush();
};

// Installs the recorder and simulates the rrweb script finishing its load (jsdom does not
// download external scripts). Returns the `emit` rrweb would call with each recorded event.
const startRecording = async () => {
  install({});
  const script = document.body.querySelector('script');
  await script.onload();
  return recorders.at(-1).emit;
};

beforeEach(() => {
  resetDom();
  seedSession();
  recorders = [];
  globalThis.rrwebRecord = (config) => recorders.push(config);
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  delete globalThis.rrwebRecord;
  mock.timers.reset();
  mock.restoreAll();
});

test('install injects the rrweb script and only records once it has loaded', async () => {
  const calls = mockFetch();
  install({});

  const scripts = document.body.querySelectorAll('script');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, RRWEB_SRC);
  assert.equal(recorders.length, 0);

  await scripts[0].onload();
  assert.equal(recorders.length, 1);
  assert.equal(typeof recorders[0].emit, 'function');
  assert.equal(calls.length, 0);
});

test('recorded events are posted every 10 seconds with the session token', async () => {
  const calls = mockFetch();
  const emit = await startRecording();

  emit({ type: 1, data: 'a' });
  emit({ type: 2, data: 'b' });
  await advance(SAVE_EVERY - 1);
  assert.equal(calls.length, 0);
  await advance(1);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[0].body, { events: [{ type: 1, data: 'a' }, { type: 2, data: 'b' }] });

  // Only new events go in the next save.
  emit({ type: 3 });
  await advance(SAVE_EVERY);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { events: [{ type: 3 }] });
});

test('nothing is posted while there are no events, and saving keeps being scheduled', async () => {
  const calls = mockFetch();
  const emit = await startRecording();

  await advance(SAVE_EVERY);
  await advance(SAVE_EVERY);
  assert.equal(calls.length, 0);

  emit({ type: 4 });
  await advance(SAVE_EVERY);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { events: [{ type: 4 }] });
});

test('a failed save is reported and the next one still runs', async () => {
  const boom = new Error('offline');
  let fail = true;
  const calls = mockFetch(() => {
    if (fail) throw boom;
    return {};
  });
  const emit = await startRecording();

  emit({ type: 5 });
  await advance(SAVE_EVERY);
  assert.equal(calls.length, 1);
  assert.deepEqual(console.error.mock.calls[0].arguments, ['Error sending data:', boom]);

  fail = false;
  emit({ type: 6 });
  await advance(SAVE_EVERY);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { events: [{ type: 6 }] });
});

test('pending events are saved when the page unloads', async () => {
  const calls = mockFetch();
  const emit = await startRecording();

  emit({ type: 7 });
  window.dispatchEvent(new window.Event('beforeunload'));
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.deepEqual(calls[0].body, { events: [{ type: 7 }] });
});
