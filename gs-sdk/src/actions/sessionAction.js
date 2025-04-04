import { getSession } from '../utils/storage';

import { getUrlParameter } from '../utils/dom';

function storeValue(key, value) {
    return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        
        const handleMessage = (event) => {
            if (event.data.type === 'localStorage' && event.data.action === 'set' && event.data.key === key) {
                window.removeEventListener('message', handleMessage);
                document.body.removeChild(iframe);
                resolve(event.data.success);
            }
        };
        
        window.addEventListener('message', handleMessage);
        
        iframe.onerror = () => {
            window.removeEventListener('message', handleMessage);
            document.body.removeChild(iframe);
            reject(new Error('Failed to load the iframe'));
        };
        
        iframe.src = `https://sdk.gopersonal.ai/libs/shared_store.html?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`;
        document.body.appendChild(iframe);
        
        setTimeout(() => {
            window.removeEventListener('message', handleMessage);
            if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
            }
            reject(new Error('Operation timed out'));
        }, 5000);
    });
}

async function _setSharedSession(key) {
    console.log('setSharedSession', key);
    const obj = getSession();
    await storeValue(key, JSON.stringify(obj));
    console.log('setSharedSession', key, obj);
};

export const executeActions = (provider) => {
    const key = getUrlParameter('_gsSessionSet');
    if (!key) {
        return;
    }
    _setSharedSession(key);
}