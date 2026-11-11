import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resetDom, seedSession, flush } from './helpers/env.mjs';
import { getSharedToken, clearToken, setSharedToken } from '../../src/utils/session.js';

const IFRAME_ORIGIN = 'https://sdk.gopersonal.ai';
const IFRAME_ID = 'gs_sessionTokenIframe';

beforeEach(() => resetDom({ url: 'https://shop.example/some/page' }));

/** Replaces the iframe's contentWindow with a recorder of postMessage calls. */
function stubContentWindow(iframe) {
  const messages = [];
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: { postMessage: (data, targetOrigin) => messages.push({ data, targetOrigin }) },
  });
  return messages;
}

/** Iframe already in the page, as left by a previous call. */
function existingIframe() {
  const iframe = document.createElement('iframe');
  iframe.id = IFRAME_ID;
  document.body.appendChild(iframe);
  return { iframe, messages: stubContentWindow(iframe) };
}

const iframeSays = (data, origin = IFRAME_ORIGIN) =>
  window.dispatchEvent(new window.MessageEvent('message', { origin, data }));

/** Resolves to 'pending' when the promise has not settled yet. */
const stateOf = async (promise) => {
  await flush(2);
  return Promise.race([promise.then((value) => ({ value })), Promise.resolve('pending')]);
};

// ---------------------------------------------------------------------------
// getSharedToken
// ---------------------------------------------------------------------------

test('getSharedToken creates the hidden iframe and asks it for the session once loaded', async () => {
  const promise = getSharedToken();

  const iframe = document.getElementById(IFRAME_ID);
  assert.ok(iframe, 'iframe added to the page');
  assert.equal(iframe.parentNode, document.body);
  assert.equal(iframe.style.display, 'none');
  assert.equal(
    iframe.src,
    `${IFRAME_ORIGIN}/iframe.html?clientOrigin=${encodeURIComponent('https://shop.example')}&clientId=client-1`,
  );

  const messages = stubContentWindow(iframe);
  assert.equal(messages.length, 0, 'nothing is sent before the iframe loads');
  iframe.onload();
  assert.deepEqual(messages, [
    { data: { action: 'getSession', clientId: 'client-1' }, targetOrigin: IFRAME_ORIGIN },
  ]);

  iframeSays({ action: 'sessionData', session: { token: 'shared-token', project: 'p1' } });
  assert.deepEqual(await promise, { token: 'shared-token', project: 'p1' });
});

test('getSharedToken reuses an iframe that is already in the page', async () => {
  const { messages } = existingIframe();

  const promise = getSharedToken();

  assert.equal(document.querySelectorAll('iframe').length, 1);
  assert.deepEqual(messages, [
    { data: { action: 'getSession', clientId: 'client-1' }, targetOrigin: IFRAME_ORIGIN },
  ]);
  iframeSays({ action: 'sessionData', session: { token: 't' } });
  assert.deepEqual(await promise, { token: 't' });
});

test('getSharedToken resolves null when the iframe has no session', async () => {
  existingIframe();
  const promise = getSharedToken();
  iframeSays({ action: 'sessionData' });
  assert.equal(await promise, null);
});

test('getSharedToken ignores messages from other origins and other actions', async () => {
  existingIframe();
  const promise = getSharedToken();

  iframeSays({ action: 'sessionData', session: { token: 'evil' } }, 'https://evil.example');
  iframeSays({ action: 'sessionSet' });
  assert.equal(await stateOf(promise), 'pending');

  iframeSays({ action: 'sessionData', session: { token: 'good' } });
  assert.deepEqual(await promise, { token: 'good' });
});

test('getSharedToken stops listening once it got its answer', async () => {
  existingIframe();
  const promise = getSharedToken();
  iframeSays({ action: 'sessionData', session: { token: 'first' } });
  iframeSays({ action: 'sessionData', session: { token: 'second' } });
  assert.deepEqual(await promise, { token: 'first' });
});

// ---------------------------------------------------------------------------
// clearToken
// ---------------------------------------------------------------------------

test('clearToken asks the iframe to clear the token of the client', () => {
  const { messages } = existingIframe();
  clearToken();
  assert.deepEqual(messages, [
    { data: { action: 'clearToken', clientId: 'client-1' }, targetOrigin: IFRAME_ORIGIN },
  ]);
});

test('clearToken does nothing when there is no iframe', () => {
  assert.doesNotThrow(() => clearToken());
  assert.equal(document.getElementById(IFRAME_ID), null);
});

// ---------------------------------------------------------------------------
// setSharedToken
// ---------------------------------------------------------------------------

test('setSharedToken creates the iframe and sends it the current session once loaded', async () => {
  const session = seedSession({ token: 'token-9', project: 'project-9', sessionId: 'session-9' });
  localStorage.setItem('gs_vuuid', 'vuuid-9');

  const promise = setSharedToken();

  const iframe = document.getElementById(IFRAME_ID);
  assert.ok(iframe, 'iframe added to the page');
  assert.equal(iframe.style.display, 'none');
  assert.equal(
    iframe.src,
    `${IFRAME_ORIGIN}/iframe.html?clientOrigin=${encodeURIComponent('https://shop.example')}&clientId=client-1`,
  );

  const messages = stubContentWindow(iframe);
  iframe.onload();
  assert.deepEqual(messages, [
    {
      data: { action: 'setSession', clientId: 'client-1', session: { ...session, vuuid: 'vuuid-9' } },
      targetOrigin: IFRAME_ORIGIN,
    },
  ]);

  assert.equal(await stateOf(promise), 'pending');
  iframeSays({ action: 'sessionSet' });
  assert.equal(await promise, undefined);
});

test('setSharedToken reuses an existing iframe and waits for the confirmation of the iframe origin', async () => {
  seedSession();
  const { messages } = existingIframe();

  const promise = setSharedToken();

  assert.equal(document.querySelectorAll('iframe').length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.action, 'setSession');
  assert.equal(messages[0].data.session.token, 'token-1');

  iframeSays({ action: 'sessionSet' }, 'https://evil.example');
  iframeSays({ action: 'sessionData', session: {} });
  assert.equal(await stateOf(promise), 'pending');

  iframeSays({ action: 'sessionSet' });
  assert.equal(await promise, undefined);
});

test('the iframe is still added when the SDK runs before <body> exists', async () => {
  const body = document.body;
  body.remove();
  try {
    const shared = getSharedToken();
    const iframe = document.getElementById(IFRAME_ID);
    assert.equal(iframe.parentNode, document.head);
    stubContentWindow(iframe);
    iframe.onload();
    iframeSays({ action: 'sessionData', session: { token: 'early' } });
    assert.deepEqual(await shared, { token: 'early' });
    iframe.remove();

    const pending = setSharedToken();
    const second = document.getElementById(IFRAME_ID);
    assert.equal(second.parentNode, document.head);
    stubContentWindow(second);
    second.onload();
    iframeSays({ action: 'sessionSet' });
    await pending;
  } finally {
    document.documentElement.appendChild(body);
  }
});
