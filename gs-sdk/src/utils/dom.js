import { md5 } from 'pure-md5';

export const injectCSS = (css, id = undefined) => {
    if (css == undefined || css == "" || css == "undefined") {
        return; // Ignore and exit the function
    }

    (async () => {
        await new Promise(resolve => setTimeout(resolve, 0)); // Yield control to the UI thread
        const styleElement = document.createElement('style');
        if (id) {
            styleElement.id = `gopersonal-style-${id}`;
        }
        styleElement.textContent = css;
        document.head.appendChild(styleElement);
    })();
};


export const selectElement = (selector) => {
    return document.querySelector(selector);
}

export const selectElementWithRetry = async (
    selector, 
    maxRetries = 40, 
    initialBackoffTime = 200,  // Starting delay
    backoffIncrement = 100,     // Increment for each retry
    maxBackoffTime = 4 * 1000   // Cap for backoff time
) => {
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

        // Linear backoff
        const backoffTime = Math.min(maxBackoffTime, initialBackoffTime + backoffIncrement * retries);

        // Wait for backoffTime milliseconds before next attempt
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
    }

    return selectedElement;
};

export const addHTMLToDiv = async (html, selector, selectorPosition, options = {}) => {
    const hash = `element:${selector}-hash:${md5(html)}`;

    const divElement = await selectElementWithRetry(selector);
    if (divElement) {

        // Check if divElement is an image element
        if (divElement.tagName && divElement.tagName.toLowerCase() === 'img') {
            // Replace the image with the htmlWithHash content
            divElement.outerHTML = html;
        } else {
            switch (selectorPosition) {
                case 'after':
                    divElement.insertAdjacentHTML('afterend', html);
                    break;
                case 'before':
                    divElement.insertAdjacentHTML('beforebegin', html);
                    break;
                default:
                    divElement.innerHTML = html;
            }
        }
    } else {
        console.error(`Element with selector "${selector}" not found.`);
    }
}

export const addHTMLToBody = (html) => {
    // Check if html is undefined, an empty string, or the string "undefined"
    if (html == undefined || html == "" || html == "undefined") {
        return; // Ignore and exit the function
    }

    const bodyElement = document.body;
    if (bodyElement) {
        (async () => {
            await new Promise(resolve => setTimeout(resolve, 0)); // Yield control to the UI thread
            bodyElement.insertAdjacentHTML('beforeend', html);
        })();
    } else {
        console.error('Body element not found.');
    }
};

export const addJavaScriptToBody = (jsCode, id = undefined) => {
    if (!jsCode) {
        return; // Ignore and exit the function
    }

    const scriptElement = document.createElement('script');
    if (id) {
        scriptElement.id = `gopersonal-script-${id}`;
    }
    scriptElement.textContent = jsCode;

    const bodyElement = document.body;
    if (bodyElement) {
        try {
            requestAnimationFrame(() => {
                bodyElement.appendChild(scriptElement);
            });
        } catch (e) {
            console.error('Error appending script:', e);
        }
    } else {
        console.error('Body element not found.');
    }
}


export const deleteGoPersonalElements = () => {
    //reco-home
    try {
        // Find all elements with the attribute data-gopersonal matching the specified id
        const htmlElements = document.querySelectorAll(`[data-gopersonal="true"]`);

        // Loop through the found elements and remove them
        htmlElements.forEach(element => {
            element.remove();
        });

        const elements = document.querySelectorAll('style, script');

        // Iterate through the selected elements
        elements.forEach(element => {
            // Check if the element's ID starts with "gopersonal-style-" or "gopersonal-script-"
            if (element.id.startsWith('gopersonal-style-') || element.id.startsWith('gopersonal-script-')) {
                element.parentNode.removeChild(element);
            }
        });

    } catch (e) {
        console.error(e);
    }
}

export const getUrlParameter = (name) => {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

export const removeParamFromUrl = (param) => {
    const url = new URL(window.location);
    url.searchParams.delete(param);
    window.history.replaceState({}, document.title, url.toString());
}