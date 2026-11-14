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
import { flushEvents } from '../../src/api/events.js';

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
  // Events queued by a test (front decision shadow reports) end here.
  mockFetch();
  flushEvents();
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
  assert.deepEqual(paths(calls), ['GET /public/cached-content/project-1/?pageType=Home&fd=1']);
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
  assert.deepEqual(paths(calls), ['GET /public/cached-content/67374d510dfcc232a627662e/?pageType=Home&fd=1']);
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
    'GET /public/cached-content/project-1/?pageType=Category&fd=1',
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
    'POST /personal/content/lazy-y?project=project-1&onlyData=true&omitRecoString=true',
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
    'POST /personal/content/lazy-v?variantId=var+7&project=project-1&onlyData=true&omitRecoString=true',
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
  assert.deepEqual(paths(calls).slice(1), ['POST /personal/content/lazy-running?project=project-1&onlyData=true&omitRecoString=true']);
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
    'POST /personal/content/lazy-personal?project=project-1&onlyData=true&omitRecoString=true',
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
// Front decision: contents decided in the browser (listing asked with fd=1)
// ---------------------------------------------------------------------------

const EVENTS_URL = 'https://events.gopersonal.ai/events';
const SALE_URL = 'https://shop.example/sale?utm=1#top';
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const urlLeaf = (x, o = null) => ({ f: 'current_url', o, x });

/** `fd` of a listed content: one target, one variant, a current_url rule. */
const fdOf = (key, rule = urlLeaf('/sale'), extra = {}) => ({
  id: `exp-${key}`,
  name: `Name of ${key}`,
  rev: 1772600767000,
  t: [{ id: `target-${key}`, r: { t: 'and', c: [rule] }, v: [{ id: `variant-${key}`, w: 100, s: 24 }] }],
  ...extra,
});

const fdListed = (key, rule, extra = {}) => ({ key, fd: fdOf(key, rule), ...extra });

/** Answer of GET /public/cached-content/<project>/variant/<variantId>. */
const fdTemplate = (variantId, extra = {}) => {
  const key = variantId.replace(/^variant-/, '');
  return {
    contentKey: key,
    // Before the slot: the contents of a page do not replace each other.
    selector: '#slot',
    selectorPosition: 'before',
    type: 'web',
    experienceId: `exp-${key}`,
    variant: {
      _id: variantId,
      status: 1,
      ratio: 100,
      templateValue: {
        html: `<p id="fd-${key}" data-variant="{{gs_variantId}}" data-target="{{gs_targetId}}" data-content="{{gs_contentId}}"`
          + ' data-imp="{{impressionId}}" data-reco="{{gs_recoImpressionId}}">{{gs_contentName}}: {{label}}</p>',
        variables: [{ name: 'label', type: { id: 'text' }, value: 'from the variant' }],
      },
    },
    ...extra,
  };
};

/** Data of POST /personal/content/<key> for a visitor that gets the variant of `fdOf(key)`. */
const fdServerData = (key, extra = {}) => ({
  variantId: `variant-${key}`,
  target: `target-${key}`,
  contentId: `exp-${key}`,
  contentName: `Name of ${key}`,
  impressionId: `imp-${key}`,
  recoImpressionId: `imp-${key}`,
  ...extra,
});

/**
 * API of a page listed with front decisions. `post(key)` is the data of the
 * POST of each content (default: the variant of its fd); `template(variantId)`
 * the template answer (default: fdTemplate).
 */
function frontApi({ fd, contents, post = (key) => fdServerData(key), template = (variantId) => fdTemplate(variantId) }) {
  return mockFetch((url, init) => {
    if (url.includes('pageType=')) return { ...pageOf([], contents), ...(fd === undefined ? {} : { fd }) };
    if (url.includes('/variant/')) return template(url.split('/variant/')[1]);
    if (init.method === 'POST' && contentKeyOf(url)) return { data: post(contentKeyOf(url)) };
    return {};
  });
}

