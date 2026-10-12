const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const { code } = babel.transformSync(fs.readFileSync(path.join(__dirname, '../src/utils/http.js'), 'utf8'), {
  babelrc: false, configFile: false,
  plugins: [() => ({ visitor: {
    ImportDeclaration(p) { p.remove(); },
    ExportNamedDeclaration(p) { p.replaceWith(p.node.declaration); },
  } })],
});
const http = new Function(code + '\nreturn { configure, getApiBaseURL };')();
assert.equal(http.configure('BR-simple'), 'simple');
assert.equal(http.getApiBaseURL(), 'https://discover.gopersonal.ai');
assert.equal(http.configure('BR-raw-client-with-hyphens', 'https://discover.example/shopper/v1'), 'raw-client-with-hyphens');
assert.equal(http.getApiBaseURL(), 'https://discover.example');
assert.equal(http.configure('LOCAL-local-client'), 'local-client');
assert.equal(http.getApiBaseURL(), 'http://localhost:3000');
assert.throws(() => http.configure('BR-client', 'javascript:alert(1)'), /HTTPS/);
assert.throws(() => http.configure('BR-client', 'https://username:password@discover.example'), /HTTPS/);
console.log('SDK API base: all assertions passed');
