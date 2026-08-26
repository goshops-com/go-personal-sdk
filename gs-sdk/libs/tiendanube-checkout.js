/**
 * Gopersonal checkout app for Tiendanube / Nuvemshop — NubeSDK.
 *
 * Single-file ES module: this is the file that gets uploaded as the app's
 * script, with the "Uses NubeSDK" flag enabled in the Partner Portal.
 *
 * Runs inside the NubeSDK Web Worker: there is no `window`, no `document`
 * and no DOM. It replaces what libs/tiendanube.js used to do on checkout:
 *
 *   1. Recovers (or creates) the Gopersonal session token.
 *   2. Identifies the customer as soon as the checkout knows the email.
 *   3. Reports the purchase when the order is confirmed.
 *
 * It renders nothing — no UI slot is involved.
 */

// --- configuration ---------------------------------------------------------

// The storefront script initializes as `new GSSDK("BR-TNSID_" + storeId)`.
// Keeping the same shape here means both contexts hit the same client.
const CLIENT_ID_PREFIX = "BR-TNSID_";
const PROVIDER = "tiendanube";

// Key the storefront gs-sdk writes its session to (src/utils/storage.js).
// We only ever read it — the checkout keeps its own copy so it can never
// corrupt the storefront session.
const STOREFRONT_SESSION_KEY = "gs-v-1";
const STOREFRONT_VUUID_KEY = "gs_vuuid";
const CHECKOUT_SESSION_KEY = "gs-ck-v-1";
const CHECKOUT_VUUID_KEY = "gs-ck-vuuid";
const PURCHASE_SENT_KEY_PREFIX = "gs-ck-purchase-";

// gs-sdk treats a session token as valid for 24h from its `ts`.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PURCHASE_FLAG_TTL_SECONDS = 7 * 24 * 60 * 60;

// `customer:update` fires on every keystroke. Identity changes go out at
// once; a name or a phone being typed waits for this much silence first.
const PROFILE_DEBOUNCE_MS = 1200;

// Query params that may carry the order id on the success page.
const ORDER_ID_QUERY_KEYS = ["order", "order_id", "orderId", "id"];

function log(...args) {
  console.log("[gopersonal:checkout]", ...args);
}

function logError(...args) {
  console.error("[gopersonal:checkout]", ...args);
}

/**
 * Splits the client id the way gs-sdk's `configure()` does: the part before
 * the hyphen selects the API host, the part after is the real client id.
 */
function resolveClient(storeId) {
  const [region, clientId] = `${CLIENT_ID_PREFIX}${storeId}`.split("-");
  const baseUrl =
    region === "BR"
      ? "https://discover.gopersonal.ai"
      : "https://go-discover-dev.goshops.ai";
  return { clientId, baseUrl };
}

