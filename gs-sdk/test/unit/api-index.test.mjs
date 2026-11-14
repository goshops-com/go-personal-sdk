import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, setUrl, mockFetch, seedSession, flush, jsonResponse } from './helpers/env.mjs';
import * as api from '../../src/api/index.js';

const CLIENT = 'clientA';
const SHARED_ORIGIN = 'https://sdk.gopersonal.ai';
// Project that resolves the product variant by page URL (src/utils/productLookup.js).
const URL_LOOKUP_PROJECT = '69f9fd15bcb8468256ba4565';
// Luna project that resolves its own skus (excluded in addInteraction).
const LUNA_OWN_SKU_PROJECT = '672154a195567b6f32f56407';
const DAY = 24 * 60 * 60 * 1000;
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const INIT_RESPONSE = { token: 'new-token', project: 'project-9', sessionId: 'session-9' };

let now;
let restoreFind = null;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

/** Path + query of a recorded request (the API base changes with the configured client id). */
const pathOf = (call) => {
  const url = new URL(call.url);
  return url.pathname + url.search;
};
const byPath = (calls, fragment) => calls.filter((call) => pathOf(call).includes(fragment));
const storedSession = () => JSON.parse(localStorage.getItem('gs-v-1'));
const storedQueue = () => JSON.parse(localStorage.getItem('gs_queue'));

/** fetch mock for init: /channel/init answers a new session, everything else `{}`. */
const initFetch = (extra = {}) =>
  mockFetch((url) => (url.includes('/channel/init') ? { ...INIT_RESPONSE, ...extra } : {}));

/** A valid session that init accepts as its own (same client id): no /channel/init call. */
const useStoredSession = (session = {}) => {
  localStorage.setItem('gs-v-1-clientId', CLIENT);
  return seedSession(session);
};
const dropSession = () => localStorage.removeItem('gs-v-1');

/** Stand-in for the shared-session iframe: records what the SDK posts to it. */
const fakeSessionIframe = () => {
  const posts = [];
  const frame = document.createElement('div');
  frame.id = 'gs_sessionTokenIframe';
  frame.contentWindow = { postMessage: (message, origin) => posts.push({ message, origin }) };
  document.body.appendChild(frame);
  return posts;
};
const brokenSessionIframe = () => {
  const frame = document.createElement('div');
  frame.id = 'gs_sessionTokenIframe';
  document.body.appendChild(frame);
};
const sharedSessionReply = (session, origin = SHARED_ORIGIN) => {
  window.dispatchEvent(new window.MessageEvent('message', { origin, data: { action: 'sessionData', session } }));
};

/**
 * The traffic-split rules are a module constant that ships empty, so that flow is unreachable
 * from the outside. This injects one rule by answering the rule lookup (an `Array#find` over
 * the empty list) with it; the real lookup callback still decides whether the rule matches.
 */
const injectTrafficRule = (rule) => {
  const original = Array.prototype.find;
  // eslint-disable-next-line no-extend-native
  Array.prototype.find = function (callback, ...rest) {
    if (this.length === 0 && typeof callback === 'function' && String(callback).includes('trafficSplitRule')) {
      return original.call([rule], callback, ...rest);
    }
    return original.call(this, callback, ...rest);
  };
  restoreFind = () => { Array.prototype.find = original; };
};
const setVarify = (appliedExperiments) => {
  window.varify = { iid: 'iid-1', loaded: true, debug: { appliedExperiments } };
};
const TRAFFIC_RULE = { clientId: CLIENT, varifyIid: 'iid-1', experimentSlug: 'checkout-test', variationIds: [11, 12] };

const setReferrer = (value) => Object.defineProperty(document, 'referrer', { configurable: true, get: () => value });

beforeEach(() => {
  resetDom();
  // resetDom drops every window.gs* global, including the store the module creates on import.
  window.gsStore = { interactionCount: 0 };
  seedSession();
  now = Date.now();
  // init starts a never-cleared setInterval (subscribeQueue): timers are always mocked here.
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  if (restoreFind) {
    restoreFind();
    restoreFind = null;
  }
  delete window.varify;
  delete window.dataLayer;
  delete globalThis.gtag;
  delete document.referrer;
  mock.timers.reset();
  mock.restoreAll();
});

// ---------------------------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------------------------

test('init with a playground token stores it as the session and makes no request', async () => {
  localStorage.setItem('gs_content_seen', '1');
  const calls = mockFetch();

  const result = await api.init(CLIENT, { playgroundToken: 'playground-1' });

  assert.equal(result, CLIENT);
  assert.equal(storedSession().token, 'playground-1');
  assert.equal(storedSession().project, undefined, 'the previous session was dropped');
  assert.equal(localStorage.getItem('gs-v-1-clientId'), CLIENT);
  assert.equal(localStorage.getItem('gs_content_seen'), null);
  assert.equal(calls.length, 0);
});

test('init creates a session when there is none and loads the default page context', async () => {
  dropSession();
  document.cookie = '_ga_ABC123=GS2.1.s1746825440$o1$g0';
  const calls = initFetch();

  const result = await api.init(CLIENT, {});
  await flush();

  assert.equal(result, CLIENT);
  const [initCall] = calls;
  assert.equal(initCall.method, 'POST');
  assert.equal(pathOf(initCall), '/channel/init');
  assert.equal(initCall.body.clientId, CLIENT);
  assert.equal(initCall.body.firstURL, 'https://shop.example/');
  assert.equal(initCall.body.gaId, '1746825440');
  assert.match(initCall.body.gsVUID, new RegExp(`^_gsVUUID_${UUID_V4}_${now}$`));
  assert.equal('externalSessionId' in initCall.body, false);

  assert.equal(localStorage.getItem('gs_vuuid'), initCall.body.gsVUID);
  assert.equal(localStorage.getItem('gs-v-1-clientId'), CLIENT);
  assert.equal(storedSession().token, 'new-token');
  assert.equal(storedSession().project, 'project-9');

  assert.equal(byPath(calls, '/public/cached-content/project-9/?pageType=other').length, 1);
  assert.equal(window.__gsLastContentContext.context, 'other');
});

test('init reuses a valid session of the same client without asking for a new one', async () => {
  const session = useStoredSession();
  const calls = initFetch();

  const result = await api.init(CLIENT, {});
  await flush();

  // Same return value as when the session is created: the client id.
  assert.equal(result, CLIENT);
  assert.equal(storedSession().sessionId, session.sessionId);
  assert.equal(byPath(calls, '/channel/init').length, 0);
  assert.equal(byPath(calls, '/public/cached-content/project-1/?pageType=other').length, 1);
});

test('init replaces a session that is older than 24 hours', async () => {
  useStoredSession({ ts: new Date(now - DAY - 1000).toISOString() });
  const calls = initFetch();

  assert.equal(await api.init(CLIENT, {}), CLIENT);

  assert.equal(byPath(calls, '/channel/init').length, 1);
  assert.equal(storedSession().token, 'new-token');
});

test('init drops the session of another client id', async () => {
  seedSession();
  localStorage.setItem('gs-v-1-clientId', 'otherClient');
  const calls = initFetch();

  assert.equal(await api.init(CLIENT, {}), CLIENT);

  assert.equal(byPath(calls, '/channel/init').length, 1);
  assert.equal(localStorage.getItem('gs-v-1-clientId'), CLIENT);
  assert.equal(storedSession().token, 'new-token');
});

test('init drops the session when the URL carries gsReset', async () => {
  useStoredSession();
  setUrl('https://shop.example/?gsReset=1');
  const calls = initFetch();

  assert.equal(await api.init(CLIENT, {}), CLIENT);

  assert.equal(byPath(calls, '/channel/init').length, 1);
  assert.equal(calls[0].body.firstURL, 'https://shop.example/?gsReset=1');
  assert.equal(storedSession().token, 'new-token');
});

test('init keeps the visitor id that is already stored', async () => {
  dropSession();
  localStorage.setItem('gs_vuuid', 'vuuid-existing');
  const calls = initFetch();
  await api.init(CLIENT, { singlePage: true });
  assert.equal(calls[0].body.gsVUID, 'vuuid-existing');
  assert.equal(calls[0].body.gaId, null);
});

