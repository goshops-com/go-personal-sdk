(function () {
  // Function to extract store ID from script src
  function getStoreId() {
    try {
      // Find all script tags
      const scripts = document.getElementsByTagName("script");

      // Look for our script tag
      for (const script of scripts) {
        const url = new URL(script.src);
        // Check if this is our script
        if (url.pathname.endsWith("tiendanube.js")) {
          // Extract store ID from query parameter
          const storeId = url.searchParams.get("store");
          if (storeId) {
            return storeId;
          }
        }
      }
      console.error("Store ID not found in script URL");
      return null;
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

      window.gsSDK = await new window.GSSDK.default(storeId, {
        provider: "Luna",
        context: { pageType: "home" },
      });
    } catch (error) {
      console.error("Failed to initialize GSSDK:", error);
    }
  }

  // Load the GSSDK script
  function loadGSSDK() {
    var gsSDKScript = document.createElement("script");
    gsSDKScript.src = "https://sdk.gopersonal.ai/gs-sdk.js";
    gsSDKScript.onload = initializeGSSDK;
    gsSDKScript.onerror = () => console.error("Failed to load GSSDK script");
    document.head.appendChild(gsSDKScript);
  }

  // Start the initialization process
  loadGSSDK();
})();
