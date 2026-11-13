import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { registerHooks } from 'node:module';
import {
  FakeIntersectionObserver, flush, mockFetch, resetDom, seedSession,
} from './helpers/env.mjs';
import GSSDK from '../../src/index.js';

// index.js defines these two on import; resetDom() drops every window.gs* global.
const sdkLog = window.gsLog;
const sdkResetSession = window.gsResetSession;

const SESSION = { token: 'token-1', project: 'project-1', sessionId: 'session-1' };
const EMPTY_PAGE = { loadNowContent: [], lazyLoadContent: [] };
// One of the projects whose contents are driven by the VTEX IO pixel app.
const VTEX_EMBEDDED_PROJECT = '67374d510dfcc232a627662e';
const ITEM = { id: 'p1', sku: 'sku-1', name: 'Remera', price: 10, category: 'Ropa', brand: 'Acme' };
const GA_ITEM = {
  item_id: 'p1', item_sku: 'sku-1', item_sku_list: [], item_parent_id: '', item_name: 'Remera', price: 10,
  item_category: 'Ropa', item_brand: 'Acme', quantity: 1,
};

// The SDK loads its admin tools and plugins with import(): this hook lets a
// test make a chunk fail to load, and serves the remote plugins (no network).
const loader = { failing: null, remote: [] };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (loader.failing && specifier.endsWith(loader.failing)) {
      throw new Error(`Loading chunk ${loader.failing} failed`);
    }
    if (specifier.startsWith('https://')) {
      loader.remote.push(specifier);
      return { url: 'data:text/javascript,export default 1;', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// Chunks are read from disk: wait for them on the real clock (timers are mocked).
const realSetTimeout = globalThis.setTimeout;
async function until(predicate, tries = 400) {
  for (let i = 0; i < tries && !predicate(); i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
  return predicate();
}

const rel = (url) => {
  const parsed = new URL(url, 'https://shop.example');
  return parsed.pathname + parsed.search;
};
const find = (calls, method, path) => calls.find((call) => call.method === method && rel(call.url) === path);
const answer = (path) => ({ ok: true, echo: path });

// Fake API: every endpoint answers `{ ok, echo: <path> }` unless `custom` says otherwise.
function api(custom) {
  return mockFetch((url, init, call) => {
    const path = new URL(url, 'https://shop.example').pathname;
    const result = custom && custom(path, call);
    if (result !== undefined) return result;
    if (path === '/channel/init') return { ...SESSION };
    if (path.startsWith('/public/cached-content/')) return EMPTY_PAGE;
    return answer(path);
  });
}

async function boot(options = {}, clientId = 'BR-shop') {
  return GSSDK(clientId, { provider: 'Custom', singlePage: true, ...options });
}

// A page that already has a valid session for the client.
function seedKnownSession(session = {}) {
  localStorage.setItem('gs-v-1-clientId', 'shop');
  return seedSession({ ...SESSION, ...session });
}

function sharedSessionIframe() {
  const messages = [];
  const iframe = document.createElement('iframe');
  iframe.id = 'gs_sessionTokenIframe';
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage: (message, origin) => messages.push({ message, origin }) },
  });
  document.body.appendChild(iframe);
  return messages;
}

const fromSharedIframe = (data) => window.dispatchEvent(
  new window.MessageEvent('message', { origin: 'https://sdk.gopersonal.ai', data }),
);

// A clean page with the globals the SDK modules define on import.
function page(options) {
  resetDom(options);
  window.gsStore = { interactionCount: 0 };
  window.gsLog = sdkLog;
  window.gsResetSession = sdkResetSession;
}

beforeEach(() => {
  page();
  loader.failing = null;
  loader.remote = [];
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  mock.method(console, 'log', () => {});
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  delete window.history.pushState;
  delete window.history.replaceState;
  delete window.dataLayer;
});

// ---------------------------------------------------------------------------
// Globals defined by the entry point
// ---------------------------------------------------------------------------

test('window.gsLog only prints when logging is enabled', () => {
  window.gsConfig = { log: false };
  window.gsLog('hidden');
  assert.equal(console.log.mock.calls.length, 0);

  window.gsConfig = { log: true };
  window.gsLog('shown', 1, { a: 2 });
  assert.deepEqual(console.log.mock.calls.map((call) => call.arguments), [['shown', 1, { a: 2 }]]);
});

test('window.gsResetSession asks for a new session and counts the reset', async () => {
  const calls = api();
  await boot();
  localStorage.removeItem('gs-v-1');
  calls.length = 0;
  const { timestamp } = window.gsResetData;

  await window.gsResetSession();

  assert.ok(find(calls, 'POST', '/channel/init'));
  assert.equal(JSON.parse(localStorage.getItem('gs-v-1')).token, 'token-1');
  assert.deepEqual(window.gsResetData, { count: 1, timestamp });
});

test('window.gsResetSession stops after 10 resets within the hour', async () => {
  const calls = api();
  await boot();
  localStorage.removeItem('gs-v-1');
  calls.length = 0;
  window.gsResetData = { count: 10, timestamp: Date.now() - 59 * 60 * 1000 };

  await window.gsResetSession();

  assert.equal(calls.length, 0);
  assert.equal(window.gsResetData.count, 10);
  assert.equal(localStorage.getItem('gs-v-1'), null);
});

