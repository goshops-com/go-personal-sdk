import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { flush, jsonResponse, mockFetch, resetDom, seedSession } from './helpers/env.mjs';
import { installVtexCheckout } from '../../src/vendors/vtexCheckout.js';

const IDENTIFIED_KEY = 'gs-vtex-ck-identified';
let documentListeners = [];

// Lets the pending requests answer and the timers of the module (cart settle
// time, vtex.js retries, orderForm polling) go by.
async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await flush(3);
    mock.timers.tick(1500);
  }
  await flush();
}

const orderForm = (email, items = []) => ({
  clientProfileData: email === null ? null : { email },
  items,
});

/**
 * A checkout page with the SDK session and a fake API. `backend` plays the
 * session: cart interactions land in `backend.cart` unless a test makes them
 * fail or get lost.
 *
 * The module keeps its state (who is identified, the last cart it synced) at
 * module level and it cannot be reset, so the tests that need a page nobody
 * was identified on come first, and every test identifies a different email.
 */
async function loadCheckout({
  url = 'https://shop.example/checkout/#/email',
  session = { sessionId: 's1' },
  jquery = true,
  vtexjs = true,
  options = {},
  initialOrderForm,
  identifiedMark,
  install = true,
} = {}) {
  resetDom({ url });
  window.gsStore = { interactionCount: 0 };
  window.gsConfig = { clientId: 'client-1', options: { provider: 'VTEX' } };
  seedSession(session);
  if (identifiedMark) sessionStorage.setItem(IDENTIFIED_KEY, identifiedMark);
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

  const backend = {
    cart: new Map(), logins: [], sent: [], bulkBodies: [], stateReads: 0, version: 1,
    drop: 0, loginFails: false, bulkFails: false, stateFails: false, emptyBody: false, loginGate: null,
  };
  const calls = mockFetch(async (requestUrl, init, call) => {
    const { pathname } = new URL(requestUrl);
    if (pathname === '/channel/login') {
      backend.logins.push(call.body.email);
      if (backend.loginGate) await backend.loginGate;
      return backend.loginFails ? jsonResponse({}, { status: 500 }) : { msg: 'Logged in' };
    }
    if (pathname === '/channel/state') {
      backend.stateReads++;
      if (backend.stateFails) return jsonResponse({}, { status: 500 });
      if (backend.emptyBody) {
        return { ...jsonResponse(''), json: async () => JSON.parse('') };
      }
      return {
        cart: {
          updatedAt: backend.version,
          products: [...backend.cart].map(([id, quantity]) => ({ id, quantity })),
        },
      };
    }
    if (pathname === '/interaction/bulk') {
      backend.bulkBodies.push(call.body);
      for (const event of call.body.events) {
        backend.sent.push(`${event.event}:${event.item}:${event.quantity}${event.fullOverride ? ':override' : ''}`);
        if (backend.bulkFails) return jsonResponse({}, { status: 500 });
        if (backend.drop > 0) {
          backend.drop--;
        } else if (event.event === 'cart') {
          backend.cart.set(event.item, event.quantity);
        } else {
          backend.cart.delete(event.item);
        }
        backend.version++;
      }
    }
    return {};
  });

  // vtex.js announces orderForm changes through jQuery events.
  const handlers = [];
  if (jquery) {
    const $ = (target) => ({ on: (name, handler) => handlers.push({ name, handler, target }) });
    $.fn = { on() {} };
    window.jQuery = $;
  }
  if (vtexjs) window.vtexjs = { checkout: { orderForm: initialOrderForm } };

  // Every install adds its own document listeners: keep them to remove them afterwards.
  if (!document.addEventListener.mock) {
    const add = document.addEventListener.bind(document);
    mock.method(document, 'addEventListener', (...args) => {
      documentListeners.push(args);
      return add(...args);
    });
  }

  if (install) {
    installVtexCheckout(options);
    await settle();
  }

  const update = async (form, { wait = true } = {}) => {
    window.vtexjs.checkout.orderForm = form;
    handlers.forEach(({ handler }) => handler({}, form));
    if (wait) await settle();
  };
  // What the browser does when the shopper leaves a field of the checkout.
  const leaveField = async (id, value, { wait = true } = {}) => {
    let field = document.getElementById(id);
    if (!field) {
      field = document.createElement('input');
      field.id = id;
      document.body.appendChild(field);
    }
    field.value = value;
    field.dispatchEvent(new window.Event('change', { bubbles: true }));
    field.dispatchEvent(new window.Event('blur'));
    if (wait) await settle();
  };

  return { backend, calls, handlers, update, leaveField };
}

