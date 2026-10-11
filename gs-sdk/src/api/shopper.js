import { httpPost, getApiBaseURL } from '../utils/http';
import { getSession } from '../utils/storage';

/** Explicit opt-in. Mounting a launcher does not request bootstrap or load React. */
export function mountShopper({ widgetUrl, container = null, context = {} } = {}) {
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
  const iframe = document.createElement('iframe');
  iframe.title = 'Personal Shopper'; iframe.style.cssText = 'display:block;width:100%;height:100%;border:0;background:white;';
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  error.style.cssText = 'padding:20px;font:14px/1.6 system-ui;color:#9c3737;';
  let bootstrap = null; let expiresAt = 0; let refreshing = null; let ready = false; let destroyed = false; let renewal;
  let conversationId = null; let ownerKey = null;
  const launcher = document.createElement('button'); launcher.type = 'button'; launcher.textContent = '✦ Personal Shopper';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483000;border:0;border-radius:24px;padding:14px 20px;background:#5e40bf;color:white;font:600 14px system-ui;cursor:pointer;';
  if (!embedded) panel.style.cssText = 'position:fixed;right:16px;bottom:80px;width:min(420px,calc(100vw - 32px));height:min(680px,calc(100dvh - 112px));z-index:2147483001;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px #0002;border:1px solid #e9e7ed;background:white;';
  else panel.style.cssText = 'position:relative;width:100%;height:100%;min-height:480px;';
  panel.appendChild(error); panel.appendChild(iframe);
  (target || document.body).appendChild(panel);
  if (!embedded) document.body.appendChild(launcher);

  function storageKey() {
    const session = getSession();
    return session.sessionId ? `gp-shopper-v1:${getApiBaseURL()}:${session.sessionId}` : null;
  }
  function post() {
    if (!ready || !bootstrap || destroyed) return;
    iframe.contentWindow.postMessage({ type: 'gp-shopper:initialize', session: {
      token: bootstrap.token, apiUrl: `${getApiBaseURL()}/shopper/v1`, config: bootstrap.config,
      sessionKey: ownerKey,
      canClose: !embedded,
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
        launcher.style.background = bootstrap.config.color;
        error.hidden = true; iframe.hidden = false;
        if (!iframe.src) {
          url.searchParams.set('hostOrigin', location.origin); iframe.src = url.href;
        }
        post();
        clearTimeout(renewal);
        renewal = setTimeout(() => { if (!panel.hidden) void connect(true); }, Math.max(1000, (bootstrap.expiresIn - 60) * 1000));
      } catch (_) {
        bootstrap = null; expiresAt = 0;
        if (!destroyed) { error.textContent = 'No pudimos abrir el asistente. Probá nuevamente.'; error.hidden = false; iframe.hidden = true; }
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function open() {
    if (destroyed) return;
    panel.hidden = false; launcher.setAttribute('aria-expanded', 'true');
    await connect();
    if (ready) iframe.focus();
  }
  function hide() { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); }
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
    }
  }
  window.addEventListener('message', receive);
  launcher.addEventListener('click', () => { if (panel.hidden) void open(); else hide(); });
  if (embedded) void open();
  return {
    open, close: hide,
    setContext(value) { context = normalizeContext(value); if (storageKey() !== ownerKey) void connect(true); else post(); },
    destroy() { destroyed = true; clearTimeout(renewal); window.removeEventListener('message', receive); panel.remove(); launcher.remove(); },
  };
}
