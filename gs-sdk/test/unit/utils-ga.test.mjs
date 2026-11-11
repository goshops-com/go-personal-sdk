import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, setUrl, mockFetch, seedSession } from './helpers/env.mjs';
import {
  getGAId,
  markSessionEvent,
  checkURLEvents,
  parseItemsForGA4,
  trackGopersonalProductImpression,
  trackGopersonalProductClick,
  trackGopersonalBannerImpression,
  trackGopersonalBannerClick,
  trackGopersonalProductClickById,
  trackGopersonalProductClickByField,
  trackGopersonalSearch,
  trackGopersonalSearchResults,
  trackGopersonalSearchResultClick,
  trackGopersonalProductAddToCart,
  trackGopersonalCustomEvent,
  trackGopersonalToDataLayer,
} from '../../src/utils/ga.js';

const ITEM = { id: 'p1', sku: 'sku-1', sku_list: ['sku-1', 'sku-2'], parent_id: 'parent-1', name: 'Shoe', price: 99.5, category: 'Shoes', brand: 'Acme' };
const GA_ITEM = {
  item_id: 'p1', item_sku: 'sku-1', item_sku_list: ['sku-1', 'sku-2'], item_parent_id: 'parent-1', item_name: 'Shoe',
  price: 99.5, item_category: 'Shoes', item_brand: 'Acme', quantity: 1,
};

let gtagCalls;
let errorLog;

function installGtag() {
  gtagCalls = [];
  globalThis.gtag = (...args) => gtagCalls.push(args);
}

beforeEach(() => {
  resetDom();
  delete globalThis.gtag;
  delete window.dataLayer;
  gtagCalls = [];
  mock.method(console, 'log', () => {});
  errorLog = mock.method(console, 'error', () => {});
});

afterEach(() => {
  delete globalThis.gtag;
  delete window.dataLayer;
  mock.restoreAll();
});

test('getGAId extracts the session number from the _ga_<stream> cookie', () => {
  assert.equal(getGAId(), null);
  document.cookie = '_ga=GA1.1.111.222; Path=/';
  assert.equal(getGAId(), null, 'the client cookie alone is not a session cookie');
  document.cookie = '_ga_ABC123=GS2.1.s1746812345$o3$g1$t1746812400; Path=/';
  assert.equal(getGAId(), '1746812345');
});

test('getGAId returns null when the session cookie has no session number', () => {
  document.cookie = '_ga_ABC123=GS1.1.nothing; Path=/';
  assert.equal(getGAId(), null);
});

test('getGAId returns null when cookies cannot be read', () => {
  const cookieDescriptor = Object.getOwnPropertyDescriptor(window.Document.prototype, 'cookie');
  Object.defineProperty(document, 'cookie', { configurable: true, get() { throw new Error('denied'); } });
  try {
    assert.equal(getGAId(), null);
  } finally {
    delete document.cookie;
    assert.ok(cookieDescriptor);
  }
});

test('markSessionEvent sends gopersonal_present through gtag when available', () => {
  assert.equal(markSessionEvent(), undefined, 'no gtag: no-op');
  installGtag();
  markSessionEvent();
  assert.deepEqual(gtagCalls, [['event', 'gopersonal_present', { product: 'gopersonal', session_marked: true }]]);
});

test('markSessionEvent swallows gtag errors', () => {
  globalThis.gtag = () => { throw new Error('boom'); };
  assert.equal(markSessionEvent(), null);
});

test('checkURLEvents sends the event described by ev_name / ev_p_* to gtag and dataLayer', () => {
  setUrl('https://shop.example/?ev_name=promo_click&ev_p_campaign=summer%20sale&ev_p_slot=1&other=x&empty=');
  installGtag();
  window.dataLayer = [];
  checkURLEvents();
  assert.deepEqual(gtagCalls, [['event', 'promo_click', { campaign: 'summer sale', slot: '1' }]]);
  assert.deepEqual(window.dataLayer, [{ event: 'promo_click', campaign: 'summer sale', slot: '1' }]);
  assert.equal(errorLog.mock.callCount(), 0);
});

test('checkURLEvents without gtag still pushes to dataLayer and reports the missing gtag', () => {
  setUrl('https://shop.example/?ev_name=promo_click');
  window.dataLayer = [];
  checkURLEvents();
  assert.deepEqual(window.dataLayer, [{ event: 'promo_click' }]);
  assert.equal(errorLog.mock.calls[0].arguments[0], 'gtag not available');
});

test('checkURLEvents does nothing without ev_name', () => {
  setUrl('https://shop.example/?ev_p_campaign=summer');
  installGtag();
  window.dataLayer = [];
  checkURLEvents();
  assert.deepEqual(gtagCalls, []);
  assert.deepEqual(window.dataLayer, []);
});

