import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { register } from 'node:module';
import { resetDom } from './helpers/env.mjs';
import { loadPlugin } from '../../src/api/plugins.js';

// loadPlugin does `import('https://sdk.gopersonal.ai/...')`. Node does not import https URLs,
// so this resolve hook (local to this file's process) maps those specifiers to an inline module
// that records which URL was asked for. No network involved.
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('https://sdk.gopersonal.ai/')) {
    const source = specifier.includes('broken')
      ? 'throw new Error("plugin failed to evaluate");'
      : '(globalThis.__gsPluginLoads ||= []).push(' + JSON.stringify(specifier) + ');';
    return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hook));

beforeEach(() => {
  resetDom();
  globalThis.__gsPluginLoads = [];
});

test('loadPlugin loads external libraries from /external-libs by default', async () => {
  assert.equal(await loadPlugin('swiper'), undefined);
  assert.deepEqual(globalThis.__gsPluginLoads, ['https://sdk.gopersonal.ai/external-libs/swiper.js']);
});

test('loadPlugin loads internal libraries from /libs when external is false', async () => {
  await loadPlugin('salesforce-b2c', false);
  assert.deepEqual(globalThis.__gsPluginLoads, ['https://sdk.gopersonal.ai/libs/salesforce-b2c.js']);
});

test('loadPlugin rejects when the plugin fails to load', async () => {
  await assert.rejects(loadPlugin('broken-plugin'), /plugin failed to evaluate/);
  await assert.rejects(loadPlugin('broken-internal', false), /plugin failed to evaluate/);
  assert.deepEqual(globalThis.__gsPluginLoads, []);
});
