import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, mockFetch, seedSession, flush, jsonResponse } from './helpers/env.mjs';
import { mountShopper } from '../../src/api/shopper.js';
import { getApiBaseURL } from '../../src/utils/http.js';

const WIDGET_URL = 'https://widget.example/shopper/index.html';
const WIDGET_ORIGIN = 'https://widget.example';
const API = getApiBaseURL();
const SESSION_KEY = `gp-shopper-v1:${API}:session-1`;

let mounted = [];

const bootstrapResponse = (extra = {}) => ({ token: 'boot-token', expiresIn: 600, config: { color: 'rgb(1, 2, 3)' }, ...extra });

const mount = (options = {}) => {
  const shopper = mountShopper({ widgetUrl: WIDGET_URL, ...options });
  mounted.push(shopper);
  return shopper;
};

const parts = () => {
  const panel = document.querySelector('section[aria-label="Personal Shopper"]');
  return {
    panel,
    iframe: panel.querySelector('iframe'),
    error: panel.querySelector('[role="alert"]'),
    launcher: document.querySelector('button'),
  };
};

// Records what the host posts to the widget iframe. Call it after the iframe got its src:
// jsdom swaps the contentWindow when the frame navigates.
const spyPosts = (iframe) => {
  const posts = [];
  iframe.contentWindow.postMessage = (message, origin) => posts.push({ message, origin });
  return posts;
};

// A message coming from the widget iframe.
const fromWidget = (iframe, data, { origin = WIDGET_ORIGIN, source = iframe.contentWindow } = {}) => {
  window.dispatchEvent(new window.MessageEvent('message', { data, origin, source }));
};

const bootstrapCalls = (calls) => calls.filter((call) => call.url === `${API}/shopper/v1/bootstrap`);

beforeEach(() => {
  resetDom();
  seedSession();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
});

afterEach(() => {
  mounted.forEach((shopper) => shopper.destroy());
  mounted = [];
  mock.timers.reset();
  mock.restoreAll();
});

test('mountShopper only accepts an HTTPS widget URL (or http on localhost)', () => {
  mockFetch();
  assert.throws(() => mountShopper({ widgetUrl: 'http://widget.example/' }), /shopper widgetUrl must use HTTPS/);
  assert.throws(() => mountShopper({ widgetUrl: 'ftp://localhost/widget' }), /shopper widgetUrl must use HTTPS/);
  assert.throws(() => mountShopper({ widgetUrl: 'not a url' }), TypeError);
  assert.throws(() => mountShopper(), TypeError);
  assert.equal(document.querySelector('section'), null);

  assert.doesNotThrow(() => mount({ widgetUrl: 'http://localhost:5173/' }));
  assert.doesNotThrow(() => mount({ widgetUrl: 'http://127.0.0.1:5173/' }));
  assert.equal(document.querySelectorAll('section').length, 2);
});

test('mountShopper fails when the container selector matches nothing', () => {
  mockFetch();
  assert.throws(() => mountShopper({ widgetUrl: WIDGET_URL, container: '#missing' }), /shopper container not found/);
  assert.equal(document.querySelector('section'), null);
});

test('mounting the floating launcher does not bootstrap until it is opened', async () => {
  const calls = mockFetch(() => bootstrapResponse());
  mount();
  await flush();

  const { panel, iframe, error, launcher } = parts();
  assert.equal(calls.length, 0);
  assert.equal(panel.parentNode, document.body);
  assert.equal(panel.hidden, true);
  assert.equal(panel.style.display, 'none');
  assert.equal(iframe.hidden, true);
  assert.equal(iframe.getAttribute('src'), null);
  assert.equal(error.hidden, true);
  assert.equal(launcher.type, 'button');
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.style.position, 'fixed');
});