const FD_ON = { v: 1, mode: 'on', sample: 1 };
const FD_SHADOW = { v: 1, mode: 'shadow', sample: 1 };
const postsOf = (calls) => paths(calls).filter((path) => path.startsWith('POST /personal/content/'));
const templatesOf = (calls) => paths(calls).filter((path) => path.includes('/variant/'));
const frontNodes = () => [...document.querySelectorAll('[id^="fd-"]')];
const clearFrontNodes = () => frontNodes().forEach((node) => node.remove());
const postOf = (key) => `POST /personal/content/${key}?project=project-1&onlyData=true&omitRecoString=true`;

test('the public listing is always asked with fd=1, and the fallback POST listing never is', async () => {
  silence('error');
  setUrl(SALE_URL);
  const calls = mockFetch((url, init) => {
    if (url.includes('/public/cached-content/') && url.includes('pageType=')) return failure();
    // Whatever the personalized page says about fd is ignored.
    if (url.includes('pageType=')) return { ...pageOf([], [fdListed('fallback-listing')]), fd: FD_ON };
    if (url.includes('/variant/')) return fdTemplate(url.split('/variant/')[1]);
    return init.method === 'POST' ? { data: fdServerData(contentKeyOf(url)) } : {};
  });

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('fd-fallback-listing'));

  assert.deepEqual(paths(calls), [
    'GET /public/cached-content/project-1/?pageType=Home&fd=1',
    'POST /personal/content-page?pageType=Home',
    postOf('fallback-listing'),
    'GET /public/cached-content/project-1/variant/variant-fallback-listing',
  ]);
});

test('project without front decision: the contents are requested exactly like before', async () => {
  setUrl(SALE_URL);
  // No top-level fd: an `fd` left on a content is ignored.
  const calls = frontApi({ contents: [fdListed('off-1'), { key: 'off-2' }] });

  await getContentByContext('Home', { product_id: 'sku-1' });
  await waitFor(() => document.getElementById('fd-off-1') && document.getElementById('fd-off-2'));

  assert.deepEqual(paths(calls), [
    'GET /public/cached-content/project-1/?pageType=Home&fd=1',
    postOf('off-1'),
    postOf('off-2'),
    'GET /public/cached-content/project-1/variant/variant-off-1',
    'GET /public/cached-content/project-1/variant/variant-off-2',
  ]);
  // The body of the POST is the one of always: nothing of fd travels.
  assert.deepEqual(calls[1].body.context.currentPage, {
    product_id: 'sku-1',
    type: 'Home',
    cache: 0,
    provider: null,
    location: SALE_URL,
    referrer: '',
  });
  assert.deepEqual(Object.keys(calls[1].body), ['context']);
  assert.equal(document.getElementById('fd-off-1').dataset.imp, 'imp-off-1');
  assert.equal(window.__gsFrontDecide, undefined);
});

test('mode on, match: no POST, one template request, and the content renders with the ids of the listing', async () => {
  setUrl(SALE_URL);
  const calls = frontApi({ fd: FD_ON, contents: [fdListed('on-1')] });

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('fd-on-1'));

  assert.deepEqual(paths(calls), [
    'GET /public/cached-content/project-1/?pageType=Home&fd=1',
    'GET /public/cached-content/project-1/variant/variant-on-1',
  ]);
  const node = document.getElementById('fd-on-1');
  assert.equal(node.dataset.variant, 'variant-on-1');
  assert.equal(node.dataset.target, 'target-on-1');
  assert.equal(node.dataset.content, 'exp-on-1');
  assert.match(node.dataset.imp, ULID, 'an impression id shaped like the one of the server');
  assert.equal(node.dataset.reco, node.dataset.imp, 'one id for both, like the server');
  assert.equal(node.textContent, 'Name of on-1: from the variant');
  assert.deepEqual(getSeenContents(), ['exp-on-1']);
  assert.equal(localStorage.getItem(POST_CACHE_KEY), null, 'a front decision is never stored as a server decision');
  assert.equal(window.__gsFrontDecide, undefined, 'nothing to report outside shadow');

  // A second load (SPA navigation) decides again: still no POST, the template is reused.
  clearFrontNodes();
  await getContentByContext('Home');
  await waitFor(() => document.getElementById('fd-on-1'));
  assert.deepEqual(postsOf(calls), []);
  assert.equal(templatesOf(calls).length, 1);
  assert.notEqual(document.getElementById('fd-on-1').dataset.imp, node.dataset.imp, 'a new impression id per decision, like per POST');
});

