// Acciones en la tienda: qué acepta el widget, qué le pide al SDK, cómo espera la respuesta y cómo se muestran.
const posted = [];
globalThis.location = { search: '?hostOrigin=https://shop.test' };
globalThis.window = { parent: { postMessage: (message, origin) => posted.push({ message, origin }) } };
require('./load.cjs');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { capabilitiesOf, actionRequestOf, requestStoreAction, receiveActionResult, productEvent } = require('../src/bridge.ts');
const { StoreAction, cartError } = require('../src/StoreAction.tsx');
const { ProductCard } = require('../src/ProductCards.tsx');
const { DEFAULT_CARDS } = require('../src/appearance.ts');
const { copy } = require('../src/copy.ts');

const config = { name: 'DOITE', welcome: 'Hola', color: '#fd5700', suggestions: [], language: 'es', currency: 'CLP' };
const session = { token: 't', apiUrl: 'https://api.test', config };
const product = { id: 'p1', name: 'Campera', url: 'https://shop.test/p1', image: 'https://img.test/p1.jpg', quantity: 2 };
const t = copy.es;
const noop = () => {};
const render = (request, state) => renderToStaticMarkup(React.createElement(StoreAction, { request, state, t, onConfirm: noop, onCancel: noop }));

(async () => {
  // Las capacidades del SDK se filtran a las acciones conocidas
  assert.deepEqual(capabilitiesOf({ ...session, capabilities: ['open_page', 'checkout', 'add_to_cart'] }), ['add_to_cart', 'open_page']);
  assert.deepEqual(capabilitiesOf({ ...session, capabilities: 'add_to_cart' }), []);
  assert.deepEqual(capabilitiesOf(session), []);

  // Una acción del backend necesita id, acción conocida y el producto o la página con su URL
  const cart = { id: 'action-1', action: 'add_to_cart', confirm: false, product };
  const page = { id: 'action-2', action: 'open_page', page: { label: 'Envíos', url: 'https://shop.test/envios' } };
  assert.equal(actionRequestOf(cart), cart);
  assert.equal(actionRequestOf(page), page);
  for (const bad of [null, 'x', { ...cart, id: 'con espacios' }, { ...cart, action: 'checkout' }, { ...cart, product: { id: 'p1' } },
    { ...cart, product: undefined }, { ...page, page: { url: 'https://shop.test' } }, { id: 'a', action: 'open_product' }]) {
    assert.equal(actionRequestOf(bad), null, JSON.stringify(bad));
  }

  // Al SDK le llega solo el id, la URL y la cantidad del producto, al origen de la tienda; la respuesta resuelve el pedido
  const pending = requestStoreAction(cart);
  assert.deepEqual(posted.at(-1), { origin: 'https://shop.test', message: { type: 'gp-shopper:action', actionId: 'action-1', action: 'add_to_cart', product: { id: 'p1', url: 'https://shop.test/p1', quantity: 2 } } });
  receiveActionResult({ actionId: 'otra', ok: true });
  receiveActionResult({ actionId: 'action-1', ok: true, cartUrl: 'https://shop.test/cart', error: 7, extra: 'x' });
  assert.deepEqual(await pending, { ok: true }, 'solo ok, error y mensaje: lo demás se descarta');
  receiveActionResult({ actionId: 'action-1', ok: false });

  // Abrir una página manda solo su URL; un error trae su código y el mensaje de la tienda
  const opening = requestStoreAction(page);
  assert.deepEqual(posted.at(-1).message, { type: 'gp-shopper:action', actionId: 'action-2', action: 'open_page', page: { url: 'https://shop.test/envios' } });
  receiveActionResult({ actionId: 'action-2', ok: 'true', error: 'rejected', message: 'Sin stock' });
  assert.deepEqual(await opening, { ok: false, error: 'rejected', message: 'Sin stock' });

  // Sin respuesta del SDK a tiempo, la acción falla con timeout
  const realTimeout = globalThis.setTimeout;
  let expire;
  globalThis.setTimeout = (fn) => { expire = fn; return 0; };
  const lost = requestStoreAction({ ...cart, id: 'action-3', product: { ...product, quantity: undefined } });
  globalThis.setTimeout = realTimeout;
  assert.equal(posted.at(-1).message.product.quantity, 1, 'sin cantidad va 1');
  expire();
  assert.deepEqual(await lost, { ok: false, error: 'timeout' });

  // Los eventos de producto van a /events con la sesión; en la vista previa no se mide
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return {}; };
  productEvent(session, { conversationId: 'c1', messageId: 'm1', productId: 'p1', type: 'add_to_cart' });
  productEvent({ ...session, preview: true }, { conversationId: 'c1', messageId: 'm1', productId: 'p1', type: 'add_to_cart' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.test/events');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t');
  assert.equal(calls[0].init.keepalive, true);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual({ ...body, eventId: typeof body.eventId }, { eventId: 'string', conversationId: 'c1', messageId: 'm1', productId: 'p1', type: 'add_to_cart' });

  // Cada error de la tienda tiene su texto; el de Fenicio se muestra tal cual
  assert.equal(cartError(t, { ok: false, error: 'variant_required' }), t.variantRequired);
  assert.equal(cartError(t, { ok: false, error: 'out_of_stock' }), t.outOfStock);
  assert.equal(cartError(t, { ok: false, error: 'not_found' }), t.notFound);
  assert.equal(cartError(t, { ok: false, error: 'rejected', message: 'Cantidad máxima' }), 'Cantidad máxima');
  assert.equal(cartError(t, { ok: false, error: 'rejected' }), t.addFailed);
  assert.equal(cartError(t, { ok: false, error: 'timeout' }), t.addFailed);

  // Agregar al carrito: producto con cantidad y el estado de cada paso
  assert.match(render(cart, { status: 'confirm' }), /Campera × 2<\/strong>.*¿Lo agregamos al carrito\?.*>Agregar al carrito<\/button>.*>No, gracias<\/button>/);
  assert.match(render(cart, { status: 'running' }), /role="status" class="gps-action-status">Agregando…/);
  assert.match(render(cart, { status: 'done', result: { ok: true } }), /role="status" class="gps-action-status">Agregado al carrito <span aria-hidden="true">✓<\/span><\/p>/);
  assert.match(render(cart, { status: 'failed', result: { ok: false, error: 'variant_required' } }), /Elegí talle o color.*<a class="gps-action-link" href="https:\/\/shop.test\/p1" target="_top">Ver producto<\/a>/);
  assert.doesNotMatch(render(cart, { status: 'failed', result: { ok: false, error: 'out_of_stock' } }), /Ver producto/);
  assert.match(render(cart, { status: 'cancelled' }), /No se agregó al carrito/);
  const past = render({ ...cart, product: { ...product, image: null, quantity: 1 } });
  assert.match(past, /class="store-action gps-action gps-action-cart is-past" data-gps-action="add_to_cart" data-gps-status="past" data-gps-product="p1"/);
  assert.match(past, /<strong class="gps-action-name">Campera<\/strong><p class="gps-action-status"><a class="gps-action-link" href="https:\/\/shop.test\/p1" target="_top">Ver producto<\/a>/, 'del historial: sin imagen, cantidad ni botones');
  assert.doesNotMatch(past, /<img/);

  // Abrir un producto o una página: mientras navega avisa, si falla lo dice y del historial o cortada queda el link
  const openProduct = { id: 'action-4', action: 'open_product', product };
  assert.match(render(openProduct, { status: 'waiting' }), /role="status" class="gps-action-status">Abriendo Campera…/);
  assert.match(render(page, { status: 'running' }), /Abriendo Envíos…/);
  assert.match(render(page, { status: 'failed' }), /No pudimos abrir la página\. <a class="gps-action-link" href="https:\/\/shop.test\/envios" target="_top">Envíos<\/a>/);
  assert.match(render(page), /<a class="gps-action-link" href="https:\/\/shop.test\/envios" target="_top">Envíos <span aria-hidden="true">→<\/span><\/a>/);
  assert.match(render(openProduct, { status: 'cancelled' }), /<a class="gps-action-link" href="https:\/\/shop.test\/p1" target="_top">Campera/);

  // La tarjeta muestra "Agregar al carrito" solo si el chat puede agregar
  const card = (props) => renderToStaticMarkup(React.createElement(ProductCard, { product: { ...product, brand: '', price: 1, currency: 'CLP', description: '' }, session, conversationId: 'c', messageId: 'm', cards: DEFAULT_CARDS, ...props }));
  assert.match(card({ onAddToCart: async () => ({ ok: true }) }), /<div class="product-cart gps-card-cart is-idle" data-gps-status="idle"><button type="button" class="gps-card-add">Agregar al carrito<\/button><\/div>/);
  assert.doesNotMatch(card({}), /gps-card-add/);

  console.log('Actions: all assertions passed');
})().catch((error) => { console.error(error); process.exit(1); });
