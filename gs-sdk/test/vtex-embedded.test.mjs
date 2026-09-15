import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadVtexEmbedded() {
  const path = new URL("../src/vendors/vtexEmbedded.js", import.meta.url);
  const source = (await readFile(path, "utf8"))
    .replace(/^import .*;\n/gm, "")
    .replace("export function onVtexEmbeddedInit", "function onVtexEmbeddedInit");
  const loginCalls = [];
  const logs = [];
  const context = vm.createContext({
    console,
    login(id, data) {
      loginCalls.push({ id, data: { ...data } });
      return Promise.resolve();
    },
    setSharedToken() {},
    window: {
      gsLog(...args) {
        logs.push(args);
      },
    },
  });

  vm.runInContext(
    `${source}\nglobalThis.__test = { handleUserData };`,
    context
  );

  return { handleUserData: context.__test.handleUserData, loginCalls, logs };
}

test("VTEX login includes the customer name and phone when available", async () => {
  const { handleUserData, loginCalls } = await loadVtexEmbedded();

  handleUserData({
    data: {
      id: "customer-id",
      email: "ada@example.com",
      firstName: " Ada ",
      lastName: " Lovelace ",
      phone: " 555 0100 ",
    },
  });

  assert.deepEqual(loginCalls, [
    {
      id: "customer-id",
      data: {
        email: "ada@example.com",
        name: "Ada Lovelace",
        phone: "555 0100",
        param_updateCartFromCustomer: true,
      },
    },
  ]);
});

test("VTEX login falls back to id and email if profile extraction fails", async () => {
  const { handleUserData, loginCalls, logs } = await loadVtexEmbedded();
  const data = { id: "customer-id", email: "ada@example.com" };
  Object.defineProperty(data, "firstName", {
    get() {
      throw new Error("unreadable profile");
    },
  });

  handleUserData({ data });

  assert.deepEqual(loginCalls, [
    {
      id: "customer-id",
      data: {
        email: "ada@example.com",
        param_updateCartFromCustomer: true,
      },
    },
  ]);
  assert.equal(logs[0][0], "Error extracting VTEX customer profile");
});