test('mode on, match: the impression flow is the same, one per content and session', async () => {
  setUrl(SALE_URL);
  frontApi({ fd: FD_ON, contents: [fdListed('on-imp')] });
  await getContentByContext('Home');
  const first = (await waitFor(() => document.getElementById('fd-on-imp'))).dataset;

  const calls = mockFetch(() => ({ success: true, impressionId: 'imp-derived-by-server' }));
  const impression = { content: first.content, target: first.target, variantId: first.variant };
  const created = await createContentImpression(first.imp, impression);

  assert.deepEqual(created, { success: true, impressionId: 'imp-derived-by-server' });
  assert.deepEqual(paths(calls), ['POST /personal/impression']);
  assert.deepEqual(calls[0].body, {
    impressionId: first.imp,
    content: 'exp-on-imp',
    target: 'target-on-imp',
    variantId: 'variant-on-imp',
    status: 'opened',
  });
  assert.equal(getContentImpressionId('exp-on-imp'), 'imp-derived-by-server');

  // The content shows again with another id: no second impression.
  frontApi({ fd: FD_ON, contents: [fdListed('on-imp')] });
  clearFrontNodes();
  await getContentByContext('Home');
  const second = (await waitFor(() => document.getElementById('fd-on-imp'))).dataset;
  const again = mockFetch();
  assert.deepEqual(await createContentImpression(second.imp, impression), {
    success: true,
    impressionId: 'imp-derived-by-server',
    skipped: true,
  });
  assert.equal(again.length, 0);
});

test('mode on, no match: no request at all and nothing injected', async () => {
  setUrl('https://shop.example/other');
  const calls = frontApi({ fd: FD_ON, contents: [fdListed('on-no-1'), fdListed('on-no-2', urlLeaf('/sale', 'in'))] });

  await getContentByContext('Home');
  await settle();

  assert.deepEqual(paths(calls), ['GET /public/cached-content/project-1/?pageType=Home&fd=1']);
  assert.deepEqual(frontNodes(), []);
  assert.equal(document.body.innerHTML, '<div id="slot"></div>');
  assert.equal(document.head.innerHTML, '');
  assert.deepEqual(getSeenContents(), []);
  assert.equal(localStorage.getItem(POST_CACHE_KEY), null);
});

test('mode on evaluates the location that would travel in the POST: the full href, at decision time', async () => {
  setUrl(SALE_URL);
  const calls = frontApi({
    fd: FD_ON,
    contents: [
      fdListed('on-href-1', urlLeaf('utm=1#top')),
      fdListed('on-href-2', urlLeaf(['HTTPS://SHOP.EXAMPLE/SALE?UTM=1#TOP '], 'in')),
      fdListed('on-href-3', urlLeaf('/sale', '!=')),
    ],
  });

  // A `location` passed in the options never replaces the one of the page (same as in the POST).
  await getContentByContext('Home', { location: 'https://shop.example/elsewhere' });
  await waitFor(() => document.getElementById('fd-on-href-1') && document.getElementById('fd-on-href-2'));

  assert.deepEqual(postsOf(calls), []);
  assert.equal(document.getElementById('fd-on-href-3'), null);
});

test('mode on only skips the POST of the contents it can decide; the rest of the page loads as always', async () => {
  setUrl(SALE_URL);
  const calls = frontApi({
    fd: FD_ON,
    contents: [
      fdListed('mix-front'),
      { key: 'mix-server' },
      fdListed('mix-unknown', { f: 'device', o: null, x: 'mobile' }),
      fdListed('mix-cached', urlLeaf('/nowhere'), { cache: 1 }),
    ],
    template: (variantId) => fdTemplate(variantId),
  });

  await getContentByContext('Home');
  await waitFor(() => ['mix-front', 'mix-server', 'mix-unknown'].every((key) => document.getElementById(`fd-${key}`)));

  assert.deepEqual(postsOf(calls), [postOf('mix-server'), postOf('mix-unknown')]);
  assert.ok(paths(calls).includes('GET /public/cached-content/project-1/mix-cached'), 'cache: 1 ignores its fd');
  assert.equal(document.getElementById('fd-mix-unknown').dataset.imp, 'imp-mix-unknown', 'rendered from the POST');
});