test('window.gsResetSession starts counting again after an hour', async () => {
  const calls = api();
  await boot();
  localStorage.removeItem('gs-v-1');
  calls.length = 0;
  const before = Date.now();
  window.gsResetData = { count: 10, timestamp: before - 61 * 60 * 1000 };

  await window.gsResetSession();

  assert.ok(find(calls, 'POST', '/channel/init'));
  assert.equal(window.gsResetData.count, 1);
  assert.ok(window.gsResetData.timestamp >= before);
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

test('GSSDK rejects without a client id', async () => {
  const calls = api();
  await assert.rejects(GSSDK(undefined, { provider: 'Custom' }), /Client ID is required to initialize the SDK/);
  await assert.rejects(GSSDK(''), /Client ID is required/);
  assert.equal(calls.length, 0);
});

test('GSSDK creates the session and leaves the SDK globals ready', async () => {
  page({ url: 'https://shop.example/home?utm=1' });
  const calls = api();
  const options = { provider: 'Custom', singlePage: true };

  const sdk = await GSSDK('BR-shop', options);

  const init = find(calls, 'POST', '/channel/init');
  assert.ok(init);
  assert.equal(new URL(init.url).origin, 'https://discover.gopersonal.ai');
  assert.equal(init.body.clientId, 'shop');
  assert.equal(init.body.firstURL, 'https://shop.example/home?utm=1');
  assert.match(init.body.gsVUID, /^_gsVUUID_/);
  assert.equal(localStorage.getItem('gs_vuuid'), init.body.gsVUID);

  assert.equal(JSON.parse(localStorage.getItem('gs-v-1')).token, 'token-1');
  assert.equal(localStorage.getItem('gs-v-1-clientId'), 'shop');
  assert.equal(window.gsConfig.options, options);
  assert.deepEqual(window.gsEventHandlers, {});
  assert.deepEqual(window.gsImpressionIds, []);
  assert.equal(window.gsResetData.count, 0);
  assert.equal(typeof sdk.addInteraction, 'function');
});

test('GSSDK can be called with `new` and still gives the promise of the API', async () => {
  api();
  const promise = new GSSDK('BR-shop', { provider: 'Custom', singlePage: true });
  assert.ok(promise instanceof Promise);
  const sdk = await promise;
  assert.equal(typeof sdk.getContent, 'function');
});

test('GSSDK reuses a valid session instead of asking for a new one', async () => {
  seedKnownSession({ token: 'token-known' });
  const calls = api();

  const sdk = await boot();

  assert.equal(find(calls, 'POST', '/channel/init'), undefined);
  assert.equal(sdk.getSession().token, 'token-known');
});

test('GSSDK in the playground uses the token of the URL as the session', async () => {
  page({ url: 'https://shop.example/?_gsPlaygroundToken=play-token' });
  const calls = api();
  const options = { provider: 'Custom', singlePage: true };

  const sdk = await GSSDK('BR-shop', options);

  assert.equal(calls.length, 0);
  assert.equal(window.gsConfig.clientId, 'BR-playground');
  assert.equal(options.playgroundToken, 'play-token');
  assert.equal(sdk.getSession().token, 'play-token');
  assert.equal(localStorage.getItem('gs-v-1-clientId'), 'playground');
});

test('GSSDK enables logging from the log option or the _gsLog param', async () => {
  const logged = () => console.log.mock.calls.some((call) => call.arguments[0] === 'GSSDK: BR-shop');
  api();

  await boot();
  assert.equal(logged(), false);

  await boot({ log: true });
  assert.equal(window.gsConfig.log, true);
  assert.equal(logged(), true);

  console.log.mock.resetCalls();
  page({ url: 'https://shop.example/?_gsLog=1' });
  await boot();
  assert.equal(logged(), true);
});

test('GSSDK installs the browse plugin only when it is configured', async () => {
  api();
  const recorder = () => document.querySelector('script[src*="rrweb-record"]');

  await boot();
  assert.equal(recorder(), null);
  await boot({ plugins: [{ id: 'other', options: {} }] });
  assert.equal(recorder(), null);
  await boot({ plugins: [{ id: 'other' }, { id: 'browse', options: { sample: 1 } }] });
  assert.ok(recorder());
});

test('GSSDK runs the actions carried by the URL', async () => {
  page({ url: 'https://shop.example/p?_gsSearchCTR=sr-1&_gsTrackExecutionId=exec-1&ev_name=promo_click&ev_p_campaign=summer' });
  window.dataLayer = [];
  mock.method(console, 'error', () => {});
  const calls = api();

  await boot();
  await flush();

  assert.deepEqual(find(calls, 'PATCH', '/item/search-interaction').body, { status: 'clicked', id: 'sr-1' });
  assert.deepEqual(find(calls, 'PATCH', '/public/track').body, { executionId: 'exec-1' });
  assert.deepEqual(window.dataLayer, [{ event: 'promo_click', campaign: 'summer' }]);
  assert.equal(new URL(window.location.href).searchParams.has('_gsSearchCTR'), false);
});

test('GSSDK reports a GA4 event carried by the URL even without other actions', async () => {
  page({ url: 'https://shop.example/p?ev_name=newsletter_open' });
  window.dataLayer = [];
  mock.method(console, 'error', () => {});
  const calls = api();

  await boot();
  await flush();

  assert.deepEqual(window.dataLayer, [{ event: 'newsletter_open' }]);
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0);
});

test('GSSDK runs no URL action on a plain URL', async () => {
  page({ url: 'https://shop.example/p?color=red&gsDebug=false' });
  window.dataLayer = [];
  const calls = api();

  await boot();
  await flush();

  assert.deepEqual(window.dataLayer, []);
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0);
});

test('GSSDK on Fenicio monitors the navigation and installs the provider 100ms later', async () => {
  page({ url: 'https://shop.example/catalogo/remera_1' });
  const calls = api();
  const options = { provider: 'Fenicio', context: { pageType: 'product_detail' } };

  const sdk = await GSSDK('BR-shop', options);
  window.gsSDK = sdk;
  await flush();
  assert.equal(window.__gsFenicioNavigationMonitorInstalled, true);
  assert.ok(find(calls, 'GET', '/public/cached-content/project-1/?pageType=product_detail'), 'initial contents');

  const publicAddInteraction = sdk.addInteraction;
  mock.timers.tick(99);
  assert.equal(window.gsSDK.addInteraction, publicAddInteraction);
  mock.timers.tick(1);
  assert.notEqual(window.gsSDK.addInteraction, publicAddInteraction, 'installFenicio wrapped addInteraction');

  // The provider tracks the product view by URL shortly after.
  await flush();
  mock.timers.tick(200);
  await flush();
  const view = find(calls, 'POST', '/interaction');
  assert.ok(view, calls.map((entry) => `${entry.method} ${rel(entry.url)}`).join(', '));
  assert.deepEqual(view.body, {
    event: 'view',
    preProcess: ['findItemByField:url'],
    fieldValue: 'https://shop.example/catalogo/remera_1',
    provider: 'fenicio',
  });
});

