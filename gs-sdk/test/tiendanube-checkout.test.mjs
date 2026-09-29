import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadCheckoutApp() {
  const path = new URL("../libs/tiendanube-checkout.js", import.meta.url);
  const source = (await readFile(path, "utf8")).replace(
    "export function App",
    "function App"
  );
  const timers = new Map();
  let nextTimer = 1;
  const context = vm.createContext({
    console,
    clearTimeout(id) {
      timers.delete(id);
    },
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
  });

  vm.runInContext(
    `${source}\nglobalThis.__test = { buildLoginPayload, CheckoutApp, desiredCartProducts, nextCartChange };`,
    context
  );

  return { ...context.__test, timers };
}

test("login payload identifies by email only, like loginEmail", async () => {
  const { buildLoginPayload } = await loadCheckoutApp();

  assert.equal(buildLoginPayload({ contact: { email: "micorreo" } }), null);
  assert.deepEqual(
    { ...buildLoginPayload({ id: 123, contact: { email: "micorreo@gmail.com" } }) },
    {
      provider: "tiendanube",
      email: "micorreo@gmail.com",
    }
  );
});

test("login payload includes profile data exposed by NubeSDK", async () => {
  const { buildLoginPayload } = await loadCheckoutApp();

  assert.deepEqual(
    {
      ...buildLoginPayload({
        contact: { email: "micorreo@gmail.com" },
        shipping_address: {
          first_name: "Santiago",
          last_name: "Cotto",
          phone: "99 970 157",
        },
      }),
    },
    {
      provider: "tiendanube",
      email: "micorreo@gmail.com",
      name: "Santiago Cotto",
      phone: "99 970 157",
    }
  );
});

test("customer updates wait for typing to stop", async () => {
  const { CheckoutApp, timers } = await loadCheckoutApp();
  const nube = {
    getBrowserAPIs: () => ({
      asyncLocalStorage: {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      },
    }),
  };
  const app = new CheckoutApp(nube);
  const sent = [];
  app.sendLogin = (_state, payload) => sent.push({ ...payload });

  app.handleCustomer({ customer: { contact: { email: "mi" } } });
  assert.equal(timers.size, 0);

  app.handleCustomer({ customer: { contact: { email: "micorreo@gmail.co" } } });
  app.handleCustomer({ customer: { contact: { email: "micorreo@gmail" } } });
  assert.equal(timers.size, 0);

  app.handleCustomer({ customer: { contact: { email: "micorreo@gmail.co" } } });
  app.handleCustomer({ customer: { contact: { email: "micorreo@gmail.com" } } });
  assert.equal(timers.size, 1);
  assert.equal(sent.length, 0);

  [...timers.values()][0]();
  assert.deepEqual(sent, [
    {
      provider: "tiendanube",
      email: "micorreo@gmail.com",
    },
  ]);
});

function fakeNube(state) {
  return {
    getState: () => state,
    getBrowserAPIs: () => ({
      asyncLocalStorage: {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      },
    }),
  };
}

test("checkout cart is grouped by product", async () => {
  const { desiredCartProducts } = await loadCheckoutApp();

  const products = desiredCartProducts([
    { product_id: 10, variant_id: 101, quantity: 1, price: 500 },
    { product_id: 10, variant_id: 102, quantity: 2, price: 500 },
    { product_id: 20, variant_id: 201, quantity: 1, price: 900 },
  ]);

  assert.deepEqual(
    [...products.values()].map((line) => ({ ...line })),
    [
      { id: "10", variantId: "101", quantity: 3, price: 500 },
      { id: "20", variantId: "201", quantity: 1, price: 900 },
    ]
  );
});

test("cart changes override quantities and drop stale products", async () => {
  const { desiredCartProducts, nextCartChange } = await loadCheckoutApp();
  const desired = desiredCartProducts([
    { product_id: 10, variant_id: 101, quantity: 2, price: 500 },
  ]);

  const add = nextCartChange(desired, new Map([["10", 1]]), new Map());
  assert.deepEqual(
    { ...add.event, preProcess: [...add.event.preProcess] },
    {
      event: "cart",
      item: "10",
      preProcess: ["findItemByField:sku_list"],
      fieldValue: "101",
      quantity: 2,
      price: 500,
      fullOverride: true,
    }
  );

  const remove = nextCartChange(desired, new Map([["10", 2], ["30", 4]]), new Map());
  assert.deepEqual({ ...remove.event }, { event: "remove-cart", item: "30", quantity: 4 });

  assert.equal(nextCartChange(desired, new Map([["10", 2]]), new Map()), null);
  assert.equal(nextCartChange(desired, new Map(), new Map([["10", 2]])), null);
});

test("login sends the cart one change at a time until the session matches", async () => {
  const { CheckoutApp } = await loadCheckoutApp();
  const state = {
    location: { page: { type: "checkout", data: { step: "start" } } },
    cart: {
      items: [
        { product_id: 10, variant_id: 101, quantity: 1, price: 500 },
        { product_id: 20, variant_id: 201, quantity: 2, price: 900 },
      ],
    },
  };
  const app = new CheckoutApp(fakeNube(state));
  app.wait = async () => {};

  const session = new Map();
  const sent = [];
  let dropNext = true;
  const client = {
    login: async () => ({ msg: "Logged in" }),
    getState: async () => ({
      cart: { products: [...session].map(([id, quantity]) => ({ id, quantity })) },
    }),
    addInteraction: async (event) => {
      sent.push(`${event.event}:${event.item}:${event.quantity}`);
      // The first write is lost, as when two interactions overlap.
      if (dropNext) {
        dropNext = false;
        return {};
      }
      session.set(event.item, event.quantity);
      return {};
    },
  };
  app.withSession = async (_state, action) => action(client);

  await app.sendLogin(state, { email: "a@b.co" }, "sig");

  assert.deepEqual(sent, ["cart:10:1", "cart:10:1", "cart:20:2"]);
  assert.deepEqual([...session], [["10", 1], ["20", 2]]);
});

test("the cart is not sent once the purchase is confirmed", async () => {
  const { CheckoutApp } = await loadCheckoutApp();
  const state = {
    location: { page: { type: "checkout", data: { step: "success" } } },
    cart: { items: [{ product_id: 10, variant_id: 101, quantity: 1, price: 500 }] },
  };
  const app = new CheckoutApp(fakeNube(state));
  app.wait = async () => {};
  const sent = [];
  app.withSession = async (_state, action) =>
    action({
      login: async () => ({ msg: "Already logged in" }),
      getState: async () => ({}),
      addInteraction: async (event) => sent.push(event),
    });

  await app.sendLogin(state, { email: "a@b.co" }, "sig");

  assert.deepEqual(sent, []);
});
