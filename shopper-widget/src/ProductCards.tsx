// Tarjetas de producto del chat y su vista previa para el admin.
import { useEffect, useRef, useState } from 'react';
import { productEvent, send, type ActionResult, type Config, type Product, type Session } from './bridge';
import { cartError, StoreAction, type ActionState } from './StoreAction';
import { CartIcon } from './CartIcon';
import { cartColors, type Appearance, type CartAppearance, type Cards } from './appearance';
import { copy } from './copy';
import { showcaseProducts } from './showcaseProducts';

type AddToCart = (product: Product) => Promise<ActionResult>;
type CartButton = CartAppearance['card'];
type ListProps = { products: Product[]; session: Session; conversationId: string; messageId: string; cards: Cards; demo?: boolean; cartButton?: CartButton; onAddToCart?: AddToCart };

// Tarjeta de un producto recomendado: toda la tarjeta abre el producto; en la vista previa (`demo`) no navega ni mide eventos.
export function ProductCard({ product, session, conversationId, messageId, cards, demo = false, cartButton, onAddToCart }: { product: Product; session: Session; conversationId: string; messageId: string; cards: Cards; demo?: boolean; cartButton?: CartButton; onAddToCart?: AddToCart }) {
  const ref = useRef<HTMLElement>(null);
  const t = copy[session.config.language] || copy.es;
  const [cart, setCart] = useState<ActionState | undefined>(undefined);
  const event = (type: 'product_view' | 'product_click') => {
    if (session.preview) return;
    productEvent(session, { conversationId, messageId, productId: product.id, type });
    if (type === 'product_click') send('product-click', { productId: product.id });
  };

  // Agrega el producto al carrito de la tienda desde la tarjeta y muestra cómo salió
  async function addToCart() {
    if (!onAddToCart || cart?.status === 'running') return;
    setCart({ status: 'running' });
    const result = await onAddToCart(product);
    setCart({ status: result.ok ? 'done' : 'failed', result });
  }
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
  return <article className={`product gps-card is-${cards.layout} fit-${cards.imageFit} radius-${cards.radius}`} data-gps-product={product.id} ref={ref}>
    <div className="product-image gps-card-image">{product.image ? <img src={product.image} alt="" loading="lazy" /> : <span aria-hidden="true">◇</span>}</div>
    <div className="product-details">{cards.showBrand && product.brand && <span className="brand gps-card-brand">{product.brand}</span>}<h3 className="gps-card-name"><a className="gps-card-link" href={product.url} target="_blank" rel="noopener noreferrer" onClick={e => { if (demo) { e.preventDefault(); return; } event('product_click'); }}>{product.name}</a></h3>
      {cards.showPrice && <div className="product-foot"><strong className={product.price === null ? 'price price-unknown gps-card-price' : 'price gps-card-price'}>{price}</strong></div>}
      {onAddToCart && <div className={`product-cart gps-card-cart is-${cart?.status || 'idle'}`} data-gps-status={cart?.status || 'idle'}>
        <button type="button" className="gps-card-add" onClick={() => void addToCart()} disabled={cart?.status === 'running'}>{cart?.status === 'running' ? t.adding : cart?.status === 'done' ? <>{cartButton?.successLabel || t.added} <span aria-hidden="true">✓</span></> : <><CartIcon icon={cartButton?.icon || 'cart'} />{cartButton?.label || t.addToCart}</>}</button>
        {cart?.status === 'failed' && <small role="alert" className="store-action-error gps-card-cart-error">{cartError(t, cart.result)}</small>}
      </div>}</div>
  </article>;
}

// Productos de una respuesta, en lista, grilla o carrusel según la config.
export function ProductList({ products, session, conversationId, messageId, cards, demo = false, cartButton, onAddToCart }: ListProps) {
  return <div className={`products gps-products is-${cards.display}`}>
    {products.map(p => <ProductCard key={p.id} product={p} session={session} conversationId={conversationId} messageId={messageId} cards={cards} demo={demo} cartButton={cartButton} onAddToCart={onAddToCart} />)}
  </div>;
}

// Agregar al carrito de la vista previa: no llama a la tienda, solo muestra el estado de agregado.
const demoAdd: AddToCart = async () => ({ ok: true });

export type ShowcaseView = 'cards' | 'confirm';

// Vista previa para el admin con productos de ejemplo y sin requests: las tarjetas (con el botón de carrito si está prendido) o la confirmación del asistente.
export function ShowcaseProducts({ config, appearance, view = 'cards' }: { config: Config; appearance: Appearance; view?: ShowcaseView }) {
  const products = showcaseProducts(config.language, config.currency);
  const session: Session = { token: '', apiUrl: '', config, preview: true };
  const t = copy[config.language] || copy.es;
  const style = { '--shopper-brand': config.color, ...cartColors(appearance.cart) } as React.CSSProperties;

  // Confirmación del asistente: la pregunta y cómo queda una vez agregado, con el primer producto de ejemplo
  if (view === 'confirm') {
    const product = products[0];
    const request = { id: 'showcase-confirm', action: 'add_to_cart' as const, confirm: true, product: { id: product.id, name: product.name, url: product.url, image: product.image } };
    return <main className="shopper gps-chat showcase-products showcase-confirm" lang={config.language} style={style}>
      <StoreAction request={request} state={{ status: 'confirm' }} t={t} confirm={appearance.cart.confirm} onConfirm={() => {}} onCancel={() => {}} />
      <StoreAction request={request} state={{ status: 'done', result: { ok: true } }} t={t} confirm={appearance.cart.confirm} onConfirm={() => {}} onCancel={() => {}} />
    </main>;
  }
  return <main className="shopper gps-chat showcase-products" lang={config.language} style={style}>
    <ProductList products={products} session={session} conversationId="showcase-products" messageId="showcase-products" cards={appearance.cards} demo
      cartButton={appearance.cart.card} onAddToCart={appearance.cart.card.show ? demoAdd : undefined} />
  </main>;
}