test('anything that is not a clean front decision goes through the POST, as always', async () => {
  const badVersion = { v: 2, mode: 'on', sample: 1 };
  const cases = [
    ['unknown-field', { contents: (key) => [fdListed(key, { f: 'utm_source', o: '=', x: 'x' })] }],
    ['unknown-operator', { contents: (key) => [fdListed(key, urlLeaf('/sale', 'regex'))] }],
    ['two-variants', { contents: (key) => {
      const listed = fdListed(key);
      listed.fd.t[0].v.push({ id: 'variant-b', w: 50, s: 1 });
      return [listed];
    } }],
    ['two-targets', { contents: (key) => {
      const listed = fdListed(key);
      listed.fd.t.push(listed.fd.t[0]);
      return [listed];
    } }],
    ['fd-not-an-object', { contents: (key) => [{ key, fd: 'yes' }] }],
    ['no-entry', { contents: (key) => [{ key }] }],
    ['version', { fd: badVersion }],
    ['version-missing', { fd: { mode: 'on', sample: 1 } }],
    ['mode-off', { fd: { v: 1, mode: 'off', sample: 1 } }],
    ['mode-other', { fd: { v: 1, mode: 'ON', sample: 1 } }],
    ['listing-fd-not-an-object', { fd: 'on' }],
    ['sample-zero', { fd: { v: 1, mode: 'on', sample: 0 } }],
    ['sample-invalid', { fd: { v: 1, mode: 'on', sample: '1' } }],
    // session-1 is out of a 10% sample (and in a 25% one, see below).
    ['out-of-sample', { fd: { v: 1, mode: 'on', sample: 0.1 } }],
    ['no-session-id', { setup: () => seedSession({ sessionId: undefined }) }],
    // An exception while deciding (here, while reading the listing block).
    ['decision-throws', {
      fd: { v: 1, mode: 'on', sample: 0.999 },
      setup: () => {
        const isArray = Array.isArray;
        mock.method(Array, 'isArray', (value) => {
          if (value && value.sample === 0.999) throw new Error('boom');
          return isArray(value);
        });
      },
    }],
    ['random-throws', { setup: () => mock.method(Math, 'random', () => { throw new Error('no entropy'); }) }],
    ['template-of-other-content', { template: (variantId) => fdTemplate(variantId, { experienceId: 'exp-other' }) }],
    ['variant-disabled', { template: (variantId) => {
      const answer = fdTemplate(variantId);
      answer.variant.status = 0;
      return answer;
    } }],
    ['variant-without-ratio', { template: (variantId) => {
      const answer = fdTemplate(variantId);
      answer.variant.ratio = 0;
      return answer;
    } }],
  ];

  for (const [name, { fd = FD_ON, contents, setup, template }] of cases) {
    resetDom({ url: SALE_URL });
    seedSession();
    document.body.innerHTML = '<div id="slot"></div>';
    setup?.();
    const key = `fallback-${name}`;
    const calls = frontApi({ fd, contents: contents ? contents(key) : [fdListed(key)], template });

    await getContentByContext('Home');
    const node = await waitFor(() => document.getElementById(`fd-${key}`));

    assert.deepEqual(postsOf(calls), [postOf(key)], name);
    assert.equal(calls.find((call) => call.method === 'POST').body.context.currentPage.location, SALE_URL, name);
    assert.equal(node.dataset.imp, `imp-${key}`, `${name}: rendered from the POST`);
    mock.restoreAll();
  }
});

test('a session inside the sample decides in the front', async () => {
  setUrl(SALE_URL);
  const calls = frontApi({ fd: { v: 1, mode: 'on', sample: 0.25 }, contents: [fdListed('sampled-in')] });

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('fd-sampled-in'));

  assert.deepEqual(postsOf(calls), []);
});

test('mode on falls back to the POST when the template of the decided variant cannot be downloaded', async () => {
  setUrl(SALE_URL);
  let templateRequests = 0;
  const calls = frontApi({
    fd: FD_ON,
    contents: [fdListed('on-broken')],
    template: (variantId) => (++templateRequests === 1 ? failure(404) : fdTemplate(variantId)),
  });

  await getContentByContext('Home');
  const node = await waitFor(() => document.getElementById('fd-on-broken'));

  assert.deepEqual(paths(calls).slice(1), [
    'GET /public/cached-content/project-1/variant/variant-on-broken',
    postOf('on-broken'),
    'GET /public/cached-content/project-1/variant/variant-on-broken',
  ]);
  assert.equal(node.dataset.imp, 'imp-on-broken');
});

