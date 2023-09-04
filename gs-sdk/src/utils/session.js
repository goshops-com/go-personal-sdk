
const iframeOrigin = "https://gs-sdk.pages.dev"; // adjust this to your iframe server domain


export const getSharedToken = (clientId, clientOrigin) => {

    return new Promise((resolve, reject) => {
        const iframeUrl = `${iframeOrigin}/iframe.html?clientOrigin=${encodeURIComponent(clientOrigin)}&clientId=${clientId}`;

        // Create iframe dynamically
        const iframe = document.createElement('iframe');
        iframe.src = iframeUrl;
        iframe.style.display = "none"; // Hide the iframe
        iframe.id = 'gs_sessionTokenIframe';
        document.body.appendChild(iframe);

        // Listener for messages from the iframe
        function messageHandler(event) {
            // Ensure messages are coming from the expected origin
            if (event.origin !== iframeOrigin) {
                return;
            }

            const token = event.data;

            if (token) {
                resolve(token);
            } else {
                reject(new Error("Token not received"));
            }

            // Remove the event listener to avoid any potential memory leaks
            window.removeEventListener('message', messageHandler);
        }

        window.addEventListener('message', messageHandler);
    });
   
}

