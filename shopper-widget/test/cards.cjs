// Tarjetas de producto, logo y CSS propio del chat: cómo se dibuja cada opción de la config.
require('./load.cjs');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { appearanceOf, DEFAULT_CARDS } = require('../src/appearance.ts');
const { ProductCard, ProductList, ShowcaseProducts } = require('../src/ProductCards.tsx');
const { Logo } = require('../src/Logo.tsx');
const { applyCustomCss } = require('../src/customCss.ts');

const config = { name: 'DOITE', welcome: 'Hola', color: '#fd5700', suggestions: [], language: 'es', currency: 'CLP' };
const session = { token: 't', apiUrl: 'https://api.test', config };
const product = { id: 'p1', name: 'Campera', brand: 'Doite', price: 89990, currency: 'CLP', image: 'https://img.test/p1.jpg', url: 'https://shop.test/p1', description: '' };
const render = (element) => renderToStaticMarkup(element);
const card = (cards, extra = {}) => render(React.createElement(ProductCard, { product: { ...product, ...extra }, session, conversationId: 'c', messageId: 'm', cards: { ...DEFAULT_CARDS, ...cards } }));

// Por defecto: horizontal, imagen completa, bordes redondeados, marca y precio; el nombre es el link que abre el producto con toda la tarjeta
const base = card({});
assert.match(base, /class="product gps-card is-horizontal fit-contain radius-round" data-gps-product="p1"/);
assert.match(base, /class="brand gps-card-brand">Doite</);
assert.match(base, /<h3 class="gps-card-name"><a class="gps-card-link" href="https:\/\/shop.test\/p1" target="_blank" rel="noopener noreferrer">Campera<\/a><\/h3>/);
assert.match(base, /class="price gps-card-price">\$?\s?89\.990/);
assert.doesNotMatch(base, /Ver producto|gps-card-cta/, 'sin link "Ver producto" aparte');
assert.equal((base.match(/<a /g) || []).length, 1);

// Cada opción de la tarjeta cambia lo que corresponde
const custom = card({ layout: 'vertical', imageFit: 'cover', radius: 'soft', showBrand: false, showPrice: false });
assert.match(custom, /class="product gps-card is-vertical fit-cover radius-soft"/);
assert.doesNotMatch(custom, /gps-card-brand|gps-card-price|product-foot/);

// Sin precio o sin imagen, la tarjeta igual se dibuja
assert.match(card({}, { price: null }), /class="price price-unknown gps-card-price">Consultar precio/);
assert.match(card({}, { image: null }), /<span aria-hidden="true">◇<\/span>/);
assert.doesNotMatch(card({}, { brand: '' }), /gps-card-brand/);

// La lista usa la disposición configurada y el carrusel es el default
const list = (cards) => render(React.createElement(ProductList, { products: [product, { ...product, id: 'p2' }], session, conversationId: 'c', messageId: 'm', cards: { ...DEFAULT_CARDS, ...cards } }));
assert.match(list({}), /^<div class="products gps-products is-carousel">/);
assert.match(list({ display: 'grid' }), /^<div class="products gps-products is-grid">/);
assert.equal((list({}).match(/gps-card /g) || []).length, 2);

// La vista previa del admin: solo tarjetas de ejemplo en el idioma y la moneda del chat, sin encabezado
const preview = render(React.createElement(ShowcaseProducts, { config: { ...config, language: 'en', currency: 'USD' }, appearance: appearanceOf({ cards: { display: 'list' } }) }));
assert.match(preview, /class="shopper gps-chat showcase-products"/);
assert.match(preview, /gps-products is-list/);
assert.match(preview, /Lightweight waterproof jacket/);
assert.match(preview, /\$39,990\.00/);
assert.doesNotMatch(preview, /gps-header/);
assert.equal((preview.match(/gps-card /g) || []).length, 3);
assert.doesNotMatch(preview, /gps-card-add/, 'sin el botón de carrito prendido no se muestra');

// Con el botón de carrito prendido, la vista previa lo muestra con su texto y sus colores
const withCart = render(React.createElement(ShowcaseProducts, { config, appearance: appearanceOf({ cart: { card: { show: true, icon: 'none', label: 'Sumar', background: '#000000', color: '#ffffff' } } }) }));
assert.equal((withCart.match(/<button type="button" class="gps-card-add">Sumar<\/button>/g) || []).length, 3, 'sin ícono, solo el texto');
assert.match(withCart, /style="--shopper-brand:#fd5700;--shopper-cart-bg:#000000;--shopper-cart-ink:#ffffff"/);

// Vista previa de la confirmación del asistente: la pregunta y el estado agregado, con sus textos y colores
const confirmPreview = render(React.createElement(ShowcaseProducts, { config, view: 'confirm',
  appearance: appearanceOf({ cart: { confirm: { question: '¿Lo sumamos?', confirmLabel: 'Sí', successLabel: 'Sumado', background: '#0a7d32' } } }) }));
assert.match(confirmPreview, /class="shopper gps-chat showcase-products showcase-confirm" lang="es" style="--shopper-brand:#fd5700;--shopper-confirm-bg:#0a7d32"/);
assert.match(confirmPreview, /data-gps-status="confirm".*¿Lo sumamos\?.*>Sí<\/button>.*>No, gracias<\/button>/);
assert.match(confirmPreview, /data-gps-status="done".*Sumado <span aria-hidden="true">✓<\/span>/);
assert.doesNotMatch(confirmPreview, /gps-card /, 'sin tarjetas');

// Logo: la inicial del nombre por defecto, o la imagen; con los colores elegidos
const logo = (value, name = 'doite') => render(React.createElement(Logo, { name, logo: appearanceOf({ header: { logo: value } }).logo }));
assert.equal(logo({}), '<div class="shopper-mark gps-logo" aria-hidden="true">D</div>');
assert.equal(logo({}, '  '), '<div class="shopper-mark gps-logo" aria-hidden="true"></div>');
assert.match(logo({ background: '#ffffff', color: '#111111' }), /style="background:#ffffff;color:#111111"/);
assert.match(logo({ kind: 'image', image: 'https://img.test/logo.png' }), /<div class="shopper-mark gps-logo has-image" aria-hidden="true"><img src="https:\/\/img.test\/logo.png" alt=""\/><\/div>$/);

// CSS propio: se agrega al final del documento, se actualiza y se quita
const head = { children: [], appendChild(node) { this.children = this.children.filter(n => n !== node).concat(node); } };
const doc = {
  head,
  getElementById: id => head.children.find(n => n.id === id) || null,
  createElement: () => ({ id: '', textContent: '', remove() { head.children = head.children.filter(n => n !== this); } }),
};
applyCustomCss('.gps-card { color: red; }', doc);
assert.equal(head.children.length, 1); assert.equal(head.children[0].textContent, '.gps-card { color: red; }');
applyCustomCss('.gps-card { color: blue; }', doc);
assert.equal(head.children.length, 1); assert.equal(head.children[0].textContent, '.gps-card { color: blue; }');
applyCustomCss('', doc);
assert.equal(head.children.length, 0);

// Ícono del botón de enviar: flecha, avión o lupa
const { SendIcon } = require('../src/SendIcon.tsx');
for (const icon of ['arrow', 'plane', 'search']) {
  assert.match(render(React.createElement(SendIcon, { icon })), new RegExp(`<svg class="gps-send-icon is-${icon}"[^>]*aria-hidden="true"><path d="M`));
}

console.log('Product cards: all assertions passed');
