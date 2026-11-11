import assert from 'node:assert/strict';
import test, { afterEach, before, beforeEach, mock } from 'node:test';
import {
  resetDom,
  setUrl,
  mockFetch,
  jsonResponse,
  seedSession,
  flush,
  waitFor,
  FakeIntersectionObserver,
} from './helpers/env.mjs';
import {
  getContentByContext,
  getContent,
  openImpression,
  createContentImpression,
  getContentImpressionId,
  clickContentImpression,
  trackURLClicked,
  observeElementInView,
  cleanContent,
  sendContentEvent,
  initPreviewListener,
  invalidateContentCache,
  purgeContentCache,
  getSeenContents,
} from '../../src/api/content.js';

const API = 'https://go-discover-dev.goshops.ai';
const HOUR = 3600 * 1000;
const POST_CACHE_KEY = 'gs_content_post_cache';

const overridden = [];

/** Overrides a property on a DOM object until the end of the test. */
function override(target, name, value) {
  Object.defineProperty(target, name, { configurable: true, get: () => value });
  overridden.push([target, name]);
}

const useMobileDevice = () =>
  override(window.navigator, 'userAgent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');

/** Lets the 0ms timers of utils/dom.js (css, html, scripts) run. */
const settle = async (ms = 10) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await flush();
};

/** With mock timers on: moves the clock and lets the chained 0ms timers run. */
const advance = async (ms) => {
  mock.timers.tick(ms);
  for (let i = 0; i < 3; i++) {
    await flush(2);
    mock.timers.tick(1);
  }
  await flush(2);
};

const silence = (method) => mock.method(console, method, () => {});
const failure = (status = 500) => jsonResponse({}, { status });
const pathOf = (url) => url.replace(API, '');
const paths = (calls) => calls.map((call) => `${call.method} ${pathOf(call.url)}`);

const webContent = (key, extra = {}) => ({
  key,
  type: 'web',
  selector: '#slot',
  experienceId: `exp-${key}`,
  contentValue: { html: `<div id="html-${key}">${key}</div>`, css: '', js: '' },
  ...extra,
});

const popup = (key, extra = {}) => ({
  key,
  type: 'pop_up',
  experienceId: `exp-${key}`,
  contentValue: { html: `<div id="pop-${key}">${key}</div>`, css: '', js: '' },
  ...extra,
});

const pageOf = (loadNowContent = [], lazyLoadContent = []) => ({ loadNowContent, lazyLoadContent });

/** Key of a lazy content requested through POST /personal/content/<key>. */
const contentKeyOf = (url) => (url.match(/\/personal\/content\/([^/?]+)/) || [])[1];

const contextCacheKey = (context, scope) =>
  `gs_content_cache_${context}_${scope}_${encodeURIComponent(window.location.href)}`;

before(() => {
  // One listener for the whole file: every call adds another one.
  initPreviewListener();
});

beforeEach(() => {
  resetDom();
  seedSession();
  document.body.innerHTML = '<div id="slot"></div>';
});

afterEach(async () => {
  mock.timers.reset();
  mock.restoreAll();
  for (const [target, name] of overridden.splice(0)) {
    delete target[name];
  }
  // Nothing injected by a test may land on the next one.
  await settle(5);
  for (const stray of [...document.documentElement.children]) {
    if (stray !== document.head && stray !== document.body) stray.remove();
  }
});

// ---------------------------------------------------------------------------
// getContentByContext: where the page is requested from
// ---------------------------------------------------------------------------

test('getContentByContext asks the public cached page of the project and injects its contents', async () => {
  const calls = mockFetch(() => pageOf([
    webContent('hero', {
      contentValue: {
        html: '<b id="hero-html">Hi</b>',
        css: '.hero { color: red; }',
        js: 'window.__gsHeroRan = (window.__gsHeroRan || 0) + 1;',
      },
    }),
  ]));

  const result = await getContentByContext('Home');
  await waitFor(() => window.__gsHeroRan === 1);

  assert.equal(result, undefined);
  assert.deepEqual(paths(calls), ['GET /public/cached-content/project-1/?pageType=Home']);
  assert.deepEqual(calls[0].headers, {}, 'public request: no auth header');
  assert.equal(document.getElementById('slot').innerHTML, '<b id="hero-html">Hi</b>');
  assert.equal(document.getElementById('gopersonal-style-hero').textContent, '.hero { color: red; }');
  assert.ok(document.getElementById('gopersonal-script-hero'));
  assert.deepEqual(getSeenContents(), ['exp-hero']);
  assert.equal(window.__gsLastContentContext.context, 'Home');
  assert.equal(window.__gsLastContentContext.url, 'https://shop.example/');
});

test('getContentByContext does nothing without a session', async () => {
  localStorage.clear();
  const log = silence('log');
  const calls = mockFetch();

  assert.equal(await getContentByContext('Home'), undefined);

  assert.equal(calls.length, 0);
  assert.deepEqual(log.mock.calls[0].arguments, ['No session or project found']);
});

test('getContentByContext skips the projects that only load content when forced', async () => {
  seedSession({ project: '67374d510dfcc232a627662e' });
  const calls = mockFetch(() => pageOf());

  await getContentByContext('Home');
  assert.equal(calls.length, 0);

  await getContentByContext('Home', { force: true });
  assert.deepEqual(paths(calls), ['GET /public/cached-content/67374d510dfcc232a627662e/?pageType=Home']);
});

test('getContentByContext falls back to the personalized POST when the cached page fails', async () => {
  const errors = silence('error');
  const calls = mockFetch((url, init) => {
    if (init.method === 'POST') return pageOf([webContent('fallback')]);
    return failure(503);
  });

  await getContentByContext('Category', { category_id: 'cat-1' });
  await waitFor(() => document.getElementById('html-fallback'));

  assert.deepEqual(paths(calls), [
    'GET /public/cached-content/project-1/?pageType=Category',
    'POST /personal/content-page?pageType=Category',
  ]);
  assert.equal(calls[1].headers.Authorization, 'Bearer token-1');
  const { context } = calls[1].body;
  assert.deepEqual(context.currentPage, {
    category_id: 'cat-1',
    type: 'Category',
    provider: null,
    location: 'https://shop.example/',
    referrer: '',
  });
  assert.deepEqual(context.seenContents, []);
  assert.equal(typeof context.screen.width, 'number');
  assert.equal(typeof context.settings.timezoneOffset, 'number');
  assert.equal(context.settings.locale, navigator.language);
  assert.equal(errors.mock.calls[0].arguments[0], 'Error fetching cached content:');

  const cached = JSON.parse(localStorage.getItem(contextCacheKey('Category', false)));
  assert.equal(cached.data.loadNowContent[0].key, 'fallback');
});

