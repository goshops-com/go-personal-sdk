
let endpoint = 'https://ipapi.co/json';
let endpoint2 = 'https://gopersonal-ip-geolocation.fly.dev/myip';

export const getCurrentGeoIPLocation = async () => {
    try {
        const response = await fetch(endpoint);
        const data = await response.json();
        return data;
    } catch (error) {
        const response = await fetch(endpoint2);
        const data = await response.json();
        return data;
    }
}