test('mode on never applies to debug, draft, forced variant, preview or the element picker', async () => {
  const cases = [
    ['debug', '?gsDebug=true', (key) => [`POST /personal/content/${key}?project=project-1`]],
    ['draft-param', '?gsIncludeDraft=true', (key) => [`POST /personal/content/${key}?includeDraft=true&project=project-1`]],
    ['draft-config', '', (key) => [`POST /personal/content/${key}?includeDraft=true&project=project-1`], () => {
      window.gsConfig.includeDraft = true;
    }],
    ['draft-other', '?gsDraftContentId=another', (key) => [postOf(key), 'POST /personal/content/another?includeDraft=true&project=project-1']],
    ['forced', '?gsVariantId=v-forced', (key) => [`POST /personal/content/${key}?variantId=v-forced&project=project-1&onlyData=true&omitRecoString=true`]],
    ['preview', '?gsPreviewVariant=v-preview', () => []],
    ['picker', '?gsElementSelector=1', () => []],
  ];

  for (const [name, query, expectedPosts, setup] of cases) {
    const key = `gated-${name}`;
    const listing = { ...pageOf([], [fdListed(key)]), fd: FD_ON };
    const answer = (url, init) => {
      if (url.includes('pageType=')) return listing;
      if (url.includes('/variant/')) return fdTemplate(url.split('/variant/')[1]);
      if (init.method === 'POST' && url.includes('onlyData')) {
        return { data: fdServerData(contentKeyOf(url)) };
      }
      return webContent(key);
    };

    // 1. The page opens with the param: neither the listing nor the content use fd.
    resetDom({ url: `https://shop.example/sale${query}` });
    seedSession();
    setup?.();
    let calls = mockFetch(answer);
    await getContentByContext('Home');
    await settle();
    assert.deepEqual(postsOf(calls), expectedPosts(key), `${name}: from the start`);

    // 2. The param shows up after the public listing (with fd) was read:
    //    getContent checks again on its own.
    resetDom({ url: 'https://shop.example/sale' });
    seedSession();
    calls = mockFetch((url, init) => {
      if (url.includes('pageType=')) {
        setUrl(`https://shop.example/sale${query}`);
        setup?.();
      }
      return answer(url, init);
    });
    await getContentByContext('Home');
    await settle();
    assert.deepEqual(
      postsOf(calls).filter((path) => path.includes(key)),
      expectedPosts(key).filter((path) => path.includes(key)),
      `${name}: after the listing`,
    );
  }
});

test('gsSDK.getContent called directly never decides in the front, whatever its options say', async () => {
  setUrl(SALE_URL);
  const calls = frontApi({ fd: FD_ON, contents: [] });

  await getContent('direct-1', { type: 'Home', fd: fdOf('direct-1'), cache: 0 });
  await waitFor(() => document.getElementById('fd-direct-1'));

  assert.deepEqual(postsOf(calls), [postOf('direct-1')]);
});

