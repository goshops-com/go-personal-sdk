// Apariencia configurable del chat: normaliza lo que llega de la config y valida el CSS propio.

export type Cards = {
  display: 'list' | 'grid' | 'carousel';
  layout: 'horizontal' | 'vertical';
  imageFit: 'contain' | 'cover';
  radius: 'none' | 'soft' | 'round';
  showBrand: boolean;
  showPrice: boolean;
};
export type Logo = { kind: 'initial' | 'image'; image: string; background: string; color: string };
// Botones de agregar al carrito: el de la tarjeta y la confirmación del asistente; vacío usa el texto y los colores del chat.
export type CartAppearance = {
  card: { show: boolean; label: string; background: string; color: string };
  confirm: { question: string; confirmLabel: string; cancelLabel: string; background: string; color: string };
};
export type Appearance = { cards: Cards; logo: Logo; cart: CartAppearance; customCss: string };

export const DEFAULT_CARDS: Cards = { display: 'carousel', layout: 'horizontal', imageFit: 'contain', radius: 'round', showBrand: true, showPrice: true };

// Devuelve el valor si está entre las opciones permitidas, o el default.
function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback;
}

// Construcciones de CSS que cargan recursos externos o escapan del texto plano; mismas reglas que admin-apis.
const BLOCKED_CSS = [/\\/, /@import/i, /url\s*\(/i, /image-set/i, /\bsrc\s*\(/i, /\/\//, /expression\s*\(/i, /javascript:/i, /</];

// Devuelve el color si es un hex válido, o vacío para que se use el de marca o el de contraste.
const hexOrEmpty = (value: unknown) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '');

// Devuelve el CSS propio si es texto válido y no carga nada externo; si no, vacío.
export function safeCss(value: unknown): string {
  if (typeof value !== 'string' || value.length > 10000) return '';
  const withoutComments = value.replace(/\/\*[\s\S]*?\*\//g, '');
  return BLOCKED_CSS.some(pattern => pattern.test(withoutComments)) ? '' : value;
}

// Devuelve el texto recortado al largo máximo, o vacío si no es texto.
const label = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

// Normaliza los botones de agregar al carrito; el de la tarjeta queda apagado salvo que esté prendido.
function cartOf(value: unknown): CartAppearance {
  const cart = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const card = cart.card && typeof cart.card === 'object' ? cart.card as Record<string, unknown> : {};
  const confirm = cart.confirm && typeof cart.confirm === 'object' ? cart.confirm as Record<string, unknown> : {};
  return {
    card: { show: card.show === true, label: label(card.label, 24), background: hexOrEmpty(card.background), color: hexOrEmpty(card.color) },
    confirm: { question: label(confirm.question, 80), confirmLabel: label(confirm.confirmLabel, 24), cancelLabel: label(confirm.cancelLabel, 24),
      background: hexOrEmpty(confirm.background), color: hexOrEmpty(confirm.color) },
  };
}

// Variables CSS con los colores propios de los botones de carrito; las que quedan automáticas no se definen.
export function cartColors(cart: CartAppearance): Record<string, string> {
  const vars: Record<string, string> = {};
  if (cart.card.background) vars['--shopper-cart-bg'] = cart.card.background;
  if (cart.card.color) vars['--shopper-cart-ink'] = cart.card.color;
  if (cart.confirm.background) vars['--shopper-confirm-bg'] = cart.confirm.background;
  if (cart.confirm.color) vars['--shopper-confirm-ink'] = cart.confirm.color;
  return vars;
}

// Arma la apariencia completa: cada campo inválido o ausente toma su default, así una config vieja se ve como siempre.
export function appearanceOf(value: unknown): Appearance {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const cards = source.cards && typeof source.cards === 'object' ? source.cards as Record<string, unknown> : {};
  const header = source.header && typeof source.header === 'object' ? source.header as Record<string, unknown> : {};
  const logo = header.logo && typeof header.logo === 'object' ? header.logo as Record<string, unknown> : {};
  const logoImage = typeof logo.image === 'string' && /^https:\/\/\S+$/.test(logo.image) ? logo.image : '';
  return {
    cards: {
      display: pick(cards.display, ['list', 'grid', 'carousel'], DEFAULT_CARDS.display),
      layout: pick(cards.layout, ['horizontal', 'vertical'], DEFAULT_CARDS.layout),
      imageFit: pick(cards.imageFit, ['contain', 'cover'], DEFAULT_CARDS.imageFit),
      radius: pick(cards.radius, ['none', 'soft', 'round'], DEFAULT_CARDS.radius),
      showBrand: typeof cards.showBrand === 'boolean' ? cards.showBrand : DEFAULT_CARDS.showBrand,
      showPrice: typeof cards.showPrice === 'boolean' ? cards.showPrice : DEFAULT_CARDS.showPrice,
    },
    cart: cartOf(source.cart),
    // El logo usa la imagen solo si es https; si no, la inicial del nombre
    logo: { kind: logo.kind === 'image' && logoImage ? 'image' : 'initial', image: logoImage, background: hexOrEmpty(logo.background), color: hexOrEmpty(logo.color) },
    customCss: safeCss(source.customCss),
  };
}