test('getContentByContext with gsDebug requests the personalized page and sends the network info', async () => {
  setUrl('https://shop.example/?gsDebug=true');
  override(window.navigator, 'connection', { downlink: 8.5, effectiveType: '4g' });
  window.gsConfig.options.provider = 'VTEX';
  const calls = mockFetch(() => pageOf());

  await getContentByContext('Home');

  assert.deepEqual(paths(calls), ['POST /personal/content-page?pageType=Home']);
  assert.deepEqual(calls[0].body.context.network, { downlink: 8.5, effectiveType: '4g' });
  assert.equal(calls[0].body.context.currentPage.provider, 'VTEX');
});

test('the personalized page is reused from storage for 5 seconds', async () => {
  setUrl('https://shop.example/?gsDebug=true');
  const calls = mockFetch(() => pageOf([webContent('fresh-cache')]));

  await getContentByContext('Home');
  await getContentByContext('Home');
  await waitFor(() => document.getElementById('html-fresh-cache'));

  assert.equal(calls.length, 1);
});

test('a stale personalized page is served once more while it is refreshed in the background', async () => {
  setUrl('https://shop.example/?gsDebug=true');
  const key = contextCacheKey('Home', false);
  localStorage.setItem(key, JSON.stringify({ data: pageOf([webContent('stale')]), timestamp: Date.now() - 6000 }));
  const calls = mockFetch(() => pageOf([webContent('refreshed')]));

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('html-stale'));
  await waitFor(() => JSON.parse(localStorage.getItem(key)).data.loadNowContent[0].key === 'refreshed');

  assert.deepEqual(paths(calls), ['POST /personal/content-page?pageType=Home']);
  assert.equal(document.getElementById('html-refreshed'), null, 'this load still shows the stale page');
  assert.ok(Date.now() - JSON.parse(localStorage.getItem(key)).timestamp < 5000);
});

test('a failed background refresh keeps the stale page in storage', async () => {
  setUrl('https://shop.example/?gsDebug=true');
  const errors = silence('error');
  const key = contextCacheKey('Home', false);
  const stale = JSON.stringify({ data: pageOf([webContent('kept')]), timestamp: 1 });
  localStorage.setItem(key, stale);
  mockFetch(() => failure());

  await getContentByContext('Home');
  await waitFor(() => errors.mock.callCount() > 0);

  assert.equal(errors.mock.calls[0].arguments[0], 'Error updating cached content:');
  assert.equal(localStorage.getItem(key), stale);
});

test('getContentByContext asks for drafts with gsIncludeDraft or gsConfig.includeDraft', async () => {
  setUrl('https://shop.example/?gsIncludeDraft=true');
  const calls = mockFetch(() => pageOf([], [{ key: 'lazy-draft' }]));

  await getContentByContext('Home');

  assert.deepEqual(paths(calls), [
    'POST /personal/content-page?pageType=Home&includeDraft=true',
    // The lazy content is rendered by the server, in draft.
    'POST /personal/content/lazy-draft?includeDraft=true&project=project-1',
  ]);
  assert.ok(localStorage.getItem(contextCacheKey('Home', 'all')));

  setUrl('https://shop.example/other');
  window.gsConfig.includeDraft = true;
  calls.length = 0;
  await getContentByContext('Home');
  assert.equal(pathOf(calls[0].url), '/personal/content-page?pageType=Home&includeDraft=true');
});

test('gsDraftContentId shows only that content in draft and the rest of the page published', async () => {
  // The admin preview URL sends both params: the id wins.
  setUrl('https://shop.example/?gsIncludeDraft=true&gsDraftContentId=draft-1');
  const calls = mockFetch((url, init) => {
    if (url.includes('/personal/content-page')) {
      return pageOf(
        [webContent('draft-1', { selector: '#slot' }), webContent('published', { selector: '#other' })],
        [{ key: 'lazy-x', experienceId: 'draft-1' }, { key: 'lazy-y' }],
      );
    }
    if (contentKeyOf(url) === 'draft-1') {
      return webContent('draft-1', { contentValue: { html: '<i id="draft-version">draft</i>', css: '', js: '' } });
    }
    return { data: {} };
  });
  document.body.innerHTML = '<div id="slot"></div><div id="other"></div>';

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('draft-version'));
  await waitFor(() => document.getElementById('html-published'));

  assert.deepEqual(paths(calls), [
    'POST /personal/content-page?pageType=Home',
    'POST /personal/content/lazy-y?project=project-1&onlyData=true',
    'POST /personal/content/draft-1?includeDraft=true&project=project-1',
  ]);
  assert.equal(document.getElementById('html-draft-1'), null, 'the published version of the draft target is left out');
  assert.ok(localStorage.getItem(contextCacheKey('Home', 'draft-1')));
});

test('gsConfig.draftContentId works like the gsDraftContentId param and survives a failing draft', async () => {
  window.gsConfig.draftContentId = 'draft-2';
  const errors = silence('error');
  const calls = mockFetch((url) => {
    if (url.includes('/personal/content-page')) return {};
    return failure();
  });

  await getContentByContext('Home');

  assert.deepEqual(paths(calls), [
    'POST /personal/content-page?pageType=Home',
    'POST /personal/content/draft-2?includeDraft=true&project=project-1',
  ]);
  assert.match(errors.mock.calls[0].arguments[0].message, /POST request failed: 500/);
});

test('gsVariantId forces a variant: it travels on every request and skips the cached routes', async () => {
  setUrl('https://shop.example/?gsVariantId=var%207');
  const calls = mockFetch((url) => {
    if (url.includes('/personal/content-page')) return pageOf([], [{ key: 'lazy-v', cache: 1 }]);
    if (url.includes('/variant/')) {
      return { variant: { templateValue: { html: '<u id="forced">forced</u>' } }, selector: '#slot' };
    }
    return { data: { variantId: 'forced-variant-1' } };
  });

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('forced'));

  assert.deepEqual(paths(calls), [
    'POST /personal/content-page?pageType=Home&variantId=var%207',
    'POST /personal/content/lazy-v?variantId=var+7&project=project-1&onlyData=true',
    'GET /public/cached-content/project-1/variant/forced-variant-1',
  ]);
  assert.ok(localStorage.getItem(contextCacheKey('Home', 'false_var 7')));
  assert.equal(localStorage.getItem(POST_CACHE_KEY), null, 'forced variants are not kept in the POST cache');
});

// ---------------------------------------------------------------------------
// getContentByContext: duplicated calls
// ---------------------------------------------------------------------------

/** Fetch that stays pending until release() is called. */
function heldPage() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = mockFetch(async () => {
    await gate;
    return pageOf();
  });
  return { calls, release };
}