test('init still generates a visitor id when crypto.randomUUID fails', async () => {
  dropSession();
  mock.method(window.crypto, 'randomUUID', () => { throw new Error('insecure context'); });
  const calls = initFetch();
  await api.init(CLIENT, { singlePage: true });
  assert.match(calls[0].body.gsVUID, new RegExp(`^_gsVUUID_${UUID_V4}_${now}$`));
});

test('init can bypass the server cache', async () => {
  dropSession();
  const calls = initFetch();
  await api.init(CLIENT, { byPassCache: true, singlePage: true });
  assert.equal(pathOf(calls[0]), '/channel/init?byPassCache=true');
});

test('init resolves to undefined when the session cannot be created', async () => {
  dropSession();
  const calls = mockFetch(() => jsonResponse({}, { status: 500 }));

  assert.equal(await api.init(CLIENT, {}), undefined);
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(localStorage.getItem('gs-v-1'), null);
});

test('init stores the draft options in gsConfig', async () => {
  useStoredSession();
  mockFetch();
  await api.init(CLIENT, { includeDraft: true, draftContentId: 'content-7', singlePage: true });
  assert.equal(window.gsConfig.includeDraft, true);
  assert.equal(window.gsConfig.draftContentId, 'content-7');

  await api.init(CLIENT, { singlePage: true });
  assert.equal(window.gsConfig.includeDraft, undefined);
  assert.equal(window.gsConfig.draftContentId, null);
});

test('init marks the GA session when the new session is part of a traffic split', async () => {
  dropSession();
  const gtag = mock.fn();
  globalThis.gtag = gtag;
  initFetch({ hasSessionSplitTraffic: true });

  await api.init(CLIENT, { singlePage: true });

  assert.equal(gtag.mock.calls.length, 1);
  assert.deepEqual(gtag.mock.calls[0].arguments, ['event', 'gopersonal_present', { product: 'gopersonal', session_marked: true }]);
});

test('init opens the content selector when the URL asks for it', async () => {
  dropSession();
  setUrl('https://shop.example/?gsElementSelector=1&gsContentKey=content-key-1');
  initFetch();

  await api.init(CLIENT, { singlePage: true });

  assert.equal(window.contentId, 'content-key-1');
  assert.equal(document.head.querySelectorAll('style').length, 1);
  assert.equal(document.body.querySelectorAll('div').length, 2, 'tooltip and notification');
  delete window.contentId;
});

test('init does not open the content selector with only one of the two params', async () => {
  dropSession();
  setUrl('https://shop.example/?gsElementSelector=1');
  initFetch();
  await api.init(CLIENT, { singlePage: true });
  assert.equal(window.contentId, undefined);
  assert.equal(document.body.children.length, 0);
});

test('init with readSharedSession adopts the session shared across domains', async () => {
  dropSession();
  localStorage.setItem('gs-v-1-clientId', CLIENT);
  const posts = fakeSessionIframe();
  const calls = initFetch();
  const ts = new Date(now - 60 * 60 * 1000).toISOString();

  const pending = api.init(CLIENT, { readSharedSession: true, singlePage: true });
  assert.deepEqual(posts, [{ message: { action: 'getSession', clientId: 'client-1' }, origin: SHARED_ORIGIN }]);
  sharedSessionReply({ token: 'ignored' }, 'https://evil.example');
  sharedSessionReply({ token: 'shared-token', project: 'project-s', sessionId: 'session-s', ts, vuuid: 'vuuid-shared' });
  const result = await pending;

  assert.equal(result, CLIENT);
  assert.equal(storedSession().token, 'shared-token');
  assert.equal(storedSession().ts, ts, 'the shared timestamp is kept');
  assert.equal(localStorage.getItem('gs_vuuid'), 'vuuid-shared');
  assert.equal(calls.length, 0);
});

test('init with readSharedSession creates a session when nothing is shared', async () => {
  dropSession();
  fakeSessionIframe();
  const calls = initFetch();

  const pending = api.init(CLIENT, { readSharedSession: true, singlePage: true });
  sharedSessionReply(null);

  assert.equal(await pending, CLIENT);
  assert.equal(byPath(calls, '/channel/init').length, 1);
  assert.equal(storedSession().token, 'new-token');
});

test('init with readSharedSession goes on when the shared session cannot be read', async () => {
  dropSession();
  brokenSessionIframe();
  const calls = initFetch();

  assert.equal(await api.init(CLIENT, { readSharedSession: true, singlePage: true }), CLIENT);

  assert.equal(console.warn.mock.calls.length, 1);
  assert.equal(byPath(calls, '/channel/init').length, 1);
});

test('init with multipleDomains sends the shared session as externalSessionId', async () => {
  dropSession();
  const posts = fakeSessionIframe();
  const calls = initFetch();

  const pending = api.init(CLIENT, { multipleDomains: true, singlePage: true });
  await flush();
  assert.deepEqual(posts, [{ message: { action: 'getSession', clientId: 'client-1' }, origin: SHARED_ORIGIN }]);
  assert.equal(calls.length, 0, 'waits for the shared session');
  sharedSessionReply({ sessionId: 'external-1' });

  assert.equal(await pending, CLIENT);
  assert.deepEqual(calls[0].body.externalSessionId, { sessionId: 'external-1' });
});

test('init with multipleDomains goes on without externalSessionId when it cannot be read', async () => {
  dropSession();
  brokenSessionIframe();
  const calls = initFetch();

  assert.equal(await api.init(CLIENT, { multipleDomains: true, singlePage: true }), CLIENT);

  assert.equal(console.warn.mock.calls.length, 1);
  assert.equal('externalSessionId' in calls[0].body, false);
});

// --- init: page context ---------------------------------------------------------------------

test('init with singlePage does not load any page content', async () => {
  useStoredSession();
  const calls = mockFetch();
  await api.init(CLIENT, { singlePage: true });
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(window.__gsLastContentContext, undefined);
});

test('init with noDefaultContext does not load the default context', async () => {
  useStoredSession();
  const calls = mockFetch();
  await api.init(CLIENT, { noDefaultContext: true });
  await flush();
  assert.equal(calls.length, 0);
});

test('init loads the context given in the options', async () => {
  useStoredSession();
  const calls = mockFetch();
  await api.init(CLIENT, { provider: 'Custom', context: { pageType: 'category', category: 'shoes' } });
  await flush();
  assert.equal(byPath(calls, '/public/cached-content/project-1/?pageType=category').length, 1);
  assert.equal(window.__gsLastContentContext.context, 'category');
});

test('init runs the channelConfig function of the session to find out the page context', async () => {
  // As stored by the admin: a function source with escaped line breaks and tabs.
  useStoredSession({ channelConfig: 'function determinePageType() {\\n\\treturn { pageType: document.body.dataset.page, total: 3 };\\n}' });
  document.body.dataset.page = 'cart';
  const calls = mockFetch();

  await api.init(CLIENT, { context: { pageType: 'ignored' } });
  await flush();

  assert.equal(byPath(calls, '/public/cached-content/project-1/?pageType=cart').length, 1);
  assert.equal(byPath(calls, 'pageType=ignored').length, 0);
});

test('init uses the channelConfig that comes with a new session', async () => {
  dropSession();
  const calls = initFetch({ channelConfig: 'function f() { return { pageType: "landing" }; }' });
  await api.init(CLIENT, {});
  await flush();
  assert.equal(byPath(calls, '/public/cached-content/project-9/?pageType=landing').length, 1);
});

for (const [name, url, pageType] of [
  ['a product page', 'https://shop.example/zapatilla-roja/p?skuId=1', 'product_detail'],
  ['the checkout cart', 'https://shop.example/checkout/#/cart', 'checkout'],
  ['any other page', 'https://shop.example/checkout/#/payment', 'unknown'],
]) {
  test(`init with the VTEX provider detects ${name} from the URL`, async () => {
    useStoredSession({ channelConfig: 'function f() { return { pageType: "from-config" }; }' });
    setUrl(url);
    const calls = mockFetch();

    await api.init(CLIENT, { provider: 'vtex' });
    await flush();

    assert.equal(byPath(calls, `/public/cached-content/project-1/?pageType=${pageType}`).length, 1);
    assert.equal(byPath(calls, 'pageType=from-config').length, 0, 'the provider wins over channelConfig');
    assert.equal(window.__gsLastContentContext.context, pageType);
  });
}

