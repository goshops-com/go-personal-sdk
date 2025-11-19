import { addInteraction, addInteractionState, login, logout, updateState } from '../api';
import { getContentByContext } from '../api/content';

const EMBEDDED_FLAG = '__gsIntegrationListener';
const RETRY_DELAY = 100;

export function onVtexEmbeddedInit() {
  if (typeof window === 'undefined') {
    return;
  }

  if (window[EMBEDDED_FLAG]) {
    return;
  }

  window[EMBEDDED_FLAG] = true;
  window.addEventListener('message', handleEvents);
}

function handleEvents(event = {}) {
  window.gsLog?.('Event embedded:', event?.data?.eventName);
  const eventName = event?.data?.eventName;
  if (!eventName) {
    return;
  }

  switch (eventName) {
    // case 'vtex:productView':
    //   handleProductView(event);
    //   break;
    // case 'vtex:userData':
    //   handleUserData(event);
    //   break;
    // case 'vtex:addToWishlist':
    //   handleAddToWishlist(event);
    //   break;
    // case 'vtex:addToCart':
    //   handleAddToCart(event);
    //   break;
    // case 'vtex:removeFromCart':
    //   handleRemoveFromCart(event);
    //   break;
    // case 'vtex:cartChanged':
    //   handleCartChanged(event);
    //   break;
    // case 'vtex:orderPlaced':
    //   handleOrderPlaced(event);
    //   break;
    case 'vtex:pageView':
      handlePageView();
      break;
    default:
      break;
  }
}

function handleProductView(event) {
  const productId = event?.data?.product?.productId;
  if (!productId) {
    return;
  }

  getContentByContext('product_detail', {
    product_id: productId,
    singlePage: true,
    force: true
  });
  addInteraction({
    event: 'view',
    item: productId
  });
}

function handleUserData(event) {
  const email = event?.data?.email;
  const userId = event?.data?.id;
  if (email) {
    retryLogin(3, 0, userId, email, true);
  } else {
    logoutCurrentClient();
  }
}

function handleAddToWishlist(event) {
  const productId = event?.data?.items?.product?.productId;
  if (!productId) {
    return;
  }

  addInteraction({
    event: 'like',
    item: productId
  });
}

function handleAddToCart(event) {
  const item = event?.data?.items?.[0];
  if (!item?.productId) {
    return;
  }

  addInteraction({
    event: 'cart',
    item: item.productId,
    quantity: item.quantity,
    price: item.price
  });
}

function handleRemoveFromCart(event) {
  const item = event?.data?.items?.[0];
  if (!item?.productId) {
    return;
  }

  addInteraction({
    event: 'remove-cart',
    item: item.productId,
    quantity: item.quantity,
    price: item.price
  });
}

function handleCartChanged(event) {
  const items = event?.data?.items || [];
  if (items.length > 0) {
    const state = {
      cart: {
        amountOfProducts: getAmountOfProducts(items),
        totalAmount: getTotalAmount(items),
        products: items.map(item => ({
          id: item.productId,
          price: item.price,
          quantity: item.quantity,
          image_url: item.imageUrl
        }))
      }
    };
    updateState(state);
  } else {
    addInteraction({ event: 'clean-cart' });
  }
}

function handleOrderPlaced(event) {
  const transactionId = event?.data?.transactionId;
  const payload = transactionId ? { transactionId } : {};
  addInteractionState('cart', payload);
}

function handlePageView() {
  if (isProductDetailPath()) {
    return;
  }

  const context = getContext();
  const { pageType, ...contentOptions } = context;
  retryContentByContext(3, 0, pageType, { ...contentOptions, force: true });
}

function retryContentByContext(maxTries, attempt, pageType, options) {
  getContentByContext(pageType, options)
    .catch((error) => {
      if (attempt + 1 < maxTries) {
        setTimeout(() => retryContentByContext(maxTries, attempt + 1, pageType, options), RETRY_DELAY);
      } else {
        window.gsLog?.('retryContentByContext failed', error);
      }
    });
}

function retryLogin(maxTries, attempt, id, email, updateCartFromCustomer) {
  login(id, {
    email,
    param_updateCartFromCustomer: updateCartFromCustomer
  }).catch(() => {
    if (attempt + 1 < maxTries) {
      setTimeout(() => retryLogin(maxTries, attempt + 1, id, email, updateCartFromCustomer), RETRY_DELAY);
    }
  });
}

function getAmountOfProducts(items = []) {
  return items.reduce((total, item) => total + (item?.quantity || 0), 0);
}

function getTotalAmount(items = []) {
  return items.reduce((total, item) => total + ((item?.price || 0) * (item?.quantity || 0)), 0);
}

function getContext() {
  if (typeof window === 'undefined') {
    return { pageType: 'unknown', singlePage: true };
  }

  const path = window.location.pathname;
  const hash = window.location.hash;
  const url = window.location.href;

  if (path === '/') {
    return { pageType: 'home', singlePage: true };
  }

  if (isProductDetailPath()) {
    return {
      pageType: 'product_detail',
      preProcess: ['findItemByField:url'],
      fieldValue: url,
      singlePage: true
    };
  }

  if (path.startsWith('/checkout/') && hash.includes('#/cart')) {
    return { pageType: 'checkout', singlePage: true };
  }

  return { pageType: 'unknown', singlePage: true };
}

function isProductDetailPath() {
  if (typeof window === 'undefined') {
    return false;
  }

  const productDetailRegex = /\/[^/]+\/p$/;
  return productDetailRegex.test(window.location.pathname);
}

function logoutCurrentClient() {
  const clientId = window?.gsConfig?.clientId;
  if (!clientId) {
    return;
  }

  logout(clientId).catch((error) => {
    window.gsLog?.('Error logging out client', error);
  });
}

