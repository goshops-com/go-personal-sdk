const iframeOrigin = "https://sdk.gopersonal.ai";

import { getToken, getSession } from './storage';

export const getSharedToken = () => {
    const clientId = window.gsConfig.clientId;
    const clientOrigin = window.location.origin;
    let iframe = document.getElementById('gs_sessionTokenIframe');

    return new Promise((resolve, reject) => {
        function messageHandler(event) {
            if (event.origin !== iframeOrigin) {
                return;
            }

            if (event.data.action === 'sessionData') {
                window.removeEventListener('message', messageHandler);
                if (event.data.session) {
                    resolve(event.data.session);
                } else {
                    reject(new Error("Session not received"));
                }
            }
        }

        window.addEventListener('message', messageHandler);

        const setupIframe = () => {
            iframe.contentWindow.postMessage({
                action: 'getSession',
                clientId: clientId
            }, iframeOrigin);
        };

        if (!iframe) {
            const iframeUrl = `${iframeOrigin}/iframe.html?clientOrigin=${encodeURIComponent(clientOrigin)}&clientId=${clientId}`;
            iframe = document.createElement('iframe');
            iframe.src = iframeUrl;
            iframe.style.display = "none";
            iframe.id = 'gs_sessionTokenIframe';
            iframe.onload = setupIframe;
            document.body.appendChild(iframe);
        } else {
            setupIframe();
        }
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
    const obj = getSession();
    let iframe = document.getElementById('gs_sessionTokenIframe');

    return new Promise((resolve, reject) => {
        function messageHandler(event) {
            if (event.origin !== iframeOrigin) {
                return;
            }

            if (event.data.action === 'sessionSet') {
                window.removeEventListener('message', messageHandler);
                resolve();
            }
        }

        window.addEventListener('message', messageHandler);

        const sendMessage = () => {
            iframe.contentWindow.postMessage({
                action: 'setSession',
                clientId: clientId,
                session: obj
            }, iframeOrigin);
        };

        if (!iframe) {
            const iframeUrl = `${iframeOrigin}/iframe.html?clientOrigin=${encodeURIComponent(clientOrigin)}&clientId=${clientId}`;
            iframe = document.createElement('iframe');
            iframe.src = iframeUrl;
            iframe.style.display = "none";
            iframe.id = 'gs_sessionTokenIframe';
            iframe.onload = sendMessage;
            document.body.appendChild(iframe);
        } else {
            sendMessage();
        }
    });
}