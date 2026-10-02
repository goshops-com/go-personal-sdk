import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function settle() {
  for (let i = 0; i < 20; i++) {
    await tick();
  }
}

// Loads the module with the API stubbed. `backend` plays the session: cart
// interactions land in `backend.cart` unless a test makes them fail or drop.
async function loadVtexCheckout({ pathname = "/checkout/", session = {}, jquery = true } = {}) {
  const path = new URL("../src/vendors/vtexCheckout.js", import.meta.url);
  const source = (await readFile(path, "utf8"))
    .replace(/^import .*;\n/gm, "")
    .replace("export function installVtexCheckout", "function installVtexCheckout");

  const backend = { cart: new Map(), logins: [], sent: [], stateReads: 0, drop: 0, emptyBody: false };
  const handlers = [];
  const storage = new Map();
  const $ = () => ({
    on(name, handler) {
      handlers.push({ name, handler });
    },
  });
  $.fn = { on() {} };

  const window = {
    location: { pathname },
    vtexjs: { checkout: { orderForm: undefined } },
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
    },
    gsLog() {},
  };
  if (jquery) {
    window.jQuery = $;
  }

  const fieldHandlers = [];
  const document = {
    addEventListener(name, handler) {
      fieldHandlers.push({ name, handler });
    },
  };
  // What the browser does when the shopper leaves an email field.
  const leaveField = async (id, value) => {
    const field = { value, matches: (selector) => selector.split(", ").includes(`#${id}`) };
    fieldHandlers.forEach(({ handler }) => handler({ target: field }));
    await settle();
  };

  const context = vm.createContext({
    console,
    window,
    document,
    setTimeout: (callback) => setImmediate(callback),
    setInterval() {},
    getCustomerSession: () => session,
    loginEmail: async (email) => {
      backend.logins.push(email);
      if (backend.loginFails) {
        throw new Error("POST request failed: 500");
      }
      return { msg: "Logged in" };
    },
    getState: async () => {
      backend.stateReads++;
      if (backend.emptyBody) {
        const error = new Error("Unexpected end of JSON input");
        error.name = "SyntaxError";
        throw error;
      }
      return {
        cart: { products: [...backend.cart].map(([id, quantity]) => ({ id, quantity })) },
      };
    },
    addBulkInteractions: async ([event]) => {
      backend.sent.push(`${event.event}:${event.item}:${event.quantity}${event.fullOverride ? ":override" : ""}`);
      if (backend.drop > 0) {
        backend.drop--;
        return {};
      }
      if (event.event === "cart") {
        backend.cart.set(event.item, event.quantity);
      } else {
        backend.cart.delete(event.item);
      }
      return {};
    },
  });

  vm.runInContext(
    `${source}\nglobalThis.__test = { installVtexCheckout, resolveEmail };`,
    context
  );

  const update = async (orderForm) => {
    window.vtexjs.checkout.orderForm = orderForm;
    handlers.forEach(({ handler }) => handler({}, orderForm));
    await settle();
  };

  return { ...context.__test, backend, handlers, storage, window, update, leaveField };
}

const orderForm = (email, items) => ({
  clientProfileData: email === null ? null : { email },
  items,
});

test("only installs on the VTEX checkout, never on the order placed page", async () => {
  for (const pathname of ["/", "/producto/p", "/checkout/orderPlaced/"]) {
    const { installVtexCheckout, handlers, window } = await loadVtexCheckout({ pathname });
    installVtexCheckout({});
    assert.equal(handlers.length, 0, pathname);
    assert.equal(window.__gsVtexCheckoutInstalled, undefined, pathname);
  }

  const off = await loadVtexCheckout();
  off.installVtexCheckout({ vtexCheckout: false });
  assert.equal(off.handlers.length, 0);

  const on = await loadVtexCheckout();
  on.installVtexCheckout({});
  on.installVtexCheckout({});
  assert.deepEqual(on.handlers.map((h) => h.name), ["orderFormUpdated.vtex"]);
});

test("masked, partial or missing emails never identify anyone", async () => {
  const { resolveEmail } = await loadVtexCheckout();

  assert.equal(resolveEmail(orderForm(null)), null);
  assert.equal(resolveEmail(orderForm("ada")), null);
  assert.equal(resolveEmail(orderForm("a***@e***.com")), null);
  assert.equal(resolveEmail(orderForm(" Ada@Example.com ")), "ada@example.com");
});

test("a guest email logs in by email and sends the cart once", async () => {
  const { installVtexCheckout, backend, update } = await loadVtexCheckout({
    session: { sessionId: "s1" },
  });
  // The storefront already put the cart in the session.
  backend.cart.set("10", 2);
  installVtexCheckout({});

  await update(orderForm(null, [{ productId: "10", quantity: 2 }]));
  assert.deepEqual(backend.logins, []);
  assert.deepEqual(backend.sent, []);

  const filled = orderForm("ada@example.com", [{ productId: "10", quantity: 2 }]);
  await update(filled);
  assert.deepEqual(backend.logins, ["ada@example.com"]);
  // Carts match, but the customer only gets the cart from a cart interaction.
  assert.deepEqual(backend.sent, ["cart:10:2:override"]);

  // Address and shipping edits update the orderForm without touching the cart.
  const reads = backend.stateReads;
  await update(filled);
  await update(filled);
  assert.deepEqual(backend.logins, ["ada@example.com"]);
  assert.deepEqual(backend.sent, ["cart:10:2:override"]);
  assert.equal(backend.stateReads, reads);
});

test("the session cart follows the checkout cart, one change at a time", async () => {
  const { installVtexCheckout, backend, update } = await loadVtexCheckout({
    session: { sessionId: "s1" },
  });
  backend.cart.set("10", 1);
  backend.cart.set("30", 1);
  // The first write is lost, as when two interactions overlap.
  backend.drop = 1;
  installVtexCheckout({});

  await update(
    orderForm("ada@example.com", [
      { productId: 10, quantity: 1 },
      { productId: 10, quantity: 2 },
      { productId: 20, quantity: 1 },
    ])
  );

  assert.deepEqual(backend.sent, [
    "cart:10:3:override",
    "cart:10:3:override",
    "cart:20:1:override",
    "remove-cart:30:1",
  ]);
  assert.deepEqual([...backend.cart], [["10", 3], ["20", 1]]);

  await update(orderForm("ada@example.com", [{ productId: 10, quantity: 3 }]));
  assert.equal(backend.sent.at(-1), "remove-cart:20:1");
});

test("a product the catalog cannot resolve is dropped after two tries", async () => {
  const { installVtexCheckout, backend, update } = await loadVtexCheckout();
  backend.drop = Infinity;
  installVtexCheckout({});

  await update(orderForm("ada@example.com", [{ productId: "404", quantity: 1 }]));

  assert.deepEqual(backend.sent, ["cart:404:1:override", "cart:404:1:override"]);
});

test("a shopper the storefront already logged in is not logged in again", async () => {
  const { installVtexCheckout, backend, update } = await loadVtexCheckout({
    session: { sessionId: "s1", customer_id: "vtex-user-id", customer_email: "Ada@Example.com" },
  });
  backend.cart.set("10", 1);
  installVtexCheckout({});

  await update(orderForm("ada@example.com", [{ productId: "10", quantity: 1 }]));

  assert.deepEqual(backend.logins, []);
  assert.deepEqual(backend.sent, []);
});

test("a failed login sends nothing and is retried on the next update", async () => {
  const { installVtexCheckout, backend, update } = await loadVtexCheckout();
  backend.loginFails = true;
  installVtexCheckout({});

  const filled = orderForm("ada@example.com", [{ productId: "10", quantity: 1 }]);
  await update(filled);
  assert.deepEqual(backend.sent, []);

  backend.loginFails = false;
  await update(filled);
  assert.deepEqual(backend.logins, ["ada@example.com", "ada@example.com"]);
  assert.deepEqual(backend.sent, ["cart:10:1:override"]);
});

test("a reload of the same session does not resend a matching cart", async () => {
  const first = await loadVtexCheckout({ session: { sessionId: "s1" } });
  first.backend.cart.set("10", 1);
  first.installVtexCheckout({});
  const filled = orderForm("ada@example.com", [{ productId: "10", quantity: 1 }]);
  await first.update(filled);
  assert.deepEqual(first.backend.sent, ["cart:10:1:override"]);

  const reload = await loadVtexCheckout({ session: { sessionId: "s1" } });
  reload.backend.cart.set("10", 1);
  for (const [key, value] of first.storage) {
    reload.storage.set(key, value);
  }
  reload.window.vtexjs.checkout.orderForm = filled;
  reload.installVtexCheckout({});
  await settle();

  assert.deepEqual(reload.backend.logins, ["ada@example.com"]);
  assert.deepEqual(reload.backend.sent, []);
});

test("a session without state reads as an empty cart", async () => {
  const { installVtexCheckout, backend, update } = await loadVtexCheckout();
  backend.emptyBody = true;
  backend.drop = Infinity;
  installVtexCheckout({});

  await update(orderForm("ada@example.com", [{ productId: "10", quantity: 1 }]));

  assert.equal(backend.sent[0], "cart:10:1:override");
});

test("an email typed in the checkout field identifies before the orderForm has it", async () => {
  const { installVtexCheckout, backend, update, leaveField } = await loadVtexCheckout({
    session: { sessionId: "s1" },
  });
  backend.cart.set("10", 1);
  backend.cart.set("657", 1);
  installVtexCheckout({});
  // New shopper: the orderForm has no profile until the whole form is sent.
  const items = [{ productId: "10", quantity: 1 }, { productId: "657", quantity: 1, isGift: true }];
  await update(orderForm(null, items));

  await leaveField("cart-coupon", "ada@example.com");
  await leaveField("client-email", "ada@exam");
  assert.deepEqual(backend.logins, []);

  await leaveField("client-email", " Ada@Example.com ");
  assert.deepEqual(backend.logins, ["ada@example.com"]);
  assert.deepEqual(backend.sent, ["cart:10:1:override"]);

  // Both `change` and `blur` fire, and the orderForm catches up later.
  await leaveField("client-email", "ada@example.com");
  await update(orderForm("ada@example.com", items));
  assert.deepEqual(backend.logins, ["ada@example.com"]);
  assert.deepEqual(backend.sent, ["cart:10:1:override"]);

  // Cart changes are followed even while the orderForm has no email.
  await update(orderForm(null, [{ productId: "10", quantity: 2 }]));
  assert.deepEqual(backend.sent.slice(1), ["cart:10:2:override", "remove-cart:657:1"]);
});

test("a typed email is not undone by the one the orderForm still carries", async () => {
  const { installVtexCheckout, backend, update, leaveField } = await loadVtexCheckout();
  installVtexCheckout({});
  const items = [{ productId: "10", quantity: 1 }];

  await update(orderForm("old@example.com", items));
  await leaveField("client-pre-email", "new@example.com");
  await update(orderForm("old@example.com", items));
  assert.deepEqual(backend.logins, ["old@example.com", "new@example.com"]);

  await update(orderForm("third@example.com", items));
  assert.deepEqual(backend.logins.at(-1), "third@example.com");
});
