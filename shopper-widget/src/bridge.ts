// Formato común de variantes que arma el backend para cualquier provider.
export type VariantOption = { name: string; values: string[] };
export type Variant = { id: string; title: string; available: boolean; options: Record<string, string>; image: string | null };
export type Product = {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  image: string | null;
  url: string;
  brand: string;
  description: string;
  options?: VariantOption[];
  variants?: Variant[];
};
export type Config = { name: string; welcome: string; color: string; suggestions: string[]; language: 'es' | 'en' | 'pt'; currency: string };
export type Session = { token: string; apiUrl: string; config: Config; sessionKey?: string; conversationId?: string; preview?: boolean; canClose?: boolean; appearance?: unknown; capabilities?: unknown; provider?: unknown; context?: { productId?: string; pageType?: 'home' | 'product' | 'search' | 'other' } };
export type StoreActionName = 'add_to_cart' | 'open_product' | 'open_page';
// Capacidades que anuncia el SDK: las acciones del asistente y el botón de carrito de las tarjetas.
export type Capability = StoreActionName | 'card_add_to_cart';
export type ActionProduct = {
  id: string;
  name: string;
  url: string;
  image?: string | null;
  quantity?: number;
  variantId?: string;
  variantTitle?: string;
  options?: VariantOption[];
  variants?: Variant[];
};
export type ActionRequest = { id: string; action: StoreActionName | 'card_add_to_cart'; confirm?: boolean; chooseVariant?: boolean; product?: ActionProduct; page?: { label: string; url: string } };
export type ActionResult = { ok: boolean; error?: string; message?: string };
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
const CAPABILITIES: Capability[] = ['add_to_cart', 'card_add_to_cart', 'open_product', 'open_page'];
const ACTION_TIMEOUT_MS = 20000;
const waiting = new Map<string, (result: ActionResult) => void>();

// Devuelve las capacidades conocidas que el SDK dice que este sitio puede ejecutar.
export function capabilitiesOf(session: Session): Capability[] {
  return Array.isArray(session.capabilities) ? CAPABILITIES.filter(action => (session.capabilities as unknown[]).includes(action)) : [];
}

// Devuelve solo las acciones del asistente, que son las que se le informan al backend del chat.
export function assistantActionsOf(session: Session): StoreActionName[] {
  return capabilitiesOf(session).filter((action): action is StoreActionName => action !== 'card_add_to_cart');
}

// Valida una acción en la tienda que mandó el backend; devuelve null si no tiene la forma esperada.
export function actionRequestOf(value: unknown): ActionRequest | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as ActionRequest;
  if (typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.id) || !STORE_ACTIONS.includes(request.action as StoreActionName)) return null;
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

    // Al SDK solo le llega lo que necesita: id, URL, cantidad y variante del producto, o la URL de la página
    const message: Record<string, unknown> = { actionId: id, action };
    if (product) {
      const item: Record<string, unknown> = { id: product.id, url: product.url, quantity: product.quantity || 1 };
      if (product.variantId) item.variantId = product.variantId;
      message.product = item;
    }
    if (page) message.page = { url: page.url };
    send('action', message);
  });
}

// Entrega el resultado que mandó el SDK a la acción que lo está esperando.
export function receiveActionResult(data: Record<string, unknown>) {
  const done = typeof data.actionId === 'string' ? waiting.get(data.actionId) : undefined;
  if (!done) return;
  done({ ok: data.ok === true,
    ...(typeof data.error === 'string' ? { error: data.error } : {}),
    ...(typeof data.message === 'string' ? { message: data.message } : {}) });
}

// Registra un evento de producto de la conversación; en la vista previa no mide nada.
export function productEvent(session: Session, { conversationId, messageId, productId, type }: { conversationId: string; messageId: string; productId: string; type: ProductEvent }) {
  if (session.preview) return;
  void fetch(`${session.apiUrl}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ eventId: crypto.randomUUID(), conversationId, messageId, productId, type }), keepalive: true }).catch(() => {});
}

// Devuelve la plataforma de la tienda que informó el SDK, o vacío.
export function providerOf(session: Session): string {
  if (typeof session.provider !== 'string') return '';
  return session.provider.trim().slice(0, 40);
}

// Dice si un valor tiene la forma de una variante del formato común.
function isVariant(value: any): value is Variant {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.available !== 'boolean') return false;
  return !!value.options && typeof value.options === 'object';
}

// Devuelve las variantes válidas; una imagen que no es texto queda en null.
export function variantsOf(value: unknown): Variant[] {
  if (!Array.isArray(value)) return [];

  const variants = value.filter(isVariant);
  return variants.map(variant => {
    const image = typeof variant.image === 'string' ? variant.image : null;
    return { ...variant, image };
  });
}

// Devuelve las opciones de las variantes; si el backend no las manda, las arma con los valores de cada variante.
export function optionsOf(value: unknown, variants: Variant[]): VariantOption[] {
  const given = Array.isArray(value) ? value : [];
  const valid = given.filter(option => option && typeof option.name === 'string' && Array.isArray(option.values));
  if (valid.length) return valid.map(option => ({ name: option.name, values: option.values.map(String) }));

  // Sin opciones: una por cada nombre que aparece en las variantes, con sus valores distintos en orden
  const names = new Set(variants.flatMap(variant => Object.keys(variant.options)));
  return [...names].map(name => {
    const values = variants.map(variant => variant.options[name]).filter(item => typeof item === 'string');
    return { name, values: [...new Set(values)] };
  });
}
