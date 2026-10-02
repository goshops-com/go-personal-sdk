import { loginEmail, addBulkInteractions, getState, getCustomerSession } from '../api';

// VTEX checkout (checkout-ui v6). The IO pixel app does not run there, so a
// guest who types their email and leaves is never identified and their cart
// never becomes a customer cart. When the SDK is loaded on the checkout with
// the VTEX provider, this module identifies the shopper by email and keeps the
// session cart in line with the checkout cart.
//
// The email comes from two places. The orderForm has it for a returning or
// logged in shopper, but for a new one only once the whole profile form went
// through, which is too late for someone who leaves halfway. So the checkout's
// own email fields are read as well, when the shopper leaves them.
//
// Everything here is best effort: it must never throw into the checkout, and
// it does nothing outside of it.
const INSTALLED_FLAG = '__gsVtexCheckoutInstalled';
const IDENTIFIED_KEY = 'gs-vtex-ck-identified';
// Ids checkout-ui gives the email field on the email and profile steps.
const EMAIL_INPUT_SELECTOR = '#client-email, #client-pre-email';
const READY_RETRY_DELAY = 500;
const READY_MAX_TRIES = 20;
// Only used when jQuery, which carries `orderFormUpdated.vtex`, is missing.
const POLL_INTERVAL = 3000;
// The API applies each cart interaction on top of the session state it read
// when the request arrived, so two in flight overwrite each other. Changes go
// one at a time, waiting for each to land before reading the session again.
const CART_SYNC_SETTLE_MS = 1500;
// A product the catalog cannot resolve never shows up in the session cart, so
// it would be resent forever; give up on it after this many tries.
const CART_SYNC_MAX_ATTEMPTS = 2;

let latestOrderForm = null;
// Email whose customer is attached to the session, as far as this page knows.
let identifiedEmail = null;
let identifying = null;
// Email that arrived while another login was in flight; it goes next.
let queuedEmail = null;
// Email the orderForm still carried when the shopper typed a different one.
// Until the orderForm moves on, it must not undo what they typed.
let supersededEmail = null;
let cartSync = null;
let cartSyncPending = false;
// Login does not copy the session cart into the customer; the API only does
// that when a cart interaction arrives for an identified session. Set after a
// login so at least one goes out even if the carts already match.
let touchPending = false;
// Cart the session was last matched against. The orderForm also changes with
// every address or shipping edit, none of which is worth a request.
let syncedCartSignature = null;

export function installVtexCheckout(options = {}) {
  if (typeof window === 'undefined') {
    return;
  }
  if (options.vtexCheckout === false || !isVtexCheckoutPage()) {
    return;
  }
  if (window[INSTALLED_FLAG]) {
    return;
  }

  window[INSTALLED_FLAG] = true;
  bindEmailInputs();
  waitForCheckout(0);
}

// Delegated, so it also covers fields the checkout renders later. `change` and
// `blur` only fire once the shopper is done with the field, never per key.
function bindEmailInputs() {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
    return;
  }

  const onEmailField = (event) => {
    try {
      const field = event && event.target;
      if (!field || typeof field.matches !== 'function' || !field.matches(EMAIL_INPUT_SELECTOR)) {
        return;
      }
      const email = normalizeEmail(field.value);
      if (!email || email === identifiedEmail) {
        return;
      }
      supersededEmail = resolveEmail(latestOrderForm);
      identify(email);
    } catch (error) {
      window.gsLog?.('[vtex-checkout] email field handling failed', error);
    }
  };

  document.addEventListener('change', onEmailField, true);
  document.addEventListener('blur', onEmailField, true);
}

// The order placed page lives under /checkout too, but the purchase is
// reported there by the pixel app and sending the cart again would turn a
// completed order back into an abandoned cart.
function isVtexCheckoutPage() {
  try {
    const path = String(window.location.pathname || '').toLowerCase();
    return path.startsWith('/checkout') && !path.includes('orderplaced');
  } catch (error) {
    return false;
  }
}

function waitForCheckout(tries) {
  if (window.vtexjs && window.vtexjs.checkout) {
    bindOrderForm();
    return;
  }
  if (tries < READY_MAX_TRIES) {
    setTimeout(() => waitForCheckout(tries + 1), READY_RETRY_DELAY);
  }
}

function bindOrderForm() {
  const currentOrderForm = () => window.vtexjs?.checkout?.orderForm;
  const $ = window.jQuery || window.$;

  // vtex.js announces every orderForm change through a jQuery event, which a
  // native listener cannot see.
  if (typeof $ === 'function' && $.fn && typeof $.fn.on === 'function') {
    $(window).on('orderFormUpdated.vtex', (_event, orderForm) => {
      handleOrderForm(orderForm || currentOrderForm());
    });
  } else {
    setInterval(() => handleOrderForm(currentOrderForm()), POLL_INTERVAL);
  }

  // The orderForm may already be loaded, e.g. a shopper coming back.
  handleOrderForm(currentOrderForm());
}

function handleOrderForm(orderForm) {
  try {
    if (!orderForm) {
      return;
    }
    latestOrderForm = orderForm;

    const email = resolveEmail(orderForm);
    if (email && email !== supersededEmail) {
      supersededEmail = null;
      if (email !== identifiedEmail) {
        identify(email);
        return;
      }
    }

    if (!identifiedEmail) {
      return;
    }

    if (touchPending || cartSignature(desiredCartProducts(orderForm.items)) !== syncedCartSignature) {
      syncCart();
    }
  } catch (error) {
    window.gsLog?.('[vtex-checkout] orderForm handling failed', error);
  }
}

function resolveEmail(orderForm) {
  return normalizeEmail(orderForm?.clientProfileData?.email);
}