test('an identical getContentByContext call reuses the one in flight', async () => {
  const { calls, release } = heldPage();
  setUrl('https://shop.example/list');

  const first = getContentByContext('Category');
  // VTEX IO fires a second pageView when the URL becomes ?page=1.
  setUrl('https://shop.example/list?page=1');
  const second = getContentByContext('Category');

  assert.equal(second, first);
  release();
  await first;
  assert.equal(calls.length, 1);

  // Once it finished, the same call loads the page again.
  const third = getContentByContext('Category');
  assert.notEqual(third, first);
  await third;
  assert.equal(calls.length, 2);
});

test('a duplicated call that reuses the same options object is deduplicated too', async () => {
  const { calls, release } = heldPage();
  setUrl('https://shop.example/reused');

  // The load writes `type` into the object it receives; that must not change the key.
  const options = { singlePage: true };
  const first = getContentByContext('Category', options);
  const second = getContentByContext('Category', options);

  assert.equal(second, first);
  release();
  await first;
  assert.equal(calls.length, 1);
});

test('calls with another context, other options or another path are not deduplicated', async () => {
  const { calls, release } = heldPage();

  const requests = [
    getContentByContext('Home'),
    getContentByContext('Product'),
    getContentByContext('Product', { product_id: 'p-1' }),
  ];
  setUrl('https://shop.example/other');
  requests.push(getContentByContext('Product', { product_id: 'p-1' }));

  assert.equal(new Set(requests).size, 4);
  release();
  await Promise.all(requests);
  assert.equal(calls.length, 4);
});

test('a repeated call is not reused once the 500ms window has passed', async () => {
  mock.timers.enable({ apis: ['Date'] });
  const { calls, release } = heldPage();

  const first = getContentByContext('Home');
  mock.timers.tick(499);
  assert.equal(getContentByContext('Home'), first);
  mock.timers.tick(2);
  const late = getContentByContext('Home');
  assert.notEqual(late, first);

  release();
  await Promise.all([first, late]);
  assert.equal(calls.length, 2);
});

test('options that cannot be serialized are never deduplicated', async () => {
  const { calls, release } = heldPage();
  const options = {};
  options.self = options;

  const first = getContentByContext('Home', options);
  const second = getContentByContext('Home', options);

  assert.notEqual(second, first);
  release();
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
});

// ---------------------------------------------------------------------------
// getContentByContext: scheduling, single page, lazy contents
// ---------------------------------------------------------------------------

test('contents outside their publishAt / publishUntil range are skipped', async () => {
  const future = new Date(Date.now() + HOUR).toISOString();
  const past = new Date(Date.now() - HOUR).toISOString();
  document.body.innerHTML = ['a', 'b', 'c', 'd', 'e'].map((id) => `<div id="slot-${id}"></div>`).join('');
  const calls = mockFetch((url) => {
    if (url.includes('pageType=')) {
      return pageOf(
        [
          webContent('not-yet', { selector: '#slot-a', publishAt: future }),
          webContent('expired', { selector: '#slot-b', publishUntil: past }),
          webContent('running', { selector: '#slot-c', publishAt: past, publishUntil: future }),
          webContent('bad-date', { selector: '#slot-d', publishAt: 'whenever' }),
          webContent('no-dates', { selector: '#slot-e', publishAt: null, publishUntil: null }),
        ],
        [
          { key: 'lazy-not-yet', publishAt: future },
          { key: 'lazy-running', publishUntil: future },
        ],
      );
    }
    return { data: {} };
  });

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('html-no-dates'));

  assert.equal(document.getElementById('html-not-yet'), null);
  assert.equal(document.getElementById('html-expired'), null);
  assert.ok(document.getElementById('html-running'));
  assert.ok(document.getElementById('html-bad-date'));
  assert.deepEqual(paths(calls).slice(1), ['POST /personal/content/lazy-running?project=project-1&onlyData=true']);
});

test('singlePage removes the contents and pending triggers of the previous page', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  mockFetch((url) => {
    if (url.includes('pageType=')) return pageOf();
    return popup('previous-page', { trigger: { id: 'wait', value: 2 } });
  });
  await getContent('previous-page', { cache: 1 });
  document.body.insertAdjacentHTML('beforeend', '<div id="old-content" data-gopersonal="true"></div>');
  document.head.insertAdjacentHTML('beforeend', '<style id="gopersonal-style-old"></style><style id="theme"></style>');

  await getContentByContext('Home', { singlePage: true });

  assert.equal(document.getElementById('old-content'), null);
  assert.equal(document.getElementById('gopersonal-style-old'), null);
  assert.ok(document.getElementById('theme'), 'styles of the host page are kept');
  await advance(2000);
  assert.equal(document.getElementById('pop-previous-page'), null, 'the popup waiting on the previous page never shows');
});

test('lazy contents are requested with the page options, from the cached route when they allow it', async () => {
  const calls = mockFetch((url) => {
    if (url.includes('pageType=')) return pageOf([], [{ key: 'lazy-cached', cache: 1 }, { key: 'lazy-personal' }]);
    if (url.endsWith('/lazy-cached')) return webContent('lazy-cached');
    return { data: {} };
  });

  await getContentByContext('Product', { product_id: 'sku-1' });
  await waitFor(() => document.getElementById('html-lazy-cached'));

  assert.deepEqual(paths(calls).slice(1), [
    'GET /public/cached-content/project-1/lazy-cached',
    'POST /personal/content/lazy-personal?project=project-1&onlyData=true',
  ]);
  assert.equal(calls[2].body.context.currentPage.type, 'Product');
  assert.equal(calls[2].body.context.currentPage.product_id, 'sku-1');
  assert.equal(calls[2].body.context.currentPage.cache, 0);
});

/** Page whose lazy contents answer when the test decides. */
function lazyPage(lazyLoadContent, { failing = [] } = {}) {
  const order = [];
  const releases = {};
  mockFetch((url) => {
    if (url.includes('pageType=')) return pageOf([], lazyLoadContent);
    const key = contentKeyOf(url);
    order.push(key);
    return new Promise((resolve) => {
      releases[key] = () => resolve(failing.includes(key) ? failure() : { data: {} });
    });
  });
  const requested = (count) => waitFor(() => order.length >= count);
  return { order, releases, requested };
}

test('lazy contents without priorities, or all with the same one, load in parallel', async () => {
  const { order, releases, requested } = lazyPage([
    { key: 'a', priority: 1 },
    { key: 'b', priority: '1' },
    { key: 'c' },
    { key: 'd', priority: 'high' },
  ]);

  const request = getContentByContext('Home');
  await requested(4);
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);

  Object.values(releases).forEach((release) => release());
  await request;
});

