import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadSDK(search = '') {
  const calls = [];
  const window = { location: { search } };
  const context = vm.createContext({
    window,
    URLSearchParams,
    console,
    getUrlParameter: key => new URLSearchParams(search).get(key),
    init: (clientId, options) => {
      calls.push({ clientId, options });
      return Promise.resolve(clientId);
    },
    purgeContentCache: () => calls.push('purge'),
    getCustomerSession: () => ({}),
    previewVariant: () => false,
    getParam: () => null,
    checkURLEvents: () => null,
    executeActions: () => null,
    executeSearchActions: () => null,
    executeSessionActions: () => null,
  });
  const source = (await readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
    .replace(/^import\s[\s\S]*?;\s*$/gm, '')
    .replace('export default GSSDK;', 'globalThis.sdk = GSSDK;');
  vm.runInContext(source, context);
  return { window, calls, sdk: context.sdk };
}

test('empty bootstrap preserves the valid instance and all shared state references', async () => {
  const { window, calls, sdk } = await loadSDK();
  window.gsSDK = await sdk('BR-client', { provider: 'Magento' });
  window.gsEventHandlers.ready = () => 'ready';
  window.gsImpressionIds.push('impression');
  const saved = {
    instance: window.gsSDK,
    config: window.gsConfig,
    options: window.gsConfig.options,
    handlers: window.gsEventHandlers,
    impressions: window.gsImpressionIds,
    reset: window.gsResetData,
  };
  const handler = saved.handlers.ready;
  await assert.rejects(sdk('', { log: true }), /Client ID is required to initialize the SDK/);
  assert.equal(window.gsSDK, saved.instance);
  assert.equal(window.gsConfig, saved.config);
  assert.equal(window.gsConfig.clientId, 'BR-client');
  assert.equal(window.gsConfig.options, saved.options);
  assert.equal(window.gsEventHandlers, saved.handlers);
  assert.equal(saved.handlers.ready, handler);
  assert.equal(saved.handlers.ready(), 'ready');
  assert.equal(window.gsImpressionIds, saved.impressions);
  assert.deepEqual([...saved.impressions], ['impression']);
  assert.equal(window.gsResetData, saved.reset);
  assert.equal(typeof saved.instance.search, 'function');
  assert.equal(calls.length, 2);
});

for (const env of ['', 'AR']) {
  test(`playground accepts missing clientId with ${env || 'default'} environment`, async () => {
    const { window, calls, sdk } = await loadSDK(`?_gsPlaygroundToken=token&_gsPlaygroundEnv=${env}`);
    const options = { provider: 'Magento' };
    const instance = await sdk(undefined, options);
    assert.equal(window.gsConfig.clientId, `${env || 'BR'}-playground`);
    assert.equal(options.playgroundToken, 'token');
    assert.equal(calls[1].clientId, `${env || 'BR'}-playground`);
    assert.equal(calls[1].options, options);
    assert.equal(typeof instance.search, 'function');
  });
}

test('valid bootstrap still resets globals and initializes with the original options and accepted ID', async () => {
  const { window, calls, sdk } = await loadSDK('?_gsLog=1');
  const options = { provider: 'Magento' };
  const oldConfig = window.gsConfig = { stale: true };
  const oldHandlers = window.gsEventHandlers = { stale: true };
  const oldImpressions = window.gsImpressionIds = ['stale'];
  const instance = await sdk(' ', options);
  assert.notEqual(window.gsConfig, oldConfig);
  assert.notEqual(window.gsEventHandlers, oldHandlers);
  assert.notEqual(window.gsImpressionIds, oldImpressions);
  assert.equal(Object.keys(window.gsEventHandlers).length, 0);
  assert.equal(window.gsImpressionIds.length, 0);
  assert.equal(window.gsConfig.log, '1');
  assert.equal(window.gsConfig.clientId, ' ');
  assert.equal(window.gsConfig.options, options);
  assert.deepEqual(calls, ['purge', { clientId: ' ', options }]);
  assert.equal(typeof instance.search, 'function');
});
