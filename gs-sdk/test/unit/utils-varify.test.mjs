import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { resetDom, flush } from './helpers/env.mjs';
import { ensureVarify, getAppliedExperimentBySlug, getAppliedExperiments } from '../../src/utils/varify.js';

const SCRIPT_SELECTOR = 'script[src*="app.varify.io/varify.js"]';

let logs;

function clearVarifyGlobals() {
  for (const key of ['varify', '_varify', 'varifyLoaded', 'varifyScriptLoaded']) {
    try { delete window[key]; } catch (e) { /* ignore */ }
  }
}

// jsdom does not fetch external scripts, so load/error are fired by hand.
function pendingScript() {
  return document.head.querySelector(SCRIPT_SELECTOR);
}

beforeEach(() => {
  resetDom();
  clearVarifyGlobals();
  logs = [];
  window.gsLog = (...args) => logs.push(args);
});

afterEach(() => {
  clearVarifyGlobals();
});

test('ensureVarify without an iid returns the current window.varify untouched', async () => {
  assert.equal(await ensureVarify(), undefined);
  window.varify = { iid: 7 };
  assert.deepEqual(await ensureVarify(null), { iid: 7 });
  assert.equal(pendingScript(), null);
});

test('ensureVarify injects the script, guards the iid and resolves once the script loads', async () => {
  const promise = ensureVarify(123);
  const script = pendingScript();
  assert.ok(script, 'script tag appended to head');
  assert.match(script.src, /^https:\/\/app\.varify\.io\/varify\.js\?forceReload=\d+$/);
  assert.equal(script.async, true);
  assert.equal(window.varify.iid, 123);

  script.onload();
  const result = await promise;
  assert.equal(result, window.varify);
  assert.equal(result.iid, 123);
  assert.ok(logs.some(([msg, data]) => msg === 'Varify script loaded' && data.iid === 123 && data.currentIid === 123));
});

test('the guarded instance ignores iid changes and logs unexpected ones', async () => {
  const promise = ensureVarify(123);
  pendingScript().onload();
  await promise;

  window.varify.iid = 123; // same value: silently accepted
  assert.equal(logs.filter(([msg]) => msg === 'Blocked unexpected Varify iid change').length, 0);

  window.varify.iid = 999;
  assert.equal(window.varify.iid, 123);
  const blocked = logs.find(([msg]) => msg === 'Blocked unexpected Varify iid change');
  assert.deepEqual(blocked[1], { attemptedIid: 999, lockedIid: 123 });
});

test('replacing window.varify keeps the new object but forces the locked iid', async () => {
  const promise = ensureVarify(123);
  pendingScript().onload();
  await promise;

  const replacement = { iid: 555, loaded: true, debug: { appliedExperiments: {} } };
  window.varify = replacement;
  assert.equal(window.varify, replacement);
  assert.equal(window.varify.iid, 123);
  assert.equal(window.varify.loaded, true);
  const blocked = logs.find(([msg]) => msg === 'Blocked replacement of the guarded Varify instance');
  // attemptedIid is not asserted: the source logs it after the value was already
  // rewritten with the locked iid (see varify.js installVarifyGuard setter).
  assert.equal(blocked[1].lockedIid, 123);

  // A non-object replacement becomes a fresh guarded object.
  window.varify = 'nope';
  assert.equal(typeof window.varify, 'object');
  assert.equal(window.varify.iid, 123);
});

test('ensureVarify short-circuits when the expected iid is already loaded', async () => {
  const existing = { iid: 42, loaded: true };
  window.varify = existing;
  const result = await ensureVarify(42);
  assert.equal(result, existing);
  assert.equal(pendingScript(), null);
  // Now guarded: the iid cannot be changed anymore.
  window.varify.iid = 1;
  assert.equal(window.varify.iid, 42);
});

test('concurrent calls for the same iid share one script load', async () => {
  const first = ensureVarify(77);
  const second = ensureVarify(77);
  assert.equal(document.head.querySelectorAll(SCRIPT_SELECTOR).length, 1);
  assert.ok(logs.some(([msg, data]) => msg === 'Varify load already in progress' && data.iid === 77));
  pendingScript().onload();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(a.iid, 77);
});

test('ensureVarify removes the previous Varify footprint before reloading with another iid', async () => {
  window.varify = { iid: 1, loaded: true };
  window._varify = { stale: true };
  window.varifyLoaded = true;
  window.varifyScriptLoaded = true;
  const oldScript = document.createElement('script');
  oldScript.setAttribute('src', 'https://app.varify.io/varify.js?old=1');
  oldScript.id = 'old-varify';
  // type keeps jsdom from trying to run it
  oldScript.type = 'text/plain';
  document.head.appendChild(oldScript);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('src', 'about:blank#varify');
  iframe.id = 'old-varify-frame';
  document.body.appendChild(iframe);

  const promise = ensureVarify(2);
  assert.equal(document.getElementById('old-varify'), null);
  assert.equal(document.getElementById('old-varify-frame'), null);
  assert.equal('_varify' in window, false);
  assert.equal('varifyLoaded' in window, false);
  assert.equal('varifyScriptLoaded' in window, false);
  assert.equal(window.varify.iid, 2);
  assert.equal(window.varify.loaded, undefined, 'old instance is dropped');
  const reload = logs.find(([msg]) => msg === 'Reloading Varify with the expected iid');
  assert.deepEqual(reload[1], { previousIid: 1, nextIid: 2, previousLoaded: true });

  pendingScript().onload();
  assert.equal((await promise).iid, 2);
});

test('a failed script load is logged and still resolves with the guarded instance', async () => {
  const promise = ensureVarify(9);
  const failure = new Error('blocked by client');
  pendingScript().onerror(failure);
  const result = await promise;
  assert.equal(result.iid, 9);
  assert.ok(logs.some(([msg, error]) => msg === 'Varify load failed' && error === failure));

  // The pending state is cleared: a new call starts a new load.
  const retry = ensureVarify(9);
  await flush(1);
  assert.equal(document.head.querySelectorAll(SCRIPT_SELECTOR).length, 1, 'previous tag replaced by a new one');
  pendingScript().onload();
  await retry;
});

test('getAppliedExperiments returns the applied experiments or an empty object', () => {
  assert.deepEqual(getAppliedExperiments(), {});
  window.varify = { debug: { appliedExperiments: { 10: { experimentSlug: 'hero' } } } };
  assert.deepEqual(getAppliedExperiments(), { 10: { experimentSlug: 'hero' } });
});

test('getAppliedExperimentBySlug finds an experiment by slug', () => {
  assert.equal(getAppliedExperimentBySlug('hero'), undefined);
  window.varify = {
    debug: {
      appliedExperiments: {
        10: { experimentSlug: 'hero', variationId: 1 },
        11: null,
        12: { experimentSlug: 'pdp', variationId: 2 },
      },
    },
  };
  assert.deepEqual(getAppliedExperimentBySlug('pdp'), { experimentSlug: 'pdp', variationId: 2 });
  assert.equal(getAppliedExperimentBySlug('missing'), undefined);
});
