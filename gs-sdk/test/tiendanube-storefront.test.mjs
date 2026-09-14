import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadStorefrontHelpers() {
  const path = new URL("../libs/tiendanube.js", import.meta.url);
  const source = (await readFile(path, "utf8")).replace(
    "  setupUrlChangeDetection();\n  captureAccountForms();\n  loadGSSDK();",
    "  globalThis.__test = { readAccountFields };"
  );
  const context = vm.createContext({ console });

  vm.runInContext(source, context);
  return context.__test;
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
