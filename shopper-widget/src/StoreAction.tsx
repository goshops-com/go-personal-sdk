// Acciones en la tienda dentro del chat: agregar al carrito (con confirmación opcional) y abrir productos o páginas.
import type { ActionRequest, ActionResult } from './bridge';
import type { copy } from './copy';

export type ActionState = { status: 'confirm' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled'; result?: ActionResult };
type Texts = (typeof copy)['es'];

// Devuelve el texto del error con que respondió la tienda al agregar al carrito.
export function cartError(t: Texts, result?: ActionResult): string {
  switch (result?.error) {
    case 'variant_required': return t.variantRequired;
    case 'out_of_stock': return t.outOfStock;
    case 'not_found': return t.notFound;
    case 'rejected': return result.message || t.addFailed;
    default: return t.addFailed;
  }
}

// Estado de agregar al carrito: confirmación, en curso, agregado o el error.
function CartStatus({ request, state, t, onConfirm, onCancel }: { request: ActionRequest; state?: ActionState; t: Texts; onConfirm: () => void; onCancel: () => void }) {
  switch (state?.status) {
    case 'confirm':
      return <div className="store-action-confirm gps-action-question"><p className="gps-action-question-text">{t.confirmAdd}</p>
        <div className="store-action-buttons gps-action-buttons"><button type="button" className="gps-action-confirm" onClick={onConfirm}>{t.addToCart}</button><button type="button" className="secondary gps-action-cancel" onClick={onCancel}>{t.cancel}</button></div></div>;
    case 'running':
      return <p role="status" className="gps-action-status">{t.adding}</p>;
    case 'done':
      return <p role="status" className="gps-action-status">{t.added} <span aria-hidden="true">✓</span></p>;
    case 'failed':
      return <p role="alert" className="store-action-error gps-action-error">{cartError(t, state.result)}{state.result?.error === 'variant_required' && <> <a className="gps-action-link" href={request.product!.url} target="_top">{t.product}</a></>}</p>;
    case 'cancelled':
      return <p className="gps-action-status">{t.notAdded}</p>;
    default:
      return <p className="gps-action-status"><a className="gps-action-link" href={request.product!.url} target="_top">{t.product}</a></p>;
  }
}

// Acción que pidió el asistente; sin estado (una respuesta del historial) muestra solo a qué apunta.
export function StoreAction({ request, state, t, onConfirm, onCancel }: { request: ActionRequest; state?: ActionState; t: Texts; onConfirm: () => void; onCancel: () => void }) {
  const status = state?.status || 'past';
  // Atributos para apuntar desde el CSS propio a una acción, un estado o un producto puntual
  const data = { 'data-gps-action': request.action, 'data-gps-status': status, ...(request.product ? { 'data-gps-product': request.product.id } : {}) };

  // Agregar al carrito: el producto con su estado
  if (request.action === 'add_to_cart') {
    const product = request.product!;
    const quantity = product.quantity || 1;
    return <div className={`store-action gps-action gps-action-cart is-${status}`} {...data}>
      {product.image && <img className="gps-action-image" src={product.image} alt="" />}
      <div className="store-action-body gps-action-body"><strong className="gps-action-name">{product.name}{quantity > 1 ? ` × ${quantity}` : ''}</strong>
        <CartStatus request={request} state={state} t={t} onConfirm={onConfirm} onCancel={onCancel} /></div>
    </div>;
  }

  // Abrir un producto o una página: mientras navega avisa, si falla lo dice y en el historial queda el link
  const label = request.page ? request.page.label : request.product!.name;
  const url = request.page ? request.page.url : request.product!.url;
  return <div className={`store-action gps-action gps-action-open is-${status}`} {...data}>
    {status === 'failed' ? <p role="alert" className="store-action-error gps-action-error">{t.openFailed} <a className="gps-action-link" href={url} target="_top">{label}</a></p>
      : status === 'past' || status === 'cancelled' ? <p className="gps-action-status"><a className="gps-action-link" href={url} target="_top">{label} <span aria-hidden="true">→</span></a></p>
      : <p role="status" className="gps-action-status">{t.opening} {label}…</p>}
  </div>;
}
