(function () {
  const CART_MONITORING_INTERVAL = 5;
  let previousCartState = null;
  let cartMonitoringInterval = null;

  // Function to extract store ID from script src
  function getStoreId() {
    try {
      const storeId = LS.store.id;
      return storeId;
    } catch (error) {
      console.error("Error extracting store ID:", error);
      return null;
    }
  }

  function getPageType(){
    let pageType = "home";
    let productId = LS.product?.id;
    let categoryId = LS.category?.id;
    if (LS.product && productId) {
      pageType = "product_detail";
    } else if (LS.category && categoryId) {
      pageType = "category_detail";
    } else if (LS.order) {
      pageType = "thankyou";
    }
    return pageType;
  }
  async function refreshContent(){
    let pageType = getPageType();
    let productId = LS.product?.id;
    window.gsSDK.getContentByContext(pageType, {product_id: productId + '' })
  }

  // Function to handle URL changes
  function handleUrlChange() {
    console.log("URL changed to:", window.location.href);
    if (window.gsSDK) {
      refreshContent();
    } else {
      console.log("GSSDK not initialized yet, will refresh content after initialization");
    }
  }

  // Function to set up URL change detection
  function setupUrlChangeDetection() {
    let currentUrl = window.location.href;

    // Listen for popstate events (back/forward button)
    window.addEventListener('popstate', () => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        handleUrlChange();
      }
    });

    // Override pushState to detect programmatic navigation
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        handleUrlChange();
      }
    };

    // Override replaceState to detect programmatic navigation
    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        handleUrlChange();
      }
    };

    console.log("URL change detection initialized");
  }

  // Function to initialize GSSDK
  async function initializeGSSDK() {
    try {
      const storeId = getStoreId();
      if (!storeId) {
        throw new Error("Store ID is required for initialization");
      }
      console.log("storeId", storeId);

      let pageType = getPageType();
      let productId = LS.product?.id;
      let categoryId = LS.category?.id;

      window.gsSDK = await new window.GSSDK.default("BR-TNSID_" + storeId, {
        provider: "TiendaNube",
        context: { pageType: pageType, product_id: productId + '' },
      });

      if (pageType === "product_detail") {
        setTimeout(() => {
          window.gsSDK.addInteraction({
            event: "view",
            item: productId + "",
          });
        }, 1000);
      }

      if (pageType === "thankyou" && LS.order) {
        window.gsSDK.addInteractionState('cart', { 
          "transactionId": LS.order.number + ""
        });
        console.log("Thank you page detected, order interaction sent:", LS.order.number);
      } else {
        startCartMonitoring();
      }
    } catch (error) {
      console.error("Failed to initialize GSSDK:", error);
    }
  }

  // Load the GSSDK script
  function loadGSSDK() {
    console.log("loadGSSDK V1");
    var gsSDKScript = document.createElement("script");
    gsSDKScript.src = "https://sdk.gopersonal.ai/gs-sdk.js";
    gsSDKScript.onload = initializeGSSDK;
    gsSDKScript.onerror = () => console.error("Failed to load GSSDK script");
    document.head.appendChild(gsSDKScript);
  }

  // Function to get current cart state of GSSDK
  async function getCurrentCartStateGSSDK() {
    try {
      const state = await window.gsSDK.getState();
      const cart = state.cart;
      return {
        items: cart.products.map(item => ({
          id: item.id,
          name: item.name,
          unit_price: item.price,
          quantity: item.quantity
        })),
        subtotal: cart.totalAmount || 0
      };
    } catch (error) {
      console.error("Error getting cart state:", error);
      return { items: [], subtotal: 0 };
    }
  }

  // Function to get current cart state
  function getCurrentCartState() {
    try {
      if (!LS || !LS.cart || !LS.cart.items) {
        return { items: [], subtotal: 0 };
      }
      return {
        items: LS.cart.items.map(item => ({
          id: item.variant_id,
          name: item.name,
          unit_price: item.unit_price,
          quantity: item.quantity
        })),
        subtotal: LS.cart.subtotal || 0
      };
    } catch (error) {
      console.error("Error getting cart state:", error);
      return { items: [], subtotal: 0 };
    }
  }

  // Function to compare cart states and detect changes
  function detectCartChanges(currentCart, previousCart) {
    if (!previousCart) {
      return { hasChanges: false, changes: [] };
    }

    const changes = [];
    const currentItemsMap = new Map();
    const previousItemsMap = new Map();

    currentCart.items.forEach(item => {
      currentItemsMap.set(item.id, item);
    });

    previousCart.items.forEach(item => {
      previousItemsMap.set(item.id, item);
    });

    for (const [itemId, currentItem] of currentItemsMap) {
      const previousItem = previousItemsMap.get(itemId);
      
      if (!previousItem) {
        changes.push({
          type: 'cart',
          item: currentItem,
          quantityAdded: currentItem.quantity
        });
      } else if (currentItem.quantity > previousItem.quantity) {
        changes.push({
          type: 'cart',
          item: currentItem,
          quantityAdded: currentItem.quantity - previousItem.quantity
        });
      } else if (currentItem.quantity < previousItem.quantity) {
        changes.push({
          type: 'remove-cart',
          item: currentItem,
          quantityRemoved: previousItem.quantity - currentItem.quantity
        });
      }
    }

    for (const [itemId, previousItem] of previousItemsMap) {
      if (!currentItemsMap.has(itemId)) {
        changes.push({
          type: 'remove-cart',
          item: previousItem,
          quantityRemoved: previousItem.quantity
        });
      }
    }

    return { hasChanges: changes.length > 0, changes };
  }

  // Function to send cart interactions
  function getInteraction(change) {
    if (!window.gsSDK) {
      console.warn("GSSDK not initialized, cannot send cart interaction");
      return;
    }
    try {
      const interaction = {
        event: change.type,
        preProcess: ["findItemByField:sku_list"],
        fieldValue: change.item.id + '',
        quantity: change.type === 'cart' ? change.quantityAdded : change.quantityRemoved
      };

      console.log("Sending cart interaction:", interaction);
      return interaction;
    } catch (error) {
      console.error("Error sending cart interaction:", error);
    }
  }

  // Function to monitor cart changes
  function monitorCartChanges() {
    const currentCart = getCurrentCartState();
    const { hasChanges, changes } = detectCartChanges(currentCart, previousCartState);

    if (hasChanges) {
      console.log("Cart changes detected:", changes);
      const interactions = [];
      changes.forEach(change => {
        const interaction = getInteraction(change);
        if (interaction) {
          interactions.push(interaction);
        }
      });
      for (const i of interactions) {
        window.gsSDK.addBulkInteractions([i]);
      }
    }

    previousCartState = JSON.parse(JSON.stringify(currentCart));
  }

  // Function to start cart monitoring
  async function startCartMonitoring() {
    if (cartMonitoringInterval) {
      clearInterval(cartMonitoringInterval);
    }

    previousCartState = await getCurrentCartStateGSSDK();
    console.log("Initial cart state:", previousCartState);
    
    cartMonitoringInterval = setInterval(monitorCartChanges, 1000 * CART_MONITORING_INTERVAL);
    console.log("Cart monitoring started");
  }

  // Start the initialization process
  setupUrlChangeDetection();
  loadGSSDK();
})();