test('GSSDK on Fenicio called again after a navigation reloads the contents and returns the same SDK', async () => {
  page({ url: 'https://shop.example/' });
  const calls = api();
  const sdk = await GSSDK('BR-shop', { provider: 'Fenicio', context: { pageType: 'home' } });
  window.gsSDK = sdk;
  await flush();
  calls.length = 0;

  window.history.pushState({}, '', '/mujer/remeras');
  const again = await GSSDK('BR-shop', { provider: 'Fenicio', context: { pageType: 'category' } });

  assert.equal(again, sdk);
  assert.equal(find(calls, 'POST', '/channel/init'), undefined);
  assert.ok(find(calls, 'GET', '/public/cached-content/project-1/?pageType=category'));
  assert.deepEqual(window.gsConfig.options.context, { pageType: 'category' });
});

test('GSSDK on a VTEX single page app schedules the PDP fallback', async () => {
  api();

  await boot({ provider: 'VTEX', singlePage: true });
  assert.equal(window.__gsVtexPdpFallbackScheduled, true);
  assert.equal(window.__gsVtexCheckoutInstalled, undefined, 'not on the checkout');

  page();
  await boot({ provider: 'vtex', singlePage: false, noDefaultContext: true });
  assert.equal(window.__gsVtexPdpFallbackScheduled, undefined);

  page();
  await boot({ provider: 'Custom', singlePage: true });
  assert.equal(window.__gsVtexPdpFallbackScheduled, undefined);
});

test('GSSDK on the VTEX checkout installs the checkout module', async () => {
  page({ url: 'https://shop.example/checkout/#/email' });
  const listeners = [];
  const add = document.addEventListener.bind(document);
  mock.method(document, 'addEventListener', (...args) => { listeners.push(args); return add(...args); });
  api();

  await boot({ provider: 'VTEX', singlePage: true });

  assert.equal(window.__gsVtexCheckoutInstalled, true);
  listeners.forEach((args) => document.removeEventListener(...args));
});

test('GSSDK listens to the VTEX pixel events only on the projects that use them', async () => {
  api();
  await boot();
  await flush();
  assert.equal(window.__gsIntegrationListener, undefined);

  page();
  api((path) => (path === '/channel/init' ? { ...SESSION, project: VTEX_EMBEDDED_PROJECT } : undefined));
  await boot();
  await flush();
  assert.equal(window.__gsIntegrationListener, true);
});

// Runs before the gsPreview test: the preview listener stays on the window for good.
test('GSSDK without gsPreview ignores the admin editor messages', async () => {
  document.body.innerHTML = '<div id="slot">old</div>';
  api();
  await boot();

  window.dispatchEvent(new window.MessageEvent('message', {
    origin: 'https://admin.gopersonal.ai',
    data: {
      namespace: 'gopersonal', source: 'editor', type: 'update',
      payload: { html: '<b id="preview">new</b>', previewObject: { selector: '#slot' } },
    },
  }));
  await flush();

  assert.equal(document.getElementById('slot').innerHTML, 'old');
});

test('GSSDK with gsPreview renders what the admin editor sends', async () => {
  page({ url: 'https://shop.example/?gsPreview=true' });
  document.body.innerHTML = '<div id="slot">old</div>';
  api();
  await boot();
  const send = async (origin) => {
    window.dispatchEvent(new window.MessageEvent('message', {
      origin,
      data: {
        namespace: 'gopersonal',
        source: 'editor',
        type: 'update',
        payload: { html: '<b id="preview">new</b>', previewObject: { selector: '#slot', selectorPosition: 'replace' } },
      },
    }));
    await flush();
  };

  await send('https://evil.example');
  assert.equal(document.getElementById('preview'), null);
  await send('https://admin.gopersonal.ai');
  assert.equal(document.getElementById('slot').innerHTML, '<b id="preview">new</b>');
});

test('GSSDK logs a variant editor chunk that fails to load, and still starts', async () => {
  page({ url: 'https://shop.example/?gsPreviewVariant=variant-1' });
  loader.failing = 'variantEditor';
  api();

  const sdk = await boot({ log: true });
  await until(() => console.log.mock.calls.some((call) => call.arguments[0] === 'Error initializing variant editor'));

  assert.equal(typeof sdk.getContent, 'function');
  const entry = console.log.mock.calls.find((call) => call.arguments[0] === 'Error initializing variant editor');
  assert.ok(entry);
  assert.match(entry.arguments[1].message, /Loading chunk variantEditor failed/);
  assert.equal(window.gsShowSelectorPicker, undefined);
});

test('GSSDK loads the variant editor only with gsPreviewVariant', async () => {
  api();
  await boot();
  await flush();
  assert.equal(window.gsShowSelectorPicker, undefined);

  page({ url: 'https://shop.example/?gsPreviewVariant=variant-1' });
  await boot();
  await until(() => window.gsShowSelectorPicker);
  assert.equal(typeof window.gsShowSelectorPicker, 'function');
  assert.deepEqual(window.gsVariantTextEdits, []);
});

test('GSSDK logs an element selector picker chunk that fails to load, and still starts', async () => {
  page({ url: 'https://shop.example/?gsSelectElementSelector=true' });
  loader.failing = 'elementSelectorPicker';
  api();

  const sdk = await boot({ log: true });
  await until(() => console.log.mock.calls.some((call) => call.arguments[0] === 'Error initializing element selector picker'));

  assert.equal(typeof sdk.getContent, 'function');
  const entry = console.log.mock.calls.find((call) => call.arguments[0] === 'Error initializing element selector picker');
  assert.ok(entry);
  assert.match(entry.arguments[1].message, /Loading chunk elementSelectorPicker failed/);
  assert.equal(window.gsShowElementSelectorPicker, undefined);
});

test('GSSDK loads the element selector picker only with gsSelectElementSelector=true', async () => {
  page({ url: 'https://shop.example/?gsSelectElementSelector=false' });
  api();
  await boot();
  await flush();
  assert.equal(window.gsShowElementSelectorPicker, undefined);

  page({ url: 'https://shop.example/?gsSelectElementSelector=true' });
  await boot();
  await until(() => window.gsShowElementSelectorPicker);
  assert.equal(typeof window.gsShowElementSelectorPicker, 'function');
  window.gsHideElementSelectorPicker();
});

// ---------------------------------------------------------------------------
// Public API: methods that are one request to the API
// ---------------------------------------------------------------------------

