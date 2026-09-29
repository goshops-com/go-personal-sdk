// Carrito para plantillas (barra de envío gratis, "Retomá donde dejaste"):
//   gsSDK.getCart()        -> { products, totalAmount, amountOfProducts, updatedAt } | null
//   gsSDK.onCartChange(cb) -> cb(cart) cada vez que cambia; devuelve la función para desuscribirse
// También se emite window "gopersonal:cart-updated" con el carrito en event.detail.
//
// El carrito de la sesión lo actualiza el worker de interacciones de discover unos segundos
// DESPUÉS del POST de la interacción, así que avisar al responder el POST daría el carrito
// viejo. Después de cada interacción de carrito se vuelve a leer /channel/state hasta que
// cambia updatedAt (con esperas crecientes) y recién ahí se avisa.

import { httpGet } from "../utils/http";

export const CART_UPDATED_EVENT = "gopersonal:cart-updated";

const CART_EVENTS = ["cart", "remove-cart", "clean-cart", "purchase"];
// Esperas entre lecturas (ms): ~11 s en total, lo que tarda el worker en el peor caso normal.
const RETRY_DELAYS = [700, 1000, 1500, 2500, 5000];

let lastCart;
let pollId = 0;

export const getCart = async () => {
  try {
    const state = await httpGet(`/channel/state`);
    lastCart = (state && state.cart) || null;
  } catch (e) {
    window.gsLog?.("getCart error", e);
  }
  return lastCart || null;
};

export const onCartChange = (callback) => {
  if (typeof callback !== "function") return () => {};
  const handler = (event) => {
    try {
      callback(event.detail);
    } catch (e) {
      window.gsLog?.("onCartChange callback error", e);
    }
  };
  window.addEventListener(CART_UPDATED_EVENT, handler);
  return () => window.removeEventListener(CART_UPDATED_EVENT, handler);
};

// La llaman addInteraction / addBulkInteractions después del POST. Una interacción nueva
// reinicia la espera: solo avisa la última.
export const notifyCartInteraction = async (events) => {
  const list = Array.isArray(events) ? events : [events];
  if (!list.some((event) => CART_EVENTS.includes(event))) return;

  const id = ++pollId;
  // Sin una lectura previa no hay contra qué comparar: se lee ya (el worker todavía no
  // procesó la interacción, así que es el carrito de antes).
  if (lastCart === undefined) await getCart();
  if (id !== pollId) return;
  const before = lastCart && lastCart.updatedAt;
  let attempt = 0;

  const dispatch = (cart) => window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT, { detail: cart }));
  const check = async () => {
    if (id !== pollId) return;
    const cart = await getCart();
    if (id !== pollId) return;
    if ((cart && cart.updatedAt) !== before) return dispatch(cart);
    if (attempt < RETRY_DELAYS.length) return setTimeout(check, RETRY_DELAYS[attempt++]);
    // Se agotaron las esperas (el worker tardó más, o la interacción no cambió el
    // carrito): se avisa igual con lo último, así ninguna plantilla queda esperando.
    dispatch(cart);
  };
  setTimeout(check, RETRY_DELAYS[attempt++]);
};
