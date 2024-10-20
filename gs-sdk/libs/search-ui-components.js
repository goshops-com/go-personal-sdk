// audioSearch.js

const AudioSearch = (function() {
    let overlay, mediaRecorder, isRecording, audioChunks, timeout;
    let config = {};  // Store the configuration
  
    function removeSpecialCharsAndSpaces(str) {
      return str.replace(/[^a-zA-Z0-9 ]/g, '');
    }
  
    function createOverlay() {
      overlay = document.createElement('div');
      overlay.id = 'gopersonal-audio-search-voiceSearchOverlay';
      overlay.style.display = 'none';
      overlay.innerHTML = `
        <div class="gopersonal-audio-search-modal">
          <div class="gopersonal-audio-search-modal-header">
            <h2>Búsqueda por voz</h2>
            <span id="gopersonal-audio-search-closeVoiceSearch">&times;</span>
          </div>
          <div class="gopersonal-audio-search-modal-body">
            <p>Presiona el botón para comenzar a grabar. Puedes grabar hasta 5 segundos.</p>
            <div id="gopersonal-audio-search-voiceMicContainer">
              <div class="gopersonal-audio-search-circle">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 512" width="30" height="30"><path d="M176 352c53.02 0 96-42.98 96-96V96c0-53.02-42.98-96-96-96S80 42.98 80 96v160c0 53.02 42.98 96 96 96zm160-160h-16c-8.84 0-16 7.16-16 16v48c0 74.8-64.49 134.82-140.79 127.38C96.71 376.89 48 317.11 48 250.3V208c0-8.84-7.16-16-16-16H16c-8.84 0-16 7.16-16 16v40.16c0 89.64 63.97 169.55 152 181.69V464H96c-8.84 0-16 7.16-16 16v16c0 8.84 7.16 16 16 16h160c8.84 0 16-7.16 16-16v-16c0-8.84-7.16-16-16-16h-56v-33.77C285.71 418.47 352 344.9 352 256v-48c0-8.84-7.16-16-16-16z"/></svg>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
  
    function addStyles() {
      const style = document.createElement('style');
      style.textContent = `
        #gopersonal-audio-search-voiceSearchOverlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .gopersonal-audio-search-modal {
          background-color: white;
          padding: 20px;
          border-radius: 5px;
          width: 80%;
          max-width: 500px;
        }
        .gopersonal-audio-search-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #gopersonal-audio-search-closeVoiceSearch {
          cursor: pointer;
          font-size: 24px;
        }
        #gopersonal-audio-search-voiceMicContainer {
          display: flex;
          justify-content: center;
          margin-top: 20px;
        }
        .gopersonal-audio-search-circle {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: #ffffff;
          display: flex;
          justify-content: center;
          align-items: center;
          box-shadow: 0 6px 10px 0 rgba(0, 0, 0, .14);
          cursor: pointer;
          transition: all 0.3s ease;
        }
        .gopersonal-audio-search-circle.gopersonal-audio-search-active {
          background: #ff0000;
          animation: gopersonal-audio-search-pulse 1.5s infinite;
        }
        .gopersonal-audio-search-circle svg {
          fill: #b2b1b1;
          transition: all 0.3s ease;
        }
        .gopersonal-audio-search-circle.gopersonal-audio-search-active svg {
          fill: #ffffff;
        }
        @keyframes gopersonal-audio-search-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        .gopersonal-audio-search-fa-spin {
          animation: gopersonal-audio-search-spin 1s linear infinite;
        }
        @keyframes gopersonal-audio-search-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  
    async function toggleRecording(callback) {
      const micContainer = document.getElementById('gopersonal-audio-search-voiceMicContainer');
      if (isRecording) {
        mediaRecorder.stop();
      } else {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(function () {
          if (isRecording) {
            micContainer.click();
          }
        }, 5 * 1000);
  
        micContainer.querySelector(".gopersonal-audio-search-circle").classList.add("gopersonal-audio-search-active");
  
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];
  
          mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
          };
  
          mediaRecorder.onstop = async () => {
            micContainer.querySelector(".gopersonal-audio-search-circle").classList.remove("gopersonal-audio-search-active");
            micContainer.querySelector(".gopersonal-audio-search-circle svg").classList.add("gopersonal-audio-search-fa-spin");
  
            const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
            const audioFile = new File([audioBlob], "grabacion_audio.wav", { type: "audio/wav" });
            const formData = new FormData();
            formData.append("file", audioFile);
  
            try {
              // Use the config.limit in the SDK call
              const sdkOptions = { type: 'voice', ...config };
              const data = await window.gsSDK.voiceSearch(formData, sdkOptions);
              let query = removeSpecialCharsAndSpaces(data.query);
              callback(data);
            } catch (error) {
              console.error("Error during voice search:", error);
              callback(null, error);
            }
  
            isRecording = false;
            overlay.style.display = "none";
            micContainer.querySelector(".gopersonal-audio-search-circle svg").classList.remove("gopersonal-audio-search-fa-spin");
          };
  
          mediaRecorder.start(1000);
          isRecording = true;
        } catch (error) {
          console.error("Error accessing microphone:", error);
          micContainer.querySelector(".gopersonal-audio-search-circle").classList.remove("gopersonal-audio-search-active");
          callback(null, error);
        }
      }
    }
  
    function init(userConfig = {}) {
      config = { ...userConfig };  // Store the user configuration
      createOverlay();
      addStyles();
  
      document.getElementById('gopersonal-audio-search-voiceMicContainer').addEventListener('click', () => toggleRecording());
      document.getElementById('gopersonal-audio-search-closeVoiceSearch').addEventListener('click', () => {
        overlay.style.display = 'none';
        if (isRecording) {
          toggleRecording();
        }
      });
    }
  
    return {
        open: function(userConfig = {}, callback) {
          if (!overlay) {
            init(userConfig);
          } else {
            // Update config even if overlay exists
            config = { ...config, ...userConfig };
          }
          overlay.style.display = 'flex';
          document.getElementById('gopersonal-audio-search-voiceMicContainer').onclick = () => toggleRecording(callback);
        }
    };
  })();
  
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = AudioSearch;
  } else {
    window.AudioSearch = AudioSearch;
  }

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