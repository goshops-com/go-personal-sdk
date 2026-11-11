import assert from 'node:assert/strict';
import test from 'node:test';
import { isQuestion } from '../../src/utils/searchUtil.js';

test('isQuestion is false for empty or whitespace-only text', () => {
  assert.equal(isQuestion(''), false);
  assert.equal(isQuestion('   '), false);
});

test('isQuestion detects Spanish question words regardless of case and padding', () => {
  assert.equal(isQuestion('  Qué zapatillas me recomendás'), true);
  assert.equal(isQuestion('CUANTO sale el envio'), true);
  assert.equal(isQuestion('por qué no llega'), true);
});

test('isQuestion detects question marks at either end', () => {
  assert.equal(isQuestion('zapatillas rojas?'), true);
  assert.equal(isQuestion('¿zapatillas rojas'), true);
});

test('isQuestion detects verb-subject inversion', () => {
  assert.equal(isQuestion('tienen talle 42'), true);
  assert.equal(isQuestion('puede ser en rojo'), true);
});

test('isQuestion is false for plain product searches', () => {
  assert.equal(isQuestion('zapatillas rojas'), false);
  assert.equal(isQuestion('remera talle m'), false);
});