const REQUESTS = [
  ['login', ['u1', { email: 'ada@example.com' }], 'POST', '/channel/login', { email: 'ada@example.com', customerId: 'u1', provider: 'custom' }],
  ['login', ['u1'], 'POST', '/channel/login', { customerId: 'u1', provider: 'custom' }],
  ['loginEmail', ['ada@example.com'], 'POST', '/channel/login', { email: 'ada@example.com' }],
  ['setEmailSubscription', [true], 'POST', '/channel/email-subscription', { optIn: true }],
  ['updateCustomerData', [{ name: 'Ada' }], 'PUT', '/channel/update-customer', { name: 'Ada' }],
  ['setCookies', ['accepted'], 'PUT', '/channel/cookies-status', { status: 'accepted' }],
  ['setPreferences', [{ brand: 'acme' }], 'PUT', '/channel/preferences', { brand: 'acme' }],
  ['addInteraction', [{ event: 'view', item: 'p1' }], 'POST', '/interaction', { event: 'view', item: 'p1', provider: 'custom' }],
  ['addInteractionState', ['cart', { transactionId: 't1' }], 'POST', '/interaction/state/cart', { transactionId: 't1', provider: 'custom' }],
  ['addInteractionState', ['cart'], 'POST', '/interaction/state/cart', { provider: 'custom' }],
  ['getItems', [{ limit: 5, where: { brand: 'acme' } }], 'GET', '/item?limit=5&offset=0&where=%7B%22brand%22%3A%22acme%22%7D'],
  ['findState', [], 'GET', '/channel/state'],
  ['findLastInteractions', [], 'GET', '/channel/last-interactions?limit=10'],
  ['findLastInteractions', [3], 'GET', '/channel/last-interactions?limit=3'],
  ['updateState', [{ cart: { products: [] } }], 'PUT', '/channel/state', { cart: { products: [] } }],
  ['search', ['tv', { limit: 3 }], 'GET', '/item/search?query=tv&limit=3'],
  ['searchAnswer', ['tv', { lang: 'es' }], 'POST', '/item/search-answer', { input: 'tv', lang: 'es' }],
  ['searchChat', [{ message: 'hola' }], 'POST', '/item/search-chat', { message: 'hola' }],
  ['isSearch', [{ message: 'hola' }], 'POST', '/item/search-chat-is-search', { message: 'hola' }],
  ['searchRedirect', ['tv', { searchResultId: 'r1' }], 'GET', '/item/search-redirect?query=tv&searchResultId=r1'],
  ['searchBulk', [{ queries: ['tv', 'led'] }], 'POST', '/item/bulk-search', { queries: ['tv', 'led'] }],
  ['searchAutoFilter', [{ brand: ['acme'] }, 'tv'], 'POST', '/item/search-filter-builder', { filters: { brand: ['acme'] }, input: 'tv' }],
  ['getSearchHistory', [], 'GET', '/channel/search-history?limit=10'],
  ['getSearchHistory', [{ limit: 5 }], 'GET', '/channel/search-history?limit=5'],
  ['getTopSearches', [], 'GET', '/public/top-searches/project-1?limit=10'],
  ['getTopSearches', [{ limit: 500 }], 'GET', '/public/top-searches/project-1?limit=100'],
  ['downloadSearchAutocompleteIndex', [], 'GET', '/public/search-autocomplete/project-1'],
  ['searchFilterFacelets', [], 'GET', '/item/search-filter-facelets'],
  ['searchFilterFacelets', ['tv led'], 'GET', '/item/search-filter-facelets?query=tv%20led'],
  ['searchAutocomplete', ['tv'], 'GET', '/item/search-filter-facelets?mode=autocomplete&limit=8&query=tv'],
  ['searchAutocomplete', ['tv', { limit: 3, suggestionsOnly: true }], 'GET', '/item/search-filter-facelets?mode=autocomplete&limit=3&suggestionsOnly=1&query=tv'],
  ['searchResult', [{ query: 'tv', total: 4 }], 'POST', '/item/search-result', { query: 'tv', total: 4 }],
  ['updateSearchResult', ['sr-1', { status: 'clicked' }], 'PATCH', '/item/search-interaction', { status: 'clicked', id: 'sr-1' }],
  ['getCount', [{ where: { brand: 'acme' } }], 'GET', '/item/count?where=%7B%22brand%22%3A%22acme%22%7D'],
  ['getItemById', ['p1'], 'GET', '/item/p1'],
  ['getRanking', ['top-sellers', { limit: 5 }], 'GET', '/item/ranking/top-sellers/?limit=5'],
  ['reRank', ['top-sellers', { affinityField: 'brand', items: ['a', 'b'] }], 'POST', '/item/rerank/top-sellers/?affinityField=brand', { items: ['a', 'b'] }],
  ['getFieldValues', [{ field: 'brand' }], 'GET', '/item/custom-attributes/brand'],
  ['bestProducts', [{ includeImpressionId: true }], 'GET', '/recommendations/best-products?includeImpressionId=true'],
  ['getState', [], 'GET', '/channel/state'],
  ['getState', [{ any: 'param' }], 'GET', '/channel/state'],
  ['getAffinity', [], 'GET', '/channel/whoiam/affinity'],
  ['getAffinityCustomer', [], 'GET', '/channel/whoiam?includeCustomer=true'],
  ['getLoyalty', [], 'GET', '/personal/loyalty'],
  ['addFeedback', [{ rate: 5, comment: 'ok' }], 'POST', '/feedback', { rate: 5, comment: 'ok' }],
  ['addItemFeedback', [{ item: 'p1', rate: 4 }], 'POST', '/feedback/items', { item: 'p1', rate: 4 }],
  ['getItemFeedbackSummary', ['p 1'], 'GET', '/feedback/items/summary?item=p%201'],
  ['getItemFeedbackComments', ['p1'], 'GET', '/feedback/items/comments?item=p1&limit=10&skip=0'],
  ['getItemFeedbackComments', ['p1', { limit: 5, skip: 10 }], 'GET', '/feedback/items/comments?item=p1&limit=5&skip=10'],
  ['triggerJourney', [{ journey: 'j1' }], 'POST', '/journey/trigger', { journey: 'j1' }],
  ['trackURLClicked', ['exec-1'], 'PATCH', '/public/track', { executionId: 'exec-1' }],
  ['liveGetVideo', ['v1'], 'GET', '/addon/live/video?id=v1'],
  ['liveLikeVideo', ['v1'], 'PATCH', '/addon/live/video/v1/like', {}],
  ['liveUnlikeVideo', ['v1'], 'PATCH', '/addon/live/video/v1/unlike', {}],
  ['liveTrackVideoTime', ['v1', 30, 'view-1'], 'PATCH', '/addon/live/video/v1/time', { time: 30, videoViewId: 'view-1' }],
  ['clickContentImpression', ['imp-1', { content: 'c1', tags: ['hero'] }], 'PATCH', '/personal/impression/imp-1', { content: 'c1', tags: ['hero'] }],
  ['clickContentImpression', ['imp-1'], 'PATCH', '/personal/impression/imp-1', {}],
  ['openImpression', ['imp-1'], 'PATCH', '/recommendations/impression/imp-1', { status: 'opened' }],
];

