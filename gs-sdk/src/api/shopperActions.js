// Acciones que el chat del Personal Shopper le pide a la tienda: cuáles hay disponibles y cómo se ejecuta cada una.
import { cartItemOf } from './shopperCart';

// Devuelve las acciones que el chat puede pedir: las activadas en la config que además este sitio sabe ejecutar.
export function availableActions(skills, { cartExecutor }) {
  const actions = [];
  if (skills.addToCart === true && cartExecutor) actions.push('add_to_cart');
  if (skills.openProduct === true) actions.push('open_product');
  if (skills.openPages === true) actions.push('open_page');
  return actions;
}

// Quita el www. inicial de un dominio para comparar la tienda con y sin él.
const bareHost = host => host.replace(/^www\./, '');

// Devuelve la URL absoluta si es http(s) y del mismo dominio que la tienda, o null.
export function storeLink(value) {
  if (typeof value !== 'string' || !value) return null;
  let link;
  try { link = new URL(value, window.location.origin); } catch (_) { return null; }
  if (!['https:', 'http:'].includes(link.protocol)) return null;
  if (bareHost(link.hostname) !== bareHost(window.location.hostname)) return null;
  return link.href;
}

// Ejecuta una acción si está entre las disponibles y devuelve { ok, error?, cartUrl? } para responderle al chat.
export async function performAction(action, payload, { available, cartExecutor, isOpen }) {
  // Ejecuta la acción pedida solo si está disponible en este sitio
  if (available.includes(action)) {
    switch (action) {
      case 'add_to_cart': {
        const item = cartItemOf(payload.product);
        if (!item) return { ok: false, error: 'invalid_action' };

        const result = await cartExecutor.add(item);

        // Avisa a la página para que el theme pueda refrescar su carrito
        if (result.ok && isOpen()) {
          window.dispatchEvent(new CustomEvent('gp-shopper:cart-added', { detail: { ...item, cartUrl: result.cartUrl || null } }));
        }
        return result;
      }
      case 'open_product':
      case 'open_page': {
        // Toma la URL del producto o de la página configurada y solo navega dentro de la tienda
        const target = action === 'open_product' ? payload.product : payload.page;
        const link = storeLink(target && target.url);
        if (!link) return { ok: false, error: 'invalid_action' };

        window.location.assign(link);
        return { ok: true };
      }
    }
  }

  // Acción desconocida o apagada para esta tienda
  return { ok: false, error: 'unavailable' };
}