test('mode shadow: the POST is still made and rendered; mismatches and unknowns are reported once per content', async () => {
  setUrl(SALE_URL);
  const serverAnswers = {
    // local match, the server gives another variant
    'sh-other': fdServerData('sh-other', { variantId: 'variant-sh-other-b' }),
    // local match, the server gives another target
    'sh-target': fdServerData('sh-target', { target: 'target-x' }),
    // local match, the server gives nothing
    'sh-none': {},
    // local no match, the server gives a variant
    'sh-extra': fdServerData('sh-extra'),
    // local unknown: counted apart
    'sh-unknown': fdServerData('sh-unknown'),
    // both agree
    'sh-same': fdServerData('sh-same'),
    'sh-same-none': { reason: 'no target' },
  };
  const contents = [
    fdListed('sh-other'),
    fdListed('sh-target'),
    fdListed('sh-none'),
    fdListed('sh-extra', urlLeaf('/nowhere')),
    fdListed('sh-unknown', { f: 'device', o: null, x: 'mobile' }),
    fdListed('sh-same'),
    fdListed('sh-same-none', urlLeaf('/nowhere')),
  ];
  const calls = frontApi({ fd: FD_SHADOW, contents, post: (key) => serverAnswers[key] });

  await getContentByContext('Home');
  await waitFor(() => document.getElementById('fd-sh-other-b') && document.getElementById('fd-sh-same'));

  // Zero behaviour change: every content asked the server and rendered what it said.
  assert.deepEqual(postsOf(calls), contents.map((content) => postOf(content.key)));
  assert.equal(calls[1].body.context.currentPage.location, SALE_URL);
  assert.deepEqual(Object.keys(calls[1].body.context.currentPage).sort(), ['cache', 'location', 'provider', 'referrer', 'type']);
  assert.equal(document.getElementById('fd-sh-other-b').dataset.variant, 'variant-sh-other-b');
  assert.equal(document.getElementById('fd-sh-other-b').dataset.imp, 'imp-sh-other');
  assert.equal(document.getElementById('fd-sh-other'), null);
  assert.ok(document.getElementById('fd-sh-extra'));
  assert.equal(document.getElementById('fd-sh-none'), null);

  const pageUrl = 'https://shop.example/sale';
  const expected = [
    { kind: 'mismatch', content: 'sh-other', status: 'match', localVariant: 'variant-sh-other', serverVariant: 'variant-sh-other-b', localTarget: 'target-sh-other', serverTarget: 'target-sh-other', reason: null, url: pageUrl },
    { kind: 'mismatch', content: 'sh-target', status: 'match', localVariant: 'variant-sh-target', serverVariant: 'variant-sh-target', localTarget: 'target-sh-target', serverTarget: 'target-x', reason: null, url: pageUrl },
    { kind: 'mismatch', content: 'sh-none', status: 'match', localVariant: 'variant-sh-none', serverVariant: null, localTarget: 'target-sh-none', serverTarget: null, reason: null, url: pageUrl },
    { kind: 'mismatch', content: 'sh-extra', status: 'no_match', localVariant: null, serverVariant: 'variant-sh-extra', localTarget: null, serverTarget: 'target-sh-extra', reason: null, url: pageUrl },
    { kind: 'unknown', content: 'sh-unknown', status: 'unknown', localVariant: null, serverVariant: 'variant-sh-unknown', localTarget: null, serverTarget: 'target-sh-unknown', reason: 'rules:field', url: pageUrl },
  ];
  assert.deepEqual(window.__gsFrontDecide, expected, 'agreements are not recorded');

  // Same page again, with real POSTs again: nothing is reported twice.
  invalidateContentCache();
  await getContentByContext('Home');
  await settle();
  assert.equal(postsOf(calls).length, contents.length * 2);
  assert.equal(window.__gsFrontDecide.length, expected.length);

  // The reports leave through the events channel of gsSDK.track, without the query string.
  const sent = mockFetch();
  flushEvents();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, EVENTS_URL);
  const events = sent[0].body.events;
  assert.deepEqual(events.map((event) => event.event), expected.map(() => 'gs_fd_shadow'));
  assert.deepEqual(events.map((event) => event.props), expected);
  assert.deepEqual(events.map((event) => event.content), expected.map((record) => `exp-${record.content}`));
  assert.ok(events.every((event) => event.url === pageUrl), 'no query string, no hash');
  assert.ok(!JSON.stringify(sent[0].body.events).includes('utm=1'));
});

test('mode shadow never compares against a response served from the local POST cache', async () => {
  setUrl('https://shop.example/other');
  // A real POST leaves the decision of the server in the local cache (the
  // second one: the first render marks the content as seen, which empties it)...
  let calls = frontApi({ contents: [{ key: 'sh-cached' }] });
  for (let load = 0; load < 2; load++) {
    clearFrontNodes();
    await getContentByContext('Home');
    await waitFor(() => document.getElementById('fd-sh-cached'));
  }
  assert.deepEqual(postsOf(calls), [postOf('sh-cached'), postOf('sh-cached')]);
  assert.ok(localStorage.getItem(POST_CACHE_KEY).includes('variant-sh-cached'));

  // ...and the next load is served from it. Locally it is a no match, which against
  // a real response would be a mismatch: here there is nothing to compare with.
  calls = frontApi({ fd: FD_SHADOW, contents: [fdListed('sh-cached', urlLeaf('/sale'))] });
  clearFrontNodes();
  await getContentByContext('Home');
  await waitFor(() => document.getElementById('fd-sh-cached'));

  assert.deepEqual(postsOf(calls), []);
  assert.equal(window.__gsFrontDecide, undefined);
});

