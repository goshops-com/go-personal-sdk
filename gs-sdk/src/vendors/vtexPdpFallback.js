import { getContentByContext } from '../api/content';
import { addInteraction } from '../api';

// VTEX singlePage integrations rely on the VTEX IO pixel app forwarding
// `vtex:productView` to gsSDK.getContentByContext('product_detail', ...).
// On initial loads (mostly mobile) that event can fire BEFORE window.gsSDK
// exists and is lost forever: no contents and no view tracking on the PDP.
// This fallback resolves the PDP by itself if nobody asked for product_detail
// shortly after init. It only acts in the case that today yields nothing.
const PDP_REGEX = /\/[^/]+\/p$/;
const FALLBACK_DELAY = 2000;
const FLAG = '__gsVtexPdpFallbackScheduled';

export function scheduleVtexPdpFallback(delay = FALLBACK_DELAY) {
  if (typeof window === 'undefined') return;
  if (window[FLAG]) return;
  window[FLAG] = true;
  setTimeout(runVtexPdpFallback, delay);
}

function runVtexPdpFallback() {
  try {
    if (!PDP_REGEX.test(window.location.pathname)) return;
    const last = window.__gsLastContentContext;
    if (last && last.context === 'product_detail') return; // la app VTEX ya resolvio
    if (document.querySelector('[id^="gs_main_container_"]')) return; // ya hay widgets
    const pageCtx = window.__RUNTIME__ && window.__RUNTIME__.route && window.__RUNTIME__.route.pageContext;
    const productId = pageCtx && pageCtx.type === 'product' && pageCtx.id ? String(pageCtx.id) : null;
    window.gsLog?.('[vtex-pdp-fallback] productView not received, resolving by', productId ? 'runtime id ' + productId : 'url');
    const options = productId
      ? { product_id: productId, singlePage: true, force: true }
      : { preProcess: ['findItemByField:url'], fieldValue: window.location.href, singlePage: true, force: true };
    if (window.gsConfig && window.gsConfig.options && window.gsConfig.options.context) {
      window.gsConfig.options.context.pageType = 'product_detail';
      window.gsConfig.options.context.product_url = window.location.href;
    }
    Promise.resolve(getContentByContext('product_detail', options)).catch((e) => window.gsLog?.('[vtex-pdp-fallback] content error', e));
    if (productId) {
      try { addInteraction({ event: 'view', item: productId }); } catch (e) { window.gsLog?.('[vtex-pdp-fallback] view error', e); }
    }
  } catch (e) {
    window.gsLog?.('[vtex-pdp-fallback] exception', e);
  }
}
