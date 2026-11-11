import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { flush, getDom, mockFetch, resetDom, seedSession } from './helpers/env.mjs';
import { executeActions, debugSession } from '../../src/actions/sessionAction.js';

// jsdom cannot navigate: assigning location.href to another document only
// reports "not implemented" on the virtual console, which is what we observe.
const navigations = [];
getDom().virtualConsole.on('jsdomError', (error) => {
  if (/navigation/i.test(error.message)) navigations.push(error.message);
});

const modal = () => document.querySelector('[id^="gs-debug-modal-"]');

beforeEach(() => {
  resetDom();
  navigations.length = 0;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('executeActions needs both _gsSessionSet and callback', async () => {
  seedSession();
  const calls = mockFetch();
  for (const url of [
    'https://shop.example/',
    'https://shop.example/?_gsSessionSet=k1',
    'https://shop.example/?callback=https%3A%2F%2Fother.example%2Fcb',
  ]) {
    resetDom({ url });
    seedSession();
    executeActions('Custom');
  }
  await flush();
  assert.deepEqual(navigations, []);
  assert.equal(calls.length, 0);
});

test('executeActions redirects to the callback with the session and customer ids', async () => {
  resetDom({ url: 'https://shop.example/?_gsSessionSet=k1&callback=https%3A%2F%2Fother.example%2Fcb%3Fa%3D1' });
  seedSession({ sessionId: 'session-77' });
  localStorage.setItem('gs_vuuid', 'vuuid-5');
  const urls = [];
  const RealURL = globalThis.URL;
  // The redirect target is built with `new URL(callback)`: keep the instances to read the final URL.
  mock.method(globalThis, 'URL', function (...args) {
    const instance = new RealURL(...args);
    urls.push(instance);
    return instance;
  });

  executeActions('Custom');
  await flush();

  assert.equal(navigations.length, 1);
  assert.equal(urls.at(-1).toString(), 'https://other.example/cb?a=1&gsSessionId=session-77&gsCustomerId=vuuid-5');
});

test('executeActions throws on a callback that is not an absolute URL', () => {
  resetDom({ url: 'https://shop.example/?_gsSessionSet=k1&callback=not-a-url' });
  seedSession();
  assert.throws(() => executeActions('Custom'), TypeError);
  assert.deepEqual(navigations, []);
});

test('debugSession does nothing unless _gsDebugSession=true', () => {
  for (const url of ['https://shop.example/', 'https://shop.example/?_gsDebugSession=1']) {
    resetDom({ url });
    window.gsSDK = { getState: () => ({ never: 'shown' }) };
    debugSession();
    mock.timers.tick(1000);
    assert.equal(modal(), null, url);
  }
});

test('debugSession shows the session state in a modal one second later', async () => {
  resetDom({ url: 'https://shop.example/?_gsDebugSession=true' });
  window.gsSDK = { getState: () => ({ cart: { products: [{ id: 'p1' }] } }) };

  debugSession();
  mock.timers.tick(999);
  assert.equal(modal(), null);
  mock.timers.tick(1);
  await flush();

  const element = modal();
  assert.ok(element);
  assert.equal(element.parentNode, document.body);
  assert.equal(element.querySelector('h3').textContent.trim(), 'GS SDK Debug Session State');
  assert.deepEqual(JSON.parse(element.querySelector('pre').textContent), { cart: { products: [{ id: 'p1' }] } });
});

test('the debug modal closes from its buttons and from the backdrop, not from its content', async () => {
  resetDom({ url: 'https://shop.example/?_gsDebugSession=true' });
  window.gsSDK = { getState: () => ({ ok: true }) };
  const open = async () => {
    debugSession();
    mock.timers.tick(1000);
    await flush();
    return modal();
  };
  const click = (target) => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  let element = await open();
  click(element.querySelector('pre'));
  assert.ok(modal(), 'clicking the content keeps it open');
  click(element.firstElementChild);
  assert.equal(modal(), null, 'clicking the backdrop closes it');

  for (const index of [0, 1]) {
    element = await open();
    const buttons = element.querySelectorAll('button');
    assert.equal(buttons.length, 2);
    click(buttons[index]);
    assert.equal(modal(), null, `button ${index} closes it`);
  }
});
