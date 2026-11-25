// Mensajes del SDK y del admin al widget: qué sesión y qué config se aceptan.
require('./load.cjs');
const assert = require('node:assert/strict');
const { validSession, validConfig } = require('../src/bridge.ts');

const config = { name: 'DOITE', welcome: 'Hola', color: '#fd5700', suggestions: ['Regalo'], language: 'es', currency: 'CLP' };
const session = { token: 't', apiUrl: 'https://discover.test/shopper/v1', config };

// La sesión del SDK con la apariencia de la config pública es válida; la apariencia se normaliza después
assert.equal(validSession({ ...session, appearance: { cards: { display: 'grid' }, customCss: '.gps-card{}' } }), true);
assert.equal(validSession({ ...session, appearance: 'cualquier cosa' }), true, 'una apariencia rota no tumba la sesión');

// Se rechaza una sesión sin token, con una API que no es https o con una config inválida
assert.equal(validSession({ ...session, token: 1 }), false);
assert.equal(validSession({ ...session, apiUrl: 'http://discover.test' }), false);
assert.equal(validSession({ ...session, apiUrl: 'http://localhost:3001/shopper/v1' }), true, 'http solo para localhost');
assert.equal(validSession(null), false);

// La config de la vista previa de tarjetas valida nombre, color, idioma y sugerencias
assert.equal(validConfig(config), true);
for (const change of [{ color: 'red' }, { language: 'fr' }, { suggestions: ['a', 'b', 'c', 'd', 'e'] }, { name: 3 }, { welcome: undefined }]) {
  assert.equal(validConfig({ ...config, ...change }), false, JSON.stringify(change));
}
assert.equal(validConfig(undefined), false);
console.log('Bridge: all assertions passed');