test('lazy contents with different priorities load in order, one group at a time', async () => {
  const { order, releases, requested } = lazyPage([
    { key: 'second-a', priority: 2 },
    { key: 'first', priority: '1' },
    { key: 'free' },
    { key: 'second-b', priority: 2 },
    { key: 'third', priority: 10 },
  ]);

  const request = getContentByContext('Home');
  await requested(2);
  await flush();
  // Without priority it does not wait; the lowest priority goes first.
  assert.deepEqual(order, ['free', 'first']);

  releases.first();
  await requested(4);
  await flush();
  assert.deepEqual(order, ['free', 'first', 'second-a', 'second-b']);

  // The group has to finish completely before the next one starts.
  releases['second-a']();
  await flush();
  assert.equal(order.length, 4);
  releases['second-b']();
  await requested(5);
  assert.equal(order[4], 'third');

  let finished = false;
  request.then(() => { finished = true; });
  releases.third();
  await flush();
  assert.equal(finished, false, 'still waits for the content without priority');
  releases.free();
  await request;
});

test('a failing content does not stop the priority chain', async () => {
  const errors = silence('error');
  const { order, releases, requested } = lazyPage(
    [{ key: 'first', priority: 1 }, { key: 'second', priority: 2 }, { key: 'free' }],
    { failing: ['first', 'free'] },
  );

  const request = getContentByContext('Home');
  await requested(2);
  releases.free();
  releases.first();
  await requested(3);
  assert.deepEqual(order, ['free', 'first', 'second']);
  releases.second();
  await request;

  assert.equal(errors.mock.callCount(), 2);
  for (const call of errors.mock.calls) {
    assert.match(call.arguments[0].message, /POST request failed: 500/);
  }
});

test('getContentByContext resolves even if a lazy content fails', async () => {
  const errors = silence('error');
  mockFetch((url) => {
    if (url.includes('pageType=')) return pageOf([webContent('now')], [{ key: 'broken' }]);
    return failure();
  });

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('html-now'));

  assert.match(errors.mock.calls[0].arguments[0].message, /POST request failed: 500/);
});

// ---------------------------------------------------------------------------
// getContent: which request is made
// ---------------------------------------------------------------------------

test('getContent does nothing while the element selector picker is open', async () => {
  setUrl('https://shop.example/?gsElementSelector=1');
  const calls = mockFetch(() => webContent('picker'));

  assert.equal(await getContent('picker', { cache: 1 }), undefined);
  await settle();

  assert.equal(calls.length, 0);
  assert.equal(document.getElementById('html-picker'), null);
});

test('getContent with cache reads the public cached content and injects it', async () => {
  const calls = mockFetch(() => {
    const { key, ...content } = webContent('cached-1');
    return content;
  });

  const result = await getContent('cached-1', { cache: 1 });
  await waitFor(() => document.getElementById('html-cached-1'));

  assert.equal(result, undefined, 'only API contents are returned');
  assert.deepEqual(paths(calls), ['GET /public/cached-content/project-1/cached-1']);
  assert.deepEqual(getSeenContents(), ['exp-cached-1']);
});

test('getContent returns the content when its type is API', async () => {
  mockFetch(() => ({ type: 'API', payload: { banner: 'summer' } }));

  const result = await getContent('api-1', { cache: 1 });

  assert.deepEqual(result, { type: 'API', payload: { banner: 'summer' }, key: 'api-1' });
});

test('getContent with gsPreviewVariant asks for that variant', async () => {
  setUrl('https://shop.example/?gsPreviewVariant=variant-9');
  const calls = mockFetch(() => webContent('previewed'));

  await getContent('previewed');
  await waitFor(() => document.getElementById('html-previewed'));

  assert.deepEqual(paths(calls), ['GET /personal/content/previewed/variant/variant-9']);
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');
});

test('getContent in draft mode gets the content rendered by the server', async () => {
  window.gsConfig.includeDraft = true;
  const calls = mockFetch(() => webContent('server-draft'));

  await getContent('server-draft', { impressionStatus: 'opened' });
  await waitFor(() => document.getElementById('html-server-draft'));

  assert.deepEqual(paths(calls), [
    'POST /personal/content/server-draft?includeDraft=true&impressionStatus=opened&project=project-1',
  ]);
  assert.equal(calls[0].body.context.currentPage.type, 'Home', 'type defaults to Home');
});

test('getContent with gsDebug gets the published content rendered by the server, never from cache', async () => {
  setUrl('https://shop.example/?gsDebug=true');
  const calls = mockFetch(() => webContent('debugged'));

  await getContent('debugged', { cache: 1 });
  await waitFor(() => document.getElementById('html-debugged'));

  assert.deepEqual(paths(calls), ['POST /personal/content/debugged?project=project-1']);
});

test('getContent waits for the delay of the content before injecting it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  mockFetch(() => webContent('delayed', { delay: 3000 }));

  let finished = false;
  const request = getContent('delayed', { cache: 1 }).then(() => { finished = true; });
  await flush();
  mock.timers.tick(2999);
  await flush();
  assert.equal(finished, false);
  assert.equal(document.getElementById('html-delayed'), null);

  mock.timers.tick(1);
  await request;
  await advance(1);
  assert.ok(document.getElementById('html-delayed'));
});

test('getContent skips a content that is outside its schedule', async () => {
  mockFetch(() => webContent('scheduled', { publishAt: new Date(Date.now() + HOUR).toISOString() }));

  assert.equal(await getContent('scheduled', { cache: 1 }), undefined);
  await settle();

  assert.equal(document.getElementById('html-scheduled'), null);
  assert.deepEqual(getSeenContents(), []);
});

// ---------------------------------------------------------------------------
// getContent: client side render (data + variant template)
// ---------------------------------------------------------------------------

/** API of a content rendered on the client: POST gives the data, GET the template. */
function clientRenderApi({ data, template, templateStatus = () => 200 }) {
  return mockFetch((url, init) => {
    if (init.method === 'POST') return { data: typeof data === 'function' ? data() : data };
    const status = templateStatus();
    return status === 200 ? template : failure(status);
  });
}

