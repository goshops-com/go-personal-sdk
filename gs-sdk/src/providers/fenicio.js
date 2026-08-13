
const getFenicioPageContext = (context) => {
    const url = new URL(window.location.href);

    if (context?.pageType) {
        return {
            ...context,
            ...(context.pageType === 'product_detail'
                ? { product_url: url.href }
                : {}),
        };
    }

    if (url.pathname === '/') {
        return { pageType: 'home' };
    }

    if (url.pathname.startsWith('/catalogo/')) {
        return { pageType: 'product_detail', product_url: url.href };
    }

    if (url.pathname.startsWith('/checkout')) {
        return { pageType: 'checkout' };
    }

    return { pageType: 'category' };
};

const getFenicioNavigationKey = (context) => {
    const url = new URL(window.location.href);
    ['_gsLog', 'gsImpressionId', 'gsListName', 'gsIndex'].forEach((param) => {
        url.searchParams.delete(param);
    });

    return `${context.pageType}:${url.href}`;
};

export const processFenicioNavigation = async (context) => {
    const nextContext = getFenicioPageContext(context);
    const sdk = window.gsSDK;

    if (!nextContext || !sdk?.getContentByContext) {
        return;
    }

    const state = window.__gsFenicioNavigationState || {};
    window.__gsFenicioNavigationState = state;

    const key = getFenicioNavigationKey(nextContext);

    if (state.lastKey === key) {
        return;
    }

    if (state.inFlight && state.inFlight.key === key) {
        return state.inFlight.promise;
    }

    if (window.gsConfig?.options) {
        window.gsConfig.options.context = nextContext;
    }

    const request = sdk.getContentByContext(nextContext.pageType, {
        ...nextContext,
        singlePage: true,
    });

    state.inFlight = { key, promise: request };

    try {
        await request;
        const currentContext = getFenicioPageContext();
        if (currentContext && getFenicioNavigationKey(currentContext) === key) {
            state.lastKey = key;
        }
    } finally {
        if (state.inFlight?.key === key) {
            state.inFlight = null;
        }
    }
};

export const installFenicioNavigationMonitor = (initialContext) => {
    if (window.__gsFenicioNavigationMonitorInstalled) {
        return;
    }

    window.__gsFenicioNavigationMonitorInstalled = true;
    const context = getFenicioPageContext(initialContext);
    const key = getFenicioNavigationKey(context);
    const state = window.__gsFenicioNavigationState = {
        lastKey: key,
        inFlight: null,
        timer: null,
    };

    let lastUrl = window.location.href;

    const notifyNavigation = (method) => {
        const url = window.location.href;

        if (url === lastUrl) {
            return;
        }

        lastUrl = url;
        console.log('[Fenicio] navigation detected', method, url);
        clearTimeout(state.timer);
        state.timer = setTimeout(() => processFenicioNavigation().catch(console.error), 2000);
    };

    ['pushState', 'replaceState'].forEach((method) => {
        const originalMethod = window.history[method];

        window.history[method] = function (...args) {
            const result = originalMethod.apply(this, args);
            notifyNavigation(method);
            return result;
        };
    });

    window.addEventListener('popstate', () => notifyNavigation('popstate'));
};

export const installFenicio = async (options) => {

    console.log('[gopersonal] installing fenicio scripts');

    try{
        const originalAddInteraction = window.gsSDK.addInteraction;
        
        if (window.gsSDK.addInteraction === originalAddInteraction) {
            window.gsSDK.addInteraction = function(data) {
                if (data.event === 'cart' || data.event === 'remove-cart') {
                    const item = data.item;
                    const quantity = data.quantity;
                    // Call the original function with modified data
                    originalAddInteraction({
                        "event": data.event,
                        "preProcess": ["findItemByField:sku_list"],
                        "fieldValue": item,
                        "quantity": quantity
                    });
                } else {
                    // Continue with the original function
                    originalAddInteraction(data);
                }
            };
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));

        if (window.gsConfig?.options.context.pageType === 'product_detail') {
            const productId = window.gsConfig?.options.context.product_url?.split('?')[0] || window.location.href.split('?')[0];
            if (productId) {
                await window.gsSDK.addInteraction({
                    event: "view",
                    preProcess: ['findItemByField:url'],
                    fieldValue: productId
                });
            }
        }

        if (location.pathname === '/checkout/facturacion') {  
            const userMail = document.querySelector('.email').innerHTML;
            if (userMail && userMail.includes('@')) {
                window.gsSDK.login(userMail, {
                    email: userMail,
                    param_updateCartFromCustomer: true
                });  
            }
        }

    }catch(e){
        console.error('Error in tracking script:', e);
    }
  }
