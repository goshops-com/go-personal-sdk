export const initVendorFenicio = (options = {}) => {

    (function() {
        try {
            var oldXHROpen = XMLHttpRequest.prototype.open;
    
            XMLHttpRequest.prototype.open = function(method, url) {
                // window.gsLog("Intercepted request with method:", method, "and URL:", url);
    
                if (method.toLowerCase() === 'get' && url.includes('/ajax?service=mi-compra')) {
                    window.gsLog("Matched the target URL. Setting up readystatechange listener.");
    
                    this.addEventListener('readystatechange', function() {
                        window.gsLog("Request state changed. ReadyState:", this.readyState, "Status:", this.status);
    
                        if (this.readyState === 4 && this.status === 200) {
                            try {
                                let urlParams = new URLSearchParams(url.split('?')[1]);
                                let op = urlParams.get('op');
                                let sku, qty;
    
                                switch(op) {
                                    case 'agregar':
                                        sku = urlParams.get('sku');
                                        qty = urlParams.get('qty');
    
                                        window.gsLog("Operation: agregar");
                                        window.gsLog("SKU:", sku);
                                        window.gsLog("QTY:", qty);
    
                                        if (window.gsSDK && window.gsSDK.addInteraction) {
                                            window.gsSDK.addInteraction({
                                                event: "cart",
                                                sku: sku,
                                                quantity: qty
                                            });
                                        }
                                        break;
    
                                    case 'quitar':
                                        sku = urlParams.get('cod');  // Fetching the SKU from cod parameter
    
                                        window.gsLog("Operation: quitar");
                                        window.gsLog("SKU:", sku);
    
                                        if (window.gsSDK && window.gsSDK.addInteraction) {
                                            window.gsSDK.addInteraction({
                                                event: "remove-cart",
                                                sku: sku,
                                                quantity: 1  // Defaulting quantity to 1 as it's not provided in the quitar operation
                                            });
                                        }
                                        break;
    
                                    default:
                                        // window.gsLog("Operation not recognized:", op);
                                        break;
                                }
    
                            } catch (innerException) {
                                console.error('Error processing the intercepted request:', innerException);
                            }
                        }
                    });
                }
                oldXHROpen.apply(this, arguments);
            };
        } catch (e) {
            console.error('Error setting up request interceptor:', e);
        }
    })();
    
}