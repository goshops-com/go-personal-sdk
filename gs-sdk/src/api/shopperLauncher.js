// Botón flotante del Personal Shopper: lo dibuja con la apariencia publicada en la config, con defaults para cada campo.

const DEFAULT_COLOR = '#5e40bf';
const DEFAULT_LABEL = 'Personal Shopper';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Trazos SVG (viewBox 24x24) de cada ícono predefinido; `fill` indica si el trazo se rellena. Iguales a los del admin.
const ICONS = {
  sparkle: { fill: true, paths: ['M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z', 'M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z'] },
  chat: { fill: false, paths: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'] },
  bag: { fill: false, paths: ['M6 8h12l-1 12H7z', 'M9 8V6a3 3 0 0 1 6 0v2'] },
  search: { fill: false, paths: ['M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M20 20l-4.3-4.3'] },
  gift: { fill: false, paths: ['M4 11h16v9H4z', 'M3 7h18v4H3z', 'M12 7v13', 'M12 7c-1.5-3.5-5.5-3-4.5-.5', 'M12 7c1.5-3.5 5.5-3 4.5-.5'] },
};

// Animaciones de aparición; los keyframes se agregan una sola vez a la página.
const ANIMATIONS = {
  fade: 'gp-shopper-fade .4s ease-out both',
  slide: 'gp-shopper-slide .45s cubic-bezier(.23, 1, .32, 1) both',
  pop: 'gp-shopper-pop .5s cubic-bezier(.34, 1.56, .64, 1) both',
};
const KEYFRAMES = '@keyframes gp-shopper-fade{from{opacity:0}}@keyframes gp-shopper-slide{from{opacity:0;transform:translateY(24px)}}@keyframes gp-shopper-pop{from{opacity:0;transform:scale(.4)}}';

// Devuelve el color si es un hex válido, o vacío.
const hexOrEmpty = value => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '');

// Completa la config del botón: cada campo inválido o ausente toma su default, así una config vieja se ve como siempre.
export function launcherConfig(config) {
  const appearance = config && config.appearance && typeof config.appearance === 'object' ? config.appearance : {};
  const launcher = appearance.launcher && typeof appearance.launcher === 'object' ? appearance.launcher : {};
  const image = typeof launcher.image === 'string' && /^https:\/\/\S+$/.test(launcher.image) ? launcher.image : '';
  const icon = launcher.icon === 'none' || (launcher.icon === 'image' && image) || ICONS[launcher.icon] ? launcher.icon : 'sparkle';
  const label = typeof launcher.label === 'string' ? launcher.label.trim().slice(0, 30) : DEFAULT_LABEL;
  return {
    // Sin ícono ni texto el botón quedaría vacío: vuelve al ícono por defecto
    icon: icon === 'none' && !label ? 'sparkle' : icon,
    image,
    label,
    animation: ANIMATIONS[launcher.animation] ? launcher.animation : 'none',
    background: hexOrEmpty(launcher.background),
    iconColor: hexOrEmpty(launcher.iconColor),
    textColor: hexOrEmpty(launcher.textColor),
  };
}

// Devuelve el color de texto legible sobre un fondo hex: oscuro sobre colores claros y blanco sobre oscuros.
export function readableOn(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!match) return '#ffffff';
  // Luminancia relativa según WCAG
  const [r, g, b] = match.slice(1).map(h => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Elige el texto con mejor contraste contra el fondo
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#1f2128' : '#ffffff';
}

// Arma el ícono predefinido como SVG con nodos, sin HTML.
function iconElement(name, color) {
  const icon = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
  svg.setAttribute('fill', icon.fill ? 'currentColor' : 'none'); svg.setAttribute('stroke', icon.fill ? 'none' : 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = `display:block;flex:none;color:${color};`;
  icon.paths.forEach(d => { const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d); svg.appendChild(path); });
  return svg;
}

// Indica si el visitante pidió reducir el movimiento.
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Agrega los keyframes de las animaciones a la página, una sola vez.
function ensureKeyframes() {
  if (document.getElementById('gp-shopper-launcher-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'gp-shopper-launcher-keyframes'; style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

// Dibuja el botón con la config pública: ícono o imagen, texto opcional, colores y animación de aparición.
export function renderLauncher(button, config) {
  const launcher = launcherConfig(config);
  const background = launcher.background || hexOrEmpty(config && config.color) || DEFAULT_COLOR;
  const round = !launcher.label;
  // Contenido: ícono o imagen y el texto
  button.replaceChildren();
  if (launcher.icon === 'image') {
    const img = document.createElement('img');
    img.src = launcher.image; img.alt = '';
    img.style.cssText = `display:block;flex:none;width:${round ? 28 : 22}px;height:${round ? 28 : 22}px;object-fit:contain;border-radius:6px;`;
    button.appendChild(img);
  } else if (launcher.icon !== 'none') {
    button.appendChild(iconElement(launcher.icon, launcher.iconColor || readableOn(background)));
  }
  if (launcher.label) {
    const text = document.createElement('span');
    text.textContent = launcher.label;
    button.appendChild(text);
  }
  button.setAttribute('aria-label', launcher.label || DEFAULT_LABEL);
  // Estilos: redondo si solo tiene ícono, píldora si tiene texto
  button.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483000;display:inline-flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;margin:0;border:0;'
    + `background:${background};color:${launcher.textColor || readableOn(background)};font:600 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(18,38,63,.18);`
    + (round ? 'width:52px;height:52px;padding:0;border-radius:50%;' : 'height:48px;padding:0 20px;border-radius:24px;');
  // Animación de aparición, salvo que el visitante prefiera menos movimiento
  if (launcher.animation !== 'none' && !prefersReducedMotion()) {
    ensureKeyframes();
    button.style.animation = ANIMATIONS[launcher.animation];
  }
}
