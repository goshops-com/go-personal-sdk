import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, mockFetch, seedSession, flush, jsonResponse, getDom, setUrl } from './helpers/env.mjs';
import { mountShopper } from '../../src/api/shopper.js';
import { storeLink } from '../../src/api/shopperActions.js';
import { getApiBaseURL } from '../../src/utils/http.js';

const WIDGET_URL = 'https://widget.example/shopper/index.html';
const WIDGET_ORIGIN = 'https://widget.example';
const API = getApiBaseURL();
const SESSION_KEY = `gp-shopper-v1:${API}:session-1`;

let mounted = [];

const CONFIG_URL = `${API}/public/shopper-config/project-1`;
const CONFIG_KEY = `gp-shopper-config-v1:${API}:project-1`;
const CONFIG = { enabled: true, version: 1, name: 'Ana', color: '#123456' };

const bootstrapResponse = (extra = {}) => ({ token: 'boot-token', expiresIn: 600, config: { color: 'rgb(1, 2, 3)' }, ...extra });

// Mockea fetch: la config del shopper responde con `config` y el resto con `bootstrap`.
const shopperFetch = (bootstrap = () => ({}), config = () => CONFIG) =>
  mockFetch((url, init, call) => (url === CONFIG_URL ? config(url, init, call) : bootstrap(url, init, call)));

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

test('mounting asks for the shopper config with the session, shows the launcher with its color and caches it', async () => {
  const calls = shopperFetch();
  mount();
  assert.equal(parts().launcher, null, 'without a cached config the launcher waits for it');
  await flush();

  const configCalls = calls.filter((call) => call.url === CONFIG_URL);
  assert.equal(configCalls.length, 1);
  assert.equal(configCalls[0].method, 'GET');
  assert.deepEqual(configCalls[0].headers, {}, 'sin headers: sin preflight CORS y cacheable en el CDN');
  assert.equal(parts().launcher.style.background, 'rgb(18, 52, 86)');
  assert.deepEqual(JSON.parse(localStorage.getItem(CONFIG_KEY)), CONFIG);
});

test('a cached config paints the launcher right away and the fresh one is only stored for the next page load', async () => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...CONFIG, color: '#000001' }));
  const calls = shopperFetch(() => ({}), () => ({ ...CONFIG, version: 2, color: '#ffffff' }));
  mount();
  assert.equal(parts().launcher.style.background, 'rgb(0, 0, 1)');
  await flush();

  assert.equal(calls.filter((call) => call.url === CONFIG_URL).length, 1, 'the config is refreshed on every load');
  assert.equal(parts().launcher.style.background, 'rgb(0, 0, 1)', 'the design does not change while the page is open');
  assert.equal(JSON.parse(localStorage.getItem(CONFIG_KEY)).color, '#ffffff');
});

test('a disabled shopper shows no launcher and an embedded one does not bootstrap', async () => {
  const calls = shopperFetch(() => bootstrapResponse(), () => ({ enabled: false }));
  mount();
  document.body.insertAdjacentHTML('beforeend', '<div id="slot"></div>');
  mount({ container: '#slot' });
  await flush();

  assert.equal(parts().launcher, null);
  assert.equal(bootstrapCalls(calls).length, 0);
  assert.deepEqual(JSON.parse(localStorage.getItem(CONFIG_KEY)), { enabled: false });
});

test('a cached disabled config hides the launcher on this load even if the shopper was enabled since', async () => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ enabled: false }));
  shopperFetch();
  mount();
  await flush();
  assert.equal(parts().launcher, null);
  assert.deepEqual(JSON.parse(localStorage.getItem(CONFIG_KEY)), CONFIG, 'the next load shows it');
});

