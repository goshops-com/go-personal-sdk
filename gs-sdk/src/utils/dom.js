
export const injectCSS = async (css) => {
    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
}

export const selectElement = (selector) => {
    return document.querySelector(selector);
}

export const addHTMLToDiv = async (html, selector) => {
    const divElement = selectElement(selector);
    if (divElement) {
        divElement.innerHTML = html;
    } else {
        console.error(`Element with selector "${selector}" not found.`);
    }
}

export const addHTMLToBody = async (html) => {
    const bodyElement = document.body;
    if (bodyElement) {
        bodyElement.insertAdjacentHTML('beforeend', html);
    } else {
        console.error('Body element not found.');
    }
}

export const addJavaScriptToBody = (jsCode) => {
    const scriptElement = document.createElement('script');
    scriptElement.textContent = jsCode;

    const bodyElement = document.body;
    if (bodyElement) {
        bodyElement.appendChild(scriptElement);
    } else {
        console.error('Body element not found.');
    }
}