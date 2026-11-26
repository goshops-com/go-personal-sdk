import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, mockFetch, jsonResponse } from './helpers/env.mjs';
import { platformOf, cartItemOf, resolveCart } from '../../src/api/shopperCart.js';

const STORE = 'https://shop.example';
const item = (extra = {}) => ({ productId: 'p1', variantId: null, url: `${STORE}/products/zapatillas-trekking`, quantity: 1, ...extra });

beforeEach(() => resetDom());

test('platformOf reconoce los providers de Shopify, VTEX, Fenicio y Magento sin importar mayúsculas, y nada más por ahora', () => {
  for (const provider of ['Shopify', 'shopify', ' SHOPIFY ']) assert.equal(platformOf(provider), 'shopify');
  for (const provider of ['Vtex', 'VTEX', 'vtex']) assert.equal(platformOf(provider), 'vtex');
  for (const provider of ['Fenicio', 'FENICIO']) assert.equal(platformOf(provider), 'fenicio');
  for (const provider of ['Magento_V2', 'magento', 'Magento2']) assert.equal(platformOf(provider), 'magento');
  for (const provider of ['Custom', 'Luna', 'WooCommerce', '', undefined, null]) assert.equal(platformOf(provider), null);
});

test('cartItemOf acepta id, variante, URL y cantidad de 1 a 10, y rechaza lo demás', () => {
  assert.deepEqual(cartItemOf({ id: 42, variantId: 7, url: `${STORE}/products/a`, quantity: 2 }), { productId: '42', variantId: '7', url: `${STORE}/products/a`, quantity: 2 });
  assert.deepEqual(cartItemOf({ id: 'p1' }), { productId: 'p1', variantId: null, url: null, quantity: 1 });
  for (const bad of [null, 'p1', {}, { id: '' }, { id: {} }, { id: 'p1', quantity: 0 }, { id: 'p1', quantity: 11 }, { id: 'p1', quantity: 1.5 }, { id: 'p1', quantity: '2x' }]) {
    assert.equal(cartItemOf(bad), null, JSON.stringify(bad));
  }
});

test('sin callback ni plataforma conocida no hay quién agregue al carrito', () => {
  assert.equal(resolveCart({}), null);
  assert.equal(resolveCart({ cart: { add: 'no' }, provider: 'Custom' }), null);
  assert.equal(resolveCart(), null);
});

test('el callback de la tienda le gana a la plataforma y su respuesta se normaliza', async () => {
  const received = [];
  const custom = (value) => resolveCart({ cart: { add: async (i) => { received.push(i); if (value instanceof Error) throw value; return value; } }, provider: 'Shopify' });
  assert.equal(custom(undefined).source, 'custom');
  assert.deepEqual(await custom(undefined).add(item()), { ok: true });
  assert.deepEqual(received[0], item(), 'recibe el producto, la variante, la URL y la cantidad');
  assert.deepEqual(await custom(true).add(item()), { ok: true });
  assert.deepEqual(await custom({ ok: true, cartUrl: '/carrito' }).add(item()), { ok: true });
  assert.deepEqual(await custom({ ok: false, error: 'sin stock' }).add(item()), { ok: false, error: 'sin stock' });
  assert.deepEqual(await custom({ ok: false }).add(item()), { ok: false, error: 'failed' });
  assert.deepEqual(await custom(false).add(item()), { ok: false, error: 'failed' });
  assert.deepEqual(await custom(new Error('boom')).add(item()), { ok: false, error: 'failed' });
});

test('Shopify con variante agrega directo a /cart/add.js y devuelve la URL del carrito', async () => {
  const calls = mockFetch(() => ({ items: [] }));
  const result = await resolveCart({ provider: 'Shopify' }).add(item({ variantId: '4455', quantity: 2 }));
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${STORE}/cart/add.js`);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { items: [{ id: 4455, quantity: 2 }] });
  assert.equal(calls[0].init.credentials, 'same-origin');
});

test('Shopify sin variante usa la única disponible del producto, o pide elegir, o avisa sin stock', async () => {
  const product = (variants) => mockFetch((url) => (url.endsWith('/products/zapatillas-trekking.js') ? { variants } : { items: [] }));
  let calls = product([{ id: 1, available: false }, { id: 2, available: true }]);
  assert.deepEqual(await resolveCart({ provider: 'Shopify' }).add(item()), { ok: true });
  assert.deepEqual(calls[1].body, { items: [{ id: 2, quantity: 1 }] });
  calls = product([{ id: 1, available: true }, { id: 2, available: true }]);
  assert.deepEqual(await resolveCart({ provider: 'Shopify' }).add(item()), { ok: false, error: 'variant_required' });
  assert.equal(calls.length, 1, 'no toca el carrito');
  product([{ id: 1, available: false }]);
  assert.deepEqual(await resolveCart({ provider: 'Shopify' }).add(item()), { ok: false, error: 'out_of_stock' });
});

test('Shopify: producto inexistente, URL sin handle, sin stock al agregar, error del servidor o de red', async () => {
  const shopify = resolveCart({ provider: 'shopify' });
  mockFetch(() => jsonResponse({}, { status: 404 }));
  assert.deepEqual(await shopify.add(item()), { ok: false, error: 'not_found' });
  assert.deepEqual(await shopify.add(item({ url: `${STORE}/collections/mujer` })), { ok: false, error: 'not_found' });
  assert.deepEqual(await shopify.add(item({ url: null })), { ok: false, error: 'not_found' });
  mockFetch(() => jsonResponse({ description: 'sold out' }, { status: 422 }));
  assert.deepEqual(await shopify.add(item({ variantId: '1' })), { ok: false, error: 'out_of_stock' });
  mockFetch(() => jsonResponse('error', { status: 500 }));
  assert.deepEqual(await shopify.add(item({ variantId: '1' })), { ok: false, error: 'failed' });
  mockFetch(() => { throw new Error('offline'); });
  assert.deepEqual(await shopify.add(item({ variantId: '1' })), { ok: false, error: 'failed' });
  mockFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('no json'); } }));
  assert.deepEqual(await shopify.add(item({ variantId: 'abc' })), { ok: true }, 'una respuesta 200 sin JSON igual cuenta como agregado');
});

// Mockea las APIs de VTEX: catálogo, orderForm y agregado de ítems.
function vtexStore({ items, orderForm = { status: 200, body: { orderFormId: 'of-1' } }, add = 200 } = {}) {
  return mockFetch((url) => {
    if (url.includes('/api/catalog_system/pub/products/search')) return items === undefined ? [] : [{ items }];
    if (url.endsWith('/api/checkout/pub/orderForm')) return jsonResponse(orderForm.body, { status: orderForm.status });
    if (url.endsWith('/items')) return jsonResponse({}, { status: add });
    return jsonResponse({}, { status: 404 });
  });
}
const sku = (itemId, quantity, sellerId = '1') => ({ itemId, sellers: [{ sellerId, commertialOffer: { AvailableQuantity: quantity } }] });

test('VTEX sin SKU usa el único con stock del producto y lo agrega al orderForm del visitante', async () => {
  const calls = vtexStore({ items: [sku('10', 0), sku('11', 5, 'seller-a')] });
  assert.deepEqual(await resolveCart({ provider: 'Vtex' }).add(item({ quantity: 3 })), { ok: true });
  assert.equal(calls[0].url, `${STORE}/api/catalog_system/pub/products/search?fq=productId:p1`);
  assert.equal(calls[2].url, `${STORE}/api/checkout/pub/orderForm/of-1/items`);
  assert.deepEqual(calls[2].body, { orderItems: [{ id: '11', quantity: 3, seller: 'seller-a' }] });
});

test('VTEX con SKU no consulta el catálogo y usa el vendedor por defecto', async () => {
  const calls = vtexStore({});
  assert.deepEqual(await resolveCart({ provider: 'VTEX' }).add(item({ variantId: '99' })), { ok: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { orderItems: [{ id: '99', quantity: 1, seller: '1' }] });
});

test('VTEX: varios SKU con stock, ninguno, producto inexistente o fallas del orderForm', async () => {
  const vtex = resolveCart({ provider: 'vtex' });
  vtexStore({ items: [sku('10', 2), sku('11', 5)] });
  assert.deepEqual(await vtex.add(item()), { ok: false, error: 'variant_required' });
  vtexStore({ items: [sku('10', 0)] });
  assert.deepEqual(await vtex.add(item()), { ok: false, error: 'out_of_stock' });
  vtexStore({});
  assert.deepEqual(await vtex.add(item()), { ok: false, error: 'not_found' });
  vtexStore({ items: [sku('10', 1)], orderForm: { status: 500, body: {} } });
  assert.deepEqual(await vtex.add(item()), { ok: false, error: 'failed' });
  vtexStore({ items: [sku('10', 1)], add: 400 });
  assert.deepEqual(await vtex.add(item()), { ok: false, error: 'failed' });
});

// Simula el miCompra de una página de Fenicio que responde con `response` (o nunca, si es undefined).
function fenicioPage(response, extra = {}) {
  const calls = [];
  window.miCompra = {
    agregarArticulo: (variant, qty, callback) => { calls.push({ variant, qty }); if (response !== undefined) callback(response); },
    setCompra: (compra) => calls.push({ setCompra: compra }),
    ...extra,
  };
  return calls;
}
afterEach(() => { delete window.miCompra; mock.timers.reset(); });

test('Fenicio agrega la variante con miCompra.agregarArticulo y actualiza el carrito del header', async () => {
  const calls = fenicioPage({ msj: '', c: { cantidad: 3 } });
  const result = await resolveCart({ provider: 'Fenicio' }).add(item({ variantId: '1:SS266MET143:NE:L:1', quantity: 2 }));
  assert.deepEqual(result, { ok: true }, 'Fenicio no tiene una URL de carrito fija');
  assert.deepEqual(calls, [{ variant: '1:SS266MET143:NE:L:1', qty: 2 }, { setCompra: { cantidad: 3 } }]);
});

test('Fenicio: sin variante pide elegirla, sin miCompra no está disponible y un mensaje es un rechazo', async () => {
  const fenicio = resolveCart({ provider: 'fenicio' });
  fenicioPage({ msj: '' });
  assert.deepEqual(await fenicio.add(item()), { ok: false, error: 'variant_required' });
  delete window.miCompra;
  assert.deepEqual(await fenicio.add(item({ variantId: 'v' })), { ok: false, error: 'unavailable' });
  const calls = fenicioPage({ msj: 'No hay stock suficiente' });
  assert.deepEqual(await fenicio.add(item({ variantId: 'v' })), { ok: false, error: 'rejected', message: 'No hay stock suficiente' });
  assert.equal(calls.some((c) => c.setCompra), false);
});

test('Fenicio: sin compra en la respuesta, o si el header falla al refrescar, el producto igual queda agregado', async () => {
  fenicioPage({ msj: '' }, { setCompra: undefined });
  assert.deepEqual(await resolveCart({ provider: 'Fenicio' }).add(item({ variantId: 'v' })), { ok: true });
  fenicioPage({ msj: '', c: {} }, { setCompra: () => { throw new Error('theme'); } });
  assert.deepEqual(await resolveCart({ provider: 'Fenicio' }).add(item({ variantId: 'v' })), { ok: true });
  fenicioPage(null);
  assert.deepEqual(await resolveCart({ provider: 'Fenicio' }).add(item({ variantId: 'v' })), { ok: true }, 'una respuesta vacía no es un rechazo');
});

test('Fenicio: si agregarArticulo no responde en 15 segundos cuenta como fallido', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  fenicioPage(undefined);
  const pending = resolveCart({ provider: 'Fenicio' }).add(item({ variantId: 'v' }));
  mock.timers.tick(15000);
  assert.deepEqual(await pending, { ok: false, error: 'failed' });
});

test('Fenicio: si agregarArticulo tira una excepción cuenta como fallido', async () => {
  fenicioPage(undefined, { agregarArticulo: () => { throw new Error('boom'); } });
  assert.deepEqual(await resolveCart({ provider: 'Fenicio' }).add(item({ variantId: 'v' })), { ok: false, error: 'failed' });
});

// Simula Magento: la GraphQL encuentra el producto por SKU o url_key, y el carrito responde como en bookshop.
function magentoStore({ bySku = null, byUrlKey = null, graphql = 200, add = { status: 200, json: [] } } = {}) {
  document.cookie = 'form_key=fk%2B1; path=/';
  return mockFetch((url, init, call) => {
    if (url.endsWith('/graphql')) {
      if (graphql !== 200) return jsonResponse({}, { status: graphql });
      const found = call.body.query.includes('sku:') ? bySku : byUrlKey;
      return { data: { products: { items: found ? [found] : [] } } };
    }
    if (url.includes('/checkout/cart/add/product/')) {
      if (add.json === undefined) return jsonResponse('<!doctype html>', { status: add.status, headers: { 'content-type': 'text/html' } });
      return jsonResponse(add.json, { status: add.status, headers: { 'content-type': 'application/json' } });
    }
    return jsonResponse({}, { status: 404 });
  });
}
const book = { id: 45677, type_id: 'simple', stock_status: 'IN_STOCK' };

test('Magento busca el id interno por SKU, agrega con el form_key de la sesión y refresca el minicart', async () => {
  const reloads = [];
  window.require = (modules, callback) => callback({ reload: (sections, force) => reloads.push([modules[0], sections, force]) });
  const calls = magentoStore({ bySku: book });
  const result = await resolveCart({ provider: 'Magento_V2' }).add(item({ productId: '9791387871185', quantity: 2 }));
  assert.deepEqual(result, { ok: true });
  assert.match(calls[0].body.query, /sku: \{ eq: "9791387871185" \}/);
  assert.equal(calls[1].url, `${STORE}/checkout/cart/add/product/45677/`);
  assert.equal(calls[1].init.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(String(calls[1].init.body), 'product=45677&qty=2&form_key=fk%2B1');
  assert.deepEqual(reloads, [['Magento_Customer/js/customer-data', ['cart'], true]]);
  delete window.require;
});

test('Magento: si el SKU no aparece busca por el url_key de la URL, y sin GraphQL usa un id numérico', async () => {
  let calls = magentoStore({ byUrlKey: book });
  assert.equal((await resolveCart({ provider: 'magento' }).add(item({ productId: 'otro', url: `${STORE}/proyecto-hail-mary.html` }))).ok, true);
  assert.match(calls[1].body.query, /url_key: \{ eq: "proyecto-hail-mary" \}/);
  calls = magentoStore({ graphql: 404 });
  assert.equal((await resolveCart({ provider: 'magento' }).add(item({ productId: '45677', url: null }))).ok, true);
  assert.equal(calls.at(-1).url, `${STORE}/checkout/cart/add/product/45677/`);
});

test('Magento agrega productos virtuales y descargables, que tampoco necesitan opciones', async () => {
  for (const type of ['virtual', 'downloadable']) {
    magentoStore({ bySku: { ...book, type_id: type } });
    assert.equal((await resolveCart({ provider: 'magento' }).add(item())).ok, true, type);
  }
  for (const type of ['configurable', 'bundle', 'grouped']) {
    magentoStore({ bySku: { ...book, type_id: type } });
    assert.deepEqual(await resolveCart({ provider: 'magento' }).add(item()), { ok: false, error: 'variant_required' }, type);
  }
});

test('Magento: no encontrado, configurable, sin stock o sin form_key no tocan el carrito', async () => {
  const magento = resolveCart({ provider: 'magento' });
  magentoStore({});
  assert.deepEqual(await magento.add(item({ productId: 'sku-x', url: null })), { ok: false, error: 'not_found' });
  magentoStore({ bySku: { ...book, type_id: 'configurable' } });
  assert.deepEqual(await magento.add(item()), { ok: false, error: 'variant_required' });
  magentoStore({ bySku: { ...book, stock_status: 'OUT_OF_STOCK' } });
  assert.deepEqual(await magento.add(item()), { ok: false, error: 'out_of_stock' });
  const calls = magentoStore({ bySku: book });
  document.cookie = 'form_key=; Max-Age=0; path=/';
  assert.deepEqual(await magento.add(item()), { ok: false, error: 'unavailable' });
  assert.equal(calls.some((c) => c.url.includes('/checkout/cart/add')), false);
});

test('Magento: una redirección en HTML, un backUrl o un error del servidor son un rechazo', async () => {
  const magento = resolveCart({ provider: 'magento' });
  magentoStore({ bySku: book, add: { status: 200 } });
  assert.deepEqual(await magento.add(item()), { ok: false, error: 'rejected' }, 'Magento redirige con HTML cuando no puede agregar');
  magentoStore({ bySku: book, add: { status: 200, json: { backUrl: `${STORE}/producto.html` } } });
  assert.deepEqual(await magento.add(item()), { ok: false, error: 'rejected' });
  magentoStore({ bySku: book, add: { status: 500, json: {} } });
  assert.deepEqual(await magento.add(item()), { ok: false, error: 'rejected' });
  magentoStore({ bySku: book });
  mockFetch((url) => (url.endsWith('/graphql') ? { data: { products: { items: [book] } } } : { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => { throw new SyntaxError('x'); } }));
  assert.deepEqual(await magento.add(item()), { ok: false, error: 'rejected' });
});

test('Magento: sin RequireJS, o si customer-data falla, el producto igual queda agregado', async () => {
  magentoStore({ bySku: book });
  assert.equal((await resolveCart({ provider: 'magento' }).add(item())).ok, true);
  window.require = () => { throw new Error('requirejs'); };
  magentoStore({ bySku: book });
  assert.equal((await resolveCart({ provider: 'magento' }).add(item())).ok, true);
  delete window.require;
});