test('if the config request fails the cache is kept, and without cache the default launcher is shown', async () => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...CONFIG, color: '#000001' }));
  shopperFetch(() => ({}), () => jsonResponse({}, { status: 500 }));
  mount();
  await flush();
  assert.equal(parts().launcher.style.background, 'rgb(0, 0, 1)');
  assert.equal(JSON.parse(localStorage.getItem(CONFIG_KEY)).color, '#000001');

  resetDom(); seedSession();
  shopperFetch(() => ({}), () => jsonResponse({}, { status: 500 }));
  mount();
  await flush();
  assert.equal(parts().launcher.style.background, 'rgb(94, 64, 191)');
  assert.equal(localStorage.getItem(CONFIG_KEY), null);
});

test('an unreadable cache or an invalid color are ignored', async () => {
  localStorage.setItem(CONFIG_KEY, '{not json');
  shopperFetch(() => ({}), () => ({ ...CONFIG, color: 'red; position: static' }));
  mount();
  assert.equal(parts().launcher, null, 'a broken cache counts as no cache');
  await flush();
  assert.equal(parts().launcher.style.background, 'rgb(94, 64, 191)');
});

test('without a project in the session the config is not requested and the default launcher is shown', async () => {
  seedSession({ project: undefined });
  const calls = shopperFetch();
  mount();
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(parts().launcher.style.background, 'rgb(94, 64, 191)');
  assert.equal(localStorage.length, 1, 'only the SDK session is stored');
});

test('the launcher is shown even when the config cannot be stored', async () => {
  shopperFetch();
  mock.method(Object.getPrototypeOf(localStorage), 'setItem', () => { throw new Error('QuotaExceededError'); });
  mount();
  await flush();
  assert.equal(parts().launcher.style.background, 'rgb(18, 52, 86)');
});

test('destroying before the config arrives shows nothing', async () => {
  let release;
  shopperFetch(() => ({}), () => new Promise((resolve) => { release = () => resolve(CONFIG); }));
  const shopper = mount();
  await flush();
  shopper.destroy();
  release();
  await flush();
  assert.equal(document.querySelector('button'), null);
});

test('the chat receives the appearance of the public config the launcher was painted with', async () => {
  const appearance = { cards: { display: 'grid' }, customCss: '.gps-card { color: red; }' };
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...CONFIG, appearance }));
  shopperFetch(() => bootstrapResponse(), () => ({ ...CONFIG, version: 2, appearance: { cards: { display: 'carousel' } } }));
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.deepEqual(posts[0].message.session.appearance, appearance, 'same design as the launcher on this page');
});

test('without appearance in the config the chat initialize does not include it', async () => {
  shopperFetch(() => bootstrapResponse(), () => ({ ...CONFIG, appearance: 'broken' }));
  const shopper = mount();
  await flush();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.equal('appearance' in posts[0].message.session, false);
});

test('mounting the floating launcher does not bootstrap until it is opened', async () => {
  const calls = shopperFetch(() => bootstrapResponse());
  mount();
  await flush();

  const { panel, iframe, error, launcher } = parts();
  assert.equal(bootstrapCalls(calls).length, 0);
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
  const calls = shopperFetch(() => bootstrapResponse());
  mount();
  await flush();
  const { panel, iframe, launcher } = parts();

  launcher.click();
  await flush();

  assert.equal(bootstrapCalls(calls).length, 1);
  assert.equal(bootstrapCalls(calls)[0].url, `${API}/shopper/v1/bootstrap`);
  assert.equal(bootstrapCalls(calls)[0].method, 'POST');
  assert.equal(bootstrapCalls(calls)[0].headers.Authorization, 'Bearer token-1');
  assert.equal(panel.hidden, false);
  assert.equal(panel.style.display, 'block');
  assert.equal(panel.style.getPropertyPriority('display'), 'important');
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(iframe.hidden, false);
  assert.equal(iframe.src, `${WIDGET_URL}?hostOrigin=${encodeURIComponent('https://shop.example')}`);
  assert.equal(launcher.style.background, 'rgb(18, 52, 86)', 'the color comes from the shopper config, not from the bootstrap');

  launcher.click();
  assert.equal(panel.hidden, true);
  assert.equal(panel.style.display, 'none');
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, launcher);

  // Reopening with a bootstrap that is still valid does not ask for another one.
  launcher.click();
  await flush();
  assert.equal(panel.hidden, false);
  assert.equal(bootstrapCalls(calls).length, 1);
});