afterEach(() => {
  documentListeners.forEach((args) => document.removeEventListener(...args));
  documentListeners = [];
  mock.timers.reset();
  mock.restoreAll();
  delete window.jQuery;
  delete window.$;
  delete window.vtexjs;
});

test('only installs on the VTEX checkout, never on the order placed page', async () => {
  for (const url of ['https://shop.example/', 'https://shop.example/producto/p', 'https://shop.example/checkout/orderPlaced/?og=1']) {
    const { handlers } = await loadCheckout({ url });
    assert.equal(handlers.length, 0, url);
    assert.equal(window.__gsVtexCheckoutInstalled, undefined, url);
    assert.equal(documentListeners.length, 0, url);
  }

  const off = await loadCheckout({ options: { vtexCheckout: false } });
  assert.equal(off.handlers.length, 0);
  assert.equal(window.__gsVtexCheckoutInstalled, undefined);

  const on = await loadCheckout({ url: 'https://shop.example/Checkout/' });
  installVtexCheckout({});
  installVtexCheckout();
  assert.equal(window.__gsVtexCheckoutInstalled, true);
  assert.deepEqual(on.handlers.map((entry) => [entry.name, entry.target]), [['orderFormUpdated.vtex', window]]);
  assert.deepEqual(documentListeners.map(([type, , capture]) => [type, capture]), [['change', true], ['blur', true]]);
});

test('waits for vtex.js to load, retrying every 500ms', async () => {
  const { handlers } = await loadCheckout({ vtexjs: false, install: false });
  installVtexCheckout({});
  mock.timers.tick(500);
  mock.timers.tick(500);
  assert.equal(handlers.length, 0);

  window.vtexjs = { checkout: {} };
  mock.timers.tick(499);
  assert.equal(handlers.length, 0);
  mock.timers.tick(1);
  assert.equal(handlers.length, 1);
});

test('gives up waiting for vtex.js after 20 retries', async () => {
  const { handlers } = await loadCheckout({ vtexjs: false, install: false });
  installVtexCheckout({});
  for (let i = 0; i < 20; i++) mock.timers.tick(500);

  window.vtexjs = { checkout: {} };
  for (let i = 0; i < 10; i++) mock.timers.tick(500);
  assert.equal(handlers.length, 0);
});

test('masked, partial or missing emails never identify anyone', async () => {
  const { backend, calls, update, leaveField } = await loadCheckout();
  const items = [{ productId: '10', quantity: 1 }];

  await update(orderForm(null, items));
  await update(orderForm('ada', items));
  await update(orderForm('a***@e***.com', items));
  await update(orderForm(12345, items));
  await update(undefined);
  await leaveField('client-email', 'a***@e***.com');
  await leaveField('client-email', '');

  assert.deepEqual(backend.logins, []);
  assert.equal(calls.length, 0);
});

test('a guest email logs in by email and sends the cart once', async () => {
  const { backend, calls, update } = await loadCheckout();
  // The storefront already put the cart in the session.
  backend.cart.set('10', 2);

  await update(orderForm(null, [{ productId: '10', quantity: 2 }]));
  assert.equal(calls.length, 0);

  const filled = orderForm(' Ada@Example.com ', [{ productId: '10', quantity: 2 }]);
  await update(filled);
  assert.deepEqual(backend.logins, ['ada@example.com']);
  const login = calls.find((call) => call.url.endsWith('/channel/login'));
  assert.equal(login.method, 'POST');
  assert.deepEqual(login.body, { email: 'ada@example.com' });
  // Carts match, but the customer only gets the cart from a cart interaction.
  assert.deepEqual(backend.sent, ['cart:10:2:override']);
  assert.equal(typeof backend.bulkBodies[0].transactionId, 'string');
  assert.deepEqual(backend.bulkBodies[0].events, [
    { event: 'cart', item: '10', quantity: 2, fullOverride: true, provider: 'vtex' },
  ]);
  assert.equal(sessionStorage.getItem(IDENTIFIED_KEY), 's1|ada@example.com');

  // Address and shipping edits update the orderForm without touching the cart.
  const requests = calls.length;
  await update(filled);
  await update({ ...filled, shippingData: { address: 'x' } });
  assert.equal(calls.length, requests);
});