test('getContent renders the variant template with the data of the visitor', async () => {
  const calls = clientRenderApi({
    data: {
      variantId: 'variant-render-1',
      project: 'project-data',
      contentName: 'Welcome banner',
      impressionId: 'imp-1',
      session: { name: 'Ana' },
    },
    template: {
      contentKey: 'welcome',
      selector: '#slot',
      selectorPosition: null,
      type: 'web',
      experienceId: 'exp-welcome',
      variant: {
        templateValue: {
          html: '<p id="welcome-html" data-imp="{{impressionId}}">{{greeting}} {{session.name}}</p>',
          css: '.welcome { color: {{color}}; }',
          js: 'window.__gsWelcome = "{{gs_contentName}}|{{gs_variantId}}";',
          variables: [
            { name: 'greeting', type: { id: 'text' }, value: 'Hello' },
            { name: 'color', type: { id: 'color' }, value: 'blue' },
          ],
        },
      },
    },
  });

  const result = await getContent('content-render-1', { type: 'Product' });
  await waitFor(() => window.__gsWelcome);

  assert.equal(result, undefined);
  assert.deepEqual(paths(calls), [
    'POST /personal/content/content-render-1?project=project-1&onlyData=true',
    'GET /public/cached-content/project-data/variant/variant-render-1',
  ]);
  assert.equal(calls[0].body.context.currentPage.type, 'Product');
  assert.equal(document.getElementById('slot').innerHTML, '<p id="welcome-html" data-imp="imp-1">Hello Ana</p>');
  // The key of the template response names the injected elements.
  assert.equal(document.getElementById('gopersonal-style-welcome').textContent, '.welcome { color: blue; }');
  assert.equal(window.__gsWelcome, 'Welcome banner|variant-render-1');
  assert.deepEqual(getSeenContents(), ['exp-welcome']);
});

test('getContent injects nothing when the template of the variant is empty', async () => {
  clientRenderApi({
    data: { variantId: 'variant-empty-1' },
    template: { selector: '#slot', experienceId: 'exp-empty', variant: { templateValue: {} } },
  });

  await getContent('content-empty-1');
  await settle();

  assert.equal(document.getElementById('slot').innerHTML, '');
  assert.deepEqual(getSeenContents(), [], 'an empty content does not count as seen');
});

test('getContent stops when the visitor gets no variant', async () => {
  const calls = clientRenderApi({ data: { reason: 'no audience' }, template: {} });

  assert.equal(await getContent('content-no-variant'), undefined);

  assert.equal(calls.length, 1, 'the template is not requested');
  assert.equal(localStorage.getItem(POST_CACHE_KEY), null);
});

test('getContent does not request the template of a variant outside its schedule', async () => {
  const calls = clientRenderApi({
    data: { variantId: 'variant-scheduled-1', publishUntil: new Date(Date.now() - HOUR).toISOString() },
    template: {},
  });

  assert.equal(await getContent('content-scheduled-1'), undefined);

  assert.equal(calls.length, 1);
});

test('the data of a content is cached until a new content is seen; the template is reused in memory', async () => {
  const calls = clientRenderApi({
    data: { variantId: 'variant-cache-1' },
    template: {
      selector: '#slot',
      experienceId: 'exp-cache-1',
      variant: { templateValue: { html: '<p id="cache-html">cached</p>' } },
    },
  });
  const posts = () => calls.filter((call) => call.method === 'POST');
  const templates = () => calls.filter((call) => call.method === 'GET');

  await getContent('content-cache-1');
  assert.equal(posts().length, 1);
  assert.deepEqual(posts()[0].body.context.seenContents, []);

  // The first render marked the content as seen, which invalidates the cached
  // decisions: the second request goes out with the new list.
  await getContent('content-cache-1');
  assert.equal(posts().length, 2);
  assert.deepEqual(posts()[1].body.context.seenContents, ['exp-cache-1']);
  const cache = JSON.parse(localStorage.getItem(POST_CACHE_KEY));
  assert.deepEqual(Object.keys(cache), ['content-cache-1::Home::::::']);
  assert.equal(cache['content-cache-1::Home::::::'].data.variantId, 'variant-cache-1');

  await getContent('content-cache-1');
  assert.equal(posts().length, 2, 'served from the POST cache');

  // Another page type is another cache entry.
  await getContent('content-cache-1', { type: 'Product' });
  assert.equal(posts().length, 3);

  assert.equal(templates().length, 1, 'the template was downloaded once');
  await waitFor(() => document.getElementById('cache-html'));
});

test('a response with cache: false is never stored', async () => {
  const calls = clientRenderApi({
    data: { variantId: 'variant-nocache-1', cache: false },
    template: { selector: '#slot', variant: { templateValue: { html: '<p>customer data</p>' } } },
  });

  await getContent('content-nocache-1');
  await getContent('content-nocache-1');

  assert.equal(calls.filter((call) => call.method === 'POST').length, 2);
  assert.equal(localStorage.getItem(POST_CACHE_KEY), null);
});

test('a failed template download is not remembered', async () => {
  let status = 500;
  const calls = clientRenderApi({
    data: { variantId: 'variant-retry-1' },
    template: { selector: '#slot', variant: { templateValue: { html: '<p id="retry-html">ok</p>' } } },
    templateStatus: () => status,
  });

  await assert.rejects(getContent('content-retry-1'), /GET request failed: 500/);
  status = 200;
  await getContent('content-retry-1');
  await waitFor(() => document.getElementById('retry-html'));

  assert.equal(calls.filter((call) => call.method === 'GET').length, 2);
});

test('Luna stores resolve the product by sku_list instead of product_id', async () => {
  window.gsConfig.options.provider = 'Luna';
  const calls = mockFetch(() => ({ data: {} }));

  await getContent('content-luna', { type: 'Product', product_id: 12345 });

  assert.deepEqual(calls[0].body.context.currentPage, {
    type: 'Product',
    provider: 'Luna',
    location: 'https://shop.example/',
    referrer: '',
    preProcess: { field: 'sku_list', fieldValue: '12345' },
  });
});

test('projects that resolve variants by URL send the page URL and cache per URL', async () => {
  seedSession({ project: '69f9fd15bcb8468256ba4565' });
  setUrl('https://shop.example/p/towel-blue?utm=1');
  const calls = clientRenderApi({
    data: { variantId: 'variant-url-1' },
    template: { selector: '#slot', variant: { templateValue: { html: '<p>towel</p>' } } },
  });

  await getContent('content-url-1', { type: 'Product', product_id: 'parent-1' });

  const { currentPage } = calls[0].body.context;
  assert.equal(currentPage.product_id, 'parent-1', 'product_id stays as fallback');
  assert.deepEqual(currentPage.preProcess, { field: 'url', fieldValue: 'https://shop.example/p/towel-blue' });
  assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(POST_CACHE_KEY))), [
    'content-url-1::Product::::parent-1::https://shop.example/p/towel-blue',
  ]);
});

// ---------------------------------------------------------------------------
// Injection of web contents
// ---------------------------------------------------------------------------

/** Serves `content` on the cached route and loads it. */
async function show(content, options = {}) {
  mockFetch(() => content);
  return getContent(content.key, { cache: 1, ...options });
}