test('the widget is initialized once it says it is ready, and only messages from its own frame count', async () => {
  shopperFetch(() => bootstrapResponse({ config: { color: 'rgb(1, 2, 3)', name: 'Ana' } }));
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
  shopperFetch(() => bootstrapResponse());
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
  const calls = shopperFetch(() => bootstrapResponse());
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
  assert.equal(bootstrapCalls(calls).length, 1, 'same session: no new bootstrap');
});

test('setContext bootstraps again when the SDK session changed', async () => {
  const calls = shopperFetch(() => bootstrapResponse());
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
  shopperFetch(() => bootstrapResponse());
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
  shopperFetch(() => bootstrapResponse());
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.equal(posts[0].message.session.conversationId, 'conv-stored');
});

test('without a session id there is no session key and no stored conversation', async () => {
  seedSession({ sessionId: undefined });
  shopperFetch(() => bootstrapResponse());
  const shopper = mount();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  fromWidget(iframe, { type: 'gp-shopper:conversation', id: 'conv-2' });

  assert.equal(posts[0].message.session.sessionKey, null);
  assert.equal(localStorage.length, 2, 'only the SDK session and the shopper config are stored');
});

test('the widget can ask for a fresh token and for the panel to close', async () => {
  let n = 0;
  const calls = shopperFetch(() => bootstrapResponse({ token: `boot-${++n}` }));
  const shopper = mount();
  await shopper.open();
  const { iframe, panel, launcher } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.equal(posts[0].message.session.token, 'boot-1');

  fromWidget(iframe, { type: 'gp-shopper:refresh' });
  await flush();
  assert.equal(bootstrapCalls(calls).length, 2);
  assert.equal(posts.at(-1).message.session.token, 'boot-2');

  fromWidget(iframe, { type: 'gp-shopper:close' });
  assert.equal(panel.hidden, true);
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
});

test('concurrent opens share a single bootstrap request', async () => {
  const calls = shopperFetch(() => bootstrapResponse());
  const shopper = mount();
  await Promise.all([shopper.open(), shopper.open()]);
  assert.equal(bootstrapCalls(calls).length, 1);
});