test('without jQuery the orderForm is polled every 3 seconds', async () => {
  const { backend } = await loadCheckout({ jquery: false });
  backend.cart.set('10', 1);
  assert.deepEqual(backend.logins, []);

  window.vtexjs.checkout.orderForm = orderForm('poll@example.com', [{ productId: '10', quantity: 1 }]);
  mock.timers.tick(2999);
  await flush();
  assert.deepEqual(backend.logins, []);
  mock.timers.tick(1);
  await settle();

  assert.deepEqual(backend.logins, ['poll@example.com']);
  assert.deepEqual(backend.sent, ['cart:10:1:override']);
});

test('an orderForm that is already loaded is handled on install', async () => {
  const { backend } = await loadCheckout({
    initialOrderForm: orderForm('loaded@example.com', [{ productId: '10', quantity: 1 }]),
  });

  assert.deepEqual(backend.logins, ['loaded@example.com']);
  assert.deepEqual(backend.sent, ['cart:10:1:override']);
  assert.deepEqual([...backend.cart], [['10', 1]]);
});

test('the session cart follows the checkout cart, one change at a time', async () => {
  const { backend, update } = await loadCheckout();
  backend.cart.set('10', 1);
  backend.cart.set('30', 1);
  // The first write is lost, as when two interactions overlap.
  backend.drop = 1;

  await update(orderForm('follow@example.com', [
    { productId: 10, quantity: 1 },
    { productId: 10, quantity: 2 },
    { productId: 20 },
    { quantity: 4 },
    null,
  ]));

  assert.deepEqual(backend.sent, [
    'cart:10:3:override',
    'cart:10:3:override',
    'cart:20:1:override',
    'remove-cart:30:1',
  ]);
  assert.deepEqual([...backend.cart], [['10', 3], ['20', 1]]);

  await update(orderForm('follow@example.com', [{ productId: 10, quantity: 3 }]));
  assert.equal(backend.sent.at(-1), 'remove-cart:20:1');
  assert.deepEqual([...backend.cart], [['10', 3]]);
});

test('a cart change arriving during a sync gets one more pass, so the last cart wins', async () => {
  const { backend, update } = await loadCheckout();

  await update(orderForm('race@example.com', [{ productId: '10', quantity: 1 }]), { wait: false });
  await flush(3);
  await update(orderForm('race@example.com', [{ productId: '10', quantity: 5 }, { productId: '20', quantity: 1 }]), { wait: false });
  await settle();

  assert.deepEqual(backend.logins, ['race@example.com']);
  assert.deepEqual([...backend.cart], [['10', 5], ['20', 1]]);
});

test('a product the catalog cannot resolve is dropped after two tries', async () => {
  const { backend, update } = await loadCheckout();
  backend.drop = Infinity;

  await update(orderForm('ghost@example.com', [{ productId: '404', quantity: 1 }]));

  assert.deepEqual(backend.sent, ['cart:404:1:override', 'cart:404:1:override']);
});

test('a shopper the storefront already logged in is not logged in again', async () => {
  const { backend, update } = await loadCheckout({
    session: { sessionId: 's1', customer_id: 'vtex-user-id', customer_email: 'Store@Example.com' },
  });
  backend.cart.set('10', 1);

  await update(orderForm('store@example.com', [{ productId: '10', quantity: 1 }]));

  assert.deepEqual(backend.logins, []);
  assert.deepEqual(backend.sent, []);
  assert.equal(sessionStorage.getItem(IDENTIFIED_KEY), 's1|store@example.com');

  // Their cart is still kept in line with the checkout.
  await update(orderForm('store@example.com', [{ productId: '10', quantity: 2 }]));
  assert.deepEqual(backend.logins, []);
  assert.deepEqual(backend.sent, ['cart:10:2:override']);
});

