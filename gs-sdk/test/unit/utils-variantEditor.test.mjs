import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, mock } from 'node:test';
import { resetDom, setUrl, flush } from './helpers/env.mjs';
import { initVariantEditor } from '../../src/utils/variantEditor.js';

// The module keeps a `mounted` flag and the FAB lives in <body>, so the page is
// reset only once and the tests run in order, each one leaving the editor
// closed (FAB back in "Edit variant" mode).

const FAB_ID = 'gopersonal-edit-variant-fab';
const BAR_ID = 'gopersonal-edit-variant-fab-bar';
const ROOT_CLASS = 'gopersonal-selector-picker-root-active';
const HIGHLIGHT_CLASS = 'gopersonal-selector-picker-highlight';
const OVERLAY_SELECTOR = '.gopersonal-selector-picker-overlay';

let pointTarget = null;
let warn;

const fab = () => document.getElementById(FAB_ID);
const root = () => document.getElementById('fixture-root');
const drawer = () => document.querySelector('.gp-text-drawer-root');
const overlay = () => document.querySelector(OVERLAY_SELECTOR);
const $ = (selector) => root().querySelector(selector);

// jsdom has no layout, so document.elementFromPoint is stubbed to return the
// element the pointer event is aimed at (what a browser would hit-test).
function click(el) {
  pointTarget = el;
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  el.dispatchEvent(event);
  return event;
}

const pick = click;

function move(el) {
  pointTarget = el;
  document.body.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
}

function setFixture() {
  const previous = document.getElementById('fixture');
  if (previous) previous.remove();
  const fixture = document.createElement('div');
  fixture.id = 'fixture';
  fixture.innerHTML =
    '<p id="outside">outside</p>' +
    '<div data-gopersonal="true" data-variant="other"><p>other variant</p></div>' +
    '<div id="fixture-root" data-opersonal="true" data-variant="v1">' +
    '<h2 class="title big">Hello</h2>' +
    '<div class="box md:flex">' +
    '<img id="hero" class="pic">' +
    '<input class="name" type="text" value="abc">' +
    '<input class="check" type="checkbox">' +
    '<textarea class="notes">notes</textarea>' +
    '<p>one</p><p>two</p>' +
    '</div>' +
    '</div>';
  document.body.appendChild(fixture);
}

function stubWindowProp(name, value) {
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
}

function recordingWindow() {
  const messages = [];
  return { messages, postMessage: (message, origin) => messages.push({ message, origin }) };
}

before(() => {
  resetDom();
  document.elementFromPoint = () => pointTarget;
});

beforeEach(() => {
  setFixture();
  pointTarget = null;
  warn = mock.method(console, 'warn', () => {});
  stubWindowProp('opener', null);
  stubWindowProp('parent', window);
});

afterEach(() => {
  mock.restoreAll();
});

test('initVariantEditor is a no-op without ?gsPreviewVariant', () => {
  initVariantEditor();
  assert.equal(fab(), null);
  assert.equal(window.gsShowSelectorPicker, undefined);

  setUrl('https://shop.example/?gsPreviewVariant=%20%20');
  initVariantEditor();
  assert.equal(fab(), null, 'a blank id does not count');
});

test('initVariantEditor waits for DOMContentLoaded and mounts a single FAB', () => {
  setUrl('https://shop.example/?gsPreviewVariant=v1');
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
  try {
    initVariantEditor();
  } finally {
    delete document.readyState;
  }
  assert.equal(fab(), null, 'not mounted while the document is loading');
  assert.deepEqual(window.gsVariantTextEdits, []);
  assert.equal(typeof window.gsShowSelectorPicker, 'function');
  assert.equal(typeof window.gsHideSelectorPicker, 'function');

  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(fab().textContent, 'Edit variant');
  assert.equal(fab().dataset.mode, 'edit');
  assert.equal(fab().parentNode.id, BAR_ID);
  assert.ok(document.getElementById('gopersonal-edit-variant-fab-styles'));

  initVariantEditor();
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(document.querySelectorAll('#' + FAB_ID).length, 1);
});

