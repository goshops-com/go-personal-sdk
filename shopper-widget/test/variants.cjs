// Variantes: formato común que llega del backend, selector por opción y su uso en la tarjeta y en la acción del chat.
const posted = [];
globalThis.location = { search: '?hostOrigin=https://shop.test' };
globalThis.window = { parent: { postMessage: (message, origin) => posted.push({ message, origin }) } };
require('./load.cjs');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { providerOf, variantsOf, optionsOf, requestStoreAction, receiveActionResult } = require('../src/bridge.ts');
const { VariantPicker, choosableOptions, isValueAvailable, selectedVariant, toggleValue } = require('../src/VariantPicker.tsx');
const { ProductCard } = require('../src/ProductCards.tsx');
const { StoreAction } = require('../src/StoreAction.tsx');
const { DEFAULT_CARDS } = require('../src/appearance.ts');
const { copy } = require('../src/copy.ts');

const t = copy.es;
const render = (element) => renderToStaticMarkup(element);
const variant = (id, color, size, available = true, image = null) => ({ id, title: `${color} / ${size}`, available, options: { Color: color, Talla: size }, image });
// Blanco/15 sin stock; Blanco/16, Negro/16 y Negro/17 con stock; Negro tiene imagen propia
const VARIANTS = [variant('41', 'Blanco', '15', false), variant('42', 'Blanco', '16'), variant('43', 'Negro', '16', true, 'https://img.test/negro.jpg'), variant('44', 'Negro', '17')];
const OPTIONS = [{ name: 'Color', values: ['Blanco', 'Negro'] }, { name: 'Talla', values: ['15', '16', '17'] }, { name: 'Material', values: ['Cuero'] }];

