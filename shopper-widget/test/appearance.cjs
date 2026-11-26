// Apariencia del chat: defaults para configs viejas, valores inválidos y CSS propio que carga recursos externos.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const filename = path.join(__dirname, '../src/appearance.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const { appearanceOf, safeCss, cartColors, DEFAULT_CARDS } = mod.exports;

// Una config sin apariencia, o con una forma que no se reconoce, se ve como hoy
const DEFAULT_LOGO = { kind: 'initial', image: '', background: '', color: '' };
const DEFAULT_CART = { card: { show: false, label: '', background: '', color: '' }, confirm: { question: '', confirmLabel: '', cancelLabel: '', background: '', color: '' } };
for (const value of [undefined, null, 'x', {}, { cards: 'x', header: 'x', cart: 'x' }]) assert.deepEqual(appearanceOf(value), { cards: DEFAULT_CARDS, logo: DEFAULT_LOGO, cart: DEFAULT_CART, customCss: '' });

// El logo usa la imagen solo si es https y conserva solo colores hex
assert.deepEqual(appearanceOf({ header: { logo: { kind: 'image', image: 'https://a.test/logo.png', background: '#ffffff', color: 'red' } } }).logo,
  { kind: 'image', image: 'https://a.test/logo.png', background: '#ffffff', color: '' });
for (const image of ['http://a.test/logo.png', 'javascript:alert(1)', undefined]) assert.equal(appearanceOf({ header: { logo: { kind: 'image', image } } }).logo.kind, 'initial');

// Los valores válidos se respetan y los inválidos vuelven a su default, campo por campo
const cards = appearanceOf({ cards: { display: 'carousel', layout: 'nope', imageFit: 'cover', radius: 'soft', showBrand: false, showPrice: 'no', ctaLabel: 'Ver más', ctaStyle: 'button', extra: 1 } }).cards;
assert.deepEqual(cards, { display: 'carousel', layout: 'horizontal', imageFit: 'cover', radius: 'soft', showBrand: false, showPrice: true }, 'el link "Ver producto" viejo se descarta');

// Botones de carrito: el de la tarjeta viene apagado; textos recortados y solo colores hex
const noCart = appearanceOf(undefined).cart;
assert.deepEqual(noCart, { card: { show: false, label: '', background: '', color: '' }, confirm: { question: '', confirmLabel: '', cancelLabel: '', background: '', color: '' } });
const cart = appearanceOf({ cart: { card: { show: true, label: '  Sumar al carrito de compras ya  ', background: '#000000', color: 'white' },
  confirm: { question: ' ¿Va? ', confirmLabel: 'Sí', cancelLabel: 7, background: 'red', color: '#FFFFFF' } } }).cart;
assert.deepEqual(cart, { card: { show: true, label: 'Sumar al carrito de comp', background: '#000000', color: '' },
  confirm: { question: '¿Va?', confirmLabel: 'Sí', cancelLabel: '', background: '', color: '#FFFFFF' } });
assert.equal(appearanceOf({ cart: { card: { show: 'true' } } }).cart.card.show, false);

// Los colores propios pasan a variables CSS; los automáticos no se definen
assert.deepEqual(cartColors(noCart), {});
assert.deepEqual(cartColors(cart), { '--shopper-cart-bg': '#000000', '--shopper-confirm-ink': '#FFFFFF' });
assert.deepEqual(cartColors(appearanceOf({ cart: { card: { color: '#111111' }, confirm: { background: '#222222' } } }).cart), { '--shopper-cart-ink': '#111111', '--shopper-confirm-bg': '#222222' });

// El CSS propio se aplica salvo que cargue recursos externos o escape del texto, igual que en admin-apis
assert.equal(safeCss('.gps-card { color: red; }'), '.gps-card { color: red; }');
assert.equal(safeCss('/* url(x) */ .a { color: red }'), '/* url(x) */ .a { color: red }');
for (const css of ['.a { background: url(x) }', '@import "x";', '.a { background: ur/**/l(x) }', '.a { content: "\\75" }', '.a{background:image-set("x" 1x)}', '.a { content: "//x" }', '</style>', 'x'.repeat(10001), 3]) {
  assert.equal(safeCss(css), '', String(css).slice(0, 40));
}
console.log('Appearance: all assertions passed');
