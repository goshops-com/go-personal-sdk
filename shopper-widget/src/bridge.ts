export type Product = { id: string; name: string; price: number | null; currency: string; image: string | null; url: string; brand: string; description: string };
export type Config = { name: string; welcome: string; color: string; suggestions: string[]; language: 'es' | 'en' | 'pt'; currency: string };
export type Session = { token: string; apiUrl: string; config: Config; sessionKey?: string; conversationId?: string; preview?: boolean; canClose?: boolean; appearance?: unknown; context?: { productId?: string; pageType?: 'home' | 'product' | 'search' | 'other' } };
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