test('checkURLEvents survives a dataLayer that throws and a malformed query string', () => {
  setUrl('https://shop.example/?ev_name=promo_click');
  window.dataLayer = [];
  window.dataLayer.push = () => { throw new Error('frozen'); };
  checkURLEvents();
  assert.equal(errorLog.mock.calls.at(-1).arguments[0], 'Error pushing to dataLayer:');

  setUrl('https://shop.example/?ev_name=%E0%A4%A');
  checkURLEvents();
  assert.equal(errorLog.mock.calls.at(-1).arguments[0], 'Error checking URL events:');
});

test('parseItemsForGA4 maps items to GA4 items with 1-based index and defaults', () => {
  assert.deepEqual(parseItemsForGA4(undefined, 'Home'), []);
  assert.deepEqual(parseItemsForGA4('nope', 'Home'), []);
  assert.deepEqual(parseItemsForGA4([ITEM, { id: 'p2', price: 5 }], 'Home'), [
    { ...GA_ITEM, index: 1, item_list_name: 'Home' },
    {
      item_id: 'p2', item_sku: '', item_sku_list: [], item_parent_id: '', item_name: '', price: 5,
      item_category: '', item_brand: '', index: 2, item_list_name: 'Home', quantity: 1,
    },
  ]);
});

test('trackGopersonalProductImpression sends view_item_list through gtag with the measurement id found in a script tag', () => {
  installGtag();
  const other = document.createElement('script');
  other.type = 'text/plain';
  other.setAttribute('src', 'https://cdn.example/other.js');
  const ga = document.createElement('script');
  ga.type = 'text/plain';
  ga.setAttribute('src', 'https://www.googletagmanager.com/gtag/js?id=G-TEST123');
  document.head.append(other, ga);

  trackGopersonalProductImpression([ITEM], 'Home');
  assert.deepEqual(gtagCalls, [['event', 'view_item_list', {
    item_list_name: 'Gopersonal - Home',
    items: [{ ...GA_ITEM, index: 1, item_list_name: 'Home' }],
    send_to: 'G-TEST123',
  }]]);
});

test('the measurement id falls back to the dataLayer, and is omitted when unknown', () => {
  installGtag();
  trackGopersonalCustomEvent('custom_one', { a: 1 });
  assert.deepEqual(gtagCalls[0], ['event', 'custom_one', { a: 1 }]);

  window.dataLayer = [null, { event: 'x' }, { measurement_id: 'G-FROMDL' }];
  trackGopersonalCustomEvent('custom_two', { b: 2 });
  assert.deepEqual(gtagCalls[1], ['event', 'custom_two', { b: 2, send_to: 'G-FROMDL' }]);
});

test('without gtag, ecommerce events go to dataLayer under `ecommerce` and custom events are spread', () => {
  window.dataLayer = [];
  trackGopersonalProductClick(ITEM, 'Home', 2);
  trackGopersonalCustomEvent('custom_event', { foo: 'bar' });
  assert.deepEqual(window.dataLayer, [
    {
      event: 'select_item',
      ecommerce: { item_list_name: 'Gopersonal - Home', items: [{ ...GA_ITEM, index: 3, item_list_name: 'Home' }] },
    },
    { event: 'custom_event', foo: 'bar' },
  ]);
});

test('without gtag nor dataLayer the event is dropped with an error', () => {
  trackGopersonalCustomEvent('custom_event', { foo: 'bar' });
  assert.equal(errorLog.mock.calls[0].arguments[0], 'gtag and dataLayer not available');
});

test('draft previews (gsIncludeDraft / gsDraftContentId) never track', () => {
  installGtag();
  window.dataLayer = [];
  setUrl('https://shop.example/?gsIncludeDraft=true');
  trackGopersonalCustomEvent('custom_event', {});
  setUrl('https://shop.example/?gsDraftContentId=abc');
  trackGopersonalCustomEvent('custom_event', {});
  assert.deepEqual(gtagCalls, []);
  assert.deepEqual(window.dataLayer, []);
  setUrl('https://shop.example/?gsIncludeDraft=false');
  trackGopersonalCustomEvent('custom_event', {});
  assert.equal(gtagCalls.length, 1);
});

test('trackGopersonalBannerImpression sends view_promotion with a default creative_slot', () => {
  window.dataLayer = [];
  trackGopersonalBannerImpression([
    { promotion_id: 'b1', promotion_name: 'Banner 1' },
    { promotion_id: 'b2', promotion_name: 'Banner 2', creative_slot: 'hero' },
  ]);
  assert.deepEqual(window.dataLayer, [{
    event: 'view_promotion',
    ecommerce: {
      promotions: [
        { promotion_id: 'b1', promotion_name: 'Banner 1', creative_slot: 'gopersonal_slot' },
        { promotion_id: 'b2', promotion_name: 'Banner 2', creative_slot: 'hero' },
      ],
    },
  }]);
});

