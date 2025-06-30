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

  // Function to initialize GSSDK
  async function initializeGSSDK() {
    try {
      const storeId = getStoreId();
      if (!storeId) {
        throw new Error("Store ID is required for initialization");
      }
      console.log("storeId", storeId);

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

      window.gsSDK = await new window.GSSDK.default("BR-TNSID_" + storeId, {
        provider: "TiendaNube",
        context: { pageType: pageType, product_id: productId },
      });

      if (pageType === "product_detail") {
        setTimeout(() => {
          window.gsSDK.addInteraction({
            event: "view",
            item: productId + "",
          });
        }, 1000);
      }

      startCartMonitoring();
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

  // Function to get current cart state
  function getCurrentCartState() {
    try {
      if (!LS || !LS.cart || !LS.cart.items) {
        return { items: [], subtotal: 0 };
      }
      return {
        items: LS.cart.items.map(item => ({
          id: item.id,
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
  function sendCartInteraction(change) {
    if (!window.gsSDK) {
      console.warn("GSSDK not initialized, cannot send cart interaction");
      return;
    }

    try {
      const interaction = {
        event: change.type,
        item: change.item.id + "",
        quantity: change.type === 'cart' ? change.quantityAdded : change.quantityRemoved
      };

      console.log("Sending cart interaction:", interaction);
      window.gsSDK.addInteraction(interaction);
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
      changes.forEach(change => {
        sendCartInteraction(change);
      });
    }

    previousCartState = JSON.parse(JSON.stringify(currentCart));
  }

  // Function to start cart monitoring
  function startCartMonitoring() {
    if (cartMonitoringInterval) {
      clearInterval(cartMonitoringInterval);
    }

    previousCartState = getCurrentCartState();
    console.log("Initial cart state:", previousCartState);
    
    cartMonitoringInterval = setInterval(monitorCartChanges, 1000 * CART_MONITORING_INTERVAL);
    console.log("Cart monitoring started");
  }

  // Start the initialization process
  loadGSSDK();
})();
