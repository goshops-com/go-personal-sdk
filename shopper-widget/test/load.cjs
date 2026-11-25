// Permite requerir los .ts y .tsx del widget desde los tests, transpilándolos con TypeScript.
const fs = require('node:fs');
const ts = require('typescript');

// bridge.ts lee la URL del iframe al cargarse
globalThis.location = globalThis.location || { search: '' };

// Transpila cada .ts/.tsx al requerirlo; los .css del bundle se ignoran.
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    module._compile(outputText, filename);
  };
}
require.extensions['.css'] = () => {};
