// Íconos del botón de enviar: flecha, avión de papel o lupa.
import type { Composer } from './appearance';

// Trazos de cada ícono, en una grilla de 24 × 24.
const PATHS: Record<Composer['sendIcon'], string> = {
  arrow: 'M12 19V5M5 12l7-7 7 7',
  plane: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4',
};

// Dibuja el ícono elegido con el color del texto del botón.
export function SendIcon({ icon }: { icon: Composer['sendIcon'] }) {
  return <svg className={`gps-send-icon is-${icon}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[icon]} />
  </svg>;
}
