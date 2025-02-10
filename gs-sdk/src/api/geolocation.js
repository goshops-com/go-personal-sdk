let endpoint = 'https://ipapi.co/json';
let endpoint2 = 'https://gopersonal-ip-geolocation.fly.dev/myip';

export const getCurrentGeoIPLocation = async () => {
    const cacheKey = 'gs_geoip_location';
    const cacheExpiry = 'gs_geoip_location_expiry';
    const oneHour = 60 * 60 * 1000 * 3;

    const cached = localStorage.getItem(cacheKey);
    const expiry = localStorage.getItem(cacheExpiry);
    
    if (cached && expiry && Date.now() < parseInt(expiry)) {
        return JSON.parse(cached);
    }

    try {
        const response = await fetch(endpoint);
        if (response.status >= 400) {
            throw new Error();
        }
        const data = await response.json();
        localStorage.setItem(cacheKey, JSON.stringify(data));
        localStorage.setItem(cacheExpiry, (Date.now() + oneHour).toString());
        return data;
    } catch (error) {
        if (response?.status >= 400) {
            const response = await fetch(endpoint2);
            if (response.status >= 400) {
                return {}
            }
            const data = await response.json();
            localStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(cacheExpiry, (Date.now() + oneHour).toString());
            return data;
        }
        return {}
    }
}