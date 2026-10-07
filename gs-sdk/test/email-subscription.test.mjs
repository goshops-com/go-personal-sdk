import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadSDK() {
  const calls = [];
  const storage = new Map();
  const context = vm.createContext({
    console,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    window: { gsConfig: { options: { provider: 'Magento' } } },
    fetch: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
      return { status: 200, ok: true, json: async () => ({ success: true }) };
    },
  });

  for (const file of ['utils/storage.js', 'utils/http.js', 'api/index.js']) {
    const source = (await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))
      .replace(/^import\s[\s\S]*?;\s*$/gm, '')
      .replace(/^export /gm, '');
    vm.runInContext(source, context);
  }

  return {
    calls,
    setSession: session => storage.set('gs-v-1', JSON.stringify(session)),
    sdk: vm.runInContext('({ setEmailSubscription, getSession })', context),
  };
}

test('email subscription accepts booleans and uses the current session token', async () => {
  const env = await loadSDK();
  env.setSession({ token: 'customer-token', customer_id: 'customer' });

  await env.sdk.setEmailSubscription(false);
  await env.sdk.setEmailSubscription(true);

  assert.deepEqual(env.calls, [
    {
      url: 'https://go-discover-dev.goshops.ai/channel/email-subscription',
      authorization: 'Bearer customer-token',
      body: { optIn: false },
    },
    {
      url: 'https://go-discover-dev.goshops.ai/channel/email-subscription',
      authorization: 'Bearer customer-token',
      body: { optIn: true },
    },
  ]);
  assert.equal(env.sdk.getSession().customer_id, 'customer');
});

test('email subscription rejects values other than true or false before sending a request', async () => {
  const env = await loadSDK();
  for (const value of ['false', 0, null, undefined]) {
    await assert.rejects(env.sdk.setEmailSubscription(value), /boolean/);
  }
  assert.deepEqual(env.calls, []);
});
