import { md5 } from 'pure-md5';

export const injectCSS = (css) => {

    if (!css || css.length == 0){
        return;
    }
    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
}

export const selectElement = (selector) => {
    return document.querySelector(selector);
}

export const selectElementWithRetry = async (selector, maxRetries = 3, backoffFactor = 2, maxBackoffTime = 1000) => {
    const attemptSelect = async () => {
      try {
        return document.querySelector(selector);
      } catch (error) {
        console.error("Error selecting element:", error);
        return null;
      }
    };
  
    let retries = 0;
    let selectedElement = null;
  
    while (retries < maxRetries) {
      selectedElement = await attemptSelect();
      if (selectedElement) {
        break;
      }
  
      retries += 1;
  
      // Exponential backoff
      const backoffTime = Math.min(maxBackoffTime, backoffFactor ** retries);
  
      // Wait for backoffTime milliseconds before next attempt
      await new Promise((resolve) => setTimeout(resolve, backoffTime));
    }
  
    return selectedElement;
  };

export const addHTMLToDiv = async (html, selector, selectorPosition) => {
    const hash = md5(html);
    if (document.querySelector(`[data-hash="${hash}"]`)) {
        console.error(`Element with hash "${hash}" already exists.`);
        return;
    }

    // Attach the hash to your HTML content.
    const htmlWithHash = `<div data-hash="${hash}">${html}</div>`;

    const divElement = await selectElementWithRetry(selector);
    if (divElement) {
        // Check if divElement is an image element
        if (divElement.tagName && divElement.tagName.toLowerCase() === 'img') {
            // Replace the image with the htmlWithHash content
            divElement.outerHTML = htmlWithHash;
        } else {
            switch (selectorPosition) {
                case 'after':
                    divElement.insertAdjacentHTML('afterend', htmlWithHash);
                    break;
                case 'before':
                    divElement.insertAdjacentHTML('beforebegin', htmlWithHash);
                    break;
                default:
                    divElement.innerHTML = htmlWithHash;
            }
        }
    } else {
        console.error(`Element with selector "${selector}" not found.`);
    }
}

export const addHTMLToBody = (html) => {
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
        try{
            bodyElement.appendChild(scriptElement);
        }catch(e){
            console.error(e)
        }
    } else {
        console.error('Body element not found.');
    }
}