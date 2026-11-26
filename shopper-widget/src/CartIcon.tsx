// Íconos del botón Agregar al carrito: carrito, bolsa o más; sin ícono no dibuja nada.
import type { CartAppearance } from './appearance';

export type CartIconName = CartAppearance['card']['icon'];

// Trazos de cada ícono, en una grilla de 24 × 24.
const PATHS: Record<Exclude<CartIconName, 'none'>, string> = {
  cart: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L20 8H6.2M9 20.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Zm8 0a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z',
  bag: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  plus: 'M12 5v14M5 12h14',
};

// Dibuja el ícono elegido con el color del texto del botón.
export function CartIcon({ icon }: { icon: CartIconName }) {
  if (icon === 'none') return null;
  return <svg className={`gps-card-add-icon is-${icon}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[icon]} />
  </svg>;
}
