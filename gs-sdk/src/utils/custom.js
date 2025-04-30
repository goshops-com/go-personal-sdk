export const sendEvent = (key, value, customer) => {
    try {
    fetch('https://custom-events.gopersonal.ai/event', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            key: key,
            value: value,
            customer: customer
        })
    });
    } catch (error) {
        return null;
    }
};
