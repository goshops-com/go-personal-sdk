import { getSession } from '../utils/storage';

import { getUrlParameter } from '../utils/dom';

function uuidv4() {
    try {
      return self.crypto.randomUUID();
    } catch (e) {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
}

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
    const callback = getUrlParameter('callback');
    if (!key || !callback) {
        return;
    }

    const id = uuidv4();

    _setSharedSession(id);

    if (callback) {
        const redirectUrl = new URL(callback);
        redirectUrl.searchParams.append('gsSessionId', id);
        window.location.href = redirectUrl.toString();
    }
}