test('a failed login sends nothing and is retried on the next update', async () => {
  const { backend, update } = await loadCheckout();
  backend.loginFails = true;

  const filled = orderForm('retry@example.com', [{ productId: '10', quantity: 1 }]);
  await update(filled);
  assert.deepEqual(backend.logins, ['retry@example.com']);
  assert.deepEqual(backend.sent, []);
  assert.equal(sessionStorage.getItem(IDENTIFIED_KEY), null);

  backend.loginFails = false;
  await update(filled);
  assert.deepEqual(backend.logins, ['retry@example.com', 'retry@example.com']);
  assert.deepEqual(backend.sent, ['cart:10:1:override']);
});

test('after a reload of the same session a matching cart is not sent again', async () => {
  // What the previous page left: this session already identified this email.
  const { backend, update } = await loadCheckout({ identifiedMark: 's1|reload@example.com' });
  backend.cart.set('10', 1);

  await update(orderForm('reload@example.com', [{ productId: '10', quantity: 1 }]));

  assert.deepEqual(backend.logins, ['reload@example.com']);
  assert.deepEqual(backend.sent, []);
});

test('the identified mark of another session does not count', async () => {
  const { backend, update } = await loadCheckout({ identifiedMark: 'old-session|other@example.com' });
  backend.cart.set('10', 1);

  await update(orderForm('other@example.com', [{ productId: '10', quantity: 1 }]));

  assert.deepEqual(backend.logins, ['other@example.com']);
  assert.deepEqual(backend.sent, ['cart:10:1:override']);
  assert.equal(sessionStorage.getItem(IDENTIFIED_KEY), 's1|other@example.com');
});

test('a session without state reads as an empty cart', async () => {
  const { backend, update } = await loadCheckout();
  backend.emptyBody = true;
  backend.drop = Infinity;

  await update(orderForm('empty@example.com', [{ productId: '10', quantity: 1 }]));

  assert.equal(backend.sent[0], 'cart:10:1:override');
});

test('a session state that cannot be read stops the sync until the next change', async () => {
  const { backend, update } = await loadCheckout();
  const logged = [];
  window.gsLog = (...args) => logged.push(args);
  backend.stateFails = true;

  const filled = orderForm('nostate@example.com', [{ productId: '10', quantity: 1 }]);
  await update(filled);
  assert.deepEqual(backend.sent, []);
  assert.ok(logged.some(([message]) => message === '[vtex-checkout] could not read the session state'));
  assert.equal(sessionStorage.getItem(IDENTIFIED_KEY), null);

  backend.stateFails = false;
  await update(filled);
  assert.deepEqual(backend.logins, ['nostate@example.com'], 'no second login: only the cart is retried');
  assert.deepEqual(backend.sent, ['cart:10:1:override']);
});

test('a failed cart interaction is logged and retried on the next orderForm update', async () => {
  const { backend, update } = await loadCheckout();
  const logged = [];
  window.gsLog = (...args) => logged.push(args);
  backend.bulkFails = true;

  const filled = orderForm('bulk@example.com', [{ productId: '10', quantity: 1 }]);
  await update(filled);
  assert.deepEqual(backend.sent, ['cart:10:1:override']);
  assert.deepEqual([...backend.cart], []);
  const failure = logged.find(([message]) => message === '[vtex-checkout] cart sync failed');
  assert.ok(failure);
  assert.match(failure[1].message, /POST request failed: 500/);
  assert.equal(sessionStorage.getItem(IDENTIFIED_KEY), null);

  backend.bulkFails = false;
  await update(filled);
  assert.deepEqual(backend.logins, ['bulk@example.com']);
  assert.deepEqual([...backend.cart], [['10', 1]]);
});