for (const [name, args, method, path, body] of REQUESTS) {
  test(`gsSDK.${name}(${args.map((arg) => JSON.stringify(arg)).join(', ')}) sends ${method} ${path}`, async () => {
    const calls = api();
    const sdk = await boot();
    calls.length = 0;

    const result = await sdk[name](...args);

    const call = find(calls, method, path);
    assert.ok(call, `requests made: ${calls.map((entry) => `${entry.method} ${rel(entry.url)}`).join(', ')}`);
    if (body !== undefined) {
      assert.deepEqual(call.body, body);
    }
    assert.deepEqual(result, answer(path.split('?')[0]), 'resolves with the answer of the API');
  });
}

test('gsSDK requests carry the session token, except the public ones', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;

  await sdk.findState();
  await sdk.getTopSearches();

  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');
  assert.deepEqual(calls[1].headers, {});
});

// ---------------------------------------------------------------------------
// Public API: the rest
// ---------------------------------------------------------------------------

test('gsSDK.setEmailSubscription rejects anything that is not a boolean', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;

  await assert.rejects(sdk.setEmailSubscription('yes'), { name: 'TypeError', message: 'Email subscription must be a boolean' });
  assert.equal(calls.length, 0);
});

test('gsSDK.getSession and getCurrentSession return the stored session', async () => {
  api();
  const sdk = await boot();

  for (const session of [sdk.getSession(), sdk.getCurrentSession()]) {
    assert.equal(session.token, 'token-1');
    assert.equal(session.project, 'project-1');
    assert.equal(session.sessionId, 'session-1');
    assert.equal(session.vuuid, localStorage.getItem('gs_vuuid'));
  }
});

test('gsSDK.login keeps the customer in the session and logout drops it', async () => {
  const calls = api();
  const sdk = await boot();
  assert.equal(sdk.logout(), undefined, 'nothing to log out yet');

  await sdk.login('customer-1', { email: 'ada@example.com' });
  assert.equal(sdk.getSession().customer_id, 'customer-1');
  assert.equal(sdk.getSession().customer_email, 'ada@example.com');
  calls.length = 0;

  const result = await sdk.logout();
  await flush();

  assert.deepEqual(result, answer('/channel/logout'));
  assert.deepEqual(find(calls, 'POST', '/channel/logout').body, { clientId: 'shop' });
  assert.ok(find(calls, 'POST', '/channel/init'), 'a new anonymous session is requested');
  assert.equal(sdk.getSession().customer_id, undefined);
});

test('gsSDK.reorderCategories puts first the categories the shopper interacted with', async () => {
  api();
  const sdk = await boot();
  const interactions = [
    { data: { itemData: { category_ids: '3, 7' } } },
    { data: { itemData: { category_ids: '7' } } },
    { data: { itemData: { category_ids: ['9'] } } },
    { data: {} },
    {},
  ];
  const categories = [{ id: 1, name: 'A' }, { id: 3, name: 'B' }, { id: 7, name: 'C' }];

  assert.deepEqual(sdk.reorderCategories(interactions, categories), [
    { id: 7, name: 'C', interactionCount: 2 },
    { id: 3, name: 'B', interactionCount: 1 },
    { id: 1, name: 'A', interactionCount: 0 },
  ]);
});

test('gsSDK.getLastInteraction returns the last interaction sent from this page', async () => {
  api();
  const sdk = await boot();
  assert.equal(sdk.getLastInteraction(), null);

  await sdk.addInteraction({ event: 'cart', item: 77, quantity: 2 });

  const last = sdk.getLastInteraction();
  assert.equal(last.event, 'cart');
  assert.equal(last.item, '77');
  assert.equal(last.quantity, 2);
  assert.equal(typeof last.at, 'number');
});

test('gsSDK.addBulkInteractions sends the events in one transaction', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;

  const result = await sdk.addBulkInteractions([{ event: 'view', item: 'p1' }, { event: 'like', item: 'p2', provider: 'own' }]);

  const { body } = find(calls, 'POST', '/interaction/bulk');
  assert.equal(typeof body.transactionId, 'string');
  assert.deepEqual(body.events, [
    { event: 'view', item: 'p1', provider: 'custom' },
    { event: 'like', item: 'p2', provider: 'own' },
  ]);
  assert.deepEqual(result, answer('/interaction/bulk'));
  assert.equal(sdk.addBulkInteractions([]), undefined);
});

test('gsSDK.getCart returns the cart of the session state', async () => {
  const cart = { products: [{ id: 'p1', quantity: 1 }], totalAmount: 10, amountOfProducts: 1, updatedAt: 5 };
  api((path) => (path === '/channel/state' ? { cart } : undefined));
  const sdk = await boot();

  assert.deepEqual(await sdk.getCart(), cart);
});

test('gsSDK.onCartChange notifies cart updates until it is unsubscribed', async () => {
  api();
  const sdk = await boot();
  const seen = [];
  const unsubscribe = sdk.onCartChange((cart) => seen.push(cart));
  const emit = (detail) => window.dispatchEvent(new window.CustomEvent('gopersonal:cart-updated', { detail }));

  emit({ totalAmount: 10 });
  unsubscribe();
  emit({ totalAmount: 20 });

  assert.deepEqual(seen, [{ totalAmount: 10 }]);
});

