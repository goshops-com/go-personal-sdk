import assert from 'node:assert/strict';
import test, { beforeEach, afterEach, mock } from 'node:test';
import { resetDom, setUrl } from './helpers/env.mjs';
import {
  initElementSelectorPicker,
  showElementSelectorPicker,
  hideElementSelectorPicker,
} from '../../src/utils/elementSelectorPicker.js';

const P = 'gopersonal-element-selector-picker-';
const ROOT_CLASS = P + 'root-active';
const BTN_ACTIVE_CLASS = P + 'panel-btn-active';
const BAR_BOTTOM_CLASS = P + 'bar-bottom';

const TEXT_REPLACE = 'El contenido dinámico va a reemplazar este elemento';
const TEXT_ADD = 'El contenido dinámico se va a agregar acá';

// jsdom has no layout: hit-testing is stubbed. `stack` is what the browser
// would return from elementsFromPoint (topmost first).
let stack = [];
let warn;
let opener;

const bar = () => document.querySelector('.' + P + 'bar');
const panel = () => document.querySelector('.' + P + 'panel');
const box = () => document.querySelector('.' + P + 'highlight-box');
const label = () => document.querySelector('.' + P + 'highlight-label');
const placement = () => document.querySelector('.' + P + 'placement-label');
const select = () => bar().querySelector('select');
const dockButton = () => bar().querySelectorAll('.' + P + 'bar-close button')[0];
const closeButton = () => bar().querySelectorAll('.' + P + 'bar-close button')[1];
const modeButton = (mode) => panel().querySelector(`[data-mode="${mode}"]`);
const $ = (selector) => document.body.querySelector(selector);

function rect(el, top, left, width, height) {
  el.getBoundingClientRect = () => ({ top, left, width, height, right: left + width, bottom: top + height });
  return el;
}

function ancestors(el) {
  const list = [];
  for (let node = el; node; node = node.parentElement) list.push(node);
  return list;
}

function click(el, { at } = {}) {
  stack = at || ancestors(el);
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  el.dispatchEvent(event);
  return event;
}

function move(el, { at } = {}) {
  stack = at || (el ? ancestors(el) : []);
  document.body.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
}

function setFixture() {
  document.body.innerHTML =
    '<header class="site-header main"><nav><a class="link" href="#a">A</a><a class="link" href="#b">B</a></nav></header>' +
    '<main id="content">' +
    '<section class="hero"><h1 id=" title ">Title</h1><div id="gopersonal_home"></div></section>' +
    '<section class="grid w-1/2"><article>one</article><article>two</article></section>' +
    '</main>';
  rect($('header'), 0, 0, 1000, 80);
  rect($('nav'), 0, 0, 500, 80);
  document.body.querySelectorAll('a').forEach((a, i) => rect(a, 30, i * 60, 50, 20));
  rect($('main'), 80, 0, 1000, 900);
  rect($('.hero'), 80, 0, 1000, 300);
  rect($('h1'), 100, 10, 400, 50);
  rect($('#gopersonal_home'), 200, 0, 1000, 14);
  rect($('.grid'), 380, 0, 1000, 600);
  document.body.querySelectorAll('article').forEach((a, i) => rect(a, 380, i * 500, 500, 600));
}

function stubWindowProp(name, value) {
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
}

function recordingWindow() {
  const messages = [];
  return { messages, postMessage: (message, origin) => messages.push({ message, origin }) };
}

const lastPayload = () => opener.messages.at(-1).message.payload;

beforeEach(() => {
  hideElementSelectorPicker();
  resetDom();
  setFixture();
  stack = [];
  document.elementsFromPoint = () => stack;
  document.elementFromPoint = () => stack[0] || null;
  warn = mock.method(console, 'warn', () => {});
  mock.method(console, 'log', () => {});
  opener = recordingWindow();
  stubWindowProp('opener', opener);
  stubWindowProp('parent', window);
});

afterEach(() => {
  hideElementSelectorPicker();
  delete document.elementsFromPoint;
  delete document.elementFromPoint;
  mock.restoreAll();
});

// --- init: these two tests must run first (the module mounts only once) -----

test('initElementSelectorPicker is a no-op without ?gsSelectElementSelector=true', () => {
  initElementSelectorPicker();
  setUrl('https://shop.example/?gsSelectElementSelector=1');
  initElementSelectorPicker();
  assert.equal(bar(), null);
  assert.equal(panel(), null);
  assert.equal(window.gsShowElementSelectorPicker, undefined);
});

