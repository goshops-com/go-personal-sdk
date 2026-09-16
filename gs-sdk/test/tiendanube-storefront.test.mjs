import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadStorefrontHelpers(globals = {}) {
  const path = new URL("../libs/tiendanube.js", import.meta.url);
  const source = (await readFile(path, "utf8")).replace(
    "  if (redirectToCheckoutIfRequested()) {\n    return;\n  }\n  setupUrlChangeDetection();\n  captureAccountForms();\n  loadGSSDK();",
    "  globalThis.__test = { readAccountFields, redirectToCheckoutIfRequested };"
  );
  const context = vm.createContext({ console, URL, ...globals });

  vm.runInContext(source, context);
  return context.__test;
}

// A storefront just rich enough for the checkout shortcut: records the URL
// written by `history.replaceState` and the forms that get submitted.
function fakeStorefront(href, cart) {
  const replaced = [];
  const submitted = [];
  const element = (tag) => ({
    tag,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
    submit() {
      submitted.push(this);
    },
  });

  return {
    replaced,
    submitted,
    globals: {
      LS: { cart },
      window: { location: { href } },
      history: {
        state: null,
        replaceState(state, title, url) {
          replaced.push(url);
        },
      },
      document: { body: element("body"), createElement: element },
    },
  };
}

test("account profile extraction excludes the password", async () => {
  const { readAccountFields } = await loadStorefrontHelpers();
  const values = {
    name: " Ada Lovelace ",
    email: " ada@example.com ",
    phone: " 555 0100 ",
    password: "not-collected",
  };
  const form = {
    querySelector(selector) {
      const name = selector.match(/name="([^"]+)"/)?.[1];
      return name in values ? { value: values[name] } : null;
    },
  };

  assert.deepEqual(
    { ...readAccountFields(form) },
    {
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "555 0100",
    }
  );
});

test("gsCheckout=1 posts the cart to the checkout and drops the flag", async () => {
  const store = fakeStorefront("https://store.test/productos/?gsCheckout=1&utm_source=email", {
    id: 2071920999,
    hash: "4fe3735fb3c6d1c09501f5a0f11adefb56c13900",
    items: [{ item_id: 1 }],
  });
  const { redirectToCheckoutIfRequested } = await loadStorefrontHelpers(store.globals);

  assert.equal(redirectToCheckoutIfRequested(), true);
  assert.deepEqual(store.replaced, ["https://store.test/productos/?utm_source=email"]);
  assert.equal(store.submitted.length, 1);

  const [form] = store.submitted;
  assert.equal(form.method, "post");
  assert.equal(form.action, "/comprar/");
  assert.deepEqual(
    form.children.map(({ type, name, value }) => ({ type, name, value })),
    [{ type: "hidden", name: "go_to_checkout", value: "1" }]
  );
});

test("gsCheckout=1 with an empty cart stays on the page", async () => {
  const store = fakeStorefront("https://store.test/?gsCheckout=1", {
    id: null,
    hash: null,
    items: [],
  });
  const { redirectToCheckoutIfRequested } = await loadStorefrontHelpers(store.globals);

  assert.equal(redirectToCheckoutIfRequested(), false);
  assert.deepEqual(store.replaced, ["https://store.test/"]);
  assert.equal(store.submitted.length, 0);
});

test("pages without gsCheckout=1 are left alone", async () => {
  const store = fakeStorefront("https://store.test/?gsCheckout=0", {
    id: 2071920999,
    items: [{ item_id: 1 }],
  });
  const { redirectToCheckoutIfRequested } = await loadStorefrontHelpers(store.globals);

  assert.equal(redirectToCheckoutIfRequested(), false);
  assert.deepEqual(store.replaced, []);
  assert.equal(store.submitted.length, 0);
});
