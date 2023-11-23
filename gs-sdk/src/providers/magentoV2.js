
export const install = (options) => {
  
  require(['mage/storage'], function (storage) {
      var serviceUrl = 'rest/V1/customers/me';
      storage.get(
          serviceUrl,
          false
      ).done(function (response) {
          if (response && response.id){
              window.gsSDK.login(response.id);
          }else{
              window.gsSDK.logout();
          }
      }).fail(function (error) {
          console.error(error);
      });
  });
  
  
  require([
      'Magento_Customer/js/customer-data'
  ], function (customerData) {
      
      var previousItems = [];
      var previousIds = [];
  
      function waitForCartData(callback) {
          var cart = customerData.get('cart');
          
          // Check if cart data is already loaded
          if (cart().items && cart().items.length > 0) {
              callback(cart);
          } else {
              // Wait for cart data to be loaded
              customerData.reload(['cart'], false).done(function() {
                  callback(customerData.get('cart'));
              });
          }
      }
      
      var cartData = customerData.get('cart');
      
      // Define the handleCartChange function to handle cart changes
      function handleCartChange(updatedCart) {
          var currentItems = updatedCart.items || [];
          var currentIds = currentItems.map(function (item) { return item.product_id || item.item_id; });
  
          window.gsLog('Handling cart change. Current items:', currentItems);
          window.gsLog('Previous IDs for comparison:', previousIds);
  
          // Handle additions
          currentItems.forEach(function(item) {
              var itemId = item.product_id || item.item_id;
              if (!previousIds.includes(itemId)) {
                  window.gsLog('New item added to cart:', item);
                  // Add interaction for new item
                  window.gsSDK.addInteraction({
                      "event": "cart",
                      "item": itemId,
                      "quantity": item.qty,
                      "price": parseFloat(item.product_price_value)
                  });
              }
          });
  
          // Handle removals
          previousItems.forEach(function(item) {
              var itemId = item.product_id || item.product_id;
              if (item && !currentIds.includes(itemId)) {
                  window.gsLog('Item removed from cart:', item);
                  // Add interaction for removed item
                  window.gsSDK.addInteraction({
                      "event": "remove-cart",
                      "item": item.product_id || item.item_id,
                      "quantity": item.qty // Ensure this attribute exists or use a different one if necessary
                  });
              }
          });
  
          // Update previousItems and previousIds for the next comparison
          previousItems = currentItems.slice();
          previousIds = currentIds.slice();
      }
  
      async function initialStateComparison(cartData) {
          var currentItems = Array.isArray(cartData().items) ? cartData().items : [];
          var currentIds = currentItems.map(function (item) { return item.product_id || item.item_id; });
  
          window.gsLog('Current IDs at initialStateComparison:', currentIds);
  
          // Fetch the current SDK state for comparison
          const sdkState = await window.gsSDK.findState();
          window.gsLog('SDK state at initialStateComparison:', sdkState);
  
          const sdkStateIds = sdkState.cart.products.map(product => product.id);
          window.gsLog('SDK state IDs at initialStateComparison:', sdkStateIds);
  
          var stateChanged = currentIds.some(id => !sdkStateIds.includes(id)) || 
                          sdkStateIds.some(id => !currentIds.includes(id));
  
          if (stateChanged) {
              window.gsLog('State changed. Building updated state.');
  
              var updatedState = {
                  "cart": {
                      "products": currentItems.map(function(item) {
                          return {
                              "id": item.product_id || item.item_id,
                              "quantity": item.qty,
                              "price": parseFloat(item.product_price_value),
                              "name": item.product_name,
                              "image_url": item.product_image.src,
                              "date": new Date().toISOString()
                          };
                      }),
                      "totalAmount": cartData().subtotalAmount,
                      "amountOfProducts": currentItems.length,
                      "updatedAt": new Date().toISOString()
                  }
              };
  
              window.gsLog('Updated state to send:', updatedState);
  
              // Update the SDK state with the new cart state
              await window.gsSDK.updateState(updatedState);
          } else {
              window.gsLog('No state change detected.');
          }
      }
      
      waitForCartData(function(cart) {
          previousItems = Array.isArray(cart().items) ? cart().items : [];
          previousIds = previousItems.map(function (item) { return item.product_id || item.item_id; });
          window.gsLog('Initial previous items and IDs:', previousItems, previousIds);
          initialStateComparison(cart); // You may need to pass previousItems and previousIds here if needed
      });
  
      // Subscribe to cart data updates
      cartData.subscribe(function (updatedCart) {
          window.gsLog('Cart updated:', updatedCart);
          handleCartChange(updatedCart);
      });
      
  });
  
  (function() {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;
  
    XMLHttpRequest.prototype.open = function(method, url) {
      this._method = method;
      this._url = url;
      originalOpen.apply(this, arguments);
    };
  
    XMLHttpRequest.prototype.send = function(data) {
      // Create a reference to the current XHR object to use within the event listener
      var currentXHR = this;
  
      // Add the event listener to the current XHR object
      currentXHR.addEventListener('load', function() {
        // Check if the request is for the wishlist and the response is successful
        if (currentXHR._method === "POST" && currentXHR._url.includes('rest/V2/wishlist/mine/item') && currentXHR.status === 200) {
          try {
            var response = JSON.parse(currentXHR.responseText);
            if (response && response.product && response.product.id) {
              var productId = response.product.id + '';
              window.gsSDK.addInteraction({
                "event": "like",
                "item": productId
              });
            } else {
              window.gsLog("Response does not have the expected format or id is missing");
            }
          } catch (e) {
            // Handle any errors that occur during the parse or execution of the addInteraction
            window.gsLog("Error parsing response or executing gsSDK.addInteraction for wishlist item", e);
          }
        }
        // Check if the request is for the cart payment information and the response is successful
        if (currentXHR._method === "POST" && currentXHR._url.includes('carts/mine/payment-information') && currentXHR.status === 200) {
          window.gsSDK.addInteractionState('cart');
        }
      });
  
      originalSend.apply(this, arguments);
    };
  })();    

}