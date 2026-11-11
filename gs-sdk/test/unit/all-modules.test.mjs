// La cobertura de Node solo informa los archivos que algun test cargo. Este
// test importa todos los modulos de src/, asi uno nuevo sin tests aparece en
// el reporte (y hace fallar el minimo de funciones) en vez de pasar inadvertido.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test, { before, after, mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resetDom } from './helpers/env.mjs';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function listModules(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listModules(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

before(() => {
  resetDom();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

after(() => mock.timers.reset());

test('every module under src/ can be imported', async () => {
  const modules = listModules(SRC);
  assert.ok(modules.length > 30);
  for (const file of modules) {
    await assert.doesNotReject(import(pathToFileURL(file).href), path.relative(SRC, file));
  }
});