test('initElementSelectorPicker waits for DOMContentLoaded and starts with the position from the URL', () => {
  setUrl('https://shop.example/?gsSelectElementSelector=true&gsSelectorPosition=%20AFTER%20');
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
  try {
    initElementSelectorPicker();
  } finally {
    delete document.readyState;
  }
  assert.equal(bar(), null, 'not shown while the document is loading');
  assert.equal(window.gsShowElementSelectorPicker, showElementSelectorPicker);
  assert.equal(window.gsHideElementSelectorPicker, hideElementSelectorPicker);

  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.ok(bar());
  assert.ok(panel());
  assert.equal(select().value, 'after');
  assert.ok(document.body.classList.contains(ROOT_CLASS));

  click($('h1'));
  assert.equal(lastPayload().position, 'after');

  // Already mounted: a second init does not restart the picker.
  hideElementSelectorPicker();
  initElementSelectorPicker();
  assert.equal(bar(), null);

  // Leave the default position for the rest of the file.
  showElementSelectorPicker();
  select().value = 'replace';
  select().dispatchEvent(new window.Event('change', { bubbles: true }));
});

// --- UI ---------------------------------------------------------------------

test('showElementSelectorPicker builds the bar, the mode panel and the styles', () => {
  showElementSelectorPicker();
  assert.ok(document.getElementById(P + 'styles'));
  assert.ok(document.body.classList.contains(ROOT_CLASS));

  assert.equal(bar().parentNode, document.documentElement);
  assert.equal(bar().getAttribute('data-gopersonal-picker-ui'), 'true');
  assert.equal(bar().querySelector('.' + P + 'bar-text span').textContent, 'Apuntá y hacé click en el elemento — el contenido va a');
  assert.deepEqual(
    [...select().options].map((o) => [o.value, o.textContent]),
    [['replace', 'reemplazarlo'], ['after', 'ir después'], ['before', 'ir antes']],
  );
  assert.equal(select().value, 'replace');
  assert.ok(bar().classList.contains(BAR_BOTTOM_CLASS), 'docked at the bottom by default');
  assert.equal(dockButton().textContent, '↑');
  assert.equal(dockButton().title, 'Mover barra arriba');

  assert.deepEqual(
    [...panel().querySelectorAll('button')].map((b) => [b.getAttribute('data-mode'), b.textContent, b.classList.contains(BTN_ACTIVE_CLASS)]),
    [['select', 'Seleccionar', true], ['interact', 'Interactuar', false]],
  );

  // Calling it again rebuilds the UI instead of duplicating it.
  showElementSelectorPicker();
  assert.equal(document.querySelectorAll('.' + P + 'bar').length, 1);
  assert.equal(document.querySelectorAll('.' + P + 'panel').length, 1);
});

test('hovering highlights the smallest element under the pointer and labels it', () => {
  showElementSelectorPicker();
  move($('article'));
  assert.equal(box().style.display, 'block');
  assert.equal(box().style.top, '380px');
  assert.equal(box().style.left, '0px');
  assert.equal(box().style.width, '500px');
  assert.equal(box().style.height, '600px');
  assert.equal(label().textContent, '#content > section.grid.w-1\\/2:nth-of-type(2) > article:nth-of-type(1)');
  assert.equal(label().style.top, '-18px', 'label above the box when there is room');
  assert.equal(placement().textContent, TEXT_REPLACE);
  assert.equal(placement().style.bottom, '0px');

  // Elements with an id are labelled by it; near the top the label moves inside.
  rect($('h1'), 5, 10, 400, 50);
  move($('h1'));
  assert.equal(label().textContent, '#title');
  assert.equal(label().style.top, '0px');

  // The hit-test order does not matter: the smallest area wins, zero-area nodes are skipped.
  const zero = rect($('.hero'), 80, 0, 0, 300);
  move(null, { at: [$('main'), zero, $('nav'), $('header'), $('nav')] });
  assert.equal(label().textContent, 'body > header.site-header.main > nav');

  // Nothing pickable (only body/html, or nothing at all): the box hides.
  move(null, { at: [document.body, document.documentElement] });
  assert.equal(box().style.display, 'none');
  move($('article'));
  assert.equal(box().style.display, 'block');
  move(null);
  assert.equal(box().style.display, 'none');
});

test('the picker UI itself is never highlighted', () => {
  showElementSelectorPicker();
  move($('article'));
  assert.equal(box().style.display, 'block');
  move(null, { at: [select(), bar(), $('article')] });
  assert.equal(box().style.display, 'none');

  move($('article'));
  move(null, { at: [modeButton('interact'), panel(), $('article')] });
  assert.equal(box().style.display, 'none');

  // The highlight box and its labels are ignored as hit-test results.
  move(null, { at: [box(), label(), placement(), $('nav')] });
  assert.equal(label().textContent, 'body > header.site-header.main > nav');
});