// Same shape as gs-sdk's vuuid. `crypto.randomUUID` exists in the worker.
function generateVuuid() {
  let uuid;
  try {
    uuid = crypto.randomUUID();
  } catch (e) {
    uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  return `_gsVUUID_${uuid}_${Date.now()}`;
}

// --- storage ---------------------------------------------------------------
//
// The worker has no synchronous localStorage; NubeSDK exposes an async
// wrapper. Whether that wrapper sees the keys the storefront page wrote is
// the open question of this integration — the docs say storage is "scoped to
// your application", which would hide `gs-v-1` from us. So we probe for it,
// log the result, and fall back to creating our own session. The first run
// on a demo store settles it.

async function readJson(storage, key) {
  try {
    const raw = await storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    logError(`Could not read/parse storage key "${key}"`, error);
    return null;
  }
}

// Mirrors gs-sdk's `isTokenValid()`: token present and `ts` within 24h.
function isSessionValid(session) {
  if (!session || !session.token || !session.ts) {
    return false;
  }
  const ts = new Date(session.ts).getTime();
  return !Number.isNaN(ts) && Date.now() - ts < SESSION_TTL_MS;
}

async function readStorefrontSession(storage) {
  const session = await readJson(storage, STOREFRONT_SESSION_KEY);

  if (!session) {
    log(
      `Storefront session not visible from the worker (key "${STOREFRONT_SESSION_KEY}" is empty).`,
      "Storage is either namespaced per app, or the visitor never browsed the storefront."
    );
    return null;
  }

  if (!isSessionValid(session)) {
    log("Storefront session found but expired, ignoring it");
    return null;
  }

  log("Storefront session found and reused — the storage bridge works");
  return session;
}

// Prefer the storefront visitor id so a session created here can still be
// stitched to the browsing session server-side.
async function getOrCreateVuuid(storage) {
  try {
    const fromStorefront = await storage.getItem(STOREFRONT_VUUID_KEY);
    if (fromStorefront) {
      log("Reusing storefront vuuid");
      return fromStorefront;
    }

    const fromCheckout = await storage.getItem(CHECKOUT_VUUID_KEY);
    if (fromCheckout) {
      return fromCheckout;
    }

    const vuuid = generateVuuid();
    await storage.setItem(CHECKOUT_VUUID_KEY, vuuid);
    return vuuid;
  } catch (error) {
    logError("Could not resolve vuuid, generating a volatile one", error);
    return generateVuuid();
  }
}

// The success page can be reloaded and `order:update` may fire more than
// once, so the "already reported" flag is persisted, not kept in memory.
async function wasPurchaseReported(storage, transactionId) {
  try {
    const flag = await storage.getItem(
      `${PURCHASE_SENT_KEY_PREFIX}${transactionId}`
    );
    return flag !== null;
  } catch (error) {
    logError("Could not read purchase flag", error);
    return false;
  }
}

async function markPurchaseReported(storage, transactionId) {
  try {
    await storage.setItem(
      `${PURCHASE_SENT_KEY_PREFIX}${transactionId}`,
      "1",
      PURCHASE_FLAG_TTL_SECONDS
    );
  } catch (error) {
    logError("Could not persist purchase flag", error);
  }
}

// --- Gopersonal API --------------------------------------------------------
//
// The storefront bundle (gs-sdk.js) cannot be reused: it is built around
// window/document and would not even load in a worker. Only the three calls
// the checkout needs are re-implemented, with the same contracts.

class GopersonalClient {
  constructor(baseUrl, clientId) {
    this.baseUrl = baseUrl;
    this.clientId = clientId;
    this.token = null;
  }

  hasToken() {
    return Boolean(this.token);
  }

  // POST /channel/init — creates an anonymous session.
  async init({ vuuid, firstUrl, externalSessionId }) {
    const session = await this.post(
      "/channel/init",
      {
        clientId: this.clientId,
        externalSessionId,
        gsVUID: vuuid,
        firstURL: firstUrl,
      },
      { authenticated: false }
    );

    if (!session || !session.token) {
      return null;
    }

    // gs-sdk stamps `ts` client-side when it stores the session.
    session.ts = new Date().toISOString();
    this.token = session.token;
    return session;
  }

  // POST /channel/login — attaches the customer to the session.
  login(payload) {
    return this.post("/channel/login", payload);
  }

  // POST /interaction/state/cart — closes the purchase.
  //
  // `items` is the confirmed cart. The backend falls back to the cart it has
  // accumulated in the session when the field is absent (that is what the
  // storefront relies on), but this app cannot count on that session state
  // existing, so it always sends the order it can actually see.
  reportPurchase(transactionId, items) {
    return this.post("/interaction/state/cart", { transactionId, items });
  }

  async post(endpoint, body, options = {}) {
    const authenticated = options.authenticated !== false;

    if (authenticated && !this.token) {
      logError(`Skipping ${endpoint}: no session token`);
      return null;
    }

    const headers = { "Content-Type": "application/json" };
    if (authenticated && this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        // The caller decides whether to re-init; here we only invalidate.
        this.token = null;
        logError(`${endpoint} returned 401, session invalidated`);
        return null;
      }

      if (!response.ok) {
        logError(`${endpoint} failed with status ${response.status}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      logError(`${endpoint} request failed`, error);
      return null;
    }
  }
}

/**
 * Builds the /channel/login payload.
 *
 * A guest checkout gives us an email and no customer id. Sending the email
 * alone is not enough: the endpoint looks the customer up by email and
 * rejects the request when it does not exist yet, which is exactly the
 * first-contact case we care about. Sending the email *as* the customer id
 * skips that lookup and lets the upsert create the customer — the same
 * approach the API already takes for the fenicio provider.
 *
 * When Tiendanube does give us a real customer id we use it, so registered
 * shoppers keep their identity.
 */
function buildLoginPayload(customer) {
  const customerId = customer?.id ?? null;
  const email = resolveEmail(customer);

  if (!customerId && !email) {
    return null;
  }

  const payload = { provider: PROVIDER };
  payload.customerId = `${customerId || email}`;
  if (email) {
    payload.email = email;
  }

  // Everything below is profile data: the endpoint persists any field it is
  // given, so an absent one must be omitted rather than sent empty.
  const name = resolveName(customer);
  if (name) {
    payload.name = name;
  }
  const phone = resolvePhone(customer);
  if (phone) {
    payload.phone = phone;
  }

  return payload;
}

// --- state helpers ---------------------------------------------------------

function checkoutStep(state) {
  const page = state.location && state.location.page;
  return page && page.type === "checkout" ? page.data?.step ?? null : null;
}

function isPurchaseConfirmed(state) {
  return checkoutStep(state) === "success";
}

function firstFilled(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Checkout spreads the same three fields over several places depending on the
 * step and on whether the shopper is registered: `contact` is filled on the
 * contact step, the root fields come from a registered account, and the
 * addresses are the only source once a guest reaches shipping. Each resolver
 * reads them in that order of trust.
 */
function resolveEmail(customer) {
  return firstFilled(customer?.contact?.email, customer?.email);
}

function addressName(address) {
  if (!address) {
    return null;
  }
  return firstFilled([address.first_name, address.last_name].filter(Boolean).join(" "));
}

function resolveName(customer) {
  return firstFilled(
    customer?.contact?.name,
    customer?.name,
    addressName(customer?.billing_address),
    addressName(customer?.shipping_address)
  );
}

function resolvePhone(customer) {
  return firstFilled(
    customer?.contact?.phone,
    customer?.phone,
    customer?.billing_address?.phone,
    customer?.shipping_address?.phone
  );
}

function orderSnapshot(order) {
  if (!order) {
    return "";
  }
  return JSON.stringify({
    status: order.status ?? null,
    tracking: order.tracking_statuses ?? null,
    extra: order.extra ?? null,
  });
}

function orderIdFromUrl(url) {
  const match = String(url || "").match(/\/success\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * NubeSDK's `order` carries no id or number (unlike the legacy
 * `LS.order.number`), so the transaction id has to come from the URL. The
 * cart id is the last resort: stable per purchase and shared with the
 * storefront, but not the order number the merchant sees.
 */
/**
 * Maps the confirmed cart into the purchase items the API expects.
 *
 * Gopersonal indexes items by product while the checkout cart is expressed
 * in variants, so each line carries the same `findItemByField:sku_list`
 * lookup the storefront uses. `item` is sent as well: the interaction worker
 * only overrides it when the lookup succeeds, so the product id acts as the
 * fallback when a variant is not indexed.
 */
function buildPurchaseItems(cartItems) {
  return (cartItems || []).map((item) => ({
    // Sent as a string: catalogs index `data.id` and `data.sku_list` as
    // strings, and the lookup is an exact match.
    item: `${item.product_id}`,
    preProcess: ["findItemByField:sku_list"],
    fieldValue: `${item.variant_id}`,
    quantity: Number(item.quantity) || 1,
    price: Number(item.price) || 0,
  }));
}

function resolveTransactionId(state) {
  const queries = (state.location && state.location.queries) || {};
  for (const key of ORDER_ID_QUERY_KEYS) {
    if (queries[key]) {
      log(`Transaction id resolved from query param "${key}"`);
      return queries[key];
    }
  }

  const fromUrl = orderIdFromUrl(state.location && state.location.url);
  if (fromUrl) {
    log("Transaction id resolved from the URL path");
    return fromUrl;
  }

  if (state.cart?.id) {
    log("Transaction id falling back to the cart id");
    return state.cart.id;
  }

  return null;
}

// --- app -------------------------------------------------------------------

/**
 * Resolves the async storage, tolerating runtimes that predate
 * `getBrowserAPIs()`. The checkout runtime can be several versions behind
 * the type definitions, and a missing method here would otherwise throw
 * before a single listener is registered.
 *
 * The in-memory fallback keeps the app working for the current page: the
 * session is not reused across page loads and the purchase flag does not
 * survive a reload, but customer and purchase are still reported.
 */
function resolveStorage(nube) {
  try {
    const apis = typeof nube.getBrowserAPIs === "function" ? nube.getBrowserAPIs() : null;
    if (apis && apis.asyncLocalStorage) {
      return apis.asyncLocalStorage;
    }
    logError("getBrowserAPIs() unavailable, falling back to in-memory storage");
  } catch (error) {
    logError("getBrowserAPIs() threw, falling back to in-memory storage", error);
  }

  const mem = new Map();
  return {
    getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: async (k, v) => { mem.set(k, v); },
    removeItem: async (k) => { mem.delete(k); },
  };
}

class CheckoutApp {
  constructor(nube) {
    this.nube = nube;
    this.storage = resolveStorage(nube);
    this.client = null;

    // Memoized bootstrap so concurrent handlers share a single session.
    this.sessionPromise = null;
    // Last identity sent to /channel/login.
    this.lastIdentity = null;
    // Full payload of the last login, so an enriched profile is resent.
    this.lastLoginSignature = null;
    // Pending debounced profile flush, if any.
    this.profileTimer = null;
    // Last order snapshot, to tell a real change from a repeated event.
    this.lastOrderSnapshot = null;
  }

  start() {
    log("App loaded inside the worker. typeof self =", typeof self);

    // Bootstrap from the current state instead of waiting for
    // `checkout:ready`: the worker registers its listeners asynchronously
    // and the event may already have been dispatched by then.
    try {
      const state = this.nube.getState();
      log("Initial state, step =", checkoutStep(state));
      this.ensureSession(state);

      // The worker is re-created on every checkout step, so the customer is
      // usually already in the state by the time this instance starts and no
      // `customer:update` will fire for it. Reading it here is also what
      // makes a field captured on an earlier step reach the API.
      this.handleCustomer(state);

      // The worker is re-created on every checkout step, so landing directly
      // on the success page means `order:update` may already have been
      // dispatched before this listener exists. Report from the state we can
      // see; the persisted flag keeps the event path from doubling it.
      if (isPurchaseConfirmed(state)) {
        this.handleOrder(state, "initial-state");
      }
    } catch (error) {
      logError("Could not read the initial state", error);
    }

    // Each listener is registered on its own: an event name this runtime
    // does not know must not prevent the rest from being registered.
    this.listen("checkout:ready", (state) => {
      log("checkout:ready, step =", checkoutStep(state));
      this.ensureSession(state);
    });

    this.listen("customer:update", (state) => this.handleCustomer(state));

    this.listen("order:update", (state) => this.handleOrder(state, "order:update"));

    // Safety net: some flows reach the success page without a fresh
    // order:update. Both paths de-duplicate through the same flag.
    this.listen("checkout:success", (state) =>
      this.handleOrder(state, "checkout:success")
    );
  }

  listen(event, handler) {
    try {
      this.nube.on(event, (state) => {
        try {
          handler(state);
        } catch (error) {
          logError(`Handler for "${event}" failed`, error);
        }
      });
      log(`Listening to ${event}`);
    } catch (error) {
      logError(`Could not register a listener for "${event}"`, error);
    }
  }

  /**
   * Resolves a usable token, in order of preference:
   *   1. the session this checkout already created,
   *   2. the session the storefront script left behind,
   *   3. a brand new anonymous session.
   */
  ensureSession(state) {
    if (!this.sessionPromise) {
      this.sessionPromise = this.bootstrapSession(state).catch((error) => {
        logError("Session bootstrap failed", error);
        this.sessionPromise = null;
        return false;
      });
    }
    return this.sessionPromise;
  }

  async bootstrapSession(state) {
    const { clientId, baseUrl } = resolveClient(state.store.id);
    this.client = new GopersonalClient(baseUrl, clientId);
    log(`Client resolved: ${clientId} @ ${baseUrl}`);

    let session = null;
    let origin = "new";

    const cached = await readJson(this.storage, CHECKOUT_SESSION_KEY);
    if (isSessionValid(cached)) {
      session = cached;
      origin = "checkout-cache";
    }

    if (!session) {
      const fromStorefront = await readStorefrontSession(this.storage);
      if (fromStorefront) {
        session = fromStorefront;
        origin = "storefront";
      }
    }

    if (!session) {
      const vuuid = await getOrCreateVuuid(this.storage);
      session = await this.client.init({
        vuuid,
        firstUrl: state.location.url,
        // The storefront cart survives into the checkout, so its id is the
        // only identifier both contexts agree on today.
        externalSessionId: state.cart?.id,
      });
      origin = "new";
    }

    if (!session || !session.token) {
      logError("Could not obtain a Gopersonal session token");
      return false;
    }

    this.client.token = session.token;

    try {
      await this.storage.setItem(CHECKOUT_SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      logError("Could not persist checkout session", error);
    }

    log(`Session ready (origin: ${origin})`);
    return true;
  }

  /**
   * Runs an authenticated call, re-creating the session once if the token
   * turned out to be stale (the client clears it on a 401).
   */
  async withSession(state, action) {
    const ready = await this.ensureSession(state);
    if (!ready || !this.client) {
      return;
    }

    await action(this.client);

    if (!this.client.hasToken()) {
      log("Token was rejected, re-initializing the session and retrying once");
      this.sessionPromise = null;
      if (await this.ensureSession(state)) {
        await action(this.client);
      }
    }
  }

  handleCustomer(state) {
    const payload = buildLoginPayload(state.customer);
    if (!payload) {
      return;
    }

    const signature = JSON.stringify(payload);
    if (signature === this.lastLoginSignature) {
      return;
    }

    // Who the shopper is drives everything else in the session, so identity
    // goes out immediately. A name or a phone only enriches the record, and
    // `customer:update` fires per keystroke, so those wait for a pause --
    // otherwise typing a phone is one /channel/login per digit.
    const identity = `${payload.customerId}|${payload.email ?? ""}`;
    if (identity !== this.lastIdentity) {
      this.lastIdentity = identity;
      this.cancelProfileFlush();
      this.sendLogin(state, payload, signature);
      return;
    }

    this.scheduleProfileFlush(state, payload, signature);
  }

  cancelProfileFlush() {
    if (this.profileTimer !== null) {
      clearTimeout(this.profileTimer);
      this.profileTimer = null;
    }
  }

  scheduleProfileFlush(state, payload, signature) {
    // A worker without timers is not worth working around: send right away
    // and accept the extra calls.
    if (typeof setTimeout !== "function") {
      this.sendLogin(state, payload, signature);
      return;
    }

    this.cancelProfileFlush();
    this.profileTimer = setTimeout(() => {
      this.profileTimer = null;
      this.sendLogin(state, payload, signature);
    }, PROFILE_DEBOUNCE_MS);
  }

  async sendLogin(state, payload, signature) {
    // Marked before the call so a burst of updates cannot queue duplicates;
    // a failed login is retried by the next state change anyway.
    this.lastLoginSignature = signature;
    log("Customer identified:", payload);
    await this.withSession(state, (client) => client.login(payload));
  }

  async handleOrder(state, source) {
    const snapshot = orderSnapshot(state.order);
    if (snapshot !== this.lastOrderSnapshot) {
      log(`Order changed (${source}):`, state.order ?? null);
      this.lastOrderSnapshot = snapshot;
    }

    if (!isPurchaseConfirmed(state)) {
      return;
    }

    const transactionId = resolveTransactionId(state);
    if (!transactionId) {
      logError("Purchase confirmed but no transaction id could be resolved", {
        url: state.location?.url,
        queries: state.location?.queries,
        cartId: state.cart?.id,
      });
      return;
    }

    if (await wasPurchaseReported(this.storage, transactionId)) {
      log(`Purchase ${transactionId} already reported, skipping`);
      return;
    }

    const items = buildPurchaseItems(state.cart && state.cart.items);
    if (!items.length) {
      logError("Order confirmed but the cart is empty, not reporting");
      return;
    }

    log(`Reporting purchase ${transactionId} (from ${source})`, {
      items: items.length,
    });
    await this.withSession(state, (client) =>
      client.reportPurchase(transactionId, items)
    );
    await markPurchaseReported(this.storage, transactionId);
  }
}

export function App(nube) {
  try {
    new CheckoutApp(nube).start();
  } catch (error) {
    // A throw here is swallowed by the runtime and the app dies silently,
    // so make the failure visible in the console instead.
    logError("App failed to start", error);
  }
}
