export type Product = { id: string; name: string; price: number | null; currency: string; image: string | null; url: string; brand: string; description: string };
export type Config = { name: string; welcome: string; color: string; suggestions: string[]; language: 'es' | 'en' | 'pt'; currency: string };
export type Session = { token: string; apiUrl: string; config: Config; sessionKey?: string; conversationId?: string; preview?: boolean; canClose?: boolean; appearance?: unknown; capabilities?: unknown; context?: { productId?: string; pageType?: 'home' | 'product' | 'search' | 'other' } };
export type StoreActionName = 'add_to_cart' | 'open_product' | 'open_page';
export type ActionProduct = { id: string; name: string; url: string; image?: string | null; quantity?: number };
export type ActionRequest = { id: string; action: StoreActionName; confirm?: boolean; product?: ActionProduct; page?: { label: string; url: string } };
export type ActionResult = { ok: boolean; error?: string; message?: string; cartUrl?: string };
export type ProductEvent = 'product_view' | 'product_click' | 'add_to_cart' | 'open_product';
export const hostOrigin = new URLSearchParams(location.search).get('hostOrigin');
export function send(type: string, data: Record<string, unknown> = {}) {
  if (hostOrigin) window.parent.postMessage({ type: `gp-shopper:${type}`, ...data }, hostOrigin);
}
export function validSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Session;
  try {
    const u = new URL(s.apiUrl);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return false;
  } catch { return false; }
  return typeof s.token === 'string' && s.token.length < 5000 && validConfig(s.config);
}
// Valida la config pública que dibuja el chat: nombre, color, sugerencias, idioma y bienvenida.
export function validConfig(value: unknown): value is Config {
  if (!value || typeof value !== 'object') return false;
  const c = value as Config;
  return typeof c.name === 'string' && /^#[a-f0-9]{6}$/i.test(c.color) && Array.isArray(c.suggestions)
    && c.suggestions.length <= 4 && c.suggestions.every(v => typeof v === 'string' && v.length <= 120)
    && ['es', 'en', 'pt'].includes(c.language) && typeof c.welcome === 'string';
}

const STORE_ACTIONS: StoreActionName[] = ['add_to_cart', 'open_product', 'open_page'];
const ACTION_TIMEOUT_MS = 20000;
const waiting = new Map<string, (result: ActionResult) => void>();

// Devuelve las acciones conocidas que el SDK dice que este sitio puede ejecutar.
export function capabilitiesOf(session: Session): StoreActionName[] {
  return Array.isArray(session.capabilities) ? STORE_ACTIONS.filter(action => (session.capabilities as unknown[]).includes(action)) : [];
}

// Valida una acción en la tienda que mandó el backend; devuelve null si no tiene la forma esperada.
export function actionRequestOf(value: unknown): ActionRequest | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as ActionRequest;
  if (typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.id) || !STORE_ACTIONS.includes(request.action)) return null;
  if (request.action === 'open_page') return request.page && typeof request.page.url === 'string' && typeof request.page.label === 'string' ? request : null;
  return request.product && typeof request.product.id === 'string' && typeof request.product.url === 'string' && typeof request.product.name === 'string' ? request : null;
}

// Le pide una acción a la tienda por el SDK y espera su resultado; si no llega a tiempo cuenta como fallida.
export function requestStoreAction({ id, action, product, page }: ActionRequest): Promise<ActionResult> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve({ ok: false, error: 'timeout' });
    }, ACTION_TIMEOUT_MS);
    waiting.set(id, result => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve(result);
    });

    // Al SDK solo le llega lo que necesita para ejecutar: id, URL y cantidad del producto, o la URL de la página
    send('action', { actionId: id, action,
      ...(product ? { product: { id: product.id, url: product.url, quantity: product.quantity || 1 } } : {}),
      ...(page ? { page: { url: page.url } } : {}) });
  });
}

// Entrega el resultado que mandó el SDK a la acción que lo está esperando.
export function receiveActionResult(data: Record<string, unknown>) {
  const done = typeof data.actionId === 'string' ? waiting.get(data.actionId) : undefined;
  if (!done) return;
  done({ ok: data.ok === true,
    ...(typeof data.error === 'string' ? { error: data.error } : {}),
    ...(typeof data.message === 'string' ? { message: data.message } : {}),
    ...(typeof data.cartUrl === 'string' ? { cartUrl: data.cartUrl } : {}) });
}

// Registra un evento de producto de la conversación; en la vista previa no mide nada.
export function productEvent(session: Session, { conversationId, messageId, productId, type }: { conversationId: string; messageId: string; productId: string; type: ProductEvent }) {
  if (session.preview) return;
  void fetch(`${session.apiUrl}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ eventId: crypto.randomUUID(), conversationId, messageId, productId, type }), keepalive: true }).catch(() => {});
}
