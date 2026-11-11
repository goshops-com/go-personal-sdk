const CUSTOM_EVENTS_URL = 'https://custom-events.gopersonal.ai/event';

// Va a un servicio aparte, con URL absoluta: no pasa por httpPost, que arma la
// URL sobre la base del API de discover. El servicio solo acepta Content-Type.
export const sendEvent = async (targetId, variantId, customer) => {
    const response = await fetch(CUSTOM_EVENTS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: targetId, value: variantId, customer: customer }),
    });

    if (!response.ok) {
        throw new Error(`POST request failed: ${response.status}`);
    }
};