test('an email typed in the checkout field identifies before the orderForm has it', async () => {
  const { backend, update, leaveField } = await loadCheckout();
  backend.cart.set('10', 1);
  backend.cart.set('657', 1);
  // New shopper: the orderForm has no profile until the whole form is sent.
  const items = [{ productId: '10', quantity: 1 }, { productId: '657', quantity: 1, isGift: true }];
  await update(orderForm(null, items));

  await leaveField('cart-coupon', 'typed@example.com');
  await leaveField('client-email', 'typed@exam');
  document.dispatchEvent(new window.Event('change'));
  assert.deepEqual(backend.logins, []);
  assert.deepEqual(backend.sent, []);

  await leaveField('client-email', ' Typed@Example.com ');
  assert.deepEqual(backend.logins, ['typed@example.com']);
  assert.deepEqual(backend.sent, ['cart:10:1:override']);

  // Both `change` and `blur` fire, and the orderForm catches up later.
  await leaveField('client-email', 'typed@example.com');
  await update(orderForm('typed@example.com', items));
  assert.deepEqual(backend.logins, ['typed@example.com']);
  assert.deepEqual(backend.sent, ['cart:10:1:override']);

  // Cart changes are followed even while the orderForm has no email.
  await update(orderForm(null, [{ productId: '10', quantity: 2 }]));
  assert.deepEqual(backend.sent.slice(1), ['cart:10:2:override', 'remove-cart:657:1']);
});

test('a typed email is not undone by the one the orderForm still carries', async () => {
  const { backend, update, leaveField } = await loadCheckout();
  const items = [{ productId: '10', quantity: 1 }];

  await update(orderForm('old@example.com', items));
  await leaveField('client-pre-email', 'new@example.com');
  await update(orderForm('old@example.com', items));
  assert.deepEqual(backend.logins, ['old@example.com', 'new@example.com']);

  await update(orderForm('third@example.com', items));
  assert.deepEqual(backend.logins, ['old@example.com', 'new@example.com', 'third@example.com']);
});

test('an email arriving while another login is in flight goes next', async () => {
  const { backend, update, leaveField } = await loadCheckout();
  let release;
  backend.loginGate = new Promise((resolve) => { release = resolve; });
  const items = [{ productId: '10', quantity: 1 }];

  await update(orderForm('q1@example.com', items), { wait: false });
  await flush();
  assert.deepEqual(backend.logins, ['q1@example.com']);

  // Typed twice while the first login has not answered: only the last one counts.
  await leaveField('client-email', 'q2@example.com', { wait: false });
  await leaveField('client-email', 'q3@example.com', { wait: false });
  await flush();
  assert.deepEqual(backend.logins, ['q1@example.com']);

  backend.loginGate = null;
  release();
  await settle();
  assert.deepEqual(backend.logins, ['q1@example.com', 'q3@example.com']);
  assert.equal(sessionStorage.getItem(IDENTIFIED_KEY), 's1|q3@example.com');
});

test('the same email arriving again while its login is in flight is not queued', async () => {
  const { backend, update } = await loadCheckout();
  let release;
  backend.loginGate = new Promise((resolve) => { release = resolve; });
  const filled = orderForm('same@example.com', [{ productId: '10', quantity: 1 }]);

  await update(filled, { wait: false });
  await flush();
  await update(filled, { wait: false });
  backend.loginGate = null;
  release();
  await settle();

  assert.deepEqual(backend.logins, ['same@example.com']);
  assert.deepEqual(backend.sent, ['cart:10:1:override']);
});

test('works with sessionStorage blocked: the shopper is still identified and synced', async () => {
  const { backend, update } = await loadCheckout();
  const { getItem, setItem } = window.Storage.prototype;
  mock.method(window.Storage.prototype, 'getItem', function (key) {
    if (key === IDENTIFIED_KEY) throw new Error('storage blocked');
    return getItem.call(this, key);
  });
  mock.method(window.Storage.prototype, 'setItem', function (key, value) {
    if (key === IDENTIFIED_KEY) throw new Error('storage blocked');
    return setItem.call(this, key, value);
  });

  await update(orderForm('blocked@example.com', [{ productId: '10', quantity: 1 }]));

  assert.deepEqual(backend.logins, ['blocked@example.com']);
  assert.deepEqual([...backend.cart], [['10', 1]]);
});