test('web contents are placed inside, before or after their selector', async () => {
  document.body.innerHTML = '<div id="wrap"><div id="in"></div><div id="before"></div><div id="after"></div></div>';

  await show(webContent('inside', { selector: '#in' }));
  await show(webContent('ahead', { selector: '#before', selectorPosition: 'before' }));
  await show(webContent('behind', { selector: '#after', selectorPosition: 'after' }));
  await waitFor(() => document.getElementById('html-behind'));

  assert.equal(document.getElementById('html-inside').parentNode.id, 'in');
  assert.equal(document.getElementById('before').previousElementSibling.id, 'html-ahead');
  assert.equal(document.getElementById('after').nextElementSibling.id, 'html-behind');
});

test('a web content without selector goes after the body', async () => {
  await show(webContent('no-selector', { selector: null, selectorPosition: 'before' }));
  await waitFor(() => document.getElementById('html-no-selector'));

  assert.equal(document.body.nextElementSibling.id, 'html-no-selector');
});

test('the mobile selector is used on mobile devices only', async () => {
  document.body.innerHTML = '<div id="desktop"></div><div id="mobile"></div>';
  const content = (key, mobileSelector) => webContent(key, { selector: '#desktop', mobileSelector });

  await show(content('on-desktop', '#mobile'));
  await waitFor(() => document.getElementById('html-on-desktop'));
  assert.equal(document.getElementById('html-on-desktop').parentNode.id, 'desktop');

  useMobileDevice();
  await show(content('on-mobile', '#mobile'));
  await waitFor(() => document.getElementById('html-on-mobile'));
  assert.equal(document.getElementById('html-on-mobile').parentNode.id, 'mobile');

  for (const [key, empty] of [['mobile-empty', ''], ['mobile-null', null], ['mobile-missing', undefined]]) {
    await show(content(key, empty));
    await waitFor(() => document.getElementById(`html-${key}`));
    assert.equal(document.getElementById(`html-${key}`).parentNode.id, 'desktop');
  }
});

test('contents listed in gsConfig.options.skipContents are not injected', async () => {
  window.gsConfig.options.skipContents = ['skipped'];

  await show(webContent('skipped'));
  await show(webContent('allowed', { selector: '#slot', selectorPosition: 'after' }));
  await waitFor(() => document.getElementById('html-allowed'));

  assert.equal(document.getElementById('html-skipped'), null);
  assert.deepEqual(getSeenContents(), ['exp-allowed']);
});

test('injection waits for DOMContentLoaded while the document is loading', async () => {
  override(document, 'readyState', 'loading');
  await show(webContent('early', { contentValue: { html: '<p id="html-early"></p>', css: '.early {}', js: '' } }));
  await settle();
  assert.equal(document.getElementById('html-early'), null);
  assert.equal(document.getElementById('gopersonal-style-early'), null);

  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await waitFor(() => document.getElementById('html-early'));
  await waitFor(() => document.getElementById('gopersonal-style-early'));
});

// ---------------------------------------------------------------------------
// Popups: triggers and frequency
// ---------------------------------------------------------------------------

const popupScript = (key) =>
  `window.__gsPopup_${key} = document.getElementById('pop-${key}') ? 'html-first' : 'script-first';`;

test('a popup without trigger is added to the body, and its script runs after its HTML', async () => {
  await show(popup('plain', {
    contentValue: { html: '<div id="pop-plain">x</div>', css: '.pop {}', js: popupScript('plain') },
  }));
  await waitFor(() => window.__gsPopup_plain);

  assert.equal(document.getElementById('pop-plain').parentNode, document.body);
  assert.equal(window.__gsPopup_plain, 'html-first');
  assert.ok(document.getElementById('gopersonal-style-plain'));
});

test('custom code and notifications follow their trigger like popups', async () => {
  document.body.innerHTML = '<button id="bell">Bell</button>';
  await show(popup('notice', {
    type: 'notifications',
    trigger: { id: 'click_element', value: '#bell' },
    contentValue: { html: '<div id="pop-notice">x</div>', css: '', js: popupScript('notice') },
  }));
  await show(popup('code', { type: 'custom_code' }));
  await waitFor(() => document.getElementById('pop-code'));
  assert.equal(document.getElementById('pop-notice'), null, 'waits for the click');

  document.getElementById('bell').click();
  await waitFor(() => window.__gsPopup_notice);

  assert.equal(window.__gsPopup_notice, 'html-first');
  assert.ok(document.getElementById('pop-notice'));
});

test('a popup with a wait trigger shows after its delay', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  await show(popup('waiting', { trigger: { id: 'wait', value: 3 } }));

  await advance(2990);
  assert.equal(document.getElementById('pop-waiting'), null);
  await advance(10);
  assert.ok(document.getElementById('pop-waiting'));
});

test('cleanContent removes the injected contents and cancels the popups still waiting', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  await show(popup('cancelled', { trigger: { id: 'wait', value: 3 } }));
  document.body.insertAdjacentHTML('beforeend', '<div id="shown" data-gopersonal="true"></div><p id="host"></p>');
  document.body.insertAdjacentHTML('beforeend', '<script id="gopersonal-script-shown" type="text/plain"></script>');

  cleanContent();

  assert.equal(document.getElementById('shown'), null);
  assert.equal(document.getElementById('gopersonal-script-shown'), null);
  assert.ok(document.getElementById('host'));
  await advance(3000);
  assert.equal(document.getElementById('pop-cancelled'), null);
});

test('a popup marked as not automatic only shows when forced', async () => {
  await show(popup('manual', { notAutomatic: true }));
  await settle();
  assert.equal(document.getElementById('pop-manual'), null);
  assert.deepEqual(getSeenContents(), ['exp-manual']);

  await show(
    popup('manual', {
      notAutomatic: true,
      trigger: { id: 'wait', value: 60 },
      contentValue: { html: '<div id="pop-manual">x</div>', css: '', js: popupScript('manual') },
    }),
    { forceShow: true },
  );
  await waitFor(() => window.__gsPopup_manual);

  assert.equal(window.__gsPopup_manual, 'html-first');
});

