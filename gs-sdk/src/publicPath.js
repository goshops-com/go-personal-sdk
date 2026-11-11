// De donde se bajan los chunks que se cargan a demanda (herramientas del admin):
// la misma carpeta de la que salio gs-sdk.js. Si el SDK no se cargo con su
// propio <script> (por ejemplo, empaquetado dentro de otro bundle), se usa el
// CDN. Tiene que ser el primer import de index.js.
const DEFAULT_PUBLIC_PATH = 'https://sdk.gopersonal.ai/';

let publicPath = DEFAULT_PUBLIC_PATH;
try {
  const src = document.currentScript && document.currentScript.src;
  if (src && /\/gs-sdk[^/]*\.js(\?|#|$)/.test(src)) {
    publicPath = src.slice(0, src.lastIndexOf('/') + 1);
  }
} catch (e) {}

// eslint-disable-next-line no-undef
__webpack_public_path__ = publicPath;
