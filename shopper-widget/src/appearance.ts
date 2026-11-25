// Apariencia configurable del chat: normaliza lo que llega de la config y valida el CSS propio.

export type Cards = {
  display: 'list' | 'grid' | 'carousel';
  layout: 'horizontal' | 'vertical';
  imageFit: 'contain' | 'cover';
  radius: 'none' | 'soft' | 'round';
  showBrand: boolean;
  showPrice: boolean;
  ctaLabel: string;
  ctaStyle: 'link' | 'button';
};
export type Logo = { kind: 'initial' | 'image'; image: string; background: string; color: string };
export type Appearance = { cards: Cards; logo: Logo; customCss: string };

export const DEFAULT_CARDS: Cards = { display: 'carousel', layout: 'horizontal', imageFit: 'contain', radius: 'round', showBrand: true, showPrice: true, ctaLabel: '', ctaStyle: 'link' };

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
      ctaLabel: typeof cards.ctaLabel === 'string' ? cards.ctaLabel.trim().slice(0, 20) : DEFAULT_CARDS.ctaLabel,
      ctaStyle: pick(cards.ctaStyle, ['link', 'button'], DEFAULT_CARDS.ctaStyle),
    },
    // El logo usa la imagen solo si es https; si no, la inicial del nombre
    logo: { kind: logo.kind === 'image' && logoImage ? 'image' : 'initial', image: logoImage, background: hexOrEmpty(logo.background), color: hexOrEmpty(logo.color) },
    customCss: safeCss(source.customCss),
  };
}