test('gsSDK.orderMenu returns the menu in the order the API answers', async () => {
  const calls = api((path) => (path === '/menu/order' ? { order: [2, 0, 1], promoted: [2], mapped: true } : undefined));
  const sdk = await boot();
  calls.length = 0;

  const plain = await sdk.orderMenu(['Televisores', 'Audio', 'Celulares']);
  assert.deepEqual(find(calls, 'POST', '/menu/order').body, { menu: ['Televisores', 'Audio', 'Celulares'] });
  assert.deepEqual(plain, {
    items: ['Celulares', 'Televisores', 'Audio'], order: [2, 0, 1], promoted: [2], mapped: true, reason: undefined,
  });

  calls.length = 0;
  const entries = [{ label: 'Hogar', el: 1 }, { label: 'Jardín', el: 2 }, { label: 'Autos', el: 3 }];
  const withLevel = await sdk.orderMenu(entries, { level: 'alto' });
  assert.deepEqual(find(calls, 'POST', '/menu/order').body, { menu: ['Hogar', 'Jardín', 'Autos'], level: 'alto' });
  assert.deepEqual(withLevel.items, [entries[2], entries[0], entries[1]]);
});

test('gsSDK.imageSearch, voiceSearch and uploadImage post the form data as is', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;
  const formData = new window.FormData();
  formData.append('file', 'binary');

  assert.deepEqual(await sdk.imageSearch(formData, { limit: 4 }), answer('/item/image-search'));
  assert.deepEqual(await sdk.voiceSearch(formData, { limit: 4, ignoreMetrics: true }), answer('/item/voice-search'));
  assert.deepEqual(await sdk.uploadImage(formData), answer('/item/upload'));

  const image = find(calls, 'POST', '/item/image-search?sdk=1&maxItems=4');
  const voice = find(calls, 'POST', '/item/voice-search?sdk=1&limit=4&ignoreMetrics=true');
  const upload = find(calls, 'POST', '/item/upload');
  for (const call of [image, voice, upload]) {
    assert.equal(call.body, formData);
    assert.deepEqual(call.headers, { Authorization: 'Bearer token-1' });
  }
});

test('gsSDK.loadPlugin imports the plugin from the SDK CDN', async () => {
  api();
  const sdk = await boot();

  await sdk.loadPlugin('carousel');
  await sdk.loadPlugin('carousel', true);
  await sdk.loadPlugin('search-box', false);

  assert.deepEqual(loader.remote, [
    'https://sdk.gopersonal.ai/external-libs/carousel.js',
    'https://sdk.gopersonal.ai/external-libs/carousel.js',
    'https://sdk.gopersonal.ai/libs/search-box.js',
  ]);
});

test('gsSDK.getItemsByIds and getItemsByParentIds return the products found', async () => {
  const products = [{ id: 'a' }, { id: 'b' }];
  const calls = api((path) => (path === '/item/by-ids' ? { resultData: products } : undefined));
  const sdk = await boot();
  calls.length = 0;

  assert.deepEqual(await sdk.getItemsByIds(['a', 'b', 'a', null, '']), products);
  assert.deepEqual(calls[0].body, { ids: ['a', 'b'], field: 'id' });

  assert.deepEqual(await sdk.getItemsByIds(['x'], { field: 'parent_id' }), products);
  assert.deepEqual(calls[1].body, { ids: ['x'], field: 'parent_id' });

  assert.deepEqual(await sdk.getItemsByParentIds(['parent-1', 2]), products);
  assert.deepEqual(calls[2].body, { ids: ['parent-1', '2'], field: 'parent_id' });

  assert.deepEqual(await sdk.getItemsByIds([]), []);
  assert.equal(calls.length, 3);
});

test('gsSDK.getFenicioCards asks the storefront for the native cards', async () => {
  const html = '<div data-codigo="A1"><div class="it" data-codprod="A1" data-codvar="V1"></div></div>';
  const calls = api((path) => (path === '/catalogo/cargar-variantes' ? html : undefined));
  const sdk = await boot();
  calls.length = 0;

  assert.equal(await sdk.getFenicioCards(['A1']), html);
  assert.equal(calls[0].url, '/catalogo/cargar-variantes?c%5B%5D=A1&paginaCatalogo=');

  const parsed = await sdk.getFenicioCards('A1', { responseType: 'parsed' });
  assert.deepEqual(parsed.map((group) => [group.code, group.cards[0].variantCode]), [['A1', 'V1']]);
});

test('gsSDK.recommendationByContex asks for recommendations with the strategy and count', async () => {
  const recommendations = [{ id: 'p1' }];
  const calls = api((path) => (path === '/recommendations/by-context' ? recommendations : undefined));
  const sdk = await boot();
  calls.length = 0;

  const result = await sdk.recommendationByContex({ strategy: 'top', count: 4, context: { currentPage: { productId: '9' } } });

  assert.deepEqual(result, recommendations);
  assert.deepEqual(find(calls, 'POST', '/recommendations/by-context').body, {
    context: { currentPage: { productId: '9' } },
    variables: [
      { type: { id: 'gs_recoStrategy' }, value: { id: 'top' } },
      { type: { id: 'gs_recoCount' }, value: '4' },
    ],
  });
});

test('gsSDK.getContent asks for the personalised content', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;

  // The API has no variant for this visitor: nothing to render.
  assert.equal(await sdk.getContent('content-1'), undefined);
  assert.ok(find(calls, 'POST', '/personal/content/content-1?project=project-1&onlyData=true&omitRecoString=true'));

  assert.equal(await sdk.getContent('content-2', { impressionStatus: 'opened' }), undefined);
  assert.ok(find(calls, 'POST', '/personal/content/content-2?impressionStatus=opened&project=project-1&onlyData=true&omitRecoString=true'));
});

test('gsSDK.getContentByContext asks for the contents of the page type', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;

  await sdk.getContentByContext('home', { singlePage: true });

  assert.ok(find(calls, 'GET', '/public/cached-content/project-1/?pageType=home'));
  assert.equal(window.__gsLastContentContext.context, 'home');
});

test('gsSDK.clearSharedSession tells the shared session iframe to drop the token', async () => {
  api();
  const sdk = await boot();
  sdk.clearSharedSession();

  const messages = sharedSessionIframe();
  sdk.clearSharedSession();

  assert.deepEqual(messages, [{ message: { action: 'clearToken', clientId: 'BR-shop' }, origin: 'https://sdk.gopersonal.ai' }]);
});

