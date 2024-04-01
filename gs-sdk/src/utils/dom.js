import { md5 } from 'pure-md5';

export const injectCSS = (css, id = undefined) => {
    if (css == undefined || css == "" || css == "undefined") {
        return; // Ignore and exit the function
    }

    const styleElement = document.createElement('style');
    if (id) {
        styleElement.id = `gopersonal-style-${id}`;
    }
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
}

export const selectElement = (selector) => {
    return document.querySelector(selector);
}

export const selectElementWithRetry = async (selector, maxRetries = 10, backoffFactor = 2, maxBackoffTime = 4 * 1000) => {
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

export const addHTMLToDiv = async (html, selector, selectorPosition, options = {}) => {
    const hash = `element:${selector}-hash:${md5(html)}`;
    // if (document.querySelector(`[data-hash="${hash}"]`)) {
    //     console.error(`Element with hash "${hash}" already exists.`);
    //     return;
    // }

    // Create the invisible div with the hash attribute and no inner HTML
    const divElement = await selectElementWithRetry(selector);
    if (divElement) {
        // Idea is to mark this DOM so we don't add the same element again
        // const invisibleDiv = document.createElement('div');
        // invisibleDiv.style.display = 'none'; // Make it invisible
        // invisibleDiv.setAttribute('data-hash', hash);
        // document.body.appendChild(invisibleDiv);

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
        bodyElement.insertAdjacentHTML('beforeend', html);
    } else {
        console.error('Body element not found.');
    }
}

export const addJavaScriptToBody = (jsCode, id = undefined) => {
    if (jsCode == undefined || jsCode == "" || jsCode == "undefined") {
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
            bodyElement.appendChild(scriptElement);
        } catch (e) {
            console.error(e)
        }
    } else {
        console.error('Body element not found.');
    }
}


export const deleteGoPersonalElements = () => {
    //reco-home
    try {
        console.log('Remove ', `[data-gopersonal="true"]`);

        // Find all elements with the attribute data-gopersonal matching the specified id
        const htmlElements = document.querySelectorAll(`[data-gopersonal="true"]`);

        // Loop through the found elements and remove them
        htmlElements.forEach(element => {
            element.remove();
        });

        let count = 0;

        const elements = document.querySelectorAll('style, script');

        // Iterate through the selected elements
        elements.forEach(element => {
            // Check if the element's ID starts with "gopersonal-style-" or "gopersonal-script-"
            if (element.id.startsWith('gopersonal-style-') || element.id.startsWith('gopersonal-script-')) {
                // Remove the element from the document
                count++
                element.parentNode.removeChild(element);
            }
        });
        console.log("Removed", count, "Elements");

    } catch (e) {
        console.error(e);
    }
}