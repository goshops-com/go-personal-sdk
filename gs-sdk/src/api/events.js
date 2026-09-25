import { getSession } from '../utils/storage';

// Eventos genéricos (gsSDK.track): cada cliente/contenido manda los que quiera con sus datos en
// `props`. Van al worker gopersonal-events (Cloudflare Pipelines -> R2). El proyecto y la sesión
// los saca el worker del token, no se mandan aparte.
const DEFAULT_URL = 'https://events.gopersonal.ai/events';
const SDK_VERSION = '1.0.27';
// Se juntan en memoria y se mandan de a tandas: cada FLUSH_MS, al llegar a MAX_BATCH o cuando la
// persona cambia de pestaña / se va (sendBeacon, que sobrevive al cierre de la página).
const MAX_BATCH = 20;
const MAX_QUEUE = 200;
const FLUSH_MS = 5000;

let queue = [];
let timer = null;
let listening = false;

function eventsUrl() {
  return window.gsConfig?.options?.eventsUrl || DEFAULT_URL;
}

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function listenPageExit() {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEvents({ beacon: true });
  });
  window.addEventListener('pagehide', () => flushEvents({ beacon: true }));
}

/**
 * Registra un evento. options: content, variant, pageType (si no, el del contexto del SDK).
 *   gsSDK.track('ac_click', { column: 'marcas', value: 'LENOVO', pos: 1, query: 'compu' }, { content: '<id>' })
 */
export const track = (event, props = {}, options = {}) => {
  try {
    if (!event) return;
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push({
      id: uuid(),
      event: String(event),
      ts: Date.now(),
      content: options.content,
      variant: options.variant,
      page_type: options.pageType || window.gsConfig?.options?.context?.pageType,
      url: window.location.href,
      props,
    });
    listenPageExit();
    if (queue.length >= MAX_BATCH) flushEvents();
    else if (!timer) timer = setTimeout(() => flushEvents(), FLUSH_MS);
  } catch (e) {
    window.gsLog?.('track error', e);
  }
};

/** Manda lo que haya en la cola. beacon: usar sendBeacon (al salir de la página). */
export const flushEvents = ({ beacon = false } = {}) => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const session = getSession();
  if (!queue.length || !session?.token) return;
  while (queue.length) {
    const events = queue.splice(0, 50);
    // text/plain: sin preflight de CORS, y es lo que manda sendBeacon.
    const body = JSON.stringify({ token: session.token, vuuid: session.vuuid, sdk_version: SDK_VERSION, events });
    let sent = false;
    if (beacon && navigator.sendBeacon) {
      try {
        sent = navigator.sendBeacon(eventsUrl(), new Blob([body], { type: 'text/plain' }));
      } catch (e) {
        sent = false;
      }
    }
    if (!sent) {
      fetch(eventsUrl(), { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
        .catch((e) => window.gsLog?.('track flush error', e));
    }
  }
};
