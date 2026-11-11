import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resetDom, seedSession } from './helpers/env.mjs';
import { getProductUrlLookup } from '../../src/utils/productLookup.js';

const CANNON_HOME_CL = '69f9fd15bcb8468256ba4565';

beforeEach(() => resetDom({ url: 'https://shop.example/sabanas/king-blanca.html?color=white#reviews' }));

test('getProductUrlLookup returns null when there is no session', () => {
  assert.equal(getProductUrlLookup(), null);
});

test('getProductUrlLookup returns null for projects outside the allow list', () => {
  seedSession({ project: 'project-1' });
  assert.equal(getProductUrlLookup(), null);
});

test('getProductUrlLookup returns origin + pathname (no query, no hash) for allow-listed projects', () => {
  seedSession({ project: CANNON_HOME_CL });
  assert.equal(getProductUrlLookup(), 'https://shop.example/sabanas/king-blanca.html');
});
