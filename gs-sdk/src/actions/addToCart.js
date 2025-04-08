


function _addToCartAction(provider) {

    function getUrlParameter(name) {
        name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
        var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
        var results = regex.exec(location.search);
        return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
    }

    // Get the _gsAdd and _gsRedirect parameters from the URL
    const gsAddParam = getUrlParameter('_gsAdd');
    const gsRedirect = getUrlParameter('_gsRedirect');

    // Immediately exit if _gsAdd is not present or empty
    if (!gsAddParam) {
        return; // Exit the function
    }

    // Convert _gsAdd to an array of product IDs
    let productIds = gsAddParam.split(',').map(Number);

    // Create the overlay and popup content
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: '1000'
    });

    const popupContent = document.createElement('div');
    Object.assign(popupContent.style, {
        backgroundColor: '#fff',
        padding: '20px',
        borderRadius: '5px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
    });
    popupContent.innerText = 'Agregando tus productos al carrito...';
    overlay.appendChild(popupContent);
    document.body.appendChild(overlay);

    let formData = new FormData();
    formData.append('action', 'add_products_to_cart');
    formData.append('product_ids', JSON.stringify(productIds));

    fetch('/wp-admin/admin-ajax.php', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.body.removeChild(overlay); // Remove the popup
                if (gsRedirect) {
                    window.location.href = `${window.location.origin}/${gsRedirect}`;
                }
            } else {
                console.error('Error:', data.data.message);
                document.body.removeChild(overlay); // Remove the popup even on error
            }
        })
        .catch(error => {
            console.error('Fetch Error:', error);
            document.body.removeChild(overlay); // Ensure popup is removed on fetch error
        });
}

export const executeActions = (provider) => {
    if (provider != 'WooCommerce') {
        return;
    }
    _addToCartAction();
}