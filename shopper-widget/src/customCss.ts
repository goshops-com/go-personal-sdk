// CSS propio de la tienda dentro del iframe del chat.
import { useEffect } from 'react';

// Pone el CSS propio en un <style> al final del documento, o lo quita si está vacío.
export function applyCustomCss(css: string, doc: Document = document) {
  let style = doc.getElementById('gps-custom-css');
  if (!css) { style?.remove(); return; }
  if (!style) { style = doc.createElement('style'); style.id = 'gps-custom-css'; }
  style.textContent = css;
  doc.head.appendChild(style);
}

// Aplica el CSS propio cada vez que cambia.
export function useCustomCss(css: string) {
  useEffect(() => { applyCustomCss(css); }, [css]);
}