test('gsSDK.setSharedToken and getSharedToken go through the shared session iframe', async () => {
  api();
  const sdk = await boot();
  const messages = sharedSessionIframe();

  const stored = sdk.setSharedToken();
  assert.equal(messages[0].message.action, 'setSession');
  assert.equal(messages[0].message.clientId, 'BR-shop');
  assert.equal(messages[0].message.session.token, 'token-1');
  assert.equal(messages[0].origin, 'https://sdk.gopersonal.ai');
  fromSharedIframe({ action: 'sessionSet' });
  assert.equal(await stored, undefined);

  const shared = sdk.getSharedToken();
  assert.deepEqual(messages[1].message, { action: 'getSession', clientId: 'BR-shop' });
  fromSharedIframe({ action: 'sessionData', session: { token: 'shared-token' } });
  assert.deepEqual(await shared, { token: 'shared-token' });
});

test('gsSDK.observeElementInView calls back once the element is visible', async () => {
  api();
  const sdk = await boot();
  document.body.innerHTML = '<div id="widget"></div>';
  const seen = [];

  sdk.observeElementInView('widget', 'imp-1', (...args) => seen.push(args));
  const observer = FakeIntersectionObserver.instances.at(-1);
  assert.deepEqual(observer.targets, [document.getElementById('widget')]);

  observer.trigger(false);
  assert.deepEqual(seen, []);
  observer.trigger(true);
  assert.deepEqual(seen, [['widget', 'imp-1']]);
  assert.equal(observer.disconnected, true);
});

test('gsSDK.openImpressionContent marks the impression as opened', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;

  await sdk.openImpressionContent('imp-2');

  // Only the shape of the request is asserted: the route it goes to is flagged
  // in the report (it is the recommendation one, like gsSDK.openImpression).
  const [call] = calls;
  assert.equal(call.method, 'PATCH');
  assert.match(rel(call.url), /\/impression\/imp-2$/);
  assert.deepEqual(call.body, { status: 'opened' });
});

test('gsSDK.createContentImpression creates one impression per content and session', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;
  assert.deepEqual(sdk.getSeenContents(), []);
  assert.equal(sdk.getContentImpressionId('content-9'), null);

  const created = await sdk.createContentImpression('imp-3', { content: 'content-9', variantId: 'variant-1' });

  assert.deepEqual(created, answer('/personal/impression'));
  assert.deepEqual(find(calls, 'POST', '/personal/impression').body, {
    impressionId: 'imp-3', content: 'content-9', variantId: 'variant-1', status: 'opened',
  });
  assert.equal(sdk.getContentImpressionId('content-9'), 'imp-3');
  assert.deepEqual(sdk.getSeenContents(), ['content-9']);

  // Same content again on this session: nothing is sent.
  calls.length = 0;
  const again = await sdk.createContentImpression('imp-4', { content: 'content-9' });
  assert.deepEqual(again, { success: true, impressionId: 'imp-3', skipped: true });
  assert.equal(calls.length, 0);

  // Without impression data the impression id is its own key.
  await sdk.createContentImpression('imp-5');
  assert.deepEqual(find(calls, 'POST', '/personal/impression').body, { impressionId: 'imp-5', status: 'opened' });
});

test('gsSDK.getCurrentGeoIPLocation resolves the location and caches it', async () => {
  const location = { country: 'UY', city: 'Montevideo' };
  const calls = api((path, call) => (call.url === 'https://ipapi.co/json' ? location : undefined));
  const sdk = await boot();
  calls.length = 0;

  assert.deepEqual(await sdk.getCurrentGeoIPLocation(), location);
  assert.deepEqual(await sdk.getCurrentGeoIPLocation(), location);

  assert.deepEqual(calls.map((call) => call.url), ['https://ipapi.co/json']);
});

test('gsSDK.trackError prints the error', async () => {
  api();
  const sdk = await boot();
  console.log.mock.resetCalls();
  const failure = new Error('widget failed');

  sdk.trackError(failure);

  assert.deepEqual(console.log.mock.calls.map((call) => call.arguments), [[failure]]);
});

test('gsSDK.sendContentEvent reports the event with the session id', async () => {
  const calls = api();
  const sdk = await boot();
  calls.length = 0;

  sdk.sendContentEvent('target-1', 'variant-b');
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://custom-events.gopersonal.ai/event');
  assert.deepEqual(calls[0].body, { key: 'target-1', value: 'variant-b', customer: 'session-1' });
});

test('gsSDK.invalidateContentCache drops the cached content answers', async () => {
  api();
  const sdk = await boot();
  localStorage.setItem('gs_content_post_cache', JSON.stringify({ 'c1::Home::::': { data: {}, ts: Date.now() } }));

  sdk.invalidateContentCache();

  assert.equal(localStorage.getItem('gs_content_post_cache'), null);
});

test('gsSDK.track queues events and flushEvents sends them', async () => {
  page({ url: 'https://shop.example/search?q=compu' });
  const calls = api();
  const sdk = await boot({ context: { pageType: 'search' } });
  calls.length = 0;

  sdk.track('ac_click', { column: 'marcas', pos: 1 }, { content: 'content-1', variant: 'variant-1' });
  sdk.track('ac_open');
  assert.equal(calls.length, 0, 'events wait for the next flush');
  sdk.flushEvents();
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://events.gopersonal.ai/events');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.token, 'token-1');
  assert.equal(calls[0].body.vuuid, localStorage.getItem('gs_vuuid'));
  const events = calls[0].body.events.map(({ id, ts, ...event }) => event);
  assert.deepEqual(events, [
    { event: 'ac_click', content: 'content-1', variant: 'variant-1', page_type: 'search', url: 'https://shop.example/search?q=compu', props: { column: 'marcas', pos: 1 } },
    { event: 'ac_open', page_type: 'search', url: 'https://shop.example/search?q=compu', props: {} },
  ]);

  sdk.flushEvents();
  await flush();
  assert.equal(calls.length, 1, 'nothing left to send');
});