(async () => {
  // El provider del SDK solo vale como texto
  assert.equal(providerOf({ provider: '  Shopify  ' }), 'Shopify');
  assert.equal(providerOf({ provider: { name: 'x' } }), '');
  assert.equal(providerOf({}), '');

  // Las variantes mal formadas se descartan y una imagen que no es texto queda en null
  assert.deepEqual(variantsOf([VARIANTS[1], { id: 1, title: 'x', available: true, options: {} }, { id: 'a', title: 'x', available: 'yes', options: {} }, null, { ...VARIANTS[2], image: 7 }]),
    [VARIANTS[1], { ...VARIANTS[2], image: null }]);
  assert.deepEqual(variantsOf('x'), []);

  // Las opciones vienen del backend o, si faltan, se arman con los valores de las variantes
  assert.deepEqual(optionsOf(OPTIONS, VARIANTS), OPTIONS);
  assert.deepEqual(optionsOf(undefined, VARIANTS), [{ name: 'Color', values: ['Blanco', 'Negro'] }, { name: 'Talla', values: ['15', '16', '17'] }]);
  assert.deepEqual(optionsOf([{ name: 'Talla', values: [15, 16] }, { name: 3 }], VARIANTS), [{ name: 'Talla', values: ['15', '16'] }]);

  // Solo se eligen las opciones con más de un valor con stock, y solo con esos valores
  assert.deepEqual(choosableOptions(OPTIONS, VARIANTS), [{ name: 'Color', values: ['Blanco', 'Negro'] }, { name: 'Talla', values: ['16', '17'] }], 'el 15 no tiene stock');

  // Producto separado por color: la ficha trae todos los colores pero sus variantes son de uno solo
  const BEIGE = [variant('b1', 'Beige', 'S'), variant('b2', 'Beige', 'M'), variant('b3', 'Beige', 'XXL', false)];
  const ALL_COLORS = [{ name: 'Color', values: ['Rosado', 'Lila', 'Beige', 'Negro'] }, { name: 'Talla', values: ['XS', 'S', 'M', 'XXL'] }];
  assert.deepEqual(choosableOptions(ALL_COLORS, BEIGE), [{ name: 'Talla', values: ['S', 'M'] }], 'el color no se elige y solo quedan los talles con stock');
  assert.equal(selectedVariant(ALL_COLORS, BEIGE, { Talla: 'M' }).id, 'b2', 'con el talle alcanza');

  // Cada valor se habilita si hay stock con lo ya elegido en las otras opciones
  assert.equal(isValueAvailable(VARIANTS, {}, 'Talla', '15'), false, '15 no tiene stock en ningún color');
  assert.equal(isValueAvailable(VARIANTS, {}, 'Talla', '17'), true);
  assert.equal(isValueAvailable(VARIANTS, { Color: 'Blanco' }, 'Talla', '17'), false, 'no hay Blanco / 17');
  assert.equal(isValueAvailable(VARIANTS, { Color: 'Blanco', Talla: '16' }, 'Color', 'Negro'), true, 'se puede cambiar de color manteniendo el talle');

  // La variante queda definida recién con todas las opciones elegidas y con stock
  assert.equal(selectedVariant(OPTIONS, VARIANTS, { Color: 'Negro' }), null);
  assert.equal(selectedVariant(OPTIONS, VARIANTS, { Color: 'Negro', Talla: '16' }).id, '43');
  assert.equal(selectedVariant(OPTIONS, VARIANTS, { Color: 'Blanco', Talla: '15' }), null, 'sin stock');

  // Tocar un valor lo elige y tocarlo otra vez lo quita
  assert.deepEqual(toggleValue({}, 'Color', 'Negro'), { Color: 'Negro' });
  assert.deepEqual(toggleValue({ Color: 'Negro', Talla: '16' }, 'Color', 'Negro'), { Talla: '16' });
  assert.deepEqual(toggleValue({ Color: 'Negro' }, 'Color', 'Blanco'), { Color: 'Blanco' });

  // El selector dibuja una fila por opción con sus valores; sin elegir, el botón está deshabilitado
  const picker = render(React.createElement(VariantPicker, { options: OPTIONS, variants: VARIANTS, submitLabel: 'Agregar', onPick: () => {} }));
  assert.equal((picker.match(/class="gps-variant-option"/g) || []).length, 2, 'Material tiene un solo valor y no se muestra');
  assert.match(picker, /<span class="gps-variant-name">Talla<\/span>/);
  assert.doesNotMatch(picker, />15<\/button>/, 'los valores sin stock no se muestran');
  assert.doesNotMatch(picker, /is-unavailable|disabled="">1/, 'nada tachado ni deshabilitado');
  assert.match(picker, /<button type="button" role="radio" class="gps-variant-value" aria-checked="false">17<\/button>/);
  const beigePicker = render(React.createElement(VariantPicker, { options: ALL_COLORS, variants: BEIGE, submitLabel: 'Agregar', onPick: () => {} }));
  assert.equal((beigePicker.match(/class="gps-variant-option"/g) || []).length, 1);
  assert.doesNotMatch(beigePicker, /Rosado|Lila|Beige|XS|XXL/);
  assert.match(picker, /<button type="button" class="gps-variant-submit" disabled="">Agregar<\/button>/);

  // Al SDK le llega el id de la variante elegida
  const pending = requestStoreAction({ id: 'a1', action: 'card_add_to_cart', product: { id: 'p1', name: 'x', url: 'https://shop.test/p1', variantId: '43' } });
  assert.deepEqual(posted.at(-1).message.product, { id: 'p1', url: 'https://shop.test/p1', quantity: 1, variantId: '43' });
  receiveActionResult({ actionId: 'a1', ok: true });
  await pending;

  // Tarjeta: con varias variantes con stock el botón abre el selector; sin stock queda deshabilitado
  const session = { token: 't', apiUrl: 'https://api.test', config: { name: 'X', welcome: '', color: '#fd5700', suggestions: [], language: 'es', currency: 'CLP' } };
  const product = { id: 'p1', name: 'Zapatilla', price: 100, currency: 'CLP', image: 'https://img.test/z.jpg', url: 'https://shop.test/p1', brand: '', description: '', options: OPTIONS, variants: VARIANTS };
  const card = (extra) => render(React.createElement(ProductCard, { product: { ...product, ...extra }, session, conversationId: 'c', messageId: 'm', cards: DEFAULT_CARDS, onAddToCart: async () => ({ ok: true }) }));
  assert.match(card({}), /<button type="button" class="gps-card-add" aria-expanded="false">/);
  const soldOut = card({ variants: VARIANTS.map((v) => ({ ...v, available: false })) });
  assert.match(soldOut, /<button type="button" class="gps-card-add is-soldout" disabled="">Sin stock<\/button>/);
  assert.doesNotMatch(card({ variants: [VARIANTS[1]] }), /aria-expanded/, 'con una sola variante con stock agrega directo');
  assert.doesNotMatch(card({ variants: undefined }), /aria-expanded|is-soldout/, 'sin variantes, como siempre');

  // Acción del chat: pide elegir la variante con el selector; con una elegida muestra su título y su imagen
  const request = { id: 'action-1', action: 'add_to_cart', chooseVariant: true, product: { id: 'p1', name: 'Zapatilla', url: 'https://shop.test/p1', image: 'https://img.test/z.jpg', options: OPTIONS, variants: VARIANTS } };
  const action = (state, extra = {}) => render(React.createElement(StoreAction, { request: { ...request, ...extra }, state, t, onConfirm: () => {}, onCancel: () => {} }));
  const choosing = action({ status: 'choose' });
  assert.match(choosing, /class="gps-action-question-text">Elegí la variante para agregarla\.<\/p><div class="gps-variant-picker">/);
  assert.match(choosing, /class="gps-variant-submit" disabled="">Agregar al carrito<\/button>/);
  const added = action({ status: 'done', result: { ok: true }, variant: VARIANTS[2] });
  assert.match(added, /<img class="gps-action-image" src="https:\/\/img.test\/negro.jpg"/);
  assert.match(added, /<span class="gps-action-variant">Negro \/ 16<\/span>/);
  assert.match(action({ status: 'done', result: { ok: true } }, { chooseVariant: false, product: { ...request.product, variantTitle: 'Blanco / 16' } }), /gps-action-variant">Blanco \/ 16</, 'la variante que eligió el modelo');

  console.log('Variants: all assertions passed');
})().catch((error) => { console.error(error); process.exit(1); });
