import assert from 'node:assert/strict';
import test, { before, after, beforeEach, afterEach, mock } from 'node:test';
import { resetDom } from './helpers/env.mjs';
import { addToQueue, subscribeToTask, subscribeQueue } from '../../src/utils/queue.js';

const HOUR = 3600 * 1000;

// El intervalo de la cola se crea una sola vez por pagina (y nunca se limpia):
// los timers simulados quedan activos durante todo el archivo.
before(() => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_700_000_000_000 });
});

after(() => {
  mock.timers.reset();
});

beforeEach(() => {
  resetDom();
  globalThis.__queueCalls = [];
});

afterEach(() => {
  mock.restoreAll();
  delete globalThis.__queueCalls;
});

test('addToQueue stores the task under gs_queue', () => {
  addToQueue({ type: 'interaction-view', expirationDate: Date.now() + HOUR });
  assert.deepEqual(JSON.parse(localStorage.getItem('gs_queue')), [
    { type: 'interaction-view', expirationDate: Date.now() + HOUR },
  ]);
});

test('subscribeToTask stores the callback source and its params per task type', () => {
  subscribeToTask('interaction-cart', function (params) { return params; }, { contentKey: 'k1' });
  subscribeToTask('interaction-cart', (params) => params, { contentKey: 'k2' });
  const stored = JSON.parse(localStorage.getItem('gs_suscribers'));
  assert.equal(stored['interaction-cart'].length, 2);
  assert.deepEqual(stored['interaction-cart'][0].params, { contentKey: 'k1' });
  assert.match(stored['interaction-cart'][0].callback, /^function/);
});

test('the queue runs the subscribers of a task once, then drops task and subscribers', () => {
  subscribeQueue();
  subscribeToTask('interaction-cart', function (params) { globalThis.__queueCalls.push(params.contentKey); }, { contentKey: 'k1' });
  subscribeToTask('interaction-view', function (params) { globalThis.__queueCalls.push(params.contentKey); }, { contentKey: 'other' });
  addToQueue({ type: 'interaction-cart', expirationDate: Date.now() + HOUR });

  mock.timers.tick(500);
  assert.deepEqual(globalThis.__queueCalls, ['k1']);
  assert.deepEqual(JSON.parse(localStorage.getItem('gs_queue')), []);
  assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem('gs_suscribers'))), ['interaction-view']);

  addToQueue({ type: 'interaction-cart', expirationDate: Date.now() + HOUR });
  mock.timers.tick(500);
  assert.deepEqual(globalThis.__queueCalls, ['k1']);
});

test('an expired task is removed without running its subscribers', () => {
  subscribeQueue();
  subscribeToTask('interaction-cart', function () { globalThis.__queueCalls.push('ran'); }, {});
  addToQueue({ type: 'interaction-cart', expirationDate: Date.now() - 1 });
  mock.timers.tick(500);
  assert.deepEqual(globalThis.__queueCalls, []);
  assert.deepEqual(JSON.parse(localStorage.getItem('gs_queue')), []);
  assert.equal(JSON.parse(localStorage.getItem('gs_suscribers'))['interaction-cart'].length, 1);
});

test('a task without subscribers is just removed', () => {
  subscribeQueue();
  addToQueue({ type: 'interaction-none', expirationDate: Date.now() + HOUR });
  mock.timers.tick(500);
  assert.deepEqual(JSON.parse(localStorage.getItem('gs_queue')), []);
});

test('an idle queue reads storage once per tick and parses nothing', () => {
  subscribeQueue();
  const getItem = mock.method(window.Storage.prototype, 'getItem');
  mock.timers.tick(500);
  assert.deepEqual(getItem.mock.calls.map((call) => call.arguments[0]), ['gs_queue']);

  localStorage.setItem('gs_queue', '[]');
  getItem.mock.resetCalls();
  mock.timers.tick(500);
  assert.deepEqual(getItem.mock.calls.map((call) => call.arguments[0]), ['gs_queue']);
});

test('calling subscribeQueue again does not add a second interval', () => {
  subscribeQueue();
  subscribeQueue();
  subscribeQueue();
  const getItem = mock.method(window.Storage.prototype, 'getItem');
  mock.timers.tick(500);
  assert.equal(getItem.mock.callCount(), 1);
});
