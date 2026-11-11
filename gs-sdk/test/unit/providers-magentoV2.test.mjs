import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resetDom } from './helpers/env.mjs';
import { install } from '../../src/providers/magentoV2.js';

beforeEach(() => resetDom());

test('install only announces the provider through gsLog', () => {
  const logged = [];
  window.gsLog = (...args) => logged.push(args);
  const before = document.documentElement.outerHTML;

  assert.equal(install({ provider: 'Magento' }), undefined);

  assert.deepEqual(logged, [['Magento V2']]);
  assert.equal(document.documentElement.outerHTML, before);
});
