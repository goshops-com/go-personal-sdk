// Tarjetas de producto del chat y su vista previa para el admin.
import { useEffect, useRef } from 'react';
import { send, type Config, type Product, type Session } from './bridge';
import type { Appearance, Cards } from './appearance';
import { copy } from './copy';
import { showcaseProducts } from './showcaseProducts';

type ListProps = { products: Product[]; session: Session; conversationId: string; messageId: string; cards: Cards; demo?: boolean };

// Tarjeta de un producto recomendado; en la vista previa (`demo`) no navega ni mide eventos.
export function ProductCard({ product, session, conversationId, messageId, cards, demo = false }: { product: Product; session: Session; conversationId: string; messageId: string; cards: Cards; demo?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const t = copy[session.config.language] || copy.es;
  const event = (type: 'product_view' | 'product_click') => {
    if (session.preview) return;
    void fetch(`${session.apiUrl}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ eventId: crypto.randomUUID(), conversationId, messageId, productId: product.id, type }), keepalive: true }).catch(() => {});
    if (type === 'product_click') send('product-click', { productId: product.id });
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) timer = setTimeout(() => { event('product_view'); observer.disconnect(); }, 1000);
      else if (timer) clearTimeout(timer);
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [product.id, messageId]);
  let price = t.unknownPrice;
  if (product.price !== null) {
    try { price = product.currency ? new Intl.NumberFormat(session.config.language, { style: 'currency', currency: product.currency }).format(product.price) : new Intl.NumberFormat(session.config.language).format(product.price); }
    catch { price = String(product.price); }
  }
  const button = cards.ctaStyle === 'button';
  return <article className={`product gps-card is-${cards.layout} fit-${cards.imageFit} radius-${cards.radius}`} ref={ref}>
    <div className="product-image gps-card-image">{product.image ? <img src={product.image} alt="" loading="lazy" /> : <span aria-hidden="true">◇</span>}</div>
    <div className="product-details">{cards.showBrand && product.brand && <span className="brand gps-card-brand">{product.brand}</span>}<h3 className="gps-card-name">{product.name}</h3>
      <div className="product-foot">{cards.showPrice && <strong className={product.price === null ? 'price price-unknown gps-card-price' : 'price gps-card-price'}>{price}</strong>}
        <a className={button ? 'gps-card-cta is-button' : 'gps-card-cta'} href={product.url} target="_blank" rel="noopener noreferrer" onClick={e => { if (demo) { e.preventDefault(); return; } event('product_click'); }}>{cards.ctaLabel || t.product}{!button && <> <span aria-hidden="true">↗</span></>}</a></div></div>
  </article>;
}

// Productos de una respuesta, en lista, grilla o carrusel según la config.
export function ProductList({ products, session, conversationId, messageId, cards, demo = false }: ListProps) {
  return <div className={`products gps-products is-${cards.display}`}>
    {products.map(p => <ProductCard key={p.id} product={p} session={session} conversationId={conversationId} messageId={messageId} cards={cards} demo={demo} />)}
  </div>;
}

// Vista previa de las tarjetas para el admin: solo las tarjetas con productos de ejemplo, sin requests.
export function ShowcaseProducts({ config, appearance }: { config: Config; appearance: Appearance }) {
  const products = showcaseProducts(config.language, config.currency);
  const session: Session = { token: '', apiUrl: '', config, preview: true };
  return <main className="shopper gps-chat showcase-products" lang={config.language} style={{ '--shopper-brand': config.color } as React.CSSProperties}>
    <ProductList products={products} session={session} conversationId="showcase-products" messageId="showcase-products" cards={appearance.cards} demo />
  </main>;
}