// A returning shopper who is not logged in gets their profile masked with
// asterisks; a masked value is never an identity.
function normalizeEmail(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const email = raw.trim().toLowerCase();
  if (email.includes('*') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

async function identify(email) {
  if (identifying) {
    queuedEmail = email === identifying ? null : email;
    return;
  }
  identifying = email;

  try {
    const session = getCustomerSession() || {};
    const knownByStorefront =
      Boolean(session.customer_id) &&
      String(session.customer_email || '').toLowerCase() === email;

    // A shopper the storefront already logged in keeps that customer: asking
    // the API to resolve them again by email could only move the session.
    if (!knownByStorefront) {
      // Email without a customer id: the API resolves the customer by email,
      // so a shopper it already knows is not split into a second record.
      await loginEmail(email);
      if (readIdentified() !== identifiedMark(session, email)) {
        touchPending = true;
      }
    }

    identifiedEmail = email;
    window.gsLog?.('[vtex-checkout] customer identified');
    await syncCart();
    if (!touchPending) {
      writeIdentified(identifiedMark(session, email));
    }
  } catch (error) {
    // Left unidentified on purpose: the next orderForm update tries again.
    window.gsLog?.('[vtex-checkout] identify failed', error);
  } finally {
    identifying = null;
    const next = queuedEmail;
    queuedEmail = null;
    if (next && next !== identifiedEmail) {
      identify(next);
    }
  }
}

function identifiedMark(session, email) {
  return `${session.sessionId || ''}|${email}`;
}

function readIdentified() {
  try {
    return window.sessionStorage.getItem(IDENTIFIED_KEY);
  } catch (error) {
    return null;
  }
}

function writeIdentified(mark) {
  try {
    window.sessionStorage.setItem(IDENTIFIED_KEY, mark);
  } catch (error) {
    // Storage blocked: the only cost is one redundant cart interaction on the
    // next page load.
  }
}

// One sync at a time; a change arriving meanwhile triggers one more pass so
// the last cart always wins.
function syncCart() {
  if (cartSync) {
    cartSyncPending = true;
    return cartSync;
  }

  cartSync = (async () => {
    do {
      cartSyncPending = false;
      await runCartSync();
    } while (cartSyncPending);
  })()
    .catch((error) => window.gsLog?.('[vtex-checkout] cart sync failed', error))
    .then(() => {
      cartSync = null;
    });

  return cartSync;
}

async function runCartSync() {
  const attempts = new Map();

  for (;;) {
    // The cart may change while this runs, so read the latest one each pass.
    const desired = desiredCartProducts(latestOrderForm?.items);
    const sessionState = await readSessionState();
    if (!sessionState) {
      return;
    }

    let change = nextCartChange(desired, sessionCartProducts(sessionState), attempts);
    if (!change && touchPending) {
      change = touchChange(desired);
    }
    if (!change) {
      touchPending = false;
      syncedCartSignature = cartSignature(desired);
      return;
    }

    attempts.set(change.id, (attempts.get(change.id) || 0) + 1);
    window.gsLog?.('[vtex-checkout] cart sync', change.event.event, change.id);
    await addBulkInteractions([change.event]);
    // Any cart interaction makes the API copy the session cart to the customer.
    touchPending = false;
    await wait(CART_SYNC_SETTLE_MS);
  }
}

// A session without state answers with an empty body, which fails to parse;
// that is an empty cart. Anything else is a real failure and stops the sync.
async function readSessionState() {
  try {
    return (await getState()) || {};
  } catch (error) {
    if (error && error.name === 'SyntaxError') {
      return {};
    }
    window.gsLog?.('[vtex-checkout] could not read the session state', error);
    return null;
  }
}

// The checkout cart grouped by product, which is how the session cart is
// keyed. Two SKUs of the same product add up to one line.
function desiredCartProducts(items) {
  const products = new Map();
  for (const item of items || []) {
    // Gifts stay in: the storefront already counts them in the session cart.
    if (!item || !item.productId) {
      continue;
    }
    const id = `${item.productId}`;
    const quantity = Number(item.quantity) || 1;
    products.set(id, (products.get(id) || 0) + quantity);
  }
  return products;
}

function cartSignature(products) {
  return [...products].map(([id, quantity]) => `${id}:${quantity}`).sort().join(',');
}

function sessionCartProducts(sessionState) {
  const products = new Map();
  for (const product of sessionState?.cart?.products || []) {
    products.set(`${product.id}`, parseInt(product.quantity, 10) || 1);
  }
  return products;
}

// `fullOverride` sets the quantity instead of adding to it, so resending the
// same line is harmless. No price: VTEX exposes it in cents and the API falls
// back to the catalog price.
function cartEvent(id, quantity) {
  return { event: 'cart', item: id, quantity, fullOverride: true };
}

// The next interaction that brings the session cart closer to the checkout
// cart, or null when they match (or nothing left is worth retrying).
function nextCartChange(desired, current, attempts) {
  const canTry = (id) => (attempts.get(id) || 0) < CART_SYNC_MAX_ATTEMPTS;

  for (const [id, quantity] of desired) {
    if (current.get(id) !== quantity && canTry(id)) {
      return { id, event: cartEvent(id, quantity) };
    }
  }

  for (const [id, quantity] of current) {
    if (!desired.has(id) && canTry(id)) {
      return { id, event: { event: 'remove-cart', item: id, quantity } };
    }
  }

  return null;
}

// Carts already match: resend one line as is, only to trigger the copy.
function touchChange(desired) {
  for (const [id, quantity] of desired) {
    return { id, event: cartEvent(id, quantity) };
  }
  return null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
