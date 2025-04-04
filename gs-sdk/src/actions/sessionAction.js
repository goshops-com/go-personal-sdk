import { getSession } from '../utils/storage';

import { getUrlParameter } from '../utils/dom';

function storeValue(key, value) {
    return fetch('https://kv.gopersonal.ai/' + key, {
        method: 'PUT',
        body: value,
        headers: {
            'Content-Type': 'text/plain'
        }
    });
}

async function _setSharedSession(key) {
    const obj = getSession();
    await storeValue(key, JSON.stringify(obj));
};

export const executeActions = (provider) => {
    const key = getUrlParameter('_gsSessionSet');
    if (!key) {
        return;
    }
    _setSharedSession(key);
}