
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