const iframeOrigin = "https://sdk.gopersonal.ai";

import { getToken } from './storage';

export const getSharedToken = () => {
    const clientId = window.gsConfig.clientId;
    const clientOrigin = window.location.origin;

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

export const clearToken = () => {
    const clientId = window.gsConfig.clientId;
    const iframe = document.getElementById('gs_sessionTokenIframe');
    if (iframe) {
        iframe.contentWindow.postMessage({
            action: 'clearToken',
            clientId: clientId
        }, iframeOrigin);
    }
}

export const setSharedToken = () => {
    const clientId = window.gsConfig.clientId;
    const clientOrigin = window.location.origin;
    const obj = getToken();
    let iframe = document.getElementById('gs_sessionTokenIframe');

    if (!iframe) {
        const iframeUrl = `${iframeOrigin}/iframe.html?clientOrigin=${encodeURIComponent(clientOrigin)}&clientId=${clientId}`;
        iframe = document.createElement('iframe');
        iframe.src = iframeUrl;
        iframe.style.display = "none";
        iframe.id = 'gs_sessionTokenIframe';
        document.body.appendChild(iframe);
    }

    iframe.contentWindow.postMessage({
        action: 'setToken',
        clientId: clientId,
        token: obj.token
    }, iframeOrigin);
}