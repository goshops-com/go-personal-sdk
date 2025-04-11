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