test('clicking the FAB starts the picker scoped to the variant container', () => {
  click(fab());
  assert.equal(fab().textContent, 'Confirm');
  assert.equal(fab().dataset.mode, 'confirm');
  assert.ok(root().classList.contains(ROOT_CLASS));
  assert.ok(overlay(), 'overlay appended');
  assert.ok(document.getElementById('gopersonal-selector-picker-styles'));
  assert.equal(document.querySelector('[data-variant="other"]').classList.contains(ROOT_CLASS), false);

  click(fab());
  assert.equal(fab().textContent, 'Edit variant');
  assert.equal(root().classList.contains(ROOT_CLASS), false);
  assert.equal(overlay(), null);
});

test('moving the pointer highlights the element under it and positions the overlay', () => {
  click(fab());
  const title = $('h2');
  title.getBoundingClientRect = () => ({ top: 10, left: 20, width: 300, height: 40 });
  move(title);
  assert.ok(title.classList.contains(HIGHLIGHT_CLASS));
  assert.equal(overlay().style.display, 'block');
  assert.equal(overlay().style.top, '10px');
  assert.equal(overlay().style.left, '20px');
  assert.equal(overlay().style.width, '300px');
  assert.equal(overlay().style.height, '40px');

  move($('.box'));
  assert.equal(title.classList.contains(HIGHLIGHT_CLASS), false, 'previous highlight cleared');
  assert.ok($('.box').classList.contains(HIGHLIGHT_CLASS));

  move(document.getElementById('outside'));
  assert.equal(root().querySelectorAll('.' + HIGHLIGHT_CLASS).length, 0);
  assert.equal(document.getElementById('outside').classList.contains(HIGHLIGHT_CLASS), false);
  assert.equal(overlay().style.display, 'none');

  click(fab());
});

test('clicking a non-text element dispatches gopersonal:selector-picked with its selector', () => {
  click(fab());
  const picked = [];
  const listener = (e) => picked.push(e.detail);
  window.addEventListener('gopersonal:selector-picked', listener);
  try {
    const box = $('.box');
    move(box); // adds the highlight class, which must not leak into the payload
    const event = pick(box);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(picked[0], {
      variantId: 'v1',
      selectorFromVariantRoot: 'div.box.md\\:flex',
      tag: 'DIV',
      id: undefined,
      className: 'box md:flex',
    });

    pick($('#hero'));
    assert.equal(picked[1].selectorFromVariantRoot, '#hero');
    assert.equal(picked[1].id, 'hero');
    assert.equal(picked[1].tag, 'IMG');

    pick($('.check'));
    assert.equal(picked[2].selectorFromVariantRoot, 'div.box.md\\:flex > input.check:nth-of-type(2)');
    assert.equal(drawer(), null, 'a checkbox is not text-editable');

    pick(root());
    assert.equal(picked[3].selectorFromVariantRoot, ':scope');

    // Clicks outside the variant container are left alone.
    const outside = pick(document.getElementById('outside'));
    assert.equal(outside.defaultPrevented, false);
    assert.equal(picked.length, 4);

    // Every picked selector resolves back to the element inside the root.
    assert.equal(root().querySelector(':scope > ' + picked[0].selectorFromVariantRoot), box);
    assert.equal(root().querySelector(picked[2].selectorFromVariantRoot), $('.check'));
  } finally {
    window.removeEventListener('gopersonal:selector-picked', listener);
    click(fab());
  }
});

test('clicking a text element opens the drawer; Save edits the text and records the change', async () => {
  click(fab());
  const second = root().querySelectorAll('p')[1];
  const updates = [];
  const listener = (e) => updates.push(e.detail);
  window.addEventListener('gopersonal:text-updated', listener);
  try {
    const event = pick(second);
    assert.equal(event.defaultPrevented, true);
    assert.ok(drawer());
    assert.ok(document.getElementById('gopersonal-text-drawer-styles'));
    assert.equal(drawer().querySelector('.gp-text-drawer-title').textContent, 'Edit P');
    assert.equal(drawer().querySelector('[role="dialog"]').getAttribute('aria-label'), 'Edit P');
    const textarea = drawer().querySelector('textarea');
    assert.equal(textarea.value, 'two');
    await flush();
    assert.equal(document.activeElement, textarea, 'textarea focused on the next frame');

    // The picker stops highlighting while the drawer is open.
    move($('h2'));
    assert.equal($('h2').classList.contains(HIGHLIGHT_CLASS), false);

    textarea.value = 'dos';
    click(drawer().querySelector('[data-action="save"]'));
    assert.equal(drawer(), null);
    assert.equal(second.textContent, 'dos');
    assert.equal(window.gsVariantTextEdits.length, 1);
    const edit = window.gsVariantTextEdits[0];
    assert.equal(edit.variantId, 'v1');
    assert.equal(edit.selectorFromVariantRoot, 'div.box.md\\:flex > p:nth-of-type(2)');
    assert.equal(edit.tag, 'P');
    assert.equal(edit.previousText, 'two');
    assert.equal(edit.text, 'dos');
    assert.match(edit.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(updates, [{ variantId: 'v1', tag: 'P', text: 'dos', previousText: 'two', element: second }]);
  } finally {
    window.removeEventListener('gopersonal:text-updated', listener);
    click(fab());
  }
});

test('saving an input or textarea sets its value and fires input/change', () => {
  click(fab());
  const input = $('.name');
  const fired = [];
  input.addEventListener('input', () => fired.push('input'));
  input.addEventListener('change', () => fired.push('change'));

  pick(input);
  assert.equal(drawer().querySelector('.gp-text-drawer-title').textContent, 'Edit INPUT');
  assert.equal(drawer().querySelector('textarea').value, 'abc');
  drawer().querySelector('textarea').value = 'xyz';
  click(drawer().querySelector('[data-action="save"]'));
  assert.equal(input.value, 'xyz');
  assert.deepEqual(fired, ['input', 'change']);

  pick($('.notes'));
  assert.equal(drawer().querySelector('textarea').value, 'notes');
  drawer().querySelector('textarea').value = 'new notes';
  click(drawer().querySelector('[data-action="save"]'));
  assert.equal($('.notes').value, 'new notes');

  assert.deepEqual(
    window.gsVariantTextEdits.map((e) => [e.selectorFromVariantRoot, e.previousText, e.text]),
    [
      ['div.box.md\\:flex > input.name:nth-of-type(1)', 'abc', 'xyz'],
      ['div.box.md\\:flex > textarea.notes', 'notes', 'new notes'],
    ],
  );
  click(fab());
});

test('Cancel, close, backdrop and Escape dismiss the drawer without editing', () => {
  click(fab());
  const title = $('h2');

  for (const action of ['cancel', 'close', 'backdrop']) {
    pick(title);
    drawer().querySelector('textarea').value = 'changed';
    const event = click(drawer().querySelector(`[data-action="${action}"]`));
    assert.equal(event.defaultPrevented, true, action);
    assert.equal(drawer(), null, action);
  }

  pick(title);
  // Clicks on the drawer body and other keys keep it open.
  click(drawer().querySelector('.gp-text-drawer-body'));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.ok(drawer());
  const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(drawer(), null);

  assert.equal(title.textContent, 'Hello');
  assert.deepEqual(window.gsVariantTextEdits, []);

  // Opening a second drawer replaces the first one.
  pick(title);
  pick($('p'));
  assert.equal(document.querySelectorAll('.gp-text-drawer-root').length, 1);
  assert.equal(drawer().querySelector('.gp-text-drawer-title').textContent, 'Edit P');

  // Confirm closes whatever drawer is still open.
  click(fab());
  assert.equal(drawer(), null);
});

test('Confirm posts the accumulated edits to window.opener and resets the editor', () => {
  const opener = recordingWindow();
  const parent = recordingWindow();
  stubWindowProp('opener', opener);
  stubWindowProp('parent', parent);

  click(fab());
  pick($('h2'));
  drawer().querySelector('textarea').value = 'Hola';
  click(drawer().querySelector('[data-action="save"]'));
  pick($('p'));
  drawer().querySelector('textarea').value = 'uno';
  click(drawer().querySelector('[data-action="save"]'));

  click(fab());
  assert.equal(parent.messages.length, 0, 'the opener wins over the parent');
  assert.equal(opener.messages.length, 1);
  const { message, origin } = opener.messages[0];
  assert.equal(origin, '*');
  assert.equal(message.namespace, 'gopersonal');
  assert.equal(message.source, 'preview');
  assert.equal(message.type, 'variantEditsSave');
  assert.equal(message.payload.variantId, 'v1');
  assert.deepEqual(
    message.payload.edits.map((e) => [e.selectorFromVariantRoot, e.tag, e.previousText, e.text]),
    [
      ['h2.title.big', 'H2', 'Hello', 'Hola'],
      ['div.box.md\\:flex > p:nth-of-type(1)', 'P', 'one', 'uno'],
    ],
  );
  assert.deepEqual(window.gsVariantTextEdits, [], 'edits are cleared after posting');
  assert.equal(fab().textContent, 'Edit variant');
  assert.equal(root().classList.contains(ROOT_CLASS), false);
  assert.equal(overlay(), null);

  // The picker listeners are gone: clicks behave normally again.
  const event = pick($('h2'));
  assert.equal(event.defaultPrevented, false);
  assert.equal(drawer(), null);
});

test('Confirm falls back to window.parent (iframe preview) when there is no opener', () => {
  const parent = recordingWindow();
  stubWindowProp('parent', parent);
  click(fab());
  click(fab());
  assert.equal(parent.messages.length, 1);
  assert.deepEqual(parent.messages[0].message.payload, { variantId: 'v1', edits: [] });
});

test('Confirm without any parent window, or with a throwing one, does not break the page', () => {
  click(fab());
  window.gsVariantTextEdits.push({ text: 'pending' });
  click(fab());
  assert.deepEqual(window.gsVariantTextEdits, []);
  assert.equal(fab().textContent, 'Edit variant');

  stubWindowProp('opener', { postMessage() { throw new Error('closed'); } });
  click(fab());
  click(fab());
  assert.equal(warn.mock.calls.at(-1).arguments[0], '[gs-sdk][variantEditor] postMessage failed:');
  assert.equal(fab().textContent, 'Edit variant');
});

test('starting the picker discards edits left over from a previous session', () => {
  window.gsVariantTextEdits = [{ text: 'stale' }];
  click(fab());
  assert.deepEqual(window.gsVariantTextEdits, []);
  click(fab());

  // A clobbered global is rebuilt.
  window.gsVariantTextEdits = 'broken';
  click(fab());
  assert.deepEqual(window.gsVariantTextEdits, []);
  window.gsVariantTextEdits = null;
  pick($('h2'));
  click(drawer().querySelector('[data-action="save"]'));
  assert.equal(window.gsVariantTextEdits.length, 1);
  click(fab());
});

test('gsShowSelectorPicker / gsHideSelectorPicker drive the picker without the FAB', () => {
  window.gsShowSelectorPicker({ variantId: 'missing' });
  assert.equal(warn.mock.calls.at(-1).arguments[0], '[gs-sdk][variantEditor] No container for variant:');
  assert.equal(warn.mock.calls.at(-1).arguments[1], 'missing');
  assert.equal(overlay(), null);

  window.gsShowSelectorPicker();
  assert.equal(overlay(), null, 'no payload: nothing to pick');

  window.gsShowSelectorPicker({ variantId: 'other' });
  const other = document.querySelector('[data-variant="other"]');
  assert.ok(other.classList.contains(ROOT_CLASS));
  move(other.querySelector('p'));
  assert.ok(other.querySelector('p').classList.contains(HIGHLIGHT_CLASS));

  // Showing again for another variant moves the picker.
  window.gsShowSelectorPicker({ variantId: 'v1' });
  assert.equal(other.classList.contains(ROOT_CLASS), false);
  assert.equal(other.querySelector('p').classList.contains(HIGHLIGHT_CLASS), false);
  assert.ok(root().classList.contains(ROOT_CLASS));
  assert.equal(document.querySelectorAll(OVERLAY_SELECTOR).length, 1);

  window.gsHideSelectorPicker();
  assert.equal(root().classList.contains(ROOT_CLASS), false);
  assert.equal(overlay(), null);
  window.gsHideSelectorPicker(); // idempotent
});

test('the FAB only warns when the variant container is not on the page', () => {
  root().remove();
  click(fab());
  assert.equal(warn.mock.calls.at(-1).arguments[0], '[gs-sdk][variantEditor] No container for variant:');
  assert.equal(overlay(), null);
  // Leave the FAB in "Edit variant" mode whatever state the click left it in.
  if (fab().dataset.mode === 'confirm') click(fab());
  assert.equal(fab().dataset.mode, 'edit');
});
