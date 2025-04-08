// imageSearch.js

const ImageSearch = (function() {
    let config = {};
    const SEARCH_PATH = 'catalogo';
    
    function createLoadingIndicator() {
        const loadingIndicator = document.createElement("div");
        loadingIndicator.id = "gopersonal-image-search-loadingIndicator";
        loadingIndicator.style.display = "none";
        loadingIndicator.innerHTML = '<div class="gopersonal-image-search-spinner"></div>';
        return loadingIndicator;
    }

    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #gopersonal-image-search-loadingIndicator {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }
            .gopersonal-image-search-spinner {
                border: 5px solid #f3f3f3;
                border-top: 5px solid #3498db;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: gopersonal-image-search-spin 1s linear infinite;
            }
            @keyframes gopersonal-image-search-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    function init(userConfig = {}) {
        config = { ...userConfig };
        if (!config.startLoading || !config.hideLoading) {
            addStyles();
        }
    }

    async function performImageSearch(file, callback) {
        let loadingIndicator;
        if (config.startLoading) {
            config.startLoading();
        } else {
            loadingIndicator = createLoadingIndicator();
            document.body.appendChild(loadingIndicator);
            loadingIndicator.style.display = "flex";
        }

        const formData = new FormData();
        formData.append("image", file);

        try {
            const search_id = window.gsSDK.getSession().sessionId + '-' + new Date().getTime();
            const appendToURL = window.location.search.includes('gsIncludeDraft=true') ? '&gsIncludeDraft=true' : '';
            
            const opts = { limit: config.limit || 1 };
            const data = await window.gsSDK.imageSearch(formData, opts);

            if (config.hideLoading) {
                config.hideLoading();
            } else if (loadingIndicator) {
                loadingIndicator.style.display = "none";
                document.body.removeChild(loadingIndicator);
            }

            if (data.hits && data.hits.length > 0) {
                const name = data.hits[0].name;
                const searchUrl = `/${SEARCH_PATH}?q=${name}&_gsSearchId=${search_id}${appendToURL}`;
                callback(null, { url: searchUrl, data: data });
            } else {
                callback(null, { data: data });
            }
        } catch (error) {
            if (config.hideLoading) {
                config.hideLoading();
            } else if (loadingIndicator) {
                loadingIndicator.style.display = "none";
                document.body.removeChild(loadingIndicator);
            }
            console.error("Error during image search:", error);
            callback(error);
        }
    }

    return {
        open: function(userConfig = {}, callback) {
            if (!config.initialized) {
                init(userConfig);
                config.initialized = true;
            } else {
                config = { ...config, ...userConfig };
            }

            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";

            input.onchange = async (event) => {
                const file = event.target.files[0];
                if (file) {
                    performImageSearch(file, callback);
                }
            };

            input.click();
        }
    };
})();

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = ImageSearch;
} else {
    window.ImageSearch = ImageSearch;
}