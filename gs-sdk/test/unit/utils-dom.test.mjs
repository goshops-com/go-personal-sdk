import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, setUrl, flush } from './helpers/env.mjs';
import * as dom from '../../src/utils/dom.js';

// Suma de los reintentos por defecto de selectElementWithRetry.
const TOTAL_WAIT = 89700;

beforeEach(() => {
  resetDom();
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  globalThis.MutationObserver = window.MutationObserver;
});

// Deja correr los callbacks del MutationObserver y despues los timers.
async function settle(ms = 0) {
  await flush();
  mock.timers.tick(ms);
  await flush();
}

test('injectCSS appends a <style> on the next tick and ignores empty values', async () => {
  dom.injectCSS(undefined);
  dom.injectCSS('');
  dom.injectCSS('undefined');
  dom.injectCSS('.a{color:red}', 'banner');
  dom.injectCSS('.b{color:blue}');
  assert.equal(document.querySelectorAll('style').length, 0);
  await settle();
  const styles = [...document.head.querySelectorAll('style')];
  assert.equal(styles.length, 2);
  assert.equal(styles[0].id, 'gopersonal-style-banner');
  assert.equal(styles[0].textContent, '.a{color:red}');
  assert.equal(styles[1].id, '');
});

test('selectElement is querySelector', () => {
  document.body.innerHTML = '<div id="a"></div>';
  assert.equal(dom.selectElement('#a'), document.getElementById('a'));
  assert.equal(dom.selectElement('#nope'), null);
});

test('selectElementWithRetry resolves right away when the element exists', async () => {
  document.body.innerHTML = '<div class="slot"></div>';
  assert.equal(await dom.selectElementWithRetry('.slot'), document.querySelector('.slot'));
});

test('selectElementWithRetry resolves as soon as the element is added', async () => {
  let resolved = null;
  dom.selectElementWithRetry('#late').then((element) => { resolved = element; });
  await settle();
  assert.equal(resolved, null);

  const late = document.createElement('div');
  late.id = 'late';
  document.body.appendChild(late);
  await settle(50);
  assert.equal(resolved, late);
});

test('selectElementWithRetry also sees a selector that starts matching by class', async () => {
  document.body.innerHTML = '<div id="box"></div>';
  let resolved = null;
  dom.selectElementWithRetry('#box.ready').then((element) => { resolved = element; });
  await settle();
  document.getElementById('box').classList.add('ready');
  await settle(50);
  assert.equal(resolved, document.getElementById('box'));
});

test('selectElementWithRetry checks at most once per 50ms on a busy page', async () => {
  const querySelector = mock.method(document, 'querySelector');
  dom.selectElementWithRetry('#never');
  await settle();
  querySelector.mock.resetCalls();
  for (let i = 0; i < 20; i++) {
    document.body.appendChild(document.createElement('span'));
    await flush();
  }
  assert.equal(querySelector.mock.callCount(), 0);
  mock.timers.tick(50);
  assert.equal(querySelector.mock.callCount(), 1);
  mock.timers.tick(TOTAL_WAIT);
});

test('selectElementWithRetry gives up with null after the same total wait as before', async () => {
  let resolved = 'pending';
  dom.selectElementWithRetry('#never').then((element) => { resolved = element; });
  await settle(TOTAL_WAIT - 1);
  assert.equal(resolved, 'pending');
  await settle(1);
  assert.equal(resolved, null);
});

test('selectElementWithRetry logs an invalid selector and ends up with null', async () => {
  const error = mock.method(console, 'error', () => {});
  let resolved = 'pending';
  dom.selectElementWithRetry('div[').then((element) => { resolved = element; });
  await settle(TOTAL_WAIT);
  assert.equal(resolved, null);
  assert.ok(error.mock.callCount() >= 1);
});

test('without MutationObserver it falls back to polling with backoff', async () => {
  globalThis.MutationObserver = undefined;
  let resolved = 'pending';
  dom.selectElementWithRetry('#polled').then((element) => { resolved = element; });
  await settle(300);
  assert.equal(resolved, 'pending');
  const polled = document.createElement('div');
  polled.id = 'polled';
  document.body.appendChild(polled);
  await settle(400);
  assert.equal(resolved, polled);

  let missing = 'pending';
  dom.selectElementWithRetry('#missing', 2, 10, 10, 100).then((element) => { missing = element; });
  await settle(20);
  await settle(30);
  assert.equal(missing, null);
});

test('addHTMLToDiv inserts after, before or inside the selector', async () => {
  document.body.innerHTML = '<div id="wrap"><div id="slot">old</div></div>';
  await dom.addHTMLToDiv('<p id="after"></p>', '#slot', 'after');
  await dom.addHTMLToDiv('<p id="before"></p>', '#slot', 'before');
  await dom.addHTMLToDiv('<b>new</b>', '#slot', 'replace');
  assert.deepEqual([...document.getElementById('wrap').children].map((el) => el.id), ['before', 'slot', 'after']);
  assert.equal(document.getElementById('slot').innerHTML, '<b>new</b>');
});

test('addHTMLToDiv replaces an <img> target with the html', async () => {
  document.body.innerHTML = '<div id="wrap"><img id="banner" src="x.png"></div>';
  await dom.addHTMLToDiv('<a id="promo"></a>', '#banner', 'after');
  assert.equal(document.getElementById('wrap').innerHTML, '<a id="promo"></a>');
});

test('addHTMLToDiv logs when the selector never shows up', async () => {
  const error = mock.method(console, 'error', () => {});
  const pending = dom.addHTMLToDiv('<p></p>', '#never', 'after');
  await settle(TOTAL_WAIT);
  await pending;
  assert.match(error.mock.calls.at(-1).arguments[0], /"#never" not found/);
});

test('addHTMLToBody appends on the next tick and resolves once the html is in', async () => {
  await dom.addHTMLToBody(undefined);
  await dom.addHTMLToBody('');
  await dom.addHTMLToBody('undefined');
  assert.equal(document.body.innerHTML, '');

  let done = false;
  dom.addHTMLToBody('<div id="popup"></div>').then(() => { done = true; });
  assert.equal(document.getElementById('popup'), null);
  await settle();
  assert.equal(done, true);
  assert.notEqual(document.getElementById('popup'), null);
});

test('addHTMLToBody and addJavaScriptToBody log when there is no body', async () => {
  const error = mock.method(console, 'error', () => {});
  document.body.remove();
  await dom.addHTMLToBody('<div></div>');
  dom.addJavaScriptToBody('window.__gsRan = true;', 'x');
  await settle();
  assert.equal(error.mock.callCount(), 2);
  assert.equal(window.__gsRan, undefined);
  document.documentElement.appendChild(document.createElement('body'));
});

test('addJavaScriptToBody runs the script on the next frame', async () => {
  dom.addJavaScriptToBody('');
  dom.addJavaScriptToBody('window.__gsCounter = (window.__gsCounter || 0) + 1;', 'counter');
  assert.equal(window.__gsCounter, undefined);
  await settle();
  assert.equal(window.__gsCounter, 1);
  assert.equal(document.getElementById('gopersonal-script-counter').parentNode, document.body);
});

test('a script injected again is wrapped so a redeclaration cannot break the page', async () => {
  const error = mock.method(console, 'error', () => {});
  const code = 'const gsOnce = 1; window.__gsRuns = (window.__gsRuns || 0) + 1;';
  dom.addJavaScriptToBody(code, 'once');
  await settle();
  dom.addJavaScriptToBody(code, 'once');
  await settle();
  assert.equal(window.__gsRuns, 2);
  assert.match(document.querySelectorAll('#gopersonal-script-once')[1].textContent, /^try \{/);

  // Sin id, la clave es el propio codigo; un error adentro queda logueado.
  const failing = 'window.__gsFail = (window.__gsFail || 0) + 1; if (window.__gsFail > 1) throw new Error("boom");';
  dom.addJavaScriptToBody(failing);
  await settle();
  dom.addJavaScriptToBody(failing);
  await settle();
  assert.equal(window.__gsFail, 2);
  assert.equal(error.mock.callCount(), 1);
});

test('deleteGoPersonalElements removes injected html, styles and scripts only', () => {
  document.head.innerHTML = '<style id="gopersonal-style-a"></style><style id="site"></style>';
  document.body.innerHTML = `
    <div data-gopersonal="true" id="reco"></div>
    <div id="keep"></div>
    <script id="gopersonal-script-a" type="text/plain"></script>
    <script id="site-script" type="text/plain"></script>`;
  dom.deleteGoPersonalElements();
  assert.equal(document.getElementById('reco'), null);
  assert.equal(document.getElementById('gopersonal-style-a'), null);
  assert.equal(document.getElementById('gopersonal-script-a'), null);
  for (const id of ['keep', 'site', 'site-script']) {
    assert.notEqual(document.getElementById(id), null, id);
  }
});

test('deleteGoPersonalElements never throws', () => {
  const error = mock.method(console, 'error', () => {});
  mock.method(document, 'querySelectorAll', () => { throw new Error('broken'); });
  dom.deleteGoPersonalElements();
  assert.equal(error.mock.callCount(), 1);
});

test('getUrlParameter decodes the value and returns "" when missing', () => {
  setUrl('https://shop.example/?_gsLog=true&name=a+b%21&arr[0]=x');
  assert.equal(dom.getUrlParameter('_gsLog'), 'true');
  assert.equal(dom.getUrlParameter('name'), 'a b!');
  assert.equal(dom.getUrlParameter('arr[0]'), 'x');
  assert.equal(dom.getUrlParameter('missing'), '');
});

test('removeParamFromUrl strips the param and keeps the router state', () => {
  setUrl('https://shop.example/p?gsImpressionId=1&q=tv');
  window.history.replaceState({ renderRouting: true }, '', window.location.href);
  dom.removeParamFromUrl('gsImpressionId');
  assert.equal(window.location.href, 'https://shop.example/p?q=tv');
  assert.deepEqual(window.history.state, { renderRouting: true });

  const replaceState = mock.method(window.history, 'replaceState');
  dom.removeParamFromUrl('notThere');
  assert.equal(replaceState.mock.callCount(), 0);
});
