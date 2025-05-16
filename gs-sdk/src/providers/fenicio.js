

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