test('init with the Magento_V2 provider fixes double slashes in the search result links', async () => {
  useStoredSession();
  setUrl('https://shop.example/gpsearch/result?q=tv');
  document.body.innerHTML = `
    <a class="product-item-photo" id="photo" href="https://shop.example//tv//samsung.html"></a>
    <a class="product-item-photo" id="photo-no-href"></a>
    <a class="product-item-link" id="link" href="https://shop.example//tv//lg.html"></a>
    <a class="other" id="other" href="https://shop.example//untouched"></a>`;
  const calls = mockFetch();

  await api.init(CLIENT, { provider: 'Magento_V2' });
  await flush();

  assert.equal(document.getElementById('photo').getAttribute('href'), 'https://shop.example/tv/samsung.html');
  assert.equal(document.getElementById('photo-no-href').hasAttribute('href'), false);
  assert.equal(document.getElementById('link').getAttribute('href'), 'https://shop.example/tv/lg.html');
  assert.equal(document.getElementById('other').getAttribute('href'), 'https://shop.example//untouched');
  assert.equal(byPath(calls, '/public/cached-content/project-1/?pageType=other').length, 1);
});

test('init with the Magento_V2 provider leaves links alone outside the search page', async () => {
  useStoredSession();
  document.body.innerHTML = '<a class="product-item-link" id="link" href="https://shop.example//tv//lg.html"></a>';
  mockFetch();
  await api.init(CLIENT, { provider: 'Magento_V2' });
  await flush();
  assert.equal(document.getElementById('link').getAttribute('href'), 'https://shop.example//tv//lg.html');
});

test('init with the Magento provider still loads the default context if the provider module cannot be installed', async () => {
  useStoredSession();
  const calls = mockFetch();
  await api.init(CLIENT, { provider: 'Magento' });
  await flush();
  assert.equal(byPath(calls, '/public/cached-content/project-1/?pageType=other').length, 1);
});

// --- init: API base -------------------------------------------------------------------------

test('init with a region prefix strips it from the client id and uses that region API', async () => {
  dropSession();
  const calls = initFetch();

  assert.equal(await api.init(`BR-${CLIENT}`, { singlePage: true }), CLIENT);

  assert.equal(calls[0].url, 'https://discover.gopersonal.ai/channel/init?');
  assert.equal(calls[0].body.clientId, CLIENT);
  assert.equal(localStorage.getItem('gs-v-1-clientId'), CLIENT);
});

test('init accepts an explicit apiBaseURL and rejects one that is not HTTPS', async () => {
  dropSession();
  const calls = initFetch();

  await api.init(CLIENT, { apiBaseURL: 'https://api.example/ignored/path', singlePage: true });
  assert.equal(calls[0].url, 'https://api.example/channel/init?');

  await assert.rejects(api.init(CLIENT, { apiBaseURL: 'http://api.example', singlePage: true }), /apiBaseURL must use HTTPS/);
});

// --- init: traffic split (rule injected, see injectTrafficRule) ------------------------------

test('traffic split: a visitor in a variation that is not allowed gets no session', async () => {
  injectTrafficRule(TRAFFIC_RULE);
  setVarify({ e1: { experimentSlug: 'another-test', variationId: 11 }, e2: { experimentSlug: 'checkout-test', variationId: 99 } });
  useStoredSession();
  const calls = mockFetch();

  assert.equal(await api.init(CLIENT, {}), undefined);
  await flush();

  assert.equal(localStorage.getItem('gs-v-1'), null);
  assert.equal(calls.length, 0);
});

test('traffic split: a visitor in an allowed variation gets the SDK as usual', async () => {
  injectTrafficRule(TRAFFIC_RULE);
  setVarify({ e1: { experimentSlug: 'checkout-test', variationId: 12 } });
  useStoredSession();
  mockFetch();

  const result = await api.init(CLIENT, { singlePage: true });

  assert.equal(result, CLIENT);
  assert.equal(window.varify.iid, 'iid-1');
});

test('traffic split: the rule of another client does not apply', async () => {
  injectTrafficRule({ ...TRAFFIC_RULE, clientId: 'someoneElse' });
  setVarify({ e1: { experimentSlug: 'checkout-test', variationId: 99 } });
  useStoredSession();
  mockFetch();

  const result = await api.init(CLIENT, { singlePage: true });
  assert.equal(result, CLIENT);
});

test('traffic split: waits 500 ms for the experiment to be applied before deciding', async () => {
  injectTrafficRule(TRAFFIC_RULE);
  setVarify({});
  useStoredSession();
  const calls = mockFetch();

  let settled = false;
  const pending = api.init(CLIENT, {}).then((value) => { settled = true; return value; });
  await flush();
  assert.equal(settled, false);
  assert.notEqual(localStorage.getItem('gs-v-1'), null);

  window.varify.debug.appliedExperiments.late = { experimentSlug: 'checkout-test', variationId: 99 };
  mock.timers.tick(500);

  assert.equal(await pending, undefined);
  assert.equal(localStorage.getItem('gs-v-1'), null);
  assert.equal(calls.length, 0);
});

test('traffic split: without an applied experiment after the wait the SDK works as usual', async () => {
  injectTrafficRule(TRAFFIC_RULE);
  setVarify({});
  useStoredSession();
  mockFetch();

  const pending = api.init(CLIENT, { singlePage: true });
  await flush();
  mock.timers.tick(500);

  assert.equal(await pending, CLIENT);
});

// ---------------------------------------------------------------------------------------------
// session / customer
// ---------------------------------------------------------------------------------------------

test('clearSharedSession asks the shared-session iframe to clear the token', () => {
  api.clearSharedSession(CLIENT); // no iframe yet: nothing to do
  const posts = fakeSessionIframe();
  api.clearSharedSession(CLIENT);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].message.action, 'clearToken');
  assert.equal(posts[0].origin, SHARED_ORIGIN);
});

test('login stores the customer in the session and posts it with the provider', async () => {
  window.gsConfig.options.provider = 'VTEX';
  const calls = mockFetch(() => ({ ok: true }));

  assert.deepEqual(await api.login('customer-1', { email: 'ana@example.com', name: 'Ana' }), { ok: true });

  assert.equal(storedSession().customer_id, 'customer-1');
  assert.equal(storedSession().customer_email, 'ana@example.com');
  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/channel/login');
  assert.deepEqual(calls[0].body, { email: 'ana@example.com', name: 'Ana', customerId: 'customer-1', provider: 'vtex' });
});

test('login works without extra data and without a configured provider', async () => {
  const calls = mockFetch();
  await api.login('customer-2');
  assert.equal(storedSession().customer_id, 'customer-2');
  assert.equal('customer_email' in storedSession(), false);
  assert.deepEqual(calls[0].body, { customerId: 'customer-2' });
});

test('logout does nothing when no customer is logged in', () => {
  const calls = mockFetch();
  window.gsResetSession = mock.fn();
  assert.equal(api.logout(CLIENT), undefined);
  assert.equal(calls.length, 0);
  assert.equal(window.gsResetSession.mock.calls.length, 0);
  assert.notEqual(localStorage.getItem('gs-v-1'), null);
});

test('logout clears the session, asks for a new one and notifies the API', async () => {
  seedSession({ customer_id: 'customer-1' });
  window.gsResetSession = mock.fn();
  const calls = mockFetch(() => ({ ok: true }));

  assert.deepEqual(await api.logout(CLIENT), { ok: true });

  // The request still carries the token of the session being closed.
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');

  assert.equal(localStorage.getItem('gs-v-1'), null);
  assert.equal(window.gsResetSession.mock.calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/channel/logout');
  assert.deepEqual(calls[0].body, { clientId: CLIENT });
});

test('getCustomerSession and getCurrentSession return the stored session with the visitor id', () => {
  localStorage.setItem('gs_vuuid', 'vuuid-1');
  for (const session of [api.getCustomerSession(), api.getCurrentSession()]) {
    assert.equal(session.token, 'token-1');
    assert.equal(session.project, 'project-1');
    assert.equal(session.vuuid, 'vuuid-1');
  }
  dropSession();
  assert.deepEqual(api.getCustomerSession(), {});
  assert.deepEqual(api.getCurrentSession(), {});
});

test('setEmailSubscription only accepts a boolean', async () => {
  const calls = mockFetch(() => ({ ok: true }));
  await assert.rejects(api.setEmailSubscription('yes'), TypeError);
  await assert.rejects(api.setEmailSubscription(), /must be a boolean/);
  assert.equal(calls.length, 0);

  assert.deepEqual(await api.setEmailSubscription(false), { ok: true });
  assert.equal(pathOf(calls[0]), '/channel/email-subscription');
  assert.deepEqual(calls[0].body, { optIn: false });
});

// Endpoints that just forward their arguments.
for (const [name, call, method, path, body] of [
  ['setCustomerCookies', () => api.setCustomerCookies('accepted'), 'PUT', '/channel/cookies-status', { status: 'accepted' }],
  ['updateCustomerData', () => api.updateCustomerData({ name: 'Ana' }), 'PUT', '/channel/update-customer', { name: 'Ana' }],
  ['loginEmail', () => api.loginEmail('ana@example.com'), 'POST', '/channel/login', { email: 'ana@example.com' }],
  ['findState', () => api.findState(), 'GET', '/channel/state'],
  ['getState', () => api.getState(), 'GET', '/channel/state'],
  ['findLastInteractions (default limit)', () => api.findLastInteractions(), 'GET', '/channel/last-interactions?limit=10'],
  ['findLastInteractions', () => api.findLastInteractions(3), 'GET', '/channel/last-interactions?limit=3'],
  ['updateState', () => api.updateState({ step: 2 }), 'PUT', '/channel/state', { step: 2 }],
  ['addFeedback', () => api.addFeedback({ score: 5 }), 'POST', '/feedback', { score: 5 }],
  ['triggerJourney', () => api.triggerJourney({ journey: 'j1' }), 'POST', '/journey/trigger', { journey: 'j1' }],
  ['searchChat', () => api.searchChat({ input: 'hola' }), 'POST', '/item/search-chat', { input: 'hola' }],
  ['isSearch', () => api.isSearch({ input: 'hola' }), 'POST', '/item/search-chat-is-search', { input: 'hola' }],
  ['searchAutoFilter', () => api.searchAutoFilter([{ f: 1 }], 'red shoes'), 'POST', '/item/search-filter-builder', { filters: [{ f: 1 }], input: 'red shoes' }],
  ['searchFilterFacelets', () => api.searchFilterFacelets(), 'GET', '/item/search-filter-facelets'],
  ['searchFilterFacelets (query)', () => api.searchFilterFacelets('tv & audio'), 'GET', '/item/search-filter-facelets?query=tv%20%26%20audio'],
  ['searchAnswer', () => api.searchAnswer('tv', { lang: 'es' }), 'POST', '/item/search-answer', { input: 'tv', lang: 'es' }],
  ['searchRedirect', () => api.searchRedirect('tv', {}), 'GET', '/item/search-redirect?query=tv'],
  ['searchRedirect (result id)', () => api.searchRedirect('tv', { searchResultId: 'r1' }), 'GET', '/item/search-redirect?query=tv&searchResultId=r1'],
  ['searchBulk', () => api.searchBulk({ queries: ['a'] }), 'POST', '/item/bulk-search', { queries: ['a'] }],
  ['searchResult', () => api.searchResult({ query: 'a' }), 'POST', '/item/search-result', { query: 'a' }],
  ['updateSearchResult', () => api.updateSearchResult('r1', { clicked: true }), 'PATCH', '/item/search-interaction', { clicked: true, id: 'r1' }],
  ['getItemById', () => api.getItemById('sku-1'), 'GET', '/item/sku-1'],
  ['getCount', () => api.getCount({}), 'GET', '/item/count'],
  ['getCount (where)', () => api.getCount({ where: { brand: 'ACME' } }), 'GET', `/item/count?where=${encodeURIComponent('{"brand":"ACME"}')}`],
  ['getRanking', () => api.getRanking('top'), 'GET', '/item/ranking/top/'],
  ['getRanking (params)', () => api.getRanking('top', { limit: 5, brand: 'A B' }), 'GET', '/item/ranking/top/?limit=5&brand=A%20B'],
  ['reRank', () => api.reRank('r1', { affinityField: 'brand', items: ['1', '2'] }), 'POST', '/item/rerank/r1/?affinityField=brand', { items: ['1', '2'] }],
  ['getFieldValues (default field)', () => api.getFieldValues({}), 'GET', '/item/custom-attributes/category'],
  ['getFieldValues', () => api.getFieldValues({ field: 'brand' }), 'GET', '/item/custom-attributes/brand'],
  ['setPreferences', () => api.setPreferences({ size: 'M' }), 'PUT', '/channel/preferences', { size: 'M' }],
  ['getAffinity', () => api.getAffinity(), 'GET', '/channel/whoiam/affinity'],
  ['getAffinityCustomer', () => api.getAffinityCustomer(), 'GET', '/channel/whoiam?includeCustomer=true'],
  ['getLoyalty', () => api.getLoyalty(), 'GET', '/personal/loyalty'],
  ['getSearchHistory', () => api.getSearchHistory(), 'GET', '/channel/search-history?limit=10'],
]) {
  test(`${name} sends ${method} ${path} with the session token and returns the response`, async () => {
    const response = { answer: name };
    const calls = mockFetch(() => response);

    assert.deepEqual(await call(), response);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, method);
    assert.equal(pathOf(calls[0]), path);
    assert.equal(calls[0].headers.Authorization, 'Bearer token-1');
    if (body) {
      assert.deepEqual(calls[0].body, body);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// interactions
// ---------------------------------------------------------------------------------------------

test('addInteraction posts the interaction, remembers it and queues the interaction task', async () => {
  localStorage.setItem('gs_content_post_cache', '{"some":"entry"}');
  const calls = mockFetch(() => ({ ok: true }));

  assert.deepEqual(await api.addInteraction({ event: 'like', item: 123, quantity: 2 }), { ok: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/interaction');
  assert.deepEqual(calls[0].body, { event: 'like', item: 123, quantity: 2 });
  assert.equal(window.gsStore.interactionCount, 1);
  assert.deepEqual(api.getLastInteraction(), {
    event: 'like', item: '123', preProcess: undefined, fieldValue: undefined, quantity: 2, at: now,
  });
  assert.deepEqual(storedQueue(), [{ expirationDate: now + DAY, type: 'interaction-like' }]);
  assert.equal(localStorage.getItem('gs_content_post_cache'), null, 'cached recommendations are invalidated');
});

test('getLastInteraction is null until an interaction is sent', () => {
  assert.equal(api.getLastInteraction(), null);
});

test('addInteraction rejects when the API fails, and still remembers the interaction', async () => {
  mockFetch(() => jsonResponse({}, { status: 500 }));
  await assert.rejects(api.addInteraction({ event: 'like', item: '1' }), /POST request failed: 500/);
  await flush();
  assert.equal(api.getLastInteraction().event, 'like');
});

test('addInteraction adds the configured provider unless the payload has its own', async () => {
  window.gsConfig.options.provider = 'VTEX';
  const calls = mockFetch();
  await api.addInteraction({ event: 'like', item: '1' });
  await api.addInteraction({ event: 'like', item: '1', provider: 'custom-pixel' });
  assert.equal(calls[0].body.provider, 'vtex');
  assert.equal(calls[1].body.provider, 'custom-pixel');
});

test('a cart interaction announces the updated cart once the server has processed it', async () => {
  let cart = { updatedAt: 't1' };
  const calls = mockFetch((url) => (url.includes('/channel/state') ? { cart } : {}));
  const carts = [];
  const listener = (event) => carts.push(event.detail);
  window.addEventListener('gopersonal:cart-updated', listener);
  try {
    await api.addInteraction({ event: 'cart', item: 'sku-1', quantity: 1 });
    await flush();
    assert.equal(byPath(calls, '/channel/state').length, 1, 'cart read right after the interaction');

    cart = { updatedAt: 't2', amountOfProducts: 1 };
    mock.timers.tick(700);
    await flush();

    assert.deepEqual(carts, [{ updatedAt: 't2', amountOfProducts: 1 }]);
  } finally {
    window.removeEventListener('gopersonal:cart-updated', listener);
  }
});

test('a view that comes from a recommendation click carries the impression id and reports the click to GA4', async () => {
  setUrl('https://shop.example/p/1?gsImpressionId=imp-1&gsListName=Home%20Row&gsIndex=3');
  window.dataLayer = [];
  const calls = mockFetch((url) => (url.endsWith('/item/sku-1') ? { id: 'sku-1', name: 'Shoe', price: 10 } : {}));

  await api.addInteraction({ event: 'view', item: 'sku-1' });
  await flush();

  assert.deepEqual(byPath(calls, '/interaction')[0].body, { event: 'view', item: 'sku-1', impressionId: 'imp-1' });
  assert.equal(byPath(calls, '/item/sku-1').length, 1);
  assert.equal(window.dataLayer.length, 1);
  assert.equal(window.dataLayer[0].event, 'select_item');
  assert.equal(window.dataLayer[0].ecommerce.item_list_name, 'Gopersonal - Home Row');
  const [gaItem] = window.dataLayer[0].ecommerce.items;
  assert.equal(gaItem.item_id, 'sku-1');
  assert.equal(gaItem.item_name, 'Shoe');
  assert.equal(gaItem.index, 4);
});

test('a recommendation-click view identified by a field looks the product up by that field for GA4', async () => {
  setUrl('https://shop.example/p/1?gsImpressionId=imp-2');
  window.dataLayer = [];
  const calls = mockFetch((url) => (url.includes('/public/items/') ? { resultData: [{ id: 'item-9', name: 'Lamp' }] } : {}));

  await api.addInteraction({
    event: 'view',
    preProcess: ['findItemByField:sku', 'somethingElse:sku', 'findItemByField'],
    fieldValue: 'SKU-9',
  });
  await flush();

  const lookups = byPath(calls, '/public/items/');
  assert.equal(lookups.length, 1);
  const query = new URL(lookups[0].url).searchParams;
  assert.equal(query.get('limit'), '1');
  assert.deepEqual(JSON.parse(query.get('where')), { sku: 'SKU-9' });
  assert.equal(byPath(calls, '/interaction')[0].body.impressionId, 'imp-2');
  assert.equal(window.dataLayer.length, 1);
  assert.equal(window.dataLayer[0].ecommerce.item_list_name, 'Gopersonal - gopersonal_list');
  assert.equal(window.dataLayer[0].ecommerce.items[0].item_id, 'item-9');
  assert.equal(window.dataLayer[0].ecommerce.items[0].index, 1);
});

test('a recommendation-click view does not report to GA4 again when the click was already sent', async () => {
  setUrl('https://shop.example/p/1?gsImpressionId=imp-3&gsGa4ClickSent=true');
  window.dataLayer = [];
  const calls = mockFetch();

  await api.addInteraction({ event: 'view', item: 'sku-1' });
  await api.addInteraction({ event: 'view', preProcess: ['findItemByField:sku'], fieldValue: 'SKU-9' });
  await flush();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.impressionId, 'imp-3');
  assert.deepEqual(window.dataLayer, []);
});

test('a recommendation-click view without an item sends the interaction and nothing to GA4', async () => {
  setUrl('https://shop.example/p/1?gsImpressionId=imp-4');
  window.dataLayer = [];
  const calls = mockFetch();
  await api.addInteraction({ event: 'view' });
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(window.dataLayer, []);
});

test('other events ignore the impression id of the URL', async () => {
  setUrl('https://shop.example/p/1?gsImpressionId=imp-5');
  window.dataLayer = [];
  const calls = mockFetch();
  await api.addInteraction({ event: 'like', item: 'sku-1' });
  await flush();
  assert.deepEqual(calls[0].body, { event: 'like', item: 'sku-1' });
  assert.deepEqual(window.dataLayer, []);
});

test('a view that comes from the search results reports the click to GA4', async () => {
  setReferrer('https://shop.example/search?q=tv&_gsSearchId=search-1');
  window.dataLayer = [];
  const calls = mockFetch((url) => (url.endsWith('/item/sku-2') ? { id: 'sku-2', name: 'TV' } : {}));

  await api.addInteraction({ event: 'view', item: 'sku-2' });
  await api.addInteraction({ event: 'view' });
  await flush();

  assert.equal(byPath(calls, '/item/sku-2').length, 1);
  assert.equal(window.dataLayer.length, 1);
  assert.equal(window.dataLayer[0].event, 'select_item');
  assert.match(window.dataLayer[0].ecommerce.item_list_name, /Search Results$/);
  assert.equal(window.dataLayer[0].ecommerce.items[0].item_id, 'sku-2');
  assert.equal('impressionId' in byPath(calls, '/interaction')[0].body, false);
});

test('projects that resolve variants by URL send the page URL with the view of the page product', async () => {
  seedSession({ project: URL_LOOKUP_PROJECT });
  setUrl('https://shop.example/sabana-roja.html?utm=1#reviews');
  window.gsConfig.options.context = { pageType: 'product_detail', product_id: 55 };
  const calls = mockFetch();

  await api.addInteraction({ event: 'view', item: '55' });
  await api.addInteraction({ event: 'view', item: '56' });
  await api.addInteraction({ event: 'cart', item: '55' });
  await api.addInteraction({ event: 'view', item: '55', preProcess: ['findItemByField:sku'], fieldValue: 'S' });

  const [pageProduct, otherProduct, otherEvent, ownPreProcess] = byPath(calls, '/interaction');
  assert.deepEqual(pageProduct.body, {
    event: 'view', item: '55', preProcess: ['findItemByField:url'], fieldValue: 'https://shop.example/sabana-roja.html',
  });
  assert.deepEqual(otherProduct.body, { event: 'view', item: '56' });
  assert.deepEqual(otherEvent.body, { event: 'cart', item: '55' });
  assert.deepEqual(ownPreProcess.body, { event: 'view', item: '55', preProcess: ['findItemByField:sku'], fieldValue: 'S' });
});

test('the Luna provider sends the item as a sku to resolve, except for the project that resolves its own', async () => {
  window.gsConfig.options.provider = 'Luna';
  const calls = mockFetch();

  await api.addInteraction({ event: 'like', item: 'SKU-1', quantity: 2 });
  assert.deepEqual(calls[0].body, {
    event: 'like', quantity: 2, preProcess: ['findItemByField:sku_list'], fieldValue: 'SKU-1', provider: 'luna',
  });
  assert.equal(api.getLastInteraction().fieldValue, 'SKU-1');

  await api.addInteraction({ event: 'search' });
  assert.deepEqual(calls[1].body, { event: 'search', provider: 'luna' });

  seedSession({ project: LUNA_OWN_SKU_PROJECT });
  await api.addInteraction({ event: 'like', item: 'SKU-1' });
  assert.deepEqual(calls[2].body, { event: 'like', item: 'SKU-1', provider: 'luna' });
});

test('addInteractionState posts the state and queues a purchase task for the cart state', async () => {
  window.gsConfig.options.provider = 'VTEX';
  localStorage.setItem('gs_content_post_cache', '{"some":"entry"}');
  const calls = mockFetch(() => ({ ok: true }));

  assert.deepEqual(await api.addInteractionState('cart', { items: ['1'] }), { ok: true });

  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/interaction/state/cart');
  assert.deepEqual(calls[0].body, { items: ['1'], provider: 'vtex' });
  assert.deepEqual(storedQueue(), [{ expirationDate: now + DAY, type: 'interaction-purchase' }]);
  assert.equal(window.gsStore.interactionCount, 1);
  assert.equal(localStorage.getItem('gs_content_post_cache'), null);
});

test('addInteractionState with another state queues a task without event', async () => {
  const calls = mockFetch();
  await api.addInteractionState('wishlist');
  assert.equal(pathOf(calls[0]), '/interaction/state/wishlist');
  assert.deepEqual(calls[0].body, {});
  assert.deepEqual(storedQueue(), [{ expirationDate: now + DAY, type: 'interaction-' }]);
});

test('addBulkInteractions does nothing with an empty list', () => {
  const calls = mockFetch();
  assert.equal(api.addBulkInteractions([]), undefined);
  assert.equal(calls.length, 0);
  assert.equal(localStorage.getItem('gs_queue'), null);
});

test('addBulkInteractions posts every event in one transaction and remembers the last one', async () => {
  window.gsConfig.options.provider = 'VTEX';
  const calls = mockFetch((url) => (url.includes('/channel/state') ? { cart: { updatedAt: 'bulk' } } : { ok: true }));

  const result = await api.addBulkInteractions([
    { event: 'view', item: '1' },
    { event: 'like', item: 2, provider: 'own' },
  ]);

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/interaction/bulk');
  assert.match(calls[0].body.transactionId, new RegExp(`^${now}[0-9a-f]{32}$`));
  assert.deepEqual(calls[0].body.events, [
    { event: 'view', item: '1', provider: 'vtex' },
    { event: 'like', item: 2, provider: 'own' },
  ]);
  assert.equal(api.getLastInteraction().event, 'like');
  assert.equal(api.getLastInteraction().item, '2');
  assert.deepEqual(storedQueue(), [{ expirationDate: now + DAY, type: 'interaction-view' }]);
});

test('addBulkInteractions uses a different transaction id each time', async () => {
  const calls = mockFetch();
  await api.addBulkInteractions([{ event: 'view', item: '1' }]);
  await api.addBulkInteractions([{ event: 'view', item: '1' }]);
  assert.notEqual(calls[0].body.transactionId, calls[1].body.transactionId);
});

test('addBulkInteractions keeps the previous last interaction when the last entry has no event', async () => {
  mockFetch();
  await api.addInteraction({ event: 'like', item: 'kept' });
  await api.addBulkInteractions([{ event: 'view', item: '1' }, { item: '2' }]);
  assert.equal(api.getLastInteraction().item, 'kept');
});

test('addBulkInteractions with cart events announces the updated cart', async () => {
  let cart = { updatedAt: 'b1' };
  mockFetch((url) => (url.includes('/channel/state') ? { cart } : {}));
  const carts = [];
  const listener = (event) => carts.push(event.detail);
  window.addEventListener('gopersonal:cart-updated', listener);
  try {
    await api.addBulkInteractions([{ event: 'view', item: '1' }, { event: 'cart', item: '1' }]);
    await flush();
    cart = { updatedAt: 'b2' };
    mock.timers.tick(700);
    await flush();
    assert.deepEqual(carts, [{ updatedAt: 'b2' }]);
  } finally {
    window.removeEventListener('gopersonal:cart-updated', listener);
  }
});

test('addBulkInteractions rejects when the API fails', async () => {
  mockFetch(() => jsonResponse({}, { status: 502 }));
  await assert.rejects(api.addBulkInteractions([{ event: 'view', item: '1' }]), /POST request failed: 502/);
  await flush();
});

test('reorderCategories sorts the categories by how often they appear in the interactions', () => {
  const interactions = [
    { data: { itemData: { category_ids: '10, 20' } } },
    { data: { itemData: { category_ids: '20,,30 ' } } },
    { data: { itemData: { category_ids: '20' } } },
    { data: { itemData: { category_ids: ['10'] } } },
    { data: { itemData: {} } },
    { data: {} },
    {},
  ];
  const categories = [{ id: 10, name: 'A' }, { id: 99, name: 'B' }, { id: '20', name: 'C' }, { id: 30, name: 'D' }];

  const result = api.reorderCategories(interactions, categories);

  assert.deepEqual(result, [
    { id: '20', name: 'C', interactionCount: 3 },
    { id: 10, name: 'A', interactionCount: 1 },
    { id: 30, name: 'D', interactionCount: 1 },
    { id: 99, name: 'B', interactionCount: 0 },
  ]);
  assert.equal('interactionCount' in categories[0], false, 'the input is not modified');
  assert.deepEqual(api.reorderCategories([], categories).map((c) => c.id), [10, 99, '20', 30]);
});

// ---------------------------------------------------------------------------------------------
// item feedback
// ---------------------------------------------------------------------------------------------

test('addItemFeedback needs a rate and something that identifies the item', async () => {
  const calls = mockFetch(() => ({ ok: true }));
  assert.equal(api.addItemFeedback(), undefined);
  assert.equal(api.addItemFeedback({ rate: 5 }), undefined);
  assert.equal(api.addItemFeedback({ item: '1' }), undefined);
  assert.equal(calls.length, 0);

  assert.deepEqual(await api.addItemFeedback({ item: '1', rate: 0 }), { ok: true });
  await api.addItemFeedback({ sku: 'S', rate: 4 });
  await api.addItemFeedback({ fieldValue: 'F', rate: 3, comment: 'ok' });

  assert.equal(calls.length, 3);
  assert.equal(pathOf(calls[0]), '/feedback/items');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { item: '1', rate: 0 });
  assert.deepEqual(calls[2].body, { fieldValue: 'F', rate: 3, comment: 'ok' });
});

test('getItemFeedbackSummary asks for the summary of an item', async () => {
  const calls = mockFetch(() => ({ average: 4.5 }));
  assert.equal(api.getItemFeedbackSummary(), undefined);
  assert.equal(api.getItemFeedbackSummary(null), undefined);
  assert.equal(calls.length, 0);

  assert.deepEqual(await api.getItemFeedbackSummary('sku 1/2'), { average: 4.5 });
  assert.equal(pathOf(calls[0]), '/feedback/items/summary?item=sku%201%2F2');
});

test('getItemFeedbackComments pages the comments with sane limits', async () => {
  const calls = mockFetch(() => ({ comments: [] }));
  assert.equal(api.getItemFeedbackComments(), undefined);
  assert.equal(calls.length, 0);

  assert.deepEqual(await api.getItemFeedbackComments('sku 1'), { comments: [] });
  await api.getItemFeedbackComments('a', { limit: '25', skip: '50' });
  await api.getItemFeedbackComments('a', { limit: 1000, skip: -5 });
  await api.getItemFeedbackComments('a', { limit: 0, skip: 'x' });
  await api.getItemFeedbackComments('a', { limit: 'x' });

  assert.deepEqual(calls.map(pathOf), [
    '/feedback/items/comments?item=sku%201&limit=10&skip=0',
    '/feedback/items/comments?item=a&limit=25&skip=50',
    '/feedback/items/comments?item=a&limit=100&skip=0',
    '/feedback/items/comments?item=a&limit=10&skip=0',
    '/feedback/items/comments?item=a&limit=10&skip=0',
  ]);
});

// ---------------------------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------------------------

test('getItems lists items through the public cached route, without a token', async () => {
  seedSession();
  const calls = mockFetch(() => ({ resultData: [{ id: '1' }] }));
  assert.deepEqual(await api.getItems({}), { resultData: [{ id: '1' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(pathOf(calls[0]), '/public/items/project-1?limit=20&offset=0');
  assert.deepEqual(calls[0].headers, {}, 'no Authorization header: the edge can cache it and there is no preflight');
});

test('getItems sends paging, filter and sort', async () => {
  seedSession();
  const calls = mockFetch();
  await api.getItems({ limit: 5, offset: 10, where: { brand: 'A&B' }, sortBy: { price: -1 } });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/public/items/project-1');
  assert.equal(url.searchParams.get('limit'), '5');
  assert.equal(url.searchParams.get('offset'), '10');
  assert.deepEqual(JSON.parse(url.searchParams.get('where')), { brand: 'A&B' });
  assert.deepEqual(JSON.parse(url.searchParams.get('sortBy')), { price: -1 });
});

test('getItems falls back to the authenticated route when the public one fails', async () => {
  seedSession();
  const calls = mockFetch((url) => (url.includes('/public/items/') ? jsonResponse({ error: 'x' }, { status: 500 }) : { resultData: [{ id: '2' }] }));
  assert.deepEqual(await api.getItems({ limit: 500, offset: 500, where: { active: 1 } }), { resultData: [{ id: '2' }] });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/public/items/project-1', '/item']);
  assert.equal(new URL(calls[1].url).search, new URL(calls[0].url).search, 'same query on both routes');
  assert.equal(calls[1].headers.Authorization, 'Bearer token-1');
});

test('getItems keeps the authenticated route for what the public one does not cover', async () => {
  const pathsFor = async (params) => {
    const calls = mockFetch();
    await api.getItems(params);
    return calls.map((call) => new URL(call.url).pathname);
  };

  seedSession();
  assert.deepEqual(await pathsFor({ limit: 5001 }), ['/item'], 'the public route caps the page at 5000');
  assert.deepEqual(await pathsFor({ limit: -1 }), ['/item']);
  assert.deepEqual(await pathsFor({ limit: 10, offset: -5 }), ['/item']);
  assert.deepEqual(await pathsFor({ limit: 'abc' }), ['/item']);
  assert.deepEqual(await pathsFor({ limit: 5000 }), ['/public/items/project-1']);

  seedSession({ project: undefined });
  assert.deepEqual(await pathsFor({}), ['/item'], 'no project in the session');
});

test('getItemsByIds returns nothing, without a request, when there are no usable ids', async () => {
  const calls = mockFetch();
  assert.deepEqual(await api.getItemsByIds(), []);
  assert.deepEqual(await api.getItemsByIds([]), []);
  assert.deepEqual(await api.getItemsByIds([null, undefined, '']), []);
  assert.equal(calls.length, 0);
});

test('getItemsByIds asks for unique ids as strings and returns the products', async () => {
  const calls = mockFetch(() => ({ resultData: [{ id: '1' }, { id: '2' }] }));

  assert.deepEqual(await api.getItemsByIds([1, '1', 2, null, '', 0]), [{ id: '1' }, { id: '2' }]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/item/by-ids');
  assert.deepEqual(calls[0].body, { ids: ['1', '2', '0'], field: 'id' });
});

test('getItemsByIds can look up by parent_id; any other field falls back to id', async () => {
  const calls = mockFetch(() => ({ resultData: [] }));
  await api.getItemsByIds(['p1'], { field: 'parent_id' });
  await api.getItemsByIds(['p1'], { field: 'sku' });
  assert.equal(calls[0].body.field, 'parent_id');
  assert.equal(calls[1].body.field, 'id');
});

test('getItemsByIds splits long lists in batches of 250 and joins the pages in order', async () => {
  const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
  const calls = mockFetch((url, init, call) => {
    if (call.body.ids.length === 1) return { resultData: 'not-a-list' };
    return { resultData: [{ id: call.body.ids[0] }] };
  });

  const items = await api.getItemsByIds(ids);

  assert.deepEqual(calls.map((call) => call.body.ids.length), [250, 250, 1]);
  assert.equal(calls[1].body.ids[0], 'id-250');
  assert.deepEqual(items, [{ id: 'id-0' }, { id: 'id-250' }], 'pages without a result list are skipped');
});

test('downloadSearchAutocompleteIndex fetches the public index of the project without credentials', async () => {
  const calls = mockFetch(() => ({ index: [1, 2] }));
  assert.deepEqual(await api.downloadSearchAutocompleteIndex(), { index: [1, 2] });
  assert.equal(calls[0].method, 'GET');
  assert.equal(pathOf(calls[0]), '/public/search-autocomplete/project-1');
  assert.deepEqual(calls[0].headers, {});
});

test('getTopSearches fetches the public top searches with a limit between 1 and 100', async () => {
  const calls = mockFetch(() => ({ searches: ['tv'] }));

  assert.deepEqual(await api.getTopSearches(), { searches: ['tv'] });
  await api.getTopSearches({ limit: '5' });
  await api.getTopSearches({ limit: 500 });
  await api.getTopSearches({ limit: 0 });
  await api.getTopSearches({ limit: 2.5 });

  assert.deepEqual(calls.map(pathOf), [10, 5, 100, 10, 10].map((limit) => `/public/top-searches/project-1?limit=${limit}`));
  assert.deepEqual(calls[0].headers, {});
});

test('getSearchHistory keeps the limit between 1 and 100', async () => {
  const calls = mockFetch();
  await api.getSearchHistory({ limit: '7' });
  await api.getSearchHistory({ limit: 101 });
  await api.getSearchHistory({ limit: -1 });
  await api.getSearchHistory({ limit: 'abc' });
  assert.deepEqual(calls.map(pathOf), [7, 100, 10, 10].map((limit) => `/channel/search-history?limit=${limit}`));
});

// ---------------------------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------------------------

test('searchAutocomplete asks for the autocomplete of a query', async () => {
  const calls = mockFetch(() => ({ suggestions: [] }));
  assert.deepEqual(await api.searchAutocomplete('tele & audio'), { suggestions: [] });
  assert.equal(calls[0].method, 'GET');
  assert.equal(pathOf(calls[0]), '/item/search-filter-facelets?mode=autocomplete&limit=8&query=tele%20%26%20audio');
});

test('searchAutocomplete sends the limit (1 to 20) and the optional overrides', async () => {
  const calls = mockFetch();
  await api.searchAutocomplete('tv', { limit: 5, suggestionsOnly: true, relatedCategories: '3', minRelatedScore: 0.5 });
  await api.searchAutocomplete('tv', { limit: 50 });
  await api.searchAutocomplete('tv', { limit: 'x' });
  await api.searchAutocomplete(undefined, { limit: 0 });
  assert.deepEqual(calls.map(pathOf), [
    '/item/search-filter-facelets?mode=autocomplete&limit=5&suggestionsOnly=1&relatedCategories=3&minRelatedScore=0.5&query=tv',
    '/item/search-filter-facelets?mode=autocomplete&limit=20&query=tv',
    '/item/search-filter-facelets?mode=autocomplete&limit=8&query=tv',
    '/item/search-filter-facelets?mode=autocomplete&limit=8&query=',
  ]);
});

test('search sends the query alone by default', async () => {
  const calls = mockFetch(() => ({ items: [{ id: '1' }] }));
  assert.deepEqual(await api.search('tv', {}), { items: [{ id: '1' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(pathOf(calls[0]), '/item/search?query=tv');
});

test('search and searchRedirect encode the text so it cannot break the URL', async () => {
  const calls = mockFetch();
  await api.search('tv & audio #1 c++', {});
  await api.search('50% off', {});
  await api.searchRedirect('a&b', { searchResultId: 'r1' });
  await api.search(undefined, {});
  assert.equal(pathOf(calls[0]), '/item/search?query=tv%20%26%20audio%20%231%20c%2B%2B');
  assert.equal(pathOf(calls[1]), '/item/search?query=50%25%20off');
  assert.equal(pathOf(calls[2]), '/item/search-redirect?query=a%26b&searchResultId=r1');
  assert.equal(pathOf(calls[3]), '/item/search?query=');
});

test('a query that already comes encoded is sent as it is', async () => {
  const calls = mockFetch();
  await api.search('tv%20%26%20audio', {});
  assert.equal(pathOf(calls[0]), '/item/search?query=tv%20%26%20audio');
});

test('search sends every option it is given', async () => {
  window.gsSearchOptions = { hasRetrievalQA: true };
  const calls = mockFetch();

  await api.search('tv', {
    insta: true, limit: 12, includeAllItemFields: true, ignoreMetrics: true, type: 'semantic', filter: { brand: 'A&B' },
  });

  const query = new URL(calls[0].url).searchParams;
  assert.equal(new URL(calls[0].url).pathname, '/item/search');
  assert.equal(query.get('query'), 'tv');
  assert.equal(query.get('insta'), '1');
  assert.equal(query.get('limit'), '12');
  assert.equal(query.get('includeAllItemFields'), 'true');
  assert.equal(query.get('hasRetrievalQA'), 'true');
  assert.equal(query.get('ignoreMetrics'), 'true');
  assert.equal(query.get('typeOverride'), 'semantic');
  assert.deepEqual(JSON.parse(query.get('jsonFilter')), { brand: 'A&B' });
});

test('search retries a failed request, waiting a bit longer each time', async () => {
  let attempts = 0;
  const calls = mockFetch(() => (++attempts < 3 ? jsonResponse({}, { status: 503 }) : { items: ['ok'] }));

  const pending = api.search('tv', {});
  await flush();
  assert.equal(calls.length, 1);
  mock.timers.tick(99);
  await flush();
  assert.equal(calls.length, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(calls.length, 2);
  mock.timers.tick(199);
  await flush();
  assert.equal(calls.length, 2);
  mock.timers.tick(1);

  assert.deepEqual(await pending, { items: ['ok'] });
  assert.equal(calls.length, 3);
});

test('search gives up after three attempts and rejects with the last error', async () => {
  const calls = mockFetch(() => jsonResponse({}, { status: 503 }));

  const rejection = assert.rejects(api.search('tv', {}), /GET request failed: 503/);
  await flush();
  mock.timers.tick(100);
  await flush();
  mock.timers.tick(200);
  await rejection;

  mock.timers.tick(5000);
  await flush();
  assert.equal(calls.length, 3);
});

test('imageSearch posts the image form', async () => {
  const form = new window.FormData();
  const calls = mockFetch(() => ({ items: [] }));

  assert.deepEqual(await api.imageSearch(form, {}), { items: [] });

  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/item/image-search?sdk=1');
  assert.equal(calls[0].init.body, form);
  assert.deepEqual(calls[0].headers, { Authorization: 'Bearer token-1' });
});

test('imageSearch sends the multimodal, metrics and limit options', async () => {
  window.gsSearchOptions = { hasMultimodal: true };
  const calls = mockFetch();
  await api.imageSearch(new window.FormData(), { ignoreMetrics: true, limit: 6, text: '' });
  assert.equal(pathOf(calls[0]), '/item/image-search?sdk=1&hasMultimodal=true&ignoreRanking=true&ignoreMetrics=true&maxItems=6');
});

// See the report: with `text` the query string loses its leading "?sdk=1" (src/api/index.js:927
// and :948). Only what is not in doubt is asserted here: the text travels in the URL.
test('imageSearch and voiceSearch send the accompanying text', async () => {
  const calls = mockFetch();
  await api.imageSearch(new window.FormData(), { text: 'red' });
  await api.voiceSearch(new window.FormData(), { text: 'blue' });
  assert.equal(pathOf(calls[0]), '/item/image-search?sdk=1&text=red');
  assert.equal(pathOf(calls[1]), '/item/voice-search?sdk=1&text=blue');
});

test('imageSearch and voiceSearch encode the accompanying text', async () => {
  const calls = mockFetch();
  await api.imageSearch(new window.FormData(), { text: 'red & blue' });
  await api.voiceSearch(new window.FormData(), { text: 'a#b' });
  assert.equal(pathOf(calls[0]), '/item/image-search?sdk=1&text=red%20%26%20blue');
  assert.equal(pathOf(calls[1]), '/item/voice-search?sdk=1&text=a%23b');
});

test('voiceSearch posts the audio form', async () => {
  const form = new window.FormData();
  const calls = mockFetch(() => ({ text: 'tv' }));

  assert.deepEqual(await api.voiceSearch(form, {}), { text: 'tv' });

  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/item/voice-search?sdk=1');
  assert.equal(calls[0].init.body, form);
});

test('voiceSearch sends the multimodal, limit and metrics options', async () => {
  window.gsSearchOptions = { hasMultimodal: true };
  const calls = mockFetch();
  await api.voiceSearch(new window.FormData(), { limit: 6, ignoreMetrics: true });
  assert.equal(pathOf(calls[0]), '/item/voice-search?sdk=1&hasMultimodal=true&ignoreRanking=true&limit=6&ignoreMetrics=true');
});

test('uploadImage posts the form to the upload endpoint', async () => {
  const form = new window.FormData();
  const calls = mockFetch(() => ({ url: 'https://cdn.example/i.png' }));
  assert.deepEqual(await api.uploadImage(form), { url: 'https://cdn.example/i.png' });
  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/item/upload');
  assert.equal(calls[0].init.body, form);
});

// ---------------------------------------------------------------------------------------------
// orderMenu (answers are memoized per menu for the life of the page: each test uses its own)
// ---------------------------------------------------------------------------------------------

test('orderMenu returns an invalid menu untouched without calling the API', async () => {
  const calls = mockFetch();
  assert.deepEqual(await api.orderMenu('nope'), { items: [], order: [], promoted: [], mapped: false, reason: 'invalid_menu' });
  assert.deepEqual(await api.orderMenu([]), { items: [], order: [], promoted: [], mapped: false, reason: 'invalid_menu' });
  assert.deepEqual(await api.orderMenu(['TVs', '  ', null]), {
    items: ['TVs', '  ', null], order: [0, 1, 2], promoted: [], mapped: false, reason: 'invalid_menu',
  });
  assert.deepEqual((await api.orderMenu([{ label: 'TVs' }, { name: 'no label' }])).reason, 'invalid_menu');
  assert.equal(calls.length, 0);
});

test('orderMenu reorders the menu as the API says and remembers the answer', async () => {
  const calls = mockFetch(() => ({ order: [2, 0, 1], promoted: [2], mapped: true }));
  const menu = [' Home ', 'Audio', 'TVs'];

  const result = await api.orderMenu(menu);

  assert.deepEqual(result, { items: ['TVs', ' Home ', 'Audio'], order: [2, 0, 1], promoted: [2], mapped: true, reason: undefined });
  assert.equal(calls[0].method, 'POST');
  assert.equal(pathOf(calls[0]), '/menu/order');
  assert.deepEqual(calls[0].body, { menu: ['Home', 'Audio', 'TVs'] });

  assert.deepEqual((await api.orderMenu(menu)).items, ['TVs', ' Home ', 'Audio']);
  assert.equal(calls.length, 1, 'second call answered from memory');
});

test('orderMenu accepts objects with a label and returns the same objects, and sends the level', async () => {
  const calls = mockFetch(() => ({ order: [1, 0], mapped: true }));
  const first = { label: 'Kitchen', el: {} };
  const second = { label: 'Garden', el: {} };

  const result = await api.orderMenu([first, second], { level: 'alto' });

  assert.equal(result.items[0], second);
  assert.equal(result.items[1], first);
  assert.deepEqual(result.promoted, []);
  assert.equal(result.mapped, true);
  assert.deepEqual(calls[0].body, { menu: ['Kitchen', 'Garden'], level: 'alto' });

  // Another level is another question.
  await api.orderMenu([first, second], { level: 'suave' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.level, 'suave');
});

test('orderMenu does not remember provisional answers', async () => {
  let response = { order: [0, 1], mapped: false };
  const calls = mockFetch(() => response);
  const menu = ['Provisional A', 'Provisional B'];

  assert.deepEqual(await api.orderMenu(menu), { items: menu, order: [0, 1], promoted: [], mapped: false, reason: undefined });

  response = { order: [1, 0], promoted: [1], mapped: true, reason: 'no_history' };
  assert.deepEqual(await api.orderMenu(menu), {
    items: ['Provisional B', 'Provisional A'], order: [1, 0], promoted: [1], mapped: true, reason: 'no_history',
  });

  await api.orderMenu(menu);
  assert.equal(calls.length, 3);
});

test('orderMenu keeps the original order when the answer is not a valid permutation', async () => {
  const menu = ['Bad A', 'Bad B', 'Bad C'];
  const original = { items: menu, order: [0, 1, 2], promoted: [], mapped: false };
  for (const [order, reason, expectedReason] of [
    [[0, 0, 1], undefined, 'invalid_response'],
    [[0, 1], undefined, 'invalid_response'],
    [[0, 1, 3], undefined, 'invalid_response'],
    [[0, 1, '2'], undefined, 'invalid_response'],
    ['nope', 'not_ready', 'not_ready'],
  ]) {
    mockFetch(() => ({ order, mapped: false, reason }));
    assert.deepEqual(await api.orderMenu(menu), { ...original, reason: expectedReason });
  }
});

test('orderMenu keeps the original order when the API fails, and tries again next time', async () => {
  const log = mock.fn();
  window.gsLog = log;
  let fail = true;
  const calls = mockFetch(() => (fail ? jsonResponse({}, { status: 500 }) : { order: [1, 0], mapped: true }));
  const menu = ['Fail A', 'Fail B'];

  assert.deepEqual(await api.orderMenu(menu), { items: menu, order: [0, 1], promoted: [], mapped: false, reason: 'unavailable' });
  assert.equal(log.mock.calls.at(-1).arguments[0], 'orderMenu error');

  fail = false;
  assert.deepEqual((await api.orderMenu(menu)).items, ['Fail B', 'Fail A']);
  assert.equal(calls.length, 2);
});

test('orderMenu keeps the original order when the API takes longer than the timeout', async () => {
  mockFetch(() => new Promise(() => {}));
  const menu = ['Slow A', 'Slow B'];

  let result = null;
  api.orderMenu(menu, { timeout: 200 }).then((value) => { result = value; });
  await flush();
  mock.timers.tick(199);
  await flush();
  assert.equal(result, null);
  mock.timers.tick(1);
  await flush();
  assert.deepEqual(result, { items: menu, order: [0, 1], promoted: [], mapped: false, reason: 'unavailable' });

  // Default timeout: 1.5 s.
  result = null;
  api.orderMenu(menu).then((value) => { result = value; });
  await flush();
  mock.timers.tick(1499);
  await flush();
  assert.equal(result, null);
  mock.timers.tick(1);
  await flush();
  assert.equal(result.reason, 'unavailable');
});