test('mode shadow keeps at most 50 records and survives a broken report', async () => {
  setUrl(SALE_URL);
  const contents = Array.from({ length: 55 }, (_, i) => fdListed(`sh-cap-${i}`, { f: 'device', o: null, x: 'mobile' }));
  frontApi({ fd: FD_SHADOW, contents, post: () => ({}) });

  await getContentByContext('Home');

  assert.equal(window.__gsFrontDecide.length, 50);
  assert.ok(window.__gsFrontDecide.every((record) => record.kind === 'unknown'));

  // The report throws (the log does): the content still renders from the POST.
  window.__gsFrontDecide = [];
  window.gsLog = (message) => {
    if (message === 'Front decision shadow') throw new Error('log failed');
  };
  frontApi({ fd: FD_SHADOW, contents: [fdListed('sh-log', { f: 'device', o: null, x: 'mobile' })] });
  await getContentByContext('Home');
  await waitFor(() => document.getElementById('fd-sh-log'));
  assert.deepEqual(window.__gsFrontDecide, []);
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
    'POST /personal/content/content-render-1?project=project-1&onlyData=true&omitRecoString=true',
    'GET /public/cached-content/project-data/variant/variant-render-1',
  ]);
  assert.equal(calls[0].body.context.currentPage.type, 'Product');
  assert.equal(document.getElementById('slot').innerHTML, '<p id="welcome-html" data-imp="imp-1">Hello Ana</p>');
  // The key of the template response names the injected elements.
  assert.equal(document.getElementById('gopersonal-style-welcome').textContent, '.welcome { color: blue; }');
  assert.equal(window.__gsWelcome, 'Welcome banner|variant-render-1');
  assert.deepEqual(getSeenContents(), ['exp-welcome']);
});

test('getContent builds gs_recommendations when discover sends only the array', async () => {
  const recommendations = [
    { id: '1', name: 'Uno "a"', imgs: [{ url: 'https://img/1.jpg' }] },
    { id: '2', name: 'Dos', imgs: [] },
  ];
  const expected = JSON.stringify(recommendations);
  const template = {
    contentKey: 'reco',
    selector: '#slot',
    type: 'recommendations',
    experienceId: 'exp-reco',
    variant: {
      templateValue: {
        html: '<i id="reco-html"></i>',
        js: 'window.__gsReco = {{gs_recommendations}};',
        // Variable de producto: el render la copia en cada item. El string
        // tiene que salir de los items tal como vinieron, sin ese campo.
        variables: [{ name: 'foto', type: { id: 'product_property' }, value: { id: 'image' } }],
      },
    },
  };
  clientRenderApi({
    data: { variantId: 'variant-reco-1', hasRecommendationsBlockFlag: true, recommendations },
    template,
  });

  await getContent('content-reco-1', { type: 'Home' });
  await waitFor(() => window.__gsReco);

  assert.equal(JSON.stringify(window.__gsReco), expected);

  // Desde el cache local (segunda carga) sale igual.
  delete window.__gsReco;
  await getContent('content-reco-1', { type: 'Home' });
  await waitFor(() => window.__gsReco);
  assert.equal(JSON.stringify(window.__gsReco), expected);
});

test('getContent keeps the gs_recommendations sent by discover', async () => {
  clientRenderApi({
    data: {
      variantId: 'variant-reco-2',
      recommendations: [{ id: '1' }],
      gs_recommendations: '[{"id":"from-server"}]',
    },
    template: {
      selector: '#slot',
      type: 'recommendations',
      experienceId: 'exp-reco-2',
      variant: { templateValue: { html: '<i></i>', js: 'window.__gsReco2 = {{gs_recommendations}};', variables: [] } },
    },
  });

  await getContent('content-reco-2', { type: 'Home' });
  await waitFor(() => window.__gsReco2);

  assert.equal(JSON.stringify(window.__gsReco2), '[{"id":"from-server"}]');
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
