import { getItemById } from '../api';
import { getParam } from './urlParam';

export const getGAId = () => {
    try {
        if (window.ga && typeof window.ga.getAll === 'function') {
            const tracker = window.ga.getAll()[0];
            if (tracker) return tracker.get('clientId');
        }
        
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith('_ga=')) {
                const parts = cookie.substring(4).split('.');
                if (parts.length >= 3) {
                    return parts.slice(-2).join('.');
                }
            }
        }
        
        return null;
    } catch (error) {
        return null;
    }
};

export const markSessionEvent = () => {
    try {
        if (typeof gtag === 'function') {
            gtag('event', 'gopersonal_present', {
                'product': 'gopersonal',
                'session_marked': true
            });
        }
    } catch (error) {
        return null;
    }
};

function getUrlParams() {
    const params = {};
    const queryString = window.location.search.substring(1);
    const pairs = queryString.split('&');
    
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i].split('=');
      if (pair[0] && pair[1]) {
        params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
      }
    }
    
    return params;
  }

function sendGa4Event(eventName, eventParams) {
    console.log('sending ga4 event', eventName, eventParams);
    
    if (typeof gtag === 'function') {
        gtag('event', eventName, eventParams);
    } else {
        console.error('gtag not available');
    }
    
    try {
        if (typeof window !== 'undefined' && window.dataLayer && Array.isArray(window.dataLayer)) {
            window.dataLayer.push({
                event: eventName,
                ...eventParams
            });
        }
    } catch (error) {
        console.error('Error pushing to dataLayer:', error);
    }
}

export const checkURLEvents = () => {
    try {
        const params = getUrlParams();
  
        // Check if this URL contains our event tracking parameters
        if (params.ev_name) {
            const eventName = params.ev_name;
            const eventParams = {};
            
            // Extract all event parameters (those starting with ev_p_)
            Object.keys(params).forEach(key => {
            if (key.startsWith('ev_p_')) {
                const paramName = key.substring(5); // Remove 'ev_p_' prefix
                eventParams[paramName] = params[key];
            }
            });
            
            // Send the event to GA4
            sendGa4Event(eventName, eventParams);
        }
    } catch (error) {
        console.error('Error checking URL events:', error);
    }
}


/** New GA4 Implementation */

/** Helpers */
function isgtagAvailable() {
    return typeof gtag === 'function';
}

function parseItemForGA4(item, index, listName) {
    return {
        item_id: item.id,
        item_name: item.name || '',
        price: item.price,
        item_category: item.category || '',
        item_brand: item.brand || '',
        index: parseInt(index) + 1,
        item_list_name: listName,
        quantity: 1
    };
}

function isEcommerceEvent(eventName) {
    const ecommerceEvents = [
        // Productos
        'view_item',
        'add_to_cart',
        'remove_from_cart',
      
        // Carrito / checkout
        'view_cart',
        'begin_checkout',
        'add_shipping_info',
        'add_payment_info',
      
        // Compra
        'purchase',
        'refund',
      
        // Listas
        'view_item_list',
        'select_item',
      
        // Promos
        'view_promotion',
        'select_promotion'
      ];
    return ecommerceEvents.includes(eventName);
}
function gopersonalTrack(eventName, eventData) {
    // If the parameter gsIncludeDraft is true, don't track the event
    if(getParam('gsIncludeDraft') == 'true') {
        return;
    }

    if (isgtagAvailable()) {
        gtag('event', eventName, eventData);
    } else if (typeof window !== 'undefined' && window.dataLayer && Array.isArray(window.dataLayer)) {
        window.dataLayer.push({
            event: eventName,
            ...(isEcommerceEvent(eventName) ? { ecommerce: eventData } : eventData),
        });
    } else {
        console.error('gtag and dataLayer not available');
    }
}

export const trackGopersonalProductImpression = (items, listName) => {
    // Assign the listName and the index to each item
    const enhancedItems = items.map((item, index) => parseItemForGA4(item, index, listName));
    const eventData = {
        item_list_name: listName,
        items: enhancedItems,
    };
    gopersonalTrack('view_item_list', eventData);
};

export const trackGopersonalProductClick = (item, listName, index) => {
    const enhancedItem = parseItemForGA4(item, index, listName)
    const eventData = {
        item_list_name: listName,
        items: [enhancedItem], 
    };
    gopersonalTrack('select_item', eventData);
}

export const trackGopersonalBannerImpression = (promotions) => {
    const enhancedPromotions = promotions.map(promo => ({
        ...promo, // Must include promotion_id, promotion_name
        creative_slot: promo.creative_slot || 'gopersonal_slot' // Slot por
    }));
    
    const eventData = {
        promotions: enhancedPromotions,
    };
    gopersonalTrack('view_promotion', eventData);
};

export const trackGopersonalBannerClick = (promotion) => {
    const enhancedPromotion = {
        ...promotion,
        creative_slot: 'gopersonal_slot',
    };
    const eventData = {
        promotions: [enhancedPromotion],
    };
    
    gopersonalTrack('select_promotion', eventData);
};

export const trackGopersonalProductClickById = async (itemId, listName = 'gopersonal_list', index = 0) => {
    const item = await getItemById(itemId);
    const enhancedItem = parseItemForGA4(item, index, listName);
    const eventData = {
        item_list_name: listName,
        items: [enhancedItem],
    };
    gopersonalTrack('select_item', eventData);
};

export const trackGopersonalSearch = (query, resultsCount, searchType, searchId, occasionSearch) => {
    const eventData = {
        search_query: query,
        search_results_count: resultsCount,
        search_type: searchType,
        search_id: searchId,
        occasion_search: occasionSearch
        
    };
    gopersonalTrack('search', eventData);
};

export const trackGopersonalSearchResults = (products) => {
    const enhancedItems = products.map((item, index) => parseItemForGA4(item, index, 'Gopersonal - Search Results')) || [];
    const eventData = {
        item_list_name: 'Gopersonal - Search Results',
        items: enhancedItems,
    };
    gopersonalTrack('view_item_list', eventData);
};

export const trackGopersonalSearchResultClick = (product) => {
    const enhancedItem = parseItemForGA4(product, 0, 'Gopersonal - Search Results');
    const eventData = {
        item_list_name: 'Gopersonal - Search Results',
        items: [enhancedItem],
    };
    gopersonalTrack('select_item', eventData);
};

export const trackGopersonalProductAddToCart = async (itemId, listName = 'gopersonal_list') => {
    const item = await getItemById(itemId);
    const enhancedItem = parseItemForGA4(item, 0, listName);
    const eventData = {
        item_list_name: listName,
        items: [enhancedItem],
    };
    gopersonalTrack('add_to_cart', eventData);   
};

export const trackGopersonalCustomEvent = (event,params) => {
    gopersonalTrack(event, params);    
};
