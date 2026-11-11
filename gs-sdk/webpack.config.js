const path = require('path');

// Navegadores con async/await y generators nativos: sin esto Babel baja todo a
// ES5 y mete una copia del runtime de generators en cada modulo.
const targets = { chrome: '64', edge: '79', firefox: '67', safari: '12', ios: '12', samsung: '9' };

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'gs-sdk.js',
    // Chunks que se bajan a demanda (herramientas del admin). Sin hash: un
    // gs-sdk.js viejo todavia en cache tiene que seguir encontrandolos.
    chunkFilename: 'gs-sdk-[name].js',
    // Se resuelve en runtime, ver src/publicPath.js.
    publicPath: '',
    chunkLoadingGlobal: 'gsSdkChunks',
    library: 'GSSDK',
    libraryTarget: 'window',
    // globalObject: 'this',
    umdNamedDefine: true
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /(node_modules)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [['@babel/preset-env', { targets }]]
          }
        }
      }
    ]
  },
};