test('gsSDK.mountShopper mounts the Personal Shopper launcher', async () => {
  api();
  const sdk = await boot();

  assert.throws(() => sdk.mountShopper({ widgetUrl: 'http://widget.example/app' }), /shopper widgetUrl must use HTTPS/);

  const shopper = sdk.mountShopper({ widgetUrl: 'https://widget.example/app' });
  const panel = document.querySelector('section[aria-label="Personal Shopper"]');
  const launcher = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Personal Shopper'));
  assert.ok(panel);
  assert.equal(panel.hidden, true);
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');

  shopper.destroy();
  assert.equal(document.querySelector('section[aria-label="Personal Shopper"]'), null);
  assert.equal(launcher.isConnected, false);
});

// ---------------------------------------------------------------------------
// Public API: GA4 helpers
// ---------------------------------------------------------------------------

test('gsSDK GA4 list helpers push ecommerce events to the dataLayer', async () => {
  api();
  const sdk = await boot();
  window.dataLayer = [];

  sdk.trackGopersonalProductImpression([ITEM], 'Home');
  sdk.trackGopersonalProductClick(ITEM, 'Home', 2);
  sdk.trackGopersonalSearchResults([ITEM]);
  sdk.trackGopersonalSearchResultClick(ITEM);

  assert.deepEqual(window.dataLayer, [
    { event: 'view_item_list', ecommerce: { item_list_name: 'Gopersonal - Home', items: [{ ...GA_ITEM, index: 1, item_list_name: 'Home' }] } },
    { event: 'select_item', ecommerce: { item_list_name: 'Gopersonal - Home', items: [{ ...GA_ITEM, index: 3, item_list_name: 'Home' }] } },
    { event: 'view_item_list', ecommerce: { item_list_name: 'Gopersonal - Search Results', items: [{ ...GA_ITEM, index: 1, item_list_name: 'Gopersonal - Search Results' }] } },
    { event: 'select_item', ecommerce: { item_list_name: 'Gopersonal - Search Results', items: [{ ...GA_ITEM, index: 1, item_list_name: 'Gopersonal - Search Results' }] } },
  ]);
});

test('gsSDK GA4 banner helpers push promotion events to the dataLayer', async () => {
  api();
  const sdk = await boot();
  window.dataLayer = [];

  sdk.trackGopersonalBannerImpression([{ promotion_id: 'b1' }, { promotion_id: 'b2', creative_slot: 'hero' }]);
  sdk.trackGopersonalBannerClick({ promotion_id: 'b1', promotion_name: 'Sale' });

  assert.deepEqual(window.dataLayer, [
    {
      event: 'view_promotion',
      ecommerce: { promotions: [{ promotion_id: 'b1', creative_slot: 'gopersonal_slot' }, { promotion_id: 'b2', creative_slot: 'hero' }] },
    },
    {
      event: 'select_promotion',
      ecommerce: { promotions: [{ promotion_id: 'b1', promotion_name: 'Sale', creative_slot: 'gopersonal_slot' }] },
    },
  ]);
});

test('gsSDK GA4 search and custom helpers push plain events to the dataLayer', async () => {
  api();
  const sdk = await boot();
  window.dataLayer = [];

  sdk.trackGopersonalSearch('tv', 12, 'text', 'search-1', false);
  sdk.trackGopersonalCustomEvent('gp_widget_open', { widget: 'reco' });
  sdk.trackGopersonalToDataLayer({ event: 'raw', anything: 1 });

  assert.deepEqual(window.dataLayer, [
    { event: 'search', search_query: 'tv', search_results_count: 12, search_type: 'text', search_id: 'search-1', occasion_search: false },
    { event: 'gp_widget_open', widget: 'reco' },
    { event: 'raw', anything: 1 },
  ]);
});

test('gsSDK.trackGopersonalProductAddToCart looks the product up and pushes add_to_cart', async () => {
  const calls = api((path) => (path === '/item/p1' ? ITEM : undefined));
  const sdk = await boot();
  window.dataLayer = [];
  calls.length = 0;

  await sdk.trackGopersonalProductAddToCart('p1', 'Home');

  assert.ok(find(calls, 'GET', '/item/p1'));
  assert.deepEqual(window.dataLayer, [
    { event: 'add_to_cart', ecommerce: { item_list_name: 'Gopersonal - Home', items: [{ ...GA_ITEM, index: 1, item_list_name: 'Home' }] } },
  ]);
});

test('gsSDK.parseItemsForGA4 maps products to GA4 items', async () => {
  api();
  const sdk = await boot();

  assert.deepEqual(sdk.parseItemsForGA4([ITEM, { id: 'p2', price: 5 }], 'Home'), [
    { ...GA_ITEM, index: 1, item_list_name: 'Home' },
    {
      item_id: 'p2', item_sku: '', item_sku_list: [], item_parent_id: '', item_name: '', price: 5,
      item_category: '', item_brand: '', index: 2, item_list_name: 'Home', quantity: 1,
    },
  ]);
  assert.deepEqual(sdk.parseItemsForGA4('not a list', 'Home'), []);
});

test('every method of the public API is exercised by this file', async () => {
  api();
  const sdk = await boot();
  const covered = new Set([
    ...REQUESTS.map(([name]) => name),
    'logout', 'getSession', 'getCurrentSession', 'reorderCategories', 'getLastInteraction', 'addBulkInteractions',
    'getCart', 'onCartChange', 'orderMenu', 'imageSearch', 'voiceSearch', 'uploadImage', 'loadPlugin',
    'getItemsByIds', 'getItemsByParentIds', 'getFenicioCards', 'recommendationByContex', 'getContent',
    'getContentByContext', 'clearSharedSession', 'setSharedToken', 'getSharedToken', 'observeElementInView',
    'openImpressionContent', 'createContentImpression', 'getContentImpressionId', 'getSeenContents',
    'getCurrentGeoIPLocation', 'trackError', 'sendContentEvent', 'invalidateContentCache', 'track', 'flushEvents',
    'mountShopper', 'trackGopersonalProductImpression', 'trackGopersonalProductClick', 'trackGopersonalSearchResults',
    'trackGopersonalSearchResultClick', 'trackGopersonalBannerImpression', 'trackGopersonalBannerClick',
    'trackGopersonalSearch', 'trackGopersonalCustomEvent', 'trackGopersonalToDataLayer',
    'trackGopersonalProductAddToCart', 'parseItemsForGA4',
  ]);

  assert.deepEqual(Object.keys(sdk).filter((name) => !covered.has(name)), []);
});
