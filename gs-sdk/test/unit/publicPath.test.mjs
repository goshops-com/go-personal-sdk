import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createRequire } from 'node:module';

const DEFAULT_PUBLIC_PATH = 'https://sdk.gopersonal.ai/';
const require = createRequire(import.meta.url);
const modulePath = require.resolve('../../src/publicPath.js');
let run = 0;

// publicPath.js has no import/export, so Node loads it as CommonJS and keeps it
// in require.cache: dropping that entry makes the next import evaluate it again.
async function evaluatePublicPath(currentScript) {
  Object.defineProperty(document, 'currentScript', { configurable: true, get: currentScript });
  globalThis.__webpack_public_path__ = 'not-set';
  delete require.cache[modulePath];
  await import(`../../src/publicPath.js?run=${++run}`);
  return globalThis.__webpack_public_path__;
}

afterEach(() => {
  delete document.currentScript;
  globalThis.__webpack_public_path__ = '';
});

test('falls back to the CDN when the SDK was not loaded by its own script tag', async () => {
  assert.equal(await evaluatePublicPath(() => null), DEFAULT_PUBLIC_PATH);
});

test('uses the folder gs-sdk.js was loaded from', async () => {
  assert.equal(
    await evaluatePublicPath(() => ({ src: 'https://cdn.shop.example/assets/v2/gs-sdk.js' })),
    'https://cdn.shop.example/assets/v2/',
  );
});

test('accepts a suffixed file name followed by a query string or a hash', async () => {
  assert.equal(
    await evaluatePublicPath(() => ({ src: 'https://cdn.shop.example/sdk/gs-sdk.min.js?v=3' })),
    'https://cdn.shop.example/sdk/',
  );
  assert.equal(
    await evaluatePublicPath(() => ({ src: 'https://cdn.shop.example/sdk/gs-sdk-1.0.27.js#x' })),
    'https://cdn.shop.example/sdk/',
  );
});

test('ignores scripts that are not the SDK (bundled inside another file)', async () => {
  assert.equal(
    await evaluatePublicPath(() => ({ src: 'https://shop.example/static/vendor.bundle.js' })),
    DEFAULT_PUBLIC_PATH,
  );
  assert.equal(
    await evaluatePublicPath(() => ({ src: 'https://shop.example/gs-sdk/app.js' })),
    DEFAULT_PUBLIC_PATH,
  );
  assert.equal(await evaluatePublicPath(() => ({ src: '' })), DEFAULT_PUBLIC_PATH);
});

test('falls back to the CDN when reading the current script throws', async () => {
  assert.equal(
    await evaluatePublicPath(() => { throw new Error('no currentScript here'); }),
    DEFAULT_PUBLIC_PATH,
  );
});