const frequencyCases = [
  { name: 'no frequency: always shown, nothing stored', frequency: undefined, entry: null, shown: true, stored: null },
  { name: 'once_day, first time', frequency: 'once_day', entry: null, shown: true, stored: 'once_day' },
  { name: 'once_day, seen 2 hours ago', frequency: 'once_day', entry: { period: 'once_day', hoursAgo: 2 }, shown: false },
  { name: 'once_day, seen 25 hours ago', frequency: 'once_day', entry: { period: 'once_day', hoursAgo: 25 }, shown: true, stored: 'once_day' },
  { name: 'once_day, after the frequency changed', frequency: 'once_day', entry: { period: 'once', hoursAgo: 1 }, shown: true, stored: 'once_day' },
  { name: 'once_sesion, seen 2 hours ago', frequency: 'once_sesion', entry: { period: 'once_sesion', hoursAgo: 2 }, shown: false },
  { name: 'once_sesion, seen 25 hours ago', frequency: 'once_sesion', entry: { period: 'once_sesion', hoursAgo: 25 }, shown: true, stored: 'once_sesion' },
  { name: 'once_week, seen 6 days ago', frequency: 'once_week', entry: { period: 'once_week', hoursAgo: 6 * 24 }, shown: false },
  { name: 'once_week, seen 8 days ago', frequency: 'once_week', entry: { period: 'once_week', hoursAgo: 8 * 24 }, shown: true, stored: 'once_week' },
  { name: 'once_month, seen 29 days ago', frequency: 'once_month', entry: { period: 'once_month', hoursAgo: 29 * 24 }, shown: false },
  { name: 'once_month, seen 31 days ago', frequency: 'once_month', entry: { period: 'once_month', hoursAgo: 31 * 24 }, shown: true, stored: 'once_month' },
  { name: 'once, seen a year ago', frequency: 'once', entry: { period: 'once', hoursAgo: 365 * 24 }, shown: false },
  { name: 'once, after the frequency changed', frequency: 'once', entry: { period: 'once_day', hoursAgo: 1 }, shown: true, stored: 'once' },
  { name: 'once_page, already seen', frequency: 'once_page', entry: { period: 'once_page', hoursAgo: 0 }, shown: true },
  { name: 'always, already seen', frequency: 'always', entry: { period: 'always', hoursAgo: 0 }, shown: true },
  { name: 'unknown frequency, already seen', frequency: 'sometimes', entry: { period: 'sometimes', hoursAgo: 0 }, shown: false },
];

frequencyCases.forEach(({ name, frequency, entry, shown, stored }, index) => {
  test(`popup frequency — ${name}`, async () => {
    const key = `freq-${index}`;
    const lastSeen = entry ? Date.now() - entry.hoursAgo * HOUR - 1000 : null;
    if (entry) {
      localStorage.setItem('gs_content_seen', JSON.stringify({ [`exp-${key}`]: { lastSeen, period: entry.period } }));
    }
    const before = localStorage.getItem('gs_content_seen');

    await show(popup(key, { frequency }));
    await settle();

    assert.equal(Boolean(document.getElementById(`pop-${key}`)), shown);
    const after = localStorage.getItem('gs_content_seen');
    if (stored) {
      const saved = JSON.parse(after)[`exp-${key}`];
      assert.equal(saved.period, stored);
      assert.ok(Date.now() - saved.lastSeen < 5000, 'lastSeen is refreshed');
    } else {
      assert.equal(after, before, 'the stored frequency data is untouched');
    }
  });
});

// ---------------------------------------------------------------------------
// Impressions
// ---------------------------------------------------------------------------

test('openImpression marks the impression as opened', async () => {
  const calls = mockFetch(() => ({ ok: true }));

  assert.deepEqual(await openImpression('imp-1'), { ok: true });

  assert.deepEqual(paths(calls), ['PATCH /personal/impression/imp-1']);
  assert.deepEqual(calls[0].body, { status: 'opened' });
});

test('openImpression ignores invalid ids and swallows request errors', async () => {
  const errors = silence('error');
  const calls = mockFetch(() => failure());

  assert.equal(await openImpression(), undefined);
  assert.equal(await openImpression(123), undefined);
  assert.equal(calls.length, 0);

  assert.equal(await openImpression('imp-1'), undefined);
  assert.equal(calls.length, 1);
  assert.equal(errors.mock.calls[0].arguments[0], 'Error:');
});

test('createContentImpression creates one impression per content and session', async () => {
  const calls = mockFetch(() => ({ success: true, impressionId: 'imp-page-1' }));
  localStorage.setItem(POST_CACHE_KEY, '{}');

  const created = await createContentImpression('imp-page-1', {
    content: 'content-id-1',
    target: 'target-1',
    variantId: 'variant-1',
    tags: ['home'],
  });

  assert.deepEqual(created, { success: true, impressionId: 'imp-page-1' });
  assert.deepEqual(paths(calls), ['POST /personal/impression']);
  assert.deepEqual(calls[0].body, {
    impressionId: 'imp-page-1',
    content: 'content-id-1',
    target: 'target-1',
    variantId: 'variant-1',
    status: 'opened',
    tags: ['home'],
  });
  assert.equal(getContentImpressionId('content-id-1'), 'imp-page-1');
  // The content counts as seen, which invalidates the cached decisions.
  assert.deepEqual(getSeenContents(), ['content-id-1']);
  assert.equal(localStorage.getItem(POST_CACHE_KEY), null);

  // The page gets a new impressionId on every request: the first one is kept.
  const again = await createContentImpression('imp-page-2', { content: 'content-id-1' });
  assert.deepEqual(again, { success: true, impressionId: 'imp-page-1', skipped: true });
  assert.equal(calls.length, 1);
});

test('createContentImpression keeps the impression id returned by the server', async () => {
  const calls = mockFetch(() => ({ impressionId: 'imp-from-server' }));

  await createContentImpression('imp-from-page', { variantId: 'variant-5', status: 'sent', date: '2026-01-01' });

  assert.deepEqual(calls[0].body, {
    impressionId: 'imp-from-page',
    variantId: 'variant-5',
    status: 'sent',
    date: '2026-01-01',
  });
  assert.equal(getContentImpressionId('variant-5'), 'imp-from-server');
  assert.deepEqual(getSeenContents(), [], 'without the content id nothing is marked as seen');
});

test('createContentImpression falls back to the impression id as the content key', async () => {
  mockFetch(() => ({}));

  await createContentImpression('imp-alone');

  assert.equal(getContentImpressionId('imp-alone'), 'imp-alone');
  assert.equal(getContentImpressionId('unknown'), null);
});

test('an impression that could not be created is sent again on the next try', async () => {
  silence('error');
  let fail = true;
  const calls = mockFetch(() => (fail ? failure() : { impressionId: 'imp-server' }));

  assert.equal(await createContentImpression('imp-try-1', { content: 'content-retry' }), undefined);
  assert.equal(getContentImpressionId('content-retry'), null);

  fail = false;
  const created = await createContentImpression('imp-try-2', { content: 'content-retry' });
  assert.equal(created.skipped, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.impressionId, 'imp-try-2');
  assert.equal(getContentImpressionId('content-retry'), 'imp-server');
});

test('createContentImpression ignores invalid ids and swallows request errors', async () => {
  const errors = silence('error');
  const calls = mockFetch(() => failure());

  assert.equal(await createContentImpression(null, { content: 'c' }), undefined);
  assert.equal(await createContentImpression({ id: 1 }), undefined);
  assert.equal(calls.length, 0);

  assert.equal(await createContentImpression('imp-fail', { content: 'content-fail' }), undefined);
  assert.equal(calls.length, 1);
  assert.equal(errors.mock.calls[0].arguments[0], 'Error creating content impression:');
});

