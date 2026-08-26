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
      identifyCustomer();
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

      identifyCustomer();

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

  // --- customer identification ---------------------------------------------
  //
  // `LS.customer` is only the customer id: the platform exposes no email, name
  // or phone to a storefront script (the docs define it as "current customer
  // id or null"). The account forms are the one place on the storefront where
  // the shopper types them, and their field names are the platform's own POST
  // contract, so they are read there and held until the reload that follows a
  // successful login or registration finally reveals the id.

  const IDENTITY_KEY = "gs-tn-identity";
  const PENDING_ACCOUNT_KEY = "gs-tn-account-pending";
  const PENDING_ACCOUNT_TTL = 60 * 60 * 1000;
  const ACCOUNT_FORM_SELECTOR =
    '[data-store="account-register"], [data-store="account-login"], #register-form, #login-form';
  // The fields read off those forms. `password` is deliberately absent, and
  // adding it here would be a bug.
  const ACCOUNT_FIELDS = ["name", "email", "phone"];

  function readStored(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStored(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Private mode or storage full: identification still works, it just
      // repeats itself on the next page instead of being deduplicated.
    }
  }

  function clearStored(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Nothing to do: a stale entry only costs a redundant login call.
    }
  }

  function readPendingAccount() {
    const pending = readStored(PENDING_ACCOUNT_KEY);
    if (!pending || !pending.ts || Date.now() - pending.ts > PENDING_ACCOUNT_TTL) {
      return {};
    }
    return pending.data || {};
  }

  // Captures what the shopper typed on the login or registration form.
  // Nothing is sent from here: the submission may still be rejected, so the
  // data only becomes an identity once a customer id shows up after the
  // reload. Bound in the capture phase so themes that handle the submit
  // themselves cannot swallow the event first.
  function captureAccountForms() {
    document.addEventListener(
      "submit",
      (event) => {
        try {
          const form = event.target;
          if (!form || typeof form.matches !== "function") {
            return;
          }
          if (!form.matches(ACCOUNT_FORM_SELECTOR)) {
            return;
          }

          const data = {};
          ACCOUNT_FIELDS.forEach((field) => {
            const input = form.querySelector('[name="' + field + '"]');
            const value =
              input && typeof input.value === "string" ? input.value.trim() : "";
            if (value) {
              data[field] = value;
            }
          });

          if (Object.keys(data).length) {
            writeStored(PENDING_ACCOUNT_KEY, { ts: Date.now(), data });
            console.log("Account form captured:", Object.keys(data));
          }
        } catch (error) {
          console.error("Error capturing account form:", error);
        }
      },
      true
    );
  }

  // Documented as an id, but read defensively: a theme or a future runtime
  // handing us an object should enrich the payload, not stringify into
  // "[object Object]" and corrupt the customer id.
  function readLSCustomer() {
    const raw = typeof LS !== "undefined" ? LS.customer : null;
    if (!raw) {
      return null;
    }
    if (typeof raw === "object") {
      const id = raw.id ? raw.id + "" : null;
      return id ? { id: id, data: raw } : null;
    }
    return { id: raw + "", data: {} };
  }

  async function identifyCustomer() {
    try {
      if (!window.gsSDK) {
        return;
      }

      const customer = readLSCustomer();
      if (!customer) {
        // Logged out: forget the identity so a later login is reported again.
        clearStored(IDENTITY_KEY);
        return;
      }

      const pending = readPendingAccount();
      const payload = { param_updateCartFromCustomer: true };
      ACCOUNT_FIELDS.forEach((field) => {
        const value = pending[field] || customer.data[field];
        if (value) {
          payload[field] = value;
        }
      });

      const fields = ACCOUNT_FIELDS.map((field) => payload[field] || "").join("|");
      const hasProfile = fields.replace(/\|/g, "").length > 0;
      const reported = readStored(IDENTITY_KEY) || {};

      // Resend only when the shopper changed, or when we now hold profile
      // fields we had not reported for them yet.
      if (reported.id === customer.id && (!hasProfile || reported.fields === fields)) {
        return;
      }

      await window.gsSDK.login(customer.id, payload);
      writeStored(IDENTITY_KEY, { id: customer.id, fields: hasProfile ? fields : "" });
      clearStored(PENDING_ACCOUNT_KEY);
      console.log("Customer identified:", {
        id: customer.id,
        fields: ACCOUNT_FIELDS.filter((field) => payload[field]),
      });
    } catch (error) {
      console.error("Error identifying customer:", error);
    }
  }

  // Function to get current cart state of GSSDK
  async function getCurrentCartStateGSSDK() {
    try {
      const state = await window.gsSDK.getState();
      const cart = state.cart;
      const itemsWithSkus = await Promise.all(
        cart.products.map(async item => {
          let skuList = [];
          try {
            const itemData = await window.gsSDK.getItemById(item.id + '');
            if (itemData && Array.isArray(itemData.sku_list)) {
              skuList = itemData.sku_list.map(Number);
            }
          } catch (e) {
          }
          return {
            id: item.id,
            name: item.name,
            unit_price: item.price,
            quantity: item.quantity,
            sku_list: skuList
          };
        })
      );
      return {
        items: itemsWithSkus,
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
    console.log(previousCart.items)
    for (const [itemId, currentItem] of currentItemsMap) {
      let previousItem = previousItemsMap.get(itemId);
      if (!previousItem) {
        for (const prev of previousCart.items) {
          if (prev.sku_list && Array.isArray(prev.sku_list) && prev.sku_list.includes(itemId)) {
            previousItem = prev;
            previousItem.id = itemId;
            break;
          }
        }
      }
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
      let exists = false;
      if (previousItem.sku_list && Array.isArray(previousItem.sku_list)) {
        exists = previousItem.sku_list.some(variantId => currentItemsMap.has(variantId));
      } else {
        exists = currentItemsMap.has(itemId);
      }
      if (!exists) {
        previousItem.id = previousItem.sku_list[0];
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

      return interaction;
    } catch (error) {
      console.error("Error sending cart interaction:", error);
    }
  }

  // Function to monitor cart changes
  async function monitorCartChanges() {
    previousCartState = await getCurrentCartStateGSSDK();

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
        await window.gsSDK.addBulkInteractions([i]);
      }
    }
  }

  // Function to start cart monitoring
  async function startCartMonitoring() {
    if (cartMonitoringInterval) {
      clearInterval(cartMonitoringInterval);
    }

    monitorCartChanges();
    cartMonitoringInterval = setInterval(monitorCartChanges, 1000 * CART_MONITORING_INTERVAL);
    console.log("Cart monitoring started");
  }

  // Start the initialization process
  setupUrlChangeDetection();
  captureAccountForms();
  loadGSSDK();
})();
