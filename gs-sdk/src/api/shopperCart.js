// Agregar al carrito desde el Personal Shopper: elige quién ejecuta (callback de la tienda o adaptador de su plataforma).

const MAX_QUANTITY = 10;
const FENICIO_TIMEOUT_MS = 15000;
// Tipos de producto de Magento que se agregan sin elegir opciones.
const MAGENTO_DIRECT_TYPES = ['simple', 'virtual', 'downloadable'];

// Nombres de provider que usan las tiendas, llevados a la plataforma que sabemos manejar.
const PLATFORMS = { shopify: 'shopify', vtex: 'vtex', fenicio: 'fenicio', magento: 'magento', magento_v2: 'magento', magento2: 'magento' };

// Devuelve la plataforma conocida del provider configurado en el init, o null.
export function platformOf(provider) {
  return PLATFORMS[String(provider || '').trim().toLowerCase()] || null;
}

// Arma una URL absoluta de la tienda a partir de una ruta.
const storeUrl = path => new URL(path, window.location.origin).href;

// Pide JSON a la tienda y devuelve { status, body }; el body es null si no es JSON.
async function storeJson(path, init = {}) {
  const response = await fetch(storeUrl(path), { credentials: 'same-origin', ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  let body = null;
  try { body = await response.json(); } catch (_) { /* Respuesta sin JSON. */ }
  return { status: response.status, body };
}

// Devuelve el handle de Shopify a partir de la URL del producto (/products/<handle>).
function shopifyHandle(url) {
  try { return (new URL(url, window.location.origin).pathname.match(/\/products\/([^/?#]+)/) || [])[1] || null; } catch (_) { return null; }
}

// Adaptador de Shopify: agrega con /cart/add.js y, sin variante, la busca en /products/<handle>.js.
const shopify = {
  async add({ variantId, url, quantity }) {
    let variant = variantId;

    // Sin variante: la toma del producto si tiene una sola disponible
    if (!variant) {
      const handle = shopifyHandle(url);
      if (!handle) return { ok: false, error: 'not_found' };
      const { status, body } = await storeJson(`/products/${encodeURIComponent(handle)}.js`);
      if (status !== 200 || !body || !Array.isArray(body.variants)) return { ok: false, error: 'not_found' };
      const available = body.variants.filter(v => v.available);
      if (!available.length) return { ok: false, error: 'out_of_stock' };
      if (available.length > 1) return { ok: false, error: 'variant_required' };
      variant = available[0].id;
    }

    // Agrega al carrito de la sesión del visitante
    const { status } = await storeJson('/cart/add.js', { method: 'POST', body: JSON.stringify({ items: [{ id: Number(variant) || variant, quantity }] }) });
    if (status === 200) return { ok: true };
    return { ok: false, error: status === 422 ? 'out_of_stock' : 'failed' };
  },
};

// Adaptador de VTEX: agrega con la API REST del orderForm y, sin SKU, lo busca en el catálogo de la tienda.
const vtex = {
  async add({ productId, variantId, quantity }) {
    let sku = variantId; let seller = null;

    // Sin SKU: lo toma del producto si tiene uno solo con stock
    if (!sku) {
      const { status, body } = await storeJson(`/api/catalog_system/pub/products/search?fq=productId:${encodeURIComponent(productId)}`);
      const product = status === 200 && Array.isArray(body) ? body[0] : null;
      if (!product || !Array.isArray(product.items)) return { ok: false, error: 'not_found' };
      const available = product.items.filter(item => (item.sellers || []).some(s => s.commertialOffer && s.commertialOffer.AvailableQuantity > 0));
      if (!available.length) return { ok: false, error: 'out_of_stock' };
      if (available.length > 1) return { ok: false, error: 'variant_required' };
      sku = available[0].itemId;
      seller = available[0].sellers.find(s => s.commertialOffer && s.commertialOffer.AvailableQuantity > 0).sellerId;
    }

    // Toma el carrito del visitante y le agrega el SKU
    const orderForm = await storeJson('/api/checkout/pub/orderForm');
    if (orderForm.status !== 200 || !orderForm.body || !orderForm.body.orderFormId) return { ok: false, error: 'failed' };
    const { status } = await storeJson(`/api/checkout/pub/orderForm/${encodeURIComponent(orderForm.body.orderFormId)}/items`, {
      method: 'POST', body: JSON.stringify({ orderItems: [{ id: String(sku), quantity, seller: String(seller || '1') }] }),
    });
    return status === 200 ? { ok: true } : { ok: false, error: 'failed' };
  },
};

// Adaptador de Fenicio: agrega con miCompra.agregarArticulo de la página, que necesita la variante de Fenicio.
const fenicio = {
  add({ variantId, quantity }) {
    if (!variantId) return { ok: false, error: 'variant_required' };
    const miCompra = window.miCompra;
    if (!miCompra || typeof miCompra.agregarArticulo !== 'function') return { ok: false, error: 'unavailable' };
    return new Promise(resolve => {
      // Si Fenicio no responde a tiempo, cuenta como fallido
      const timer = setTimeout(() => resolve({ ok: false, error: 'failed' }), FENICIO_TIMEOUT_MS);
      try {
        miCompra.agregarArticulo(variantId, quantity, response => {
          clearTimeout(timer);

          // Un mensaje de Fenicio es un rechazo (sin stock, cantidad máxima, etc.)
          if (response && response.msj) return resolve({ ok: false, error: 'rejected', message: String(response.msj).slice(0, 200) });

          // Actualiza el carrito del header de la tienda con la compra que devuelve
          if (response && response.c !== undefined && typeof miCompra.setCompra === 'function') {
            try { miCompra.setCompra(response.c); } catch (_) { /* El theme no pudo refrescar el header; el producto ya está agregado. */ }
          }
          resolve({ ok: true });
        });
      } catch (_) {
        // Fenicio falló al llamarlo: corta la espera y responde fallido
        clearTimeout(timer);
        resolve({ ok: false, error: 'failed' });
      }
    });
  },
};

// Busca en la GraphQL pública de Magento un producto por SKU o por url_key; devuelve { id, type, inStock } o null.
async function magentoProduct(field, value) {
  const query = `{ products(filter: { ${field}: { eq: ${JSON.stringify(value)} } }) { items { id type_id stock_status } } }`;
  const { status, body } = await storeJson('/graphql', { method: 'POST', body: JSON.stringify({ query }) });
  const found = status === 200 && body && body.data && body.data.products && body.data.products.items[0];
  return found ? { id: found.id, type: found.type_id, inStock: found.stock_status !== 'OUT_OF_STOCK' } : null;
}

// Devuelve el url_key de Magento a partir de la URL del producto (/<url_key>.html).
function magentoUrlKey(url) {
  try { return (new URL(url, window.location.origin).pathname.match(/\/([^/]+?)(?:\.html)?$/) || [])[1] || null; } catch (_) { return null; }
}

// Lee el form_key de la sesión de Magento desde su cookie.
function magentoFormKey() {
  const cookie = document.cookie.split('; ').find(c => c.startsWith('form_key='));
  return cookie ? decodeURIComponent(cookie.slice('form_key='.length)) : null;
}

// Pide a Magento que recargue la sección del carrito para refrescar el minicart, si la página tiene RequireJS.
function refreshMagentoMinicart() {
  if (typeof window.require !== 'function') return;
  try { window.require(['Magento_Customer/js/customer-data'], customerData => customerData.reload(['cart'], true)); } catch (_) { /* Sin customer-data el minicart se actualiza al recargar la página. */ }
}

// Adaptador de Magento 2: busca el id interno por GraphQL y agrega con el formulario de carrito y el form_key de la sesión.
const magento = {
  async add({ productId, variantId, url, quantity }) {
    // Busca el producto por SKU y, si no aparece, por la URL
    let product = await magentoProduct('sku', productId);
    const urlKey = !product && url ? magentoUrlKey(url) : null;
    if (!product && urlKey) product = await magentoProduct('url_key', urlKey);

    // Sin GraphQL, un id numérico se usa como id interno de un producto simple
    const numericId = [variantId, productId].find(id => /^\d+$/.test(id || ''));
    if (!product && numericId) product = { id: Number(numericId), type: 'simple', inStock: true };
    if (!product) return { ok: false, error: 'not_found' };
    if (!MAGENTO_DIRECT_TYPES.includes(product.type)) return { ok: false, error: 'variant_required' };
    if (!product.inStock) return { ok: false, error: 'out_of_stock' };

    // Agrega con el form_key de la sesión del visitante
    const formKey = magentoFormKey();
    if (!formKey) return { ok: false, error: 'unavailable' };
    const response = await fetch(storeUrl(`/checkout/cart/add/product/${product.id}/`), {
      method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ product: String(product.id), qty: String(quantity), form_key: formKey }),
    });

    // Solo cuenta como agregado una respuesta JSON sin backUrl; si no, Magento redirigió o falló
    let body = null;
    if (response.status === 200 && (response.headers.get('content-type') || '').includes('json')) {
      try { body = await response.json(); } catch (_) { body = null; }
    }
    if (!body || body.backUrl) return { ok: false, error: 'rejected' };
    refreshMagentoMinicart();
    return { ok: true };
  },
};

const ADAPTERS = { shopify, vtex, fenicio, magento };

// Normaliza lo que devuelve el callback de la tienda: undefined o true es éxito; false o { ok: false } es error.
function customResult(value) {
  if (value === undefined || value === true) return { ok: true };
  if (value && typeof value === 'object') {
    const ok = value.ok !== false;
    return ok ? { ok } : { ok, error: typeof value.error === 'string' ? value.error.slice(0, 100) : 'failed' };
  }
  return { ok: false, error: 'failed' };
}

// Valida el pedido del widget y devuelve { productId, variantId, url, quantity } o null.
export function cartItemOf(product) {
  if (!product || typeof product !== 'object') return null;
  const productId = typeof product.id === 'string' || typeof product.id === 'number' ? String(product.id).slice(0, 100) : '';
  const variantId = typeof product.variantId === 'string' || typeof product.variantId === 'number' ? String(product.variantId).slice(0, 100) : '';
  const quantity = product.quantity === undefined ? 1 : Number(product.quantity);
  if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return null;
  return { productId, variantId: variantId || null, url: typeof product.url === 'string' ? product.url : null, quantity };
}

// Devuelve quién agrega al carrito en esta tienda, o null si nadie: primero el callback de mountShopper, después la plataforma.
export function resolveCart({ cart, provider } = {}) {
  // Callback propio de la tienda (tiendas a medida o headless)
  if (cart && typeof cart.add === 'function') {
    return {
      source: 'custom',
      async add(item) {
        try { return customResult(await cart.add(item)); } catch (_) { return { ok: false, error: 'failed' }; }
      },
    };
  }
  // Adaptador de la plataforma configurada en el init
  const platform = platformOf(provider);
  if (!platform) return null;
  const adapter = ADAPTERS[platform];
  return {
    source: platform,
    async add(item) {
      try {
        return await adapter.add(item);
      } catch (_) { return { ok: false, error: 'failed' }; }
    },
  };
}
