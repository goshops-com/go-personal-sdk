// Acciones que el chat del Personal Shopper le pide a la tienda: cuáles hay disponibles y cómo se ejecuta cada una.
import { cartItemOf } from './shopperCart';

// Marca en sessionStorage y query param con los que el chat se vuelve a abrir en la página de destino.
const REOPEN_STORAGE = 'gp-shopper-reopen';
const REOPEN_PARAM = 'gp_shopper';
// Tiempo en que la marca sigue valiendo: si la navegación no llegó a tiempo, el chat queda cerrado.
const REOPEN_TTL_MS = 30000;

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

// Devuelve la URL absoluta si es http(s) y del mismo dominio que la tienda, o null; si cambia el origen le suma el param para reabrir el chat.
export function storeLink(value) {
  if (typeof value !== 'string' || !value) return null;
  let link;
  try { link = new URL(value, window.location.origin); } catch (_) { return null; }
  if (!['https:', 'http:'].includes(link.protocol)) return null;
  if (bareHost(link.hostname) !== bareHost(window.location.hostname)) return null;

  // El sessionStorage no pasa a otro origen (con o sin www., http o https): ahí el aviso va en la URL
  if (link.origin !== window.location.origin) link.searchParams.set(REOPEN_PARAM, 'open');
  return link.href;
}

// Dice si el chat venía abierto antes de una navegación pedida por él, y borra el aviso para usarlo una sola vez.
export function consumeReopen() {
  let reopen = false;

  // Aviso en la URL cuando la navegación cambió de origen: se saca de la barra de direcciones
  const current = new URL(window.location.href);
  if (current.searchParams.get(REOPEN_PARAM) === 'open') {
    reopen = true;
    current.searchParams.delete(REOPEN_PARAM);
    window.history.replaceState(window.history.state, '', current.href);
  }

  // Aviso en sessionStorage, válido solo por unos segundos
  try {
    const at = Number(window.sessionStorage.getItem(REOPEN_STORAGE));
    window.sessionStorage.removeItem(REOPEN_STORAGE);
    if (at && Date.now() - at < REOPEN_TTL_MS) reopen = true;
  } catch (_) { /* Sin storage solo cuenta el aviso de la URL. */ }
  return reopen;
}

// Ejecuta una acción si está entre las disponibles y devuelve { ok, error? } para responderle al chat.
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
          window.dispatchEvent(new CustomEvent('gp-shopper:cart-added', { detail: item }));
        }
        return result;
      }
      case 'open_product':
      case 'open_page': {
        // Toma la URL del producto o de la página configurada y solo navega dentro de la tienda
        const target = action === 'open_product' ? payload.product : payload.page;
        const link = storeLink(target && target.url);
        if (!link) return { ok: false, error: 'invalid_action' };

        // Deja la marca para que el chat se abra solo en la página de destino
        try { window.sessionStorage.setItem(REOPEN_STORAGE, String(Date.now())); } catch (_) { /* Sin storage el chat queda cerrado al navegar. */ }
        window.location.assign(link);
        return { ok: true };
      }
    }
  }

  // Acción desconocida o apagada para esta tienda
  return { ok: false, error: 'unavailable' };
}