test('the token is renewed a minute before it expires while the panel is open', async () => {
  const calls = shopperFetch(() => bootstrapResponse({ expiresIn: 120 }));
  const shopper = mount();
  await shopper.open();
  assert.equal(bootstrapCalls(calls).length, 1);

  mock.timers.tick(59999);
  await flush();
  assert.equal(bootstrapCalls(calls).length, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(bootstrapCalls(calls).length, 2);

  // Hidden panel: the renewal is skipped...
  shopper.close();
  mock.timers.tick(60000);
  await flush();
  assert.equal(bootstrapCalls(calls).length, 2);

  // ...and the next open, with the token about to expire, bootstraps again.
  mock.timers.tick(40000);
  await shopper.open();
  assert.equal(bootstrapCalls(calls).length, 3);
});

test('a short-lived token is renewed no sooner than one second later', async () => {
  const calls = shopperFetch(() => bootstrapResponse({ expiresIn: 30 }));
  const shopper = mount();
  await shopper.open();
  mock.timers.tick(999);
  await flush();
  assert.equal(bootstrapCalls(calls).length, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(bootstrapCalls(calls).length, 2);
});

test('a failed bootstrap shows an error instead of the widget, and the next open retries', async () => {
  let fail = true;
  const calls = shopperFetch(() => (fail ? jsonResponse({}, { status: 500 }) : bootstrapResponse()));
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
  assert.equal(bootstrapCalls(calls).length, 2);
  assert.equal(error.hidden, true);
  assert.equal(iframe.hidden, false);
  assert.match(iframe.src, /^https:\/\/widget\.example\//);
});

test('with a container the shopper is embedded: opens right away, has no launcher and cannot be closed by the widget', async () => {
  document.body.innerHTML = '<div id="slot"></div>';
  const calls = shopperFetch(() => bootstrapResponse());
  mount({ container: '#slot' });
  await flush();

  const { panel, iframe, launcher } = parts();
  assert.equal(panel.parentNode, document.getElementById('slot'));
  assert.equal(launcher, null);
  assert.equal(bootstrapCalls(calls).length, 1);
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
  shopperFetch(() => bootstrapResponse());
  mount({ container: slot });
  await flush();
  assert.equal(parts().panel.parentNode, slot);
});

test('destroy removes the UI and stops reacting to the widget, the launcher and the renewal timer', async () => {
  const calls = shopperFetch(() => bootstrapResponse({ expiresIn: 120 }));
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
  assert.equal(bootstrapCalls(calls).length, 1);
  assert.deepEqual(posts, []);
  assert.equal(panel.hidden, false, 'open() after destroy leaves the detached panel untouched');
  assert.equal(launcher.isConnected, false);
});

test('destroying while the bootstrap is in flight leaves nothing behind', async () => {
  let release;
  shopperFetch(() => new Promise((resolve) => { release = () => resolve(bootstrapResponse()); }));
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

// Config pública con la habilidad de agregar al carrito activada o apagada.
const withCart = (enabled = true) => () => ({ ...CONFIG, skills: { addToCart: enabled, openProduct: false, openPages: false } });

// Monta el shopper, espera la config pública, abre el chat y deja el widget listo; devuelve el iframe y los mensajes del SDK.
async function openReady(options = {}, config = withCart()) {
  shopperFetch(() => bootstrapResponse(), config);
  const shopper = mount(options);
  await flush();
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  return { shopper, iframe, posts };
}
// Pide una acción desde el widget y espera su resultado.
async function askAction(iframe, actionId, action = 'add_to_cart', product = { id: 'p1' }, options = {}) {
  fromWidget(iframe, { type: 'gp-shopper:action', actionId, action, product }, options);
  await flush();
}
const results = (posts) => posts.filter((post) => post.message.type === 'gp-shopper:action-result').map((post) => post.message);

test('turning a skill off in the admin stops it on the open page as soon as the fresh config arrives', async () => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(withCart(true)()));
  let release;
  shopperFetch(() => bootstrapResponse(), () => new Promise((resolve) => { release = () => resolve(withCart(false)()); }));
  const added = [];
  const shopper = mount({ cart: { add: async (item) => { added.push(item); } } });
  await shopper.open();
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.deepEqual(posts[0].message.session.capabilities, ['add_to_cart'], 'antes de la config fresca vale la cacheada');
  release();
  await flush();
  await askAction(iframe, 'late-1');
  assert.deepEqual(added, []);
  assert.equal(results(posts)[0].error, 'unavailable');
  const sessions = posts.filter((post) => post.message.type === 'gp-shopper:initialize');
  assert.equal(sessions.length, 2, 'al llegar la config fresca se le vuelve a mandar la sesión');
  assert.equal('capabilities' in sessions[1].message.session, false, 'el chat se entera solo de que ya no puede agregar');
});

test('the chat learns it can add to cart only when the skill is on and this site knows how to do it', async () => {
  const custom = await openReady({ cart: { add: async () => {} } });
  assert.deepEqual(custom.posts[0].message.session.capabilities, ['add_to_cart'], 'callback propio');
  custom.shopper.destroy();

  window.gsConfig.options.provider = 'Shopify';
  const platform = await openReady();
  assert.deepEqual(platform.posts[0].message.session.capabilities, ['add_to_cart'], 'plataforma soportada');
  platform.shopper.destroy();

  const skillOff = await openReady({ cart: { add: async () => {} } }, withCart(false));
  assert.equal('capabilities' in skillOff.posts[0].message.session, false, 'habilidad apagada en la config');
  skillOff.shopper.destroy();

  const noSkills = await openReady({ cart: { add: async () => {} } }, () => CONFIG);
  assert.equal('capabilities' in noSkills.posts[0].message.session, false, 'config sin skills');
  noSkills.shopper.destroy();

  window.gsConfig.options.provider = 'Custom';
  const noExecutor = await openReady();
  assert.equal('capabilities' in noExecutor.posts[0].message.session, false, 'nadie sabe agregar en este sitio');
});

test('an add_to_cart action from the chat runs once, tells the page and answers the widget', async () => {
  const added = []; const events = [];
  window.addEventListener('gp-shopper:cart-added', (event) => events.push(event.detail));
  const { iframe, posts } = await openReady({ cart: { add: async (item) => { added.push(item); return { ok: true, cartUrl: '/carrito' }; } } });
  const product = { id: 'p1', variantId: 'v1', url: 'https://shop.example/products/a', quantity: 2 };
  await askAction(iframe, 'act-1', 'add_to_cart', product);
  await askAction(iframe, 'act-1', 'add_to_cart', product);

  const item = { productId: 'p1', variantId: 'v1', url: 'https://shop.example/products/a', quantity: 2 };
  assert.deepEqual(added, [item], 'the same actionId runs only once');
  assert.deepEqual(events, [{ ...item, cartUrl: '/carrito' }]);
  assert.deepEqual(results(posts), [{ type: 'gp-shopper:action-result', actionId: 'act-1', ok: true, cartUrl: '/carrito' }]);
  assert.equal(posts.at(-1).origin, WIDGET_ORIGIN);
});

test('an action whose skill is off, unknown or malformed is answered with an error and never touches the cart', async () => {
  const added = [];
  const executor = { cart: { add: async (item) => { added.push(item); } } };
  const off = await openReady(executor, withCart(false));
  await askAction(off.iframe, 'off-1');
  assert.deepEqual(results(off.posts).map((r) => r.error), ['unavailable'], 'habilidad apagada');
  off.shopper.destroy();

  const on = await openReady(executor);
  await askAction(on.iframe, 'bad-1', 'add_to_cart', { id: 'p1', quantity: 50 });
  await askAction(on.iframe, 'bad-2', 'checkout');
  await askAction(on.iframe, 'no spaces allowed');
  await askAction(on.iframe, undefined);
  await askAction(on.iframe, 'evil-1', 'add_to_cart', { id: 'p1' }, { origin: 'https://evil.example' });
  assert.deepEqual(added, []);
  assert.deepEqual(results(on.posts).map((r) => [r.actionId, r.error]), [['bad-1', 'invalid_action'], ['bad-2', 'unavailable']],
    'malformed ids and foreign origins get no answer');
});

test('a failed add is answered with its error and does not tell the page', async () => {
  const events = [];
  window.addEventListener('gp-shopper:cart-added', (event) => events.push(event.detail));
  const { iframe, posts } = await openReady({ cart: { add: async () => ({ ok: false, error: 'variant_required' }) } });
  await askAction(iframe, 'act-3');
  assert.deepEqual(results(posts), [{ type: 'gp-shopper:action-result', actionId: 'act-3', ok: false, error: 'variant_required' }]);
  assert.deepEqual(events, []);
});

test('destroying the shopper while adding to cart sends nothing back and does not tell the page', async () => {
  let release; const events = [];
  window.addEventListener('gp-shopper:cart-added', (event) => events.push(event.detail));
  const { shopper, iframe, posts } = await openReady({ cart: { add: () => new Promise((resolve) => { release = resolve; }) } });
  await askAction(iframe, 'act-4');
  shopper.destroy();
  release({ ok: true });
  await flush();
  assert.deepEqual(results(posts), []);
  assert.deepEqual(events, []);
});

// jsdom no navega: cada location.assign a otro documento solo avisa "not implemented" en su consola, y eso se cuenta.
const navigations = [];
getDom().virtualConsole.on('jsdomError', (error) => {
  if (/navigation/i.test(error.message)) navigations.push(error.message);
});

// Config pública con las habilidades de navegación dadas y el carrito apagado.
const withLinks = ({ openProduct = true, openPages = true } = {}) => () => ({ ...CONFIG, skills: { addToCart: false, openProduct, openPages } });

// Pide desde el widget abrir un producto o una página y espera su resultado.
async function askOpen(iframe, actionId, action, url) {
  const payload = action === 'open_product' ? { product: { id: 'p1', url } } : { page: { url } };
  fromWidget(iframe, { type: 'gp-shopper:action', actionId, action, ...payload });
  await flush();
}

test('the chat learns it can open products and store pages only when each skill is on', async () => {
  const both = await openReady({}, withLinks());
  assert.deepEqual(both.posts[0].message.session.capabilities, ['open_product', 'open_page']);
  both.shopper.destroy();

  const pagesOnly = await openReady({}, withLinks({ openProduct: false }));
  assert.deepEqual(pagesOnly.posts[0].message.session.capabilities, ['open_page']);
  pagesOnly.shopper.destroy();

  const all = await openReady({ cart: { add: async () => {} } }, () => ({ ...CONFIG, skills: { addToCart: true, openProduct: true, openPages: true } }));
  assert.deepEqual(all.posts[0].message.session.capabilities, ['add_to_cart', 'open_product', 'open_page']);
});

test('opening a product or a store page navigates within the store and answers the widget', async () => {
  navigations.length = 0;
  const { iframe, posts } = await openReady({}, withLinks());
  await askOpen(iframe, 'nav-1', 'open_product', 'https://shop.example/products/remera');
  await askOpen(iframe, 'nav-1', 'open_product', 'https://shop.example/products/remera');
  await askOpen(iframe, 'nav-2', 'open_page', '/pages/envios');
  await askOpen(iframe, 'nav-3', 'open_page', 'https://www.shop.example/pages/cambios');
  assert.equal(navigations.length, 3, 'the same actionId navigates only once');
  assert.deepEqual(results(posts).map((r) => [r.actionId, r.ok]), [['nav-1', true], ['nav-2', true], ['nav-3', true]]);
});

test('links outside the store, without URL or with another scheme are rejected without navigating', async () => {
  navigations.length = 0;
  const { iframe, posts } = await openReady({}, withLinks());
  await askOpen(iframe, 'out-1', 'open_product', 'https://evil.example/products/remera');
  await askOpen(iframe, 'out-2', 'open_page', 'https://shop.example.evil.example/');
  await askOpen(iframe, 'out-3', 'open_page', 'javascript:alert(1)');
  await askOpen(iframe, 'out-4', 'open_page', 'http://[bad');
  await askOpen(iframe, 'out-5', 'open_page', 42);
  fromWidget(iframe, { type: 'gp-shopper:action', actionId: 'out-6', action: 'open_product' });
  await flush();
  assert.deepEqual(navigations, []);
  assert.deepEqual(results(posts).map((r) => r.error), Array(6).fill('invalid_action'));
});

test('opening a product or a page whose skill is off is answered as unavailable without navigating', async () => {
  navigations.length = 0;
  const { iframe, posts } = await openReady({}, withLinks({ openProduct: false, openPages: false }));
  await askOpen(iframe, 'off-p', 'open_product', 'https://shop.example/products/remera');
  await askOpen(iframe, 'off-g', 'open_page', '/pages/envios');
  assert.deepEqual(navigations, []);
  assert.deepEqual(results(posts).map((r) => r.error), ['unavailable', 'unavailable']);
});

// Simula la carga de la página de destino: vuelve a montar el shopper y espera su config.
async function nextPage() {
  mounted.forEach((shopper) => shopper.destroy());
  mounted = [];
  shopperFetch(() => bootstrapResponse(), withLinks());
  mount();
  await flush();
  return parts();
}

test('a chat that navigates to another page of the store opens again by itself on the next page, only once', async () => {
  const { iframe } = await openReady({}, withLinks());
  await askOpen(iframe, 'go-1', 'open_page', '/pages/envios');
  assert.ok(sessionStorage.getItem('gp-shopper-reopen'), 'deja la marca antes de navegar');

  const next = await nextPage();
  assert.equal(next.panel.hidden, false, 'el chat se abre solo');
  assert.equal(next.launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(sessionStorage.getItem('gp-shopper-reopen'), null, 'la marca se usa una sola vez');

  const after = await nextPage();
  assert.equal(after.panel.hidden, true, 'una carga posterior no lo reabre');
});

test('an old reopen mark is ignored and removed', async () => {
  sessionStorage.setItem('gp-shopper-reopen', String(Date.now()));
  mock.timers.tick(31000);
  const { panel } = await nextPage();
  assert.equal(panel.hidden, true);
  assert.equal(sessionStorage.getItem('gp-shopper-reopen'), null);
});

test('a link to the store on another origin carries the reopen param, which is removed from the address bar on arrival', async () => {
  assert.equal(storeLink('/pages/envios'), 'https://shop.example/pages/envios', 'mismo origen: sin param');
  assert.equal(storeLink('https://www.shop.example/pages/envios?a=1'), 'https://www.shop.example/pages/envios?a=1&gp_shopper=open');
  assert.equal(storeLink('http://shop.example/pages/envios'), 'http://shop.example/pages/envios?gp_shopper=open');

  setUrl('https://www.shop.example/pages/envios?a=1&gp_shopper=open#talles');
  const { panel } = await nextPage();
  assert.equal(panel.hidden, false, 'el chat se abre solo');
  assert.equal(location.href, 'https://www.shop.example/pages/envios?a=1#talles');
});

test('without sessionStorage navigating still works and the next page keeps the chat closed', async () => {
  navigations.length = 0;
  const { iframe, posts } = await openReady({}, withLinks());
  const proto = Object.getPrototypeOf(sessionStorage);
  const { getItem, setItem } = proto;
  proto.getItem = function failing(key) { if (key === 'gp-shopper-reopen') throw new Error('SecurityError'); return getItem.call(this, key); };
  proto.setItem = function failing(key, value) { if (key === 'gp-shopper-reopen') throw new Error('SecurityError'); return setItem.call(this, key, value); };
  try {
    await askOpen(iframe, 'go-2', 'open_product', '/products/remera');
    assert.equal(navigations.length, 1);
    assert.equal(results(posts)[0].ok, true);
    const { panel } = await nextPage();
    assert.equal(panel.hidden, true);
  } finally {
    proto.getItem = getItem;
    proto.setItem = setItem;
  }
});

test('if the stored conversation cannot be read the chat still opens, without a previous conversation', async () => {
  shopperFetch(() => bootstrapResponse());
  const shopper = mount();
  await flush();
  const original = Object.getPrototypeOf(localStorage).getItem;
  Object.getPrototypeOf(localStorage).getItem = function getItem(key) {
    if (key === SESSION_KEY) throw new Error('SecurityError');
    return original.call(this, key);
  };
  try {
    await shopper.open();
  } finally {
    Object.getPrototypeOf(localStorage).getItem = original;
  }
  const { iframe } = parts();
  const posts = spyPosts(iframe);
  fromWidget(iframe, { type: 'gp-shopper:ready' });
  assert.equal(iframe.hidden, false);
  assert.equal('conversationId' in posts[0].message.session, false);
});

test('a network error asking for the config shows the default launcher', async () => {
  mockFetch((url) => {
    if (url === CONFIG_URL) throw new TypeError('Failed to fetch');
    return bootstrapResponse();
  });
  mount();
  await flush();
  assert.equal(parts().launcher.style.background, 'rgb(94, 64, 191)');
  assert.equal(localStorage.getItem(CONFIG_KEY), null);
});
