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