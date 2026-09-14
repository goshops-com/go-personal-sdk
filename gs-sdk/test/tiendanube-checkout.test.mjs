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
    `${source}\nglobalThis.__test = { buildLoginPayload, CheckoutApp };`,
    context
  );

  return { ...context.__test, timers };
}

test("login payload uses a complete email as customerId and email", async () => {
  const { buildLoginPayload } = await loadCheckoutApp();

  assert.equal(buildLoginPayload({ contact: { email: "micorreo" } }), null);
  assert.deepEqual(
    { ...buildLoginPayload({ id: 123, contact: { email: "micorreo@gmail.com" } }) },
    {
      provider: "tiendanube",
      customerId: "micorreo@gmail.com",
      email: "micorreo@gmail.com",
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
      customerId: "micorreo@gmail.com",
      email: "micorreo@gmail.com",
    },
  ]);
});