test('falls back to elementFromPoint when elementsFromPoint is missing', () => {
  showElementSelectorPicker();
  delete document.elementsFromPoint;
  document.elementsFromPoint = undefined;
  move($('h1'));
  assert.equal(label().textContent, '#title');
  click($('h1'));
  assert.equal(lastPayload().tag, 'H1');
  assert.equal(lastPayload().id, ' title ');
  assert.match(lastPayload().selector, /#\\ title\\ $/, 'the id is CSS-escaped');
});

test('clicking an element posts its selector to the opener and swallows the click', () => {
  showElementSelectorPicker();
  const second = document.body.querySelectorAll('a')[1];
  let pageHandlerRan = false;
  second.addEventListener('click', () => { pageHandlerRan = true; });

  const event = click(second);
  assert.equal(event.defaultPrevented, true);
  assert.equal(pageHandlerRan, false, 'the page never sees the click');
  assert.equal(opener.messages.length, 1);
  assert.equal(opener.messages[0].origin, '*');
  assert.deepEqual(opener.messages[0].message, {
    namespace: 'gopersonal',
    source: 'preview',
    type: 'elementSelectorPicked',
    payload: {
      selector: 'body > header.site-header.main > nav > a.link:nth-of-type(2)',
      tag: 'A',
      id: undefined,
      className: 'link',
      position: 'replace',
    },
  });
  assert.equal(document.querySelector(lastPayload().selector), second);

  // Empty anchors with an id are the usual target.
  click($('#gopersonal_home'));
  // The selector stops at the nearest id, wherever that element is in the page.
  assert.deepEqual(lastPayload(), { selector: '#gopersonal_home', tag: 'DIV', id: 'gopersonal_home', className: undefined, position: 'replace' });
  assert.equal(document.querySelector(lastPayload().selector), $('#gopersonal_home'));

  // The click target is used even when hit-testing does not report it.
  click($('article'), { at: [] });
  assert.equal(lastPayload().selector, '#content > section.grid.w-1\\/2:nth-of-type(2) > article:nth-of-type(1)');

  // Nothing pickable under the pointer: the click goes through.
  const through = click(document.body, { at: [document.body] });
  assert.equal(through.defaultPrevented, false);
  assert.equal(opener.messages.length, 3);
});

test('SVG elements (className is an SVGAnimatedString) get a usable selector', () => {
  showElementSelectorPicker();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon big');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.appendChild(path);
  $('nav').appendChild(svg);
  rect(svg, 0, 200, 20, 20);
  rect(path, 0, 200, 10, 10);

  click(path);
  assert.deepEqual(lastPayload(), {
    selector: 'body > header.site-header.main > nav > svg.icon.big > path',
    tag: 'path',
    id: undefined,
    className: undefined,
    position: 'replace',
  });
  click(svg, { at: [svg] });
  assert.equal(lastPayload().className, 'icon big');
  assert.equal(document.querySelector(lastPayload().selector), svg);
});

test('falls back to window.parent, and survives a missing or throwing target window', () => {
  showElementSelectorPicker();
  const parent = recordingWindow();
  stubWindowProp('opener', null);
  stubWindowProp('parent', parent);
  click($('h1'));
  assert.equal(parent.messages.length, 1);
  assert.equal(parent.messages[0].message.type, 'elementSelectorPicked');

  stubWindowProp('parent', window);
  const event = click($('h1'));
  assert.equal(event.defaultPrevented, true);
  assert.equal(warn.mock.calls.at(-1).arguments[0], '[gs-sdk][elementSelectorPicker] No parent/opener window found');

  stubWindowProp('opener', { postMessage() { throw new Error('closed'); } });
  click($('h1'));
  assert.equal(warn.mock.calls.at(-1).arguments[0], '[gs-sdk][elementSelectorPicker] postMessage failed:');
});

test('the position combo changes where the content goes and travels in the payload', () => {
  showElementSelectorPicker();
  move($('h1'));

  const choose = (value) => {
    select().value = value;
    const event = new window.Event('change', { bubbles: true });
    let leaked = false;
    const listener = () => { leaked = true; };
    document.addEventListener('change', listener);
    select().dispatchEvent(event);
    document.removeEventListener('change', listener);
    assert.equal(leaked, false, 'change does not bubble into the page');
  };

  choose('after');
  assert.equal(placement().textContent, TEXT_ADD);
  assert.equal(placement().style.top, '100%');
  assert.equal(placement().style.bottom, 'auto');
  click($('h1'));
  assert.equal(lastPayload().position, 'after');

  choose('before');
  assert.equal(placement().textContent, TEXT_ADD);
  assert.equal(placement().style.top, '-14px');
  click($('h1'));
  assert.equal(lastPayload().position, 'before');

  // The choice survives closing and reopening the picker.
  hideElementSelectorPicker();
  showElementSelectorPicker();
  assert.equal(select().value, 'before');

  choose('replace');
  move($('h1'));
  assert.equal(placement().textContent, TEXT_REPLACE);
  assert.equal(placement().style.top, 'auto');
  assert.equal(placement().style.bottom, '0px');
  click($('h1'));
  assert.equal(lastPayload().position, 'replace');
});

test('clicking the combo (not the select) opens the native dropdown, or focuses it when showPicker is unavailable', () => {
  showElementSelectorPicker();
  const caret = bar().querySelector('.' + P + 'bar-caret');

  let opened = 0;
  select().showPicker = () => { opened += 1; };
  const event = click(caret);
  assert.equal(opened, 1);
  assert.equal(event.defaultPrevented, true);

  // Clicking the select itself is left to the browser.
  const onSelect = click(select());
  assert.equal(opened, 1);
  assert.equal(onSelect.defaultPrevented, false);

  select().showPicker = () => { throw new Error('NotAllowedError'); };
  assert.notEqual(document.activeElement, select());
  click(caret);
  assert.equal(document.activeElement, select());

  assert.equal(opener.messages.length, 0, 'bar clicks are never picked');
});

test('the dock button moves the bar between bottom and top', () => {
  showElementSelectorPicker();
  const event = click(dockButton());
  assert.equal(event.defaultPrevented, true);
  assert.equal(bar().classList.contains(BAR_BOTTOM_CLASS), false);
  assert.equal(dockButton().textContent, '↓');
  assert.equal(dockButton().getAttribute('aria-label'), 'Mover barra abajo');
  assert.equal(dockButton().title, 'Mover barra abajo');

  click(dockButton());
  assert.ok(bar().classList.contains(BAR_BOTTOM_CLASS));
  assert.equal(dockButton().textContent, '↑');
  assert.equal(dockButton().getAttribute('aria-label'), 'Mover barra arriba');

  // Reopening goes back to the default dock.
  click(dockButton());
  hideElementSelectorPicker();
  showElementSelectorPicker();
  assert.ok(bar().classList.contains(BAR_BOTTOM_CLASS));
  assert.equal(opener.messages.length, 0);
});

test('"Interactuar" lets the page work normally; "Seleccionar" resumes picking', () => {
  showElementSelectorPicker();
  move($('h1'));
  assert.equal(box().style.display, 'block');

  const event = click(modeButton('interact'));
  assert.equal(event.defaultPrevented, true);
  assert.ok(modeButton('interact').classList.contains(BTN_ACTIVE_CLASS));
  assert.equal(modeButton('select').classList.contains(BTN_ACTIVE_CLASS), false);
  assert.equal(document.body.classList.contains(ROOT_CLASS), false);
  assert.equal(box().style.display, 'none', 'highlight cleared');

  move($('h1'));
  assert.equal(box().style.display, 'none');
  let pageClicks = 0;
  $('a').addEventListener('click', () => { pageClicks += 1; });
  const pageClick = click($('a'));
  assert.equal(pageClicks, 1);
  assert.equal(pageClick.defaultPrevented, false);
  assert.equal(opener.messages.length, 0);

  click(modeButton('select'));
  assert.ok(modeButton('select').classList.contains(BTN_ACTIVE_CLASS));
  assert.ok(document.body.classList.contains(ROOT_CLASS));
  move($('h1'));
  assert.equal(box().style.display, 'block');
  click($('a'));
  assert.equal(pageClicks, 1);
  assert.equal(opener.messages.length, 1);
});

test('scroll and resize keep the highlight on the element, or drop it when the element is gone', () => {
  showElementSelectorPicker();
  const title = $('h1');
  move(title);
  assert.equal(box().style.top, '100px');

  rect(title, 40, 10, 400, 50);
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(box().style.top, '40px');

  rect(title, 60, 10, 300, 50);
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(box().style.top, '60px');
  assert.equal(box().style.width, '300px');

  title.remove();
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(box().style.display, 'none');
});

test('the close button tears the picker down and closes the preview window', () => {
  showElementSelectorPicker();
  move($('h1'));
  const close = mock.method(window, 'close', () => {});
  const event = click(closeButton());
  assert.equal(event.defaultPrevented, true);
  assert.equal(close.mock.callCount(), 1);
  assert.equal(bar(), null);
  assert.equal(panel(), null);
  assert.equal(box(), null);
  assert.equal(document.body.classList.contains(ROOT_CLASS), false);

  // Listeners are gone: the page gets its clicks back.
  const after = click($('h1'));
  assert.equal(after.defaultPrevented, false);
  assert.equal(opener.messages.length, 0);

  // A window that cannot be closed by script does not break the teardown.
  showElementSelectorPicker();
  mock.method(window, 'close', () => { throw new Error('not script-closable'); });
  click(closeButton());
  assert.equal(bar(), null);
});

test('hideElementSelectorPicker is safe to call when nothing is shown', () => {
  hideElementSelectorPicker();
  hideElementSelectorPicker();
  assert.equal(bar(), null);
  assert.equal(document.body.classList.contains(ROOT_CLASS), false);
});
