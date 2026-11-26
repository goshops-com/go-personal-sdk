// Estilos del widget: todos van en la capa gps-base para que el CSS propio de la tienda siempre les gane.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Saca los comentarios del CSS
const css = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Busca dónde abre la capa y dónde cierra, contando llaves
const start = css.indexOf('@layer gps-base {');
assert.ok(start >= 0, 'falta la capa gps-base');
let depth = 0; let end = -1;
for (let i = css.indexOf('{', start); i < css.length; i++) {
  if (css[i] === '{') depth++;
  if (css[i] === '}' && --depth === 0) { end = i; break; }
}
assert.ok(end > 0, 'la capa gps-base no cierra');

// Fuera de la capa solo puede haber el @charset/@import inicial o nada: ninguna regla suelta
const outside = (css.slice(0, start) + css.slice(end + 1)).trim();
assert.equal(outside, '', `reglas fuera de la capa gps-base: ${outside.slice(0, 120)}`);

// Un !important dentro de una capa le ganaría al CSS propio
assert.doesNotMatch(css, /!important/, 'el widget no usa !important');
console.log('Layer: all assertions passed');
