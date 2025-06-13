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

    const obj = getSession();

    
    if (callback) {
        const redirectUrl = new URL(callback);
        redirectUrl.searchParams.append('gsSessionId', obj.sessionId);
        redirectUrl.searchParams.append('gsCustomerId', obj.vuuid);
        window.location.href = redirectUrl.toString();
    }
}

export const debugSession = () => {
    const key = getUrlParameter('_gsDebugSession');
    setTimeout(async () => {
        const state = window.gsSDK.getState();

        const modalId = 'gs-debug-modal-' + Date.now();
        const modal = document.createElement('div');
        modal.id = modalId;
        modal.innerHTML = `
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 999999;
                display: flex;
                justify-content: center;
                align-items: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <div style="
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
                    max-width: 80%;
                    max-height: 80%;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                ">
                    <div style="
                        padding: 20px;
                        border-bottom: 1px solid #e0e0e0;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background: #f8f9fa;
                    ">
                        <h3 style="margin: 0; color: #333; font-size: 18px; font-weight: 600;">
                            GS SDK Debug Session State
                        </h3>
                        <button onclick="document.getElementById('${modalId}').remove()" style="
                            background: none;
                            border: none;
                            font-size: 24px;
                            cursor: pointer;
                            color: #666;
                            padding: 0;
                            width: 30px;
                            height: 30px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            border-radius: 4px;
                        " onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background='none'">
                            ×
                        </button>
                    </div>
                    <div style="
                        padding: 20px;
                        overflow: auto;
                        flex: 1;
                    ">
                        <pre style="
                            background: #f8f8f8;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            padding: 16px;
                            margin: 0;
                            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                            font-size: 13px;
                            line-height: 1.4;
                            color: #333;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                            max-height: 400px;
                            overflow: auto;
                        ">${JSON.stringify(state, null, 2)}</pre>
                    </div>
                    <div style="
                        padding: 15px 20px;
                        background: #f8f9fa;
                        border-top: 1px solid #e0e0e0;
                        text-align: right;
                    ">
                        <button onclick="document.getElementById('${modalId}').remove()" style="
                            background: #007bff;
                            color: white;
                            border: none;
                            padding: 8px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 14px;
                            font-weight: 500;
                        " onmouseover="this.style.background='#0056b3'" onmouseout="this.style.background='#007bff'">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal.firstElementChild) {
                modal.remove();
            }
        });
    }, 1000);
}