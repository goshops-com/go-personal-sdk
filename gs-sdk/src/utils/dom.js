
export const injectCSS = (css) => {
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

export const addHTMLToDiv = async (html, selector) => {
    const divElement = await selectElementWithRetry(selector);
    if (divElement) {
        divElement.innerHTML = html;
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
        bodyElement.appendChild(scriptElement);
    } else {
        console.error('Body element not found.');
    }
}