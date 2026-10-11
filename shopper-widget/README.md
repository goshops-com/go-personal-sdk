# Shopper widget

React cliente + AI SDK UI 7, compartido por ecommerce y preview del admin.
Assets estáticos en Cloudflare; backend en Discover. No requiere Next.js.

## Construir

`npm ci` y `npm run build`. `wrangler.jsonc` apunta al directorio `dist` para
Workers Static Assets. Configurar el dominio destino al desplegar; no hay
credenciales de modelo/admin en este bundle.

## Montaje opt-in con SDK

Después de inicializar el SDK normalmente:

```js
const shopper = gsSDK.mountShopper({
  widgetUrl: 'https://DOMINIO_DEL_WIDGET/',
  context: { pageType: 'product', productId: 'sku-123' },
});
shopper.open();
// En una SPA, cuando cambia la página:
shopper.setContext({ pageType: 'search' });
// Al desmontar la integración:
shopper.destroy();
```

Con `{container: '#mi-contenedor'}` se embebe en una sección en vez de mostrar
launcher. El contenedor necesita altura definida. El launcher no inicia requests
ni carga React hasta abrirse. La nueva capacidad no se monta automáticamente.

El SDK recupera bootstrap con su sesión y pasa token shopper limitado al iframe.
`hostOrigin` identifica al host; mensajes requieren ese origin y parent/source
exactos. No poner credenciales en la URL. El SDK conserva conversationId ligado
a su sessionId y renueva credenciales; no depende de cookies de terceros.

El widget renderiza `data-products` como tarjetas y texto como texto seguro;
usa `DefaultChatTransport`, último mensaje y requestId independiente. Imágenes
solo vienen de URLs normalizadas en el backend. PDP se abre con enlace real.
El carrito todavía no tiene una tool de escritura; requiere adapter de plataforma.

Para desarrollar solo UI sin infraestructura usar la fixture en
`../discover-api/test/shopper/fixture.js`, que sirve el build estático y un
runtime con provider simulado.
