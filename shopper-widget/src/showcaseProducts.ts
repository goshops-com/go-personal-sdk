// Productos de ejemplo para la vista previa de las tarjetas en el admin: no hacen requests ni miden eventos.
import type { Product } from './bridge';

// Ilustración simple de un producto como imagen SVG embebida.
function illustration(background: string, shape: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${background}"/>${shape}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const JACKET = illustration('#eef2f7', '<path d="M42 30l18-8 18 8 14 16-10 8-6-6v46H44V48l-6 6-10-8z" fill="#3b6fb6"/><path d="M60 22v74" stroke="#2a5594" stroke-width="3"/>');
const SHOE = illustration('#f6efe8', '<path d="M22 70c14 0 22-14 30-22 6 10 18 14 30 16 10 2 16 8 16 14v6H22z" fill="#d9663b"/><rect x="22" y="80" width="76" height="8" rx="3" fill="#8a3d20"/>');
const BACKPACK = illustration('#edf5ee', '<rect x="36" y="32" width="48" height="62" rx="12" fill="#3f8f5b"/><rect x="44" y="60" width="32" height="20" rx="5" fill="#2f6e45"/><path d="M48 32c0-10 24-10 24 0" stroke="#2f6e45" stroke-width="5" fill="none"/>');

const NAMES = {
  es: ['Campera impermeable liviana', 'Zapatillas de trekking', 'Mochila urbana 22 L'],
  en: ['Lightweight waterproof jacket', 'Hiking shoes', 'Urban backpack 22 L'],
  pt: ['Jaqueta impermeável leve', 'Tênis de trilha', 'Mochila urbana 22 L'],
};

// Devuelve los productos de ejemplo en el idioma del chat, con la moneda configurada.
export function showcaseProducts(language: 'es' | 'en' | 'pt', currency: string): Product[] {
  const names = NAMES[language] || NAMES.es;
  const images = [JACKET, SHOE, BACKPACK];
  const prices = [89990, 64990, 39990];
  return names.map((name, index) => ({
    id: `showcase-product-${index + 1}`, name, brand: 'Outdoor Co.', description: '', url: '#',
    image: images[index], price: prices[index], currency: currency || 'USD',
  }));
}
