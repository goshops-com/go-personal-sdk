let endpoint = 'https://ipapi.co/json';
let endpoint2 = 'https://gopersonal-ip-geolocation.fly.dev/myip';

const cacheKey = 'gs_geoip_location';
const cacheExpiry = 'gs_geoip_location_expiry';
const cacheTTL = 60 * 60 * 1000 * 3;

const fetchLocation = async (url) => {
    const response = await fetch(url);
    if (response.status >= 400) {
        throw new Error(`Geolocation request failed: ${response.status}`);
    }
    const data = await response.json();
    localStorage.setItem(cacheKey, JSON.stringify(data));
    localStorage.setItem(cacheExpiry, (Date.now() + cacheTTL).toString());
    return data;
};

export const getCurrentGeoIPLocation = async () => {
    const cached = localStorage.getItem(cacheKey);
    const expiry = localStorage.getItem(cacheExpiry);

    if (cached && expiry && Date.now() < parseInt(expiry)) {
        return JSON.parse(cached);
    }

    // Si el servicio principal falla (error HTTP o de red) se prueba el de
    // respaldo; si tampoco responde, no hay ubicacion.
    try {
        return await fetchLocation(endpoint);
    } catch (error) {
        try {
            return await fetchLocation(endpoint2);
        } catch (fallbackError) {
            return {};
        }
    }
}
