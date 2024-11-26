(function () {
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
      } else if (LS.cart) {
        pageType = "cart";
      } else if (LS.order) {
        pageType = "thankyou";
      }

      window.gsSDK = await new window.GSSDK.default("BR-TNSID-" + storeId, {
        provider: "TiendaNube",
        context: { pageType: pageType, product_id: productId },
      });
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

  // Start the initialization process
  loadGSSDK();
})();
