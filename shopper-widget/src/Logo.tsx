// Logo del encabezado del chat.
import type { Logo as LogoConfig } from './appearance';

// Logo del encabezado: la imagen configurada o la inicial del nombre, con los colores elegidos o los de marca.
export function Logo({ name, logo }: { name: string; logo: LogoConfig }) {
  const style = { ...(logo.background ? { background: logo.background } : {}), ...(logo.color ? { color: logo.color } : {}) };
  return <div className={logo.kind === 'image' ? 'shopper-mark gps-logo has-image' : 'shopper-mark gps-logo'} style={style} aria-hidden="true">
    {logo.kind === 'image' ? <img src={logo.image} alt="" /> : (Array.from((name || '').trim())[0] || '').toUpperCase()}
  </div>;
}
