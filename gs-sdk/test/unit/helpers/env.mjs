import { JSDOM } from 'jsdom';

export const DEFAULT_URL = 'https://shop.example/';

let dom = null;

const WINDOW_GLOBALS = [
  'document', 'localStorage', 'sessionStorage', 'history', 'navigator',
  'MutationObserver', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent',
  'MouseEvent', 'KeyboardEvent', 'MessageEvent', 'FormData', 'DOMParser',
  'getComputedStyle', 'CSS', 'XMLHttpRequest',
];

function define(name, getter) {
  Object.defineProperty(globalThis, name, { configurable: true, get: getter, set(value) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  } });
}

/**
 * IntersectionObserver controlable: jsdom no lo trae.
 *   const io = FakeIntersectionObserver.instances.at(-1); io.trigger(true);
 */
export class FakeIntersectionObserver {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = [];
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target) { this.targets.push(target); }
  unobserve(target) { this.targets = this.targets.filter((t) => t !== target); }
  disconnect() { this.disconnected = true; }
  trigger(isIntersecting = true) {
    this.callback(this.targets.map((target) => ({ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 })), this);
  }
}

/** Crea el DOM y lo publica como globals. Se llama una vez, desde register.mjs. */
export function installDom({ url = DEFAULT_URL } = {}) {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.self = window;
  define('location', () => window.location);
  for (const name of WINDOW_GLOBALS) {
    define(name, () => window[name]);
  }
  // rAF sobre los timers de Node, asi mock.timers tambien los maneja.
  const raf = (cb) => setTimeout(() => cb(Date.now()), 0);
  const caf = (id) => clearTimeout(id);
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = caf;
  globalThis.requestAnimationFrame = raf;
  globalThis.cancelAnimationFrame = caf;
  window.IntersectionObserver = FakeIntersectionObserver;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  // src/publicPath.js asigna esta variable de webpack.
  globalThis.__webpack_public_path__ = '';
  window.gsLog = () => {};
  return dom;
}

export function getDom() {
  return dom;
}

/** Cambia la URL de la pagina (cualquier origen). */
export function setUrl(url) {
  dom.reconfigure({ url });
}

/**
 * Deja la pagina limpia entre tests: URL, storage, cookies, head/body y los
 * globals `window.gs*` que va dejando el SDK.
 */
export function resetDom({ url = DEFAULT_URL } = {}) {
  const { window } = dom;
  setUrl(url);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.document.cookie.split(';').forEach((cookie) => {
    const name = cookie.split('=')[0].trim();
    if (name) window.document.cookie = `${name}=; Path=/; Max-Age=0`;
  });
  window.document.head.innerHTML = '';
  window.document.body.innerHTML = '';
  for (const key of Object.keys(window)) {
    if (/^(gs|__gs|GSSDK)/.test(key)) {
      try { delete window[key]; } catch (e) { window[key] = undefined; }
    }
  }
  window.gsLog = () => {};
  window.gsConfig = { clientId: 'client-1', options: {} };
  FakeIntersectionObserver.instances = [];
}

/** Respuesta estilo fetch. */
export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/**
 * Reemplaza fetch. `handler(url, init, call)` devuelve el body JSON, una
 * respuesta de jsonResponse() o tira un error. Sin handler responde `{}`.
 * Devuelve la lista de llamadas: { url, method, headers, body, init }.
 */
export function mockFetch(handler = () => ({})) {
  const calls = [];
  const fetchMock = async (input, init = {}) => {
    const url = String(input);
    let body = init.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { /* queda el string */ }
    }
    const call = { url, method: init.method || 'GET', headers: init.headers || {}, body, init };
    calls.push(call);
    const result = await handler(url, init, call);
    if (result && typeof result.json === 'function' && 'status' in result) {
      return result;
    }
    return jsonResponse(result === undefined ? {} : result);
  };
  globalThis.fetch = fetchMock;
  dom.window.fetch = fetchMock;
  return calls;
}

/** Sesion valida en storage, como la deja init. */
export function seedSession(session = {}) {
  const value = { token: 'token-1', project: 'project-1', sessionId: 'session-1', ts: new Date().toISOString(), ...session };
  dom.window.localStorage.setItem('gs-v-1', JSON.stringify(value));
  return value;
}

/** Deja correr microtasks y timers de 0ms pendientes. */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Espera a que `predicate` sea verdadero (o falla al vencer el timeout). */
export async function waitFor(predicate, { timeout = 2000, interval = 5 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor: timeout');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