test('trackGopersonalBannerClick sends select_promotion with the gopersonal slot', () => {
  installGtag();
  trackGopersonalBannerClick({ promotion_id: 'b1', promotion_name: 'Banner 1' });
  assert.deepEqual(gtagCalls, [['event', 'select_promotion', {
    promotions: [{ promotion_id: 'b1', promotion_name: 'Banner 1', creative_slot: 'gopersonal_slot' }],
  }]]);
});

test('trackGopersonalProductClickById fetches the item and sends select_item', async () => {
  seedSession();
  const calls = mockFetch((url) => (url.endsWith('/item/p1') ? ITEM : {}));
  installGtag();
  await trackGopersonalProductClickById('p1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/item\/p1$/);
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');
  assert.deepEqual(gtagCalls, [['event', 'select_item', {
    item_list_name: 'Gopersonal - gopersonal_list',
    items: [{ ...GA_ITEM, index: 1, item_list_name: 'gopersonal_list' }],
  }]]);

  await trackGopersonalProductClickById('p1', 'PDP', 4);
  assert.equal(gtagCalls[1][2].item_list_name, 'Gopersonal - PDP');
  assert.equal(gtagCalls[1][2].items[0].index, 5);
});

test('trackGopersonalProductClickByField looks the item up by field and sends select_item', async () => {
  seedSession();
  const calls = mockFetch(() => ({ resultData: [ITEM] }));
  installGtag();
  await trackGopersonalProductClickByField('sku', 'sku-1', 'Search', 1);
  const url = new URL(calls[0].url);
  assert.ok(url.pathname.endsWith('/item'));
  assert.equal(url.searchParams.get('limit'), '1');
  assert.deepEqual(JSON.parse(url.searchParams.get('where')), { sku: 'sku-1' });
  assert.deepEqual(gtagCalls, [['event', 'select_item', {
    item_list_name: 'Gopersonal - Search',
    items: [{ ...GA_ITEM, index: 2, item_list_name: 'Search' }],
  }]]);
});

test('trackGopersonalProductClickByField tracks nothing when no item matches', async () => {
  seedSession();
  mockFetch(() => ({ resultData: [] }));
  installGtag();
  await trackGopersonalProductClickByField('sku', 'missing');
  assert.deepEqual(gtagCalls, []);
});

test('trackGopersonalSearch sends the search event', () => {
  installGtag();
  trackGopersonalSearch('zapatillas', 12, 'text', 'search-1', false);
  assert.deepEqual(gtagCalls, [['event', 'search', {
    search_query: 'zapatillas', search_results_count: 12, search_type: 'text', search_id: 'search-1', occasion_search: false,
  }]]);
});

test('trackGopersonalSearchResults sends view_item_list for the search list', () => {
  installGtag();
  trackGopersonalSearchResults([ITEM, { ...ITEM, id: 'p2' }]);
  const [, name, data] = gtagCalls[0];
  assert.equal(name, 'view_item_list');
  assert.equal(data.item_list_name, 'Gopersonal - Search Results');
  assert.deepEqual(data.items.map((i) => [i.item_id, i.index, i.item_list_name]), [
    ['p1', 1, 'Gopersonal - Search Results'],
    ['p2', 2, 'Gopersonal - Search Results'],
  ]);
});

test('trackGopersonalSearchResultClick sends select_item for the clicked product', () => {
  installGtag();
  trackGopersonalSearchResultClick(ITEM);
  assert.deepEqual(gtagCalls, [['event', 'select_item', {
    item_list_name: 'Gopersonal - Search Results',
    items: [{ ...GA_ITEM, index: 1, item_list_name: 'Gopersonal - Search Results' }],
  }]]);
});

test('trackGopersonalProductAddToCart fetches the item and sends add_to_cart', async () => {
  seedSession();
  const calls = mockFetch(() => ITEM);
  window.dataLayer = [];
  await trackGopersonalProductAddToCart('p1', 'Cart drawer');
  assert.match(calls[0].url, /\/item\/p1$/);
  assert.deepEqual(window.dataLayer, [{
    event: 'add_to_cart',
    ecommerce: {
      item_list_name: 'Gopersonal - Cart drawer',
      items: [{ ...GA_ITEM, index: 1, item_list_name: 'Cart drawer' }],
    },
  }]);
});

test('trackGopersonalToDataLayer pushes raw params, or reports a missing dataLayer', () => {
  trackGopersonalToDataLayer({ event: 'raw' });
  assert.equal(errorLog.mock.calls[0].arguments[0], 'dataLayer not available');
  window.dataLayer = [];
  trackGopersonalToDataLayer({ event: 'raw', value: 1 });
  assert.deepEqual(window.dataLayer, [{ event: 'raw', value: 1 }]);
});