test('clicking the launcher opens the panel, bootstraps and loads the widget; clicking again hides it', async () => {
  const calls = mockFetch(() => bootstrapResponse());
  mount();
  const { panel, iframe, launcher } = parts();

  launcher.click();
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/shopper/v1/bootstrap`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');
  assert.equal(panel.hidden, false);
  assert.equal(panel.style.display, 'block');
  assert.equal(panel.style.getPropertyPriority('display'), 'important');
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(iframe.hidden, false);
  assert.equal(iframe.src, `${WIDGET_URL}?hostOrigin=${encodeURIComponent('https://shop.example')}`);
  assert.equal(launcher.style.background, 'rgb(1, 2, 3)');

  launcher.click();
  assert.equal(panel.hidden, true);
  assert.equal(panel.style.display, 'none');
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, launcher);

  // Reopening with a bootstrap that is still valid does not ask for another one.
  launcher.click();
  await flush();
  assert.equal(panel.hidden, false);
  assert.equal(calls.length, 1);
});

test('the widget is initialized once it says it is ready, and only messages from its own frame count', async () => {
  mockFetch(() => bootstrapResponse({ config: { color: 'rgb(1, 2, 3)', name: 'Ana' } }));
  const shopper = mount({ context: { pageType: 'product_detail', productId: 42, extra: 'dropped' } });
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);

  fromWidget(iframe, { type: 'gp-shopper:ready' }, { origin: 'https://evil.example' });
  fromWidget(iframe, { type: 'gp-shopper:ready' }, { source: window });
  fromWidget(iframe, null);
  assert.deepEqual(posts, []);

  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.deepEqual(posts, [{
    origin: WIDGET_ORIGIN,
    message: {
      type: 'gp-shopper:initialize',
      session: {
        token: 'boot-token',
        apiUrl: `${API}/shopper/v1`,
        config: { color: 'rgb(1, 2, 3)', name: 'Ana' },
        sessionKey: SESSION_KEY,
        canClose: true,
        context: { productId: '42', pageType: 'product' },
      },
    },
  }]);

  // Unknown message types are ignored.
  fromWidget(iframe, { type: 'gp-shopper:unknown' });
  assert.equal(posts.length, 1);
});

test('open focuses the widget once it is ready', async () => {
  mockFetch(() => bootstrapResponse());
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });

  shopper.close();
  assert.notEqual(document.activeElement, iframe);
  await shopper.open();
  assert.equal(document.activeElement, iframe);
});

test('setContext re-initializes the widget with the normalized context', async () => {
  const calls = mockFetch(() => bootstrapResponse());
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.deepEqual(posts[0].message.session.context, {});

  shopper.setContext({ pageType: 'search', productId: 'sku-1' });
  shopper.setContext({ pageType: 'checkout', productId: { nested: true } });
  shopper.setContext(null);
  shopper.setContext({ pageType: 'home' });

  assert.deepEqual(posts.slice(1).map((post) => post.message.session.context), [
    { productId: 'sku-1', pageType: 'search' },
    {},
    {},
    { pageType: 'home' },
  ]);
  assert.equal(calls.length, 1, 'same session: no new bootstrap');
});

test('setContext bootstraps again when the SDK session changed', async () => {
  const calls = mockFetch(() => bootstrapResponse());
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });

  seedSession({ sessionId: 'session-2' });
  shopper.setContext({ pageType: 'other' });
  await flush();

  assert.equal(bootstrapCalls(calls).length, 2);
  const last = posts.at(-1).message.session;
  assert.equal(last.sessionKey, `gp-shopper-v1:${API}:session-2`);
  assert.deepEqual(last.context, { pageType: 'other' });
});

test('the conversation id reported by the widget is stored per session and sent back on the next initialize', async () => {
  mockFetch(() => bootstrapResponse());
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.equal('conversationId' in posts[0].message.session, false);

  fromWidget(iframe, { type: 'gp-shopper:conversation', id: 'not valid!' });
  fromWidget(iframe, { type: 'gp-shopper:conversation' });
  assert.equal(localStorage.getItem(SESSION_KEY), null);

  fromWidget(iframe, { type: 'gp-shopper:conversation', id: 'conv_1-A' });
  assert.equal(localStorage.getItem(SESSION_KEY), 'conv_1-A');

  shopper.setContext({});
  assert.equal(posts.at(-1).message.session.conversationId, 'conv_1-A');
});

test('a stored conversation is resumed by a new mount of the same session', async () => {
  localStorage.setItem(SESSION_KEY, 'conv-stored');
  mockFetch(() => bootstrapResponse());
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.equal(posts[0].message.session.conversationId, 'conv-stored');
});

test('without a session id there is no session key and no stored conversation', async () => {
  seedSession({ sessionId: undefined });
  mockFetch(() => bootstrapResponse());
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  fromWidget(iframe, { type: 'gp-shopper:conversation', id: 'conv-2' });

  assert.equal(posts[0].message.session.sessionKey, null);
  assert.equal(localStorage.length, 1, 'only the SDK session is stored');
});

test('the widget can ask for a fresh token and for the panel to close', async () => {
  let n = 0;
  const calls = mockFetch(() => bootstrapResponse({ token: `boot-${++n}` }));
  const shopper = mount();
  await shopper.open();
  const { iframe, panel, launcher } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.equal(posts[0].message.session.token, 'boot-1');

  fromWidget(iframe, { type: 'gp-shopper:refresh' });
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(posts.at(-1).message.session.token, 'boot-2');

  fromWidget(iframe, { type: 'gp-shopper:close' });
  assert.equal(panel.hidden, true);
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
});

test('concurrent opens share a single bootstrap request', async () => {
  const calls = mockFetch(() => bootstrapResponse());
  const shopper = mount();
  await Promise.all([shopper.open(), shopper.open()]);
  assert.equal(calls.length, 1);
});

test('the token is renewed a minute before it expires while the panel is open', async () => {
  const calls = mockFetch(() => bootstrapResponse({ expiresIn: 120 }));
  const shopper = mount();
  await shopper.open();
  assert.equal(calls.length, 1);

  mock.timers.tick(59999);
  await flush();
  assert.equal(calls.length, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(calls.length, 2);

  // Hidden panel: the renewal is skipped...
  shopper.close();
  mock.timers.tick(60000);
  await flush();
  assert.equal(calls.length, 2);

  // ...and the next open, with the token about to expire, bootstraps again.
  mock.timers.tick(40000);
  await shopper.open();
  assert.equal(calls.length, 3);
});

test('a short-lived token is renewed no sooner than one second later', async () => {
  const calls = mockFetch(() => bootstrapResponse({ expiresIn: 30 }));
  const shopper = mount();
  await shopper.open();
  mock.timers.tick(999);
  await flush();
  assert.equal(calls.length, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(calls.length, 2);
});

test('a failed bootstrap shows an error instead of the widget, and the next open retries', async () => {
  let fail = true;
  const calls = mockFetch(() => (fail ? jsonResponse({}, { status: 500 }) : bootstrapResponse()));
  const shopper = mount();
  await shopper.open();
  const { panel, iframe, error } = parts();

  assert.equal(panel.hidden, false);
  assert.equal(error.hidden, false);
  assert.equal(error.style.display, 'block');
  assert.notEqual(error.textContent, '');
  assert.equal(iframe.hidden, true);
  assert.equal(iframe.getAttribute('src'), null);

  fail = false;
  await shopper.open();
  assert.equal(calls.length, 2);
  assert.equal(error.hidden, true);
  assert.equal(iframe.hidden, false);
  assert.match(iframe.src, /^https:\/\/widget\.example\//);
});

test('with a container the shopper is embedded: opens right away, has no launcher and cannot be closed by the widget', async () => {
  document.body.innerHTML = '<div id="slot"></div>';
  const calls = mockFetch(() => bootstrapResponse());
  mount({ container: '#slot' });
  await flush();

  const { panel, iframe, launcher } = parts();
  assert.equal(panel.parentNode, document.getElementById('slot'));
  assert.equal(launcher, null);
  assert.equal(calls.length, 1);
  assert.equal(panel.hidden, false);
  assert.equal(panel.style.position, 'relative');

  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.equal(posts[0].message.session.canClose, false);

  fromWidget(iframe, { type: 'gp-shopper:close' });
  assert.equal(panel.hidden, false);
});

test('the container can be given as an element', async () => {
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  mockFetch(() => bootstrapResponse());
  mount({ container: slot });
  await flush();
  assert.equal(parts().panel.parentNode, slot);
});

test('destroy removes the UI and stops reacting to the widget, the launcher and the renewal timer', async () => {
  const calls = mockFetch(() => bootstrapResponse({ expiresIn: 120 }));
  const shopper = mount();
  await shopper.open();
  const { panel, iframe, launcher } = parts();
  const frameWindow = iframe.contentWindow;
  const posts = spyPosts(iframe);

  shopper.destroy();

  assert.equal(document.querySelector('section'), null);
  assert.equal(document.querySelector('button'), null);
  window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'gp-shopper:refresh' }, origin: WIDGET_ORIGIN, source: frameWindow }));
  mock.timers.tick(120000);
  await shopper.open();
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(posts, []);
  assert.equal(panel.hidden, false, 'open() after destroy leaves the detached panel untouched');
  assert.equal(launcher.isConnected, false);
});

test('destroying while the bootstrap is in flight leaves nothing behind', async () => {
  let release;
  mockFetch(() => new Promise((resolve) => { release = () => resolve(bootstrapResponse()); }));
  const shopper = mount();
  const opening = shopper.open();
  const { iframe, error } = parts();
  await flush();

  shopper.destroy();
  release();
  await opening;

  assert.equal(iframe.getAttribute('src'), null);
  assert.equal(error.hidden, true);
});