test('clickContentImpression reports the click with the content and tags', async () => {
  const calls = mockFetch(() => ({ success: true }));

  assert.deepEqual(await clickContentImpression('imp-1', { content: 'content-id-1', tags: ['cta'] }), { success: true });
  await clickContentImpression('imp-2');

  assert.deepEqual(paths(calls), ['PATCH /personal/impression/imp-1', 'PATCH /personal/impression/imp-2']);
  assert.deepEqual(calls[0].body, { content: 'content-id-1', tags: ['cta'] });
  assert.deepEqual(calls[1].body, {});
});

test('clickContentImpression ignores invalid ids and swallows request errors', async () => {
  const errors = silence('error');
  const calls = mockFetch(() => failure());

  assert.equal(await clickContentImpression('', { content: 'c' }), undefined);
  assert.equal(await clickContentImpression(42), undefined);
  assert.equal(calls.length, 0);

  assert.equal(await clickContentImpression('imp-1', { content: 'c' }), undefined);
  assert.equal(errors.mock.calls[0].arguments[0], 'Error clicking content impression:');
});

test('trackURLClicked reports the execution', async () => {
  const calls = mockFetch(() => ({ tracked: true }));

  assert.deepEqual(await trackURLClicked('execution-1'), { tracked: true });

  assert.deepEqual(paths(calls), ['PATCH /public/track']);
  assert.deepEqual(calls[0].body, { executionId: 'execution-1' });
});

test('observeElementInView calls back once the element enters the viewport', () => {
  document.body.innerHTML = '<div id="banner"></div>';
  const callback = mock.fn();

  observeElementInView('banner', 'imp-1', callback);

  const observer = FakeIntersectionObserver.instances.at(-1);
  assert.deepEqual(observer.targets, [document.getElementById('banner')]);

  observer.trigger(false);
  assert.equal(callback.mock.callCount(), 0);
  assert.equal(observer.disconnected, false);

  observer.trigger(true);
  assert.deepEqual(callback.mock.calls.map((call) => call.arguments), [['banner', 'imp-1']]);
  assert.equal(observer.disconnected, true);
});

test('sendContentEvent sends the event with the session id as customer', async () => {
  const calls = mockFetch();

  sendContentEvent('target-1', 'variant-1');
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://custom-events.gopersonal.ai/event');
  assert.deepEqual(calls[0].body, { key: 'target-1', value: 'variant-1', customer: 'session-1' });
});

test('sendContentEvent never rejects when the event cannot be sent', async () => {
  mockFetch(() => failure());
  assert.equal(await sendContentEvent('target-1', 'variant-1'), undefined);
});

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

test('invalidateContentCache drops the cached POST responses', () => {
  localStorage.setItem(POST_CACHE_KEY, JSON.stringify({ 'c::Home::::::': { data: {}, ts: Date.now() } }));
  invalidateContentCache();
  assert.equal(localStorage.getItem(POST_CACHE_KEY), null);
});

test('purgeContentCache drops only the expired POST responses', () => {
  localStorage.setItem(POST_CACHE_KEY, JSON.stringify({
    'old::Home::::::': { data: { variantId: 'a' }, ts: Date.now() - 6 * 60 * 1000 },
    'new::Home::::::': { data: { variantId: 'b' }, ts: Date.now() },
  }));
  purgeContentCache();
  assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(POST_CACHE_KEY))), ['new::Home::::::']);
});

// ---------------------------------------------------------------------------
// Preview from the admin editor
// ---------------------------------------------------------------------------

const ADMIN_ORIGIN = 'https://admin.gopersonal.ai';

const editorSays = (data, origin = ADMIN_ORIGIN) =>
  window.dispatchEvent(new window.MessageEvent('message', { origin, data }));

const editorUpdate = (payload) => ({ namespace: 'gopersonal', source: 'editor', type: 'update', payload });

test('an update from the editor replaces the previous content with the preview', async () => {
  document.body.innerHTML = '<div id="slot"></div><div id="previous" data-gopersonal="true"></div>';

  editorSays(editorUpdate({
    css: '.preview { color: red; }',
    html: '<p id="preview-html">preview</p>',
    js: 'window.__gsPreviewRan = document.getElementById("preview-html") ? "html-first" : "script-first";',
    previewObject: { selector: '#slot', selectorPosition: null },
  }));
  await waitFor(() => window.__gsPreviewRan);

  assert.equal(document.getElementById('previous'), null);
  assert.equal(document.getElementById('slot').innerHTML, '<p id="preview-html">preview</p>');
  assert.equal(document.getElementById('gopersonal-style-gs-preview').textContent, '.preview { color: red; }');
  assert.equal(window.__gsPreviewRan, 'html-first');
  assert.ok(document.getElementById('gopersonal-script-gs-preview'));
});

test('a preview without selector goes after the body, and on mobile into the mobile selector', async () => {
  editorSays(editorUpdate({ html: '<p id="preview-after">x</p>', previewObject: { mobileSelector: '#mobile' } }));
  await waitFor(() => document.getElementById('preview-after'));
  assert.equal(document.body.nextElementSibling.id, 'preview-after');
  assert.equal(document.getElementById('gopersonal-style-gs-preview'), null, 'no css, no style element');

  document.body.innerHTML = '<div id="desktop"></div><div id="mobile"></div>';
  useMobileDevice();
  editorSays(editorUpdate({
    html: '<p id="preview-mobile">x</p>',
    previewObject: { selector: '#desktop', mobileSelector: '#mobile' },
  }));
  await waitFor(() => document.getElementById('preview-mobile'));
  assert.equal(document.getElementById('preview-mobile').parentNode.id, 'mobile');
});

test('messages that are not an editor update from the admin are ignored', async () => {
  document.body.innerHTML = '<div id="slot"></div><div id="previous" data-gopersonal="true"></div>';
  const payload = { html: '<p id="preview-html">preview</p>', previewObject: { selector: '#slot' } };

  editorSays(editorUpdate(payload), 'https://evil.example');
  editorSays({ ...editorUpdate(payload), namespace: 'other' });
  editorSays({ ...editorUpdate(payload), source: 'page' });
  editorSays({ ...editorUpdate(payload), type: 'ping' });
  editorSays(null);
  await settle();

  assert.ok(document.getElementById('previous'));
  assert.equal(document.getElementById('slot').innerHTML, '');
});

test('a broken preview payload is reported and does not throw', async () => {
  const errors = silence('error');

  editorSays(editorUpdate({ html: '<p id="preview-html">preview</p>' }));
  await settle();

  assert.equal(errors.mock.calls[0].arguments[0], 'Error rendering content preview:');
  assert.equal(document.getElementById('preview-html'), null);
});
