import { httpPost, getApiBaseURL } from '../utils/http';
import { getSession } from '../utils/storage';
import { renderLauncher } from './shopperLauncher';
import { resolveCart } from './shopperCart';
import { availableActions, performAction, consumeReopen } from './shopperActions';

const CONFIG_STORAGE = 'gp-shopper-config-v1';

/** Explicit opt-in. Mounting a launcher does not request bootstrap or load React. */
export function mountShopper({ widgetUrl, container = null, context = {}, cart = null } = {}) {
  const url = new URL(widgetUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('shopper widgetUrl must use HTTPS');
  }
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (container && !target) throw new Error('shopper container not found');
  const embedded = !!target;
  function normalizeContext(value) {
    const result = {};
    if (value && (typeof value.productId === 'string' || typeof value.productId === 'number')) result.productId = String(value.productId);
    const pageType = value && value.pageType === 'product_detail' ? 'product' : value && value.pageType;
    if (['home', 'product', 'search', 'other'].includes(pageType)) result.pageType = pageType;
    return result;
  }
  context = normalizeContext(context);
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Personal Shopper'); panel.hidden = !embedded;
  // Store themes often override the browser's [hidden] rule (including iframes).
  function visible(element, show) {
    element.hidden = !show;
    element.style.setProperty('display', show ? 'block' : 'none', 'important');
  }
  const iframe = document.createElement('iframe');
  iframe.title = 'Personal Shopper'; iframe.style.cssText = 'display:block;width:100%;height:100%;border:0;background:white;';
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  error.style.cssText = 'padding:20px;font:14px/1.6 system-ui;color:#9c3737;';
  let bootstrap = null; let expiresAt = 0; let refreshing = null; let ready = false; let destroyed = false; let renewal;
  let conversationId = null; let ownerKey = null;
  // Config pública con la que se dibujó el botón (su apariencia no cambia con la página abierta)
  let shopperConfig = null;
  // Acciones activadas según la config más nueva: apagar una en el admin corta apenas llega la config fresca
  let skills = {};
  // Quién agrega al carrito en esta tienda (callback propio o plataforma del init) y acciones ya ejecutadas
  // Plataforma de la tienda según el init: la usa el carrito y el chat la recibe para leer las variantes
  const options = (window.gsConfig && window.gsConfig.options) || {};
  const provider = typeof options.provider === 'string' ? options.provider.trim().slice(0, 40) : '';
  const cartExecutor = resolveCart({ cart, provider });
  const handledActions = new Set();
  // Si el chat estaba abierto antes de navegar a esta página desde una acción, se vuelve a abrir
  let reopen = consumeReopen();
  const launcher = document.createElement('button'); launcher.type = 'button';
  launcher.setAttribute('aria-expanded', 'false');
  if (!embedded) panel.style.cssText = 'position:fixed;right:16px;bottom:80px;width:min(420px,calc(100vw - 32px));height:min(680px,calc(100dvh - 112px));z-index:2147483001;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px #0002;border:1px solid #e9e7ed;background:white;';
  else panel.style.cssText = 'position:relative;width:100%;height:100%;min-height:480px;';
  panel.style.boxSizing = 'border-box';
  visible(panel, embedded); visible(error, false); visible(iframe, false);
  panel.appendChild(error); panel.appendChild(iframe);
  (target || document.body).appendChild(panel);

  function storageKey() {
    const session = getSession();
    return session.sessionId ? `gp-shopper-v1:${getApiBaseURL()}:${session.sessionId}` : null;
  }
  // Apariencia de la config pública para el chat, o null si no hay.
  function appearance() {
    return shopperConfig && shopperConfig.appearance && typeof shopperConfig.appearance === 'object' ? shopperConfig.appearance : null;
  }
  // Acciones que el chat puede pedir: las activadas en la config de la tienda que además este sitio sabe ejecutar.
  function capabilities() {
    return availableActions(skills, { cartExecutor });
  }
  function post() {
    if (!ready || !bootstrap || destroyed) return;
    const style = appearance();
    const actions = capabilities();
    iframe.contentWindow.postMessage({ type: 'gp-shopper:initialize', session: {
      token: bootstrap.token, apiUrl: `${getApiBaseURL()}/shopper/v1`, config: bootstrap.config,
      sessionKey: ownerKey,
      canClose: !embedded,
      ...(style ? { appearance: style } : {}),
      ...(actions.length ? { capabilities: actions } : {}),
      ...(provider ? { provider } : {}),
      ...(conversationId ? { conversationId } : {}), context,
    } }, url.origin);
  }
  async function connect(force = false) {
    if (refreshing) return refreshing;
    const key = storageKey();
    if (!force && bootstrap && Date.now() < expiresAt - 30000 && key === ownerKey) { post(); return; }
    refreshing = (async () => {
      try {
        bootstrap = await httpPost('/shopper/v1/bootstrap');
        if (destroyed) return;
        expiresAt = Date.now() + bootstrap.expiresIn * 1000;
        ownerKey = key;
        try { conversationId = key ? localStorage.getItem(key) : null; } catch (_) { conversationId = null; }
        visible(error, false); visible(iframe, true);
        if (!iframe.src) {
          url.searchParams.set('hostOrigin', location.origin); iframe.src = url.href;
        }
        post();
        clearTimeout(renewal);
        renewal = setTimeout(() => { if (!panel.hidden) void connect(true); }, Math.max(1000, (bootstrap.expiresIn - 60) * 1000));
      } catch (_) {
        bootstrap = null; expiresAt = 0;
        if (!destroyed) { error.textContent = 'No pudimos abrir el asistente. Probá nuevamente.'; visible(error, true); visible(iframe, false); }
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function open() {
    if (destroyed) return;
    visible(panel, true); launcher.setAttribute('aria-expanded', 'true');
    await connect();
    if (ready) iframe.focus();
  }
  function hide() { visible(panel, false); launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); }
  function receive(event) {
    if (event.origin !== url.origin || event.source !== iframe.contentWindow || !event.data || destroyed) return;
    switch (event.data.type) {
      case 'gp-shopper:ready': ready = true; post(); break;
      case 'gp-shopper:refresh': void connect(true); break;
      case 'gp-shopper:close': if (!embedded) hide(); break;
      case 'gp-shopper:conversation':
        if (/^[a-zA-Z0-9_-]{1,100}$/.test(event.data.id || '')) {
          conversationId = event.data.id;
          try { if (ownerKey) localStorage.setItem(ownerKey, conversationId); } catch (_) { /* Storage may be unavailable. */ }
        }
        break;
      case 'gp-shopper:action': void runAction(event.data); break;
    }
  }
  // Ejecuta una acción que pide el chat, una sola vez por actionId, y le responde con el resultado.
  async function runAction({ actionId, action, ...payload }) {
    // Ignora ids inválidos y acciones que ya se ejecutaron
    if (typeof actionId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(actionId) || handledActions.has(actionId)) return;
    handledActions.add(actionId);

    // Ejecuta solo si está activada para esta tienda y le responde al chat, salvo que el shopper ya se haya cerrado
    const result = await performAction(action, payload, { available: capabilities(), cartExecutor, isOpen: () => !destroyed });
    if (!destroyed) iframe.contentWindow.postMessage({ type: 'gp-shopper:action-result', actionId, ...result }, url.origin);
  }
  // Arma la clave de localStorage de la config pública del proyecto de la sesión.
  function configKey() {
    const session = getSession();
    return session.project ? `${CONFIG_STORAGE}:${getApiBaseURL()}:${session.project}` : null;
  }
  // Lee la config cacheada, o null si no está o no se puede leer.
  function readConfig(key) {
    try { return key ? JSON.parse(localStorage.getItem(key)) : null; } catch (_) { return null; }
  }
  // Pide la config pública del proyecto y la guarda para la próxima carga; null si falla el request.
  async function refreshConfig(key) {
    if (!key) return null;
    let fresh;
    try {
      const response = await fetch(`${getApiBaseURL()}/public/shopper-config/${encodeURIComponent(getSession().project)}`);
      if (!response.ok) return null;
      fresh = await response.json();
    } catch (_) { return null; }
    try { localStorage.setItem(key, JSON.stringify(fresh)); } catch (_) { /* Sin storage disponible se sigue sin cache. */ }
    return fresh;
  }
  // Toma las acciones activadas de una config y, si el chat ya está abierto y cambiaron, se las vuelve a mandar.
  function useSkills(config) {
    if (!config) return;
    const before = capabilities().join();
    skills = config.skills && typeof config.skills === 'object' ? config.skills : {};

    // Si el chat ya está abierto y cambiaron sus acciones, le vuelve a mandar la sesión
    if (capabilities().join() !== before) post();
  }
  // Muestra el botón, o abre el panel embebido, salvo que la config diga que está desactivado.
  function show(config) {
    if (destroyed || (config && config.enabled === false)) return;
    // Guarda la config con la que se dibuja: el chat recibe su apariencia al abrirse
    shopperConfig = config;
    if (embedded) return void open();
    // Dibuja el botón con la apariencia publicada; sin config usa el diseño por defecto
    renderLauncher(launcher, config);
    document.body.appendChild(launcher);

    // Reabre el chat que venía abierto de la página anterior
    if (reopen) {
      reopen = false;
      void open();
    }
  }
  window.addEventListener('message', receive);
  launcher.addEventListener('click', () => { if (panel.hidden) void open(); else hide(); });
  // Pinta con la config cacheada al instante y siempre la refresca para la próxima carga.
  const key = configKey();
  const cached = readConfig(key);
  const latestConfig = refreshConfig(key);
  useSkills(cached);
  void latestConfig.then(useSkills);
  if (cached) show(cached); else void latestConfig.then(show);
  return {
    open, close: hide,
    setContext(value) { context = normalizeContext(value); if (storageKey() !== ownerKey) void connect(true); else post(); },
    destroy() { destroyed = true; clearTimeout(renewal); window.removeEventListener('message', receive); panel.remove(); launcher.remove(); },
  };
}
