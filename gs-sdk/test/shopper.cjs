const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/api/shopper.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export function mountShopper', 'function mountShopper');

function fixture({ fail = false, embedded = false } = {}) {
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {};
      this.style = { setProperty: (name, value, priority) => { this.style[name] = value; this.style[`${name}Priority`] = priority; } };
      this.contentWindow = { postMessage() {} }; this.hidden = false;
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    appendChild(child) { this.children.push(child); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    remove() { this.removed = true; }
    focus() {}
  }
  const body = new Element('body'); const container = new Element('div'); const listeners = {};
  let calls = 0;
  const context = vm.createContext({ URL, Date, Math, Promise,
    document: { body, createElement: tag => new Element(tag), querySelector: () => container },
    location: { origin: 'https://store.test' },
    window: { addEventListener: (name, handler) => { listeners[name] = handler; }, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {},
    getSession: () => ({ sessionId: 'session-1' }), getApiBaseURL: () => 'https://api.test',
    httpPost: async () => { calls++; if (fail) throw Error('Unavailable'); return { token: 'test', expiresIn: 900, config: { color: '#556ee6' } }; },
  });
  vm.runInContext(`${source}\nglobalThis.mount = mountShopper;`, context);
  const api = context.mount({ widgetUrl: 'https://widget.test/', ...(embedded ? { container: '#embedded' } : {}) });
  const panel = (embedded ? container : body).children[0];
  return { api, panel, iframe: panel.children[1], error: panel.children[0], launcher: body.children[1], calls: () => calls };
}

test('floating shopper stays closed and unloaded despite storefront display overrides', async () => {
  const f = fixture();
  assert.equal(f.calls(), 0); assert.equal(f.iframe.src, undefined);
  assert.equal(f.panel.hidden, true);
  assert.equal(f.panel.style.display, 'none'); assert.equal(f.panel.style.displayPriority, 'important');
  assert.equal(f.iframe.style.display, 'none'); assert.equal(f.iframe.style.displayPriority, 'important');
  assert.equal(f.launcher.attributes['aria-expanded'], 'false');
  await f.api.open();
  assert.equal(f.calls(), 1); assert.equal(f.panel.hidden, false); assert.equal(f.panel.style.display, 'block');
  assert.equal(f.error.style.display, 'none'); assert.equal(f.iframe.style.display, 'block');
  assert.equal(new URL(f.iframe.src).searchParams.get('hostOrigin'), 'https://store.test');
  f.api.close();
  assert.equal(f.panel.style.display, 'none'); assert.equal(f.launcher.attributes['aria-expanded'], 'false');
  await f.api.open(); assert.equal(f.calls(), 1, 'reopening reuses a valid session');
  f.api.destroy(); assert.equal(f.panel.removed, true); assert.equal(f.launcher.removed, true);
});

test('a failed bootstrap shows the error without a blank iframe and can be closed', async () => {
  const f = fixture({ fail: true }); await f.api.open();
  assert.equal(f.calls(), 1); assert.equal(f.error.hidden, false); assert.equal(f.error.style.display, 'block');
  assert.equal(f.iframe.hidden, true); assert.equal(f.iframe.style.display, 'none');
  f.api.close(); assert.equal(f.panel.style.display, 'none');
  await f.api.open(); assert.equal(f.calls(), 2, 'opening again retries bootstrap');
});

test('explicit embedded mode still initializes automatically', async () => {
  const f = fixture({ embedded: true }); await Promise.resolve();
  assert.equal(f.calls(), 1); assert.equal(f.panel.hidden, false); assert.equal(f.panel.style.display, 'block');
  assert.equal(f.launcher, undefined); f.api.destroy();
});
