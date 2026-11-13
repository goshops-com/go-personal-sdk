import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { resetDom } from './helpers/env.mjs';
import {
  EXIT_INTENT_ARM_DELAY_MS,
  onExitIntent,
  clearPendingTriggers,
  suscribe,
} from '../../src/utils/trigger.js';
import { subscribeQueue } from '../../src/utils/queue.js';

const overridden = [];

/** Overrides a property on a DOM object until the end of the test. */
function override(target, name, value) {
  Object.defineProperty(target, name, { configurable: true, get: () => value });
  overridden.push([target, name]);
}

beforeEach(() => {
  resetDom();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

afterEach(() => {
  clearPendingTriggers();
  mock.timers.reset();
  mock.restoreAll();
  for (const [target, name] of overridden.splice(0)) {
    delete target[name];
  }
});

const mouseOut = (init = {}) =>
  document.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, clientY: 0, relatedTarget: null, ...init }));

const setVisibility = (state) => {
  override(document, 'visibilityState', state);
  document.dispatchEvent(new window.Event('visibilitychange'));
};

const content = (trigger, key = 'content-1') => ({
  key,
  trigger,
  contentValue: { html: `<p>${key}</p>`, js: `/* ${key} */` },
});

/** Runs the pending requestAnimationFrame callbacks (setTimeout 0 in the harness). */
const nextFrame = () => mock.timers.tick(1);

// ---------------------------------------------------------------------------
// onExitIntent
// ---------------------------------------------------------------------------

test('onExitIntent ignores the cursor leaving until the arm delay has passed', () => {
  const fire = mock.fn();
  onExitIntent(fire);

  mouseOut();
  assert.equal(fire.mock.callCount(), 0);

  mock.timers.tick(EXIT_INTENT_ARM_DELAY_MS - 1);
  mouseOut();
  assert.equal(fire.mock.callCount(), 0);

  mock.timers.tick(1);
  mouseOut();
  assert.equal(fire.mock.callCount(), 1);
});

test('onExitIntent fires only once', () => {
  const fire = mock.fn();
  onExitIntent(fire, { armDelayMs: 0 });
  mock.timers.tick(0);

  mouseOut();
  mouseOut();
  setVisibility('hidden');
  setVisibility('visible');
  assert.equal(fire.mock.callCount(), 1);
});

test('onExitIntent only reacts to the cursor leaving the document through the top', () => {
  const fire = mock.fn();
  onExitIntent(fire, { armDelayMs: 10 });
  mock.timers.tick(10);

  // Moving from one element to another: relatedTarget is the element entered.
  mouseOut({ relatedTarget: document.body });
  // Leaving through a side or the bottom.
  mouseOut({ clientY: 200 });
  assert.equal(fire.mock.callCount(), 0);

  mouseOut({ clientY: -5 });
  assert.equal(fire.mock.callCount(), 1);
});

test('onExitIntent fires when the visitor comes back after leaving the tab', () => {
  const fire = mock.fn();
  onExitIntent(fire);

  // Becoming visible without having left is not a signal.
  setVisibility('visible');
  assert.equal(fire.mock.callCount(), 0);

  setVisibility('hidden');
  assert.equal(fire.mock.callCount(), 0);

  setVisibility('visible');
  assert.equal(fire.mock.callCount(), 1);
});

// ---------------------------------------------------------------------------
// suscribe
// ---------------------------------------------------------------------------

test('suscribe shows the content right away when it has no trigger', () => {
  const cb = mock.fn();
  suscribe(content(undefined, 'no-trigger'), cb);
  suscribe(content({}, 'empty-trigger'), cb);

  assert.deepEqual(cb.mock.calls.map((call) => call.arguments), [
    ['<p>no-trigger</p>', '/* no-trigger */'],
    ['<p>empty-trigger</p>', '/* empty-trigger */'],
  ]);
});

test('suscribe with a wait trigger shows the content after the given seconds', () => {
  const cb = mock.fn();
  const timer = suscribe(content({ id: 'wait', value: '3' }), cb);
  assert.ok(timer, 'returns the timer');

  mock.timers.tick(2999);
  assert.equal(cb.mock.callCount(), 0);
  mock.timers.tick(1);
  assert.deepEqual(cb.mock.calls[0].arguments, ['<p>content-1</p>', '/* content-1 */']);
});

test('suscribe with a wait trigger and no valid value waits 0 seconds', () => {
  const cb = mock.fn();
  suscribe(content({ id: 'wait', value: 'soon' }), cb);
  assert.equal(cb.mock.callCount(), 0);
  mock.timers.tick(0);
  assert.equal(cb.mock.callCount(), 1);
});

test('clearPendingTriggers cancels the wait triggers that did not fire yet', () => {
  const cb = mock.fn();
  suscribe(content({ id: 'wait', value: 2 }), cb);
  clearPendingTriggers();
  mock.timers.tick(5000);
  assert.equal(cb.mock.callCount(), 0);
});

test('suscribe with an exit_intent trigger shows the content when the visitor tries to leave', () => {
  const cb = mock.fn();
  suscribe(content({ id: 'exit_intent' }), cb);

  mock.timers.tick(EXIT_INTENT_ARM_DELAY_MS);
  assert.equal(cb.mock.callCount(), 0);
  mouseOut();
  assert.deepEqual(cb.mock.calls.map((call) => call.arguments), [['<p>content-1</p>', '/* content-1 */']]);
});

test('suscribe with a click_element trigger shows the content when the element is clicked', () => {
  document.body.innerHTML = '<button id="open">Open</button>';
  const cb = mock.fn();
  suscribe(content({ id: 'click_element', value: '#open' }), cb);
  assert.equal(cb.mock.callCount(), 0);

  document.getElementById('open').click();
  assert.deepEqual(cb.mock.calls[0].arguments, ['<p>content-1</p>', '/* content-1 */']);
});

test('suscribe with a mouseover_element trigger shows the content when the element is hovered', () => {
  document.body.innerHTML = '<div id="menu">Menu</div>';
  const cb = mock.fn();
  suscribe(content({ id: 'mouseover_element', value: '#menu' }), cb);
  assert.equal(cb.mock.callCount(), 0);

  document.getElementById('menu').dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  assert.deepEqual(cb.mock.calls[0].arguments, ['<p>content-1</p>', '/* content-1 */']);
});

test('suscribe does nothing when the element of a click or mouseover trigger is missing', () => {
  const cb = mock.fn();
  suscribe(content({ id: 'click_element', value: '#missing' }), cb);
  suscribe(content({ id: 'mouseover_element', value: '#missing' }), cb);
  suscribe(content({ id: 'unknown_trigger' }), cb);
  assert.equal(cb.mock.callCount(), 0);
});

/** Page of 1000px of scrollable height, scrolled to `scrolled` px. */
function scrollablePage(scrolled = 0) {
  override(document.documentElement, 'scrollHeight', window.innerHeight + 1000);
  override(window, 'pageYOffset', scrolled);
}

const scrollTo = (scrolled) => {
  override(window, 'pageYOffset', scrolled);
  window.dispatchEvent(new window.Event('scroll'));
};

test('suscribe with a scroll trigger shows the content once the page is scrolled past the threshold', () => {
  scrollablePage(0);
  const cb = mock.fn();
  suscribe(content({ id: 'scroll', value: '70' }), cb);
  assert.equal(cb.mock.callCount(), 0);

  scrollTo(690);
  nextFrame();
  assert.equal(cb.mock.callCount(), 0);

  scrollTo(700);
  // Scroll events are throttled to one check per animation frame.
  scrollTo(710);
  assert.equal(cb.mock.callCount(), 0);
  nextFrame();
  assert.deepEqual(cb.mock.calls.map((call) => call.arguments), [['<p>content-1</p>', '/* content-1 */']]);

  scrollTo(900);
  nextFrame();
  assert.equal(cb.mock.callCount(), 1, 'fires only once');
});

test('suscribe with a scroll trigger fires immediately when the page is already scrolled enough', () => {
  scrollablePage(800);
  const cb = mock.fn();
  suscribe(content({ id: 'scroll', value: 75 }), cb);
  assert.equal(cb.mock.callCount(), 1);
});

test('suscribe with a scroll trigger defaults to 50% and reads scrollTop when pageYOffset is 0', () => {
  scrollablePage(0);
  const cb = mock.fn();
  suscribe(content({ id: 'scroll', value: 'half' }), cb);

  override(document.documentElement, 'scrollTop', 499);
  window.dispatchEvent(new window.Event('scroll'));
  nextFrame();
  assert.equal(cb.mock.callCount(), 0);

  override(document.documentElement, 'scrollTop', 500);
  window.dispatchEvent(new window.Event('scroll'));
  nextFrame();
  assert.equal(cb.mock.callCount(), 1);
});

test('suscribe with a scroll trigger never fires on a page that cannot scroll', () => {
  const cb = mock.fn();
  suscribe(content({ id: 'scroll', value: 10 }), cb);
  window.dispatchEvent(new window.Event('scroll'));
  nextFrame();
  assert.equal(cb.mock.callCount(), 0);
});

test('clearPendingTriggers disarms the scroll triggers, even with a check already scheduled', () => {
  scrollablePage(0);
  const cb = mock.fn();
  suscribe(content({ id: 'scroll', value: 50 }), cb);

  scrollTo(900);
  clearPendingTriggers();
  nextFrame();
  scrollTo(950);
  nextFrame();
  assert.equal(cb.mock.callCount(), 0);
});

test('clearPendingTriggers keeps going when one cleanup throws', () => {
  scrollablePage(0);
  const errors = mock.method(console, 'error', () => {});
  const cb = mock.fn();
  suscribe(content({ id: 'scroll', value: 50 }, 'scroll-content'), cb);
  suscribe(content({ id: 'wait', value: 1 }, 'wait-content'), cb);

  const failure = new Error('removeEventListener failed');
  const removeListener = mock.method(window, 'removeEventListener', () => { throw failure; });
  clearPendingTriggers();
  removeListener.mock.restore();

  assert.deepEqual(errors.mock.calls.map((call) => call.arguments[0]), [failure]);
  mock.timers.tick(1000);
  assert.equal(cb.mock.callCount(), 0, 'the wait trigger registered after the failing one was still cancelled');
});

test('suscribe with a page_load trigger shows the content right away', () => {
  mock.method(console, 'log', () => {});
  const cb = mock.fn();
  suscribe(content({ id: 'page_load' }), cb);
  assert.deepEqual(cb.mock.calls.map((call) => call.arguments), [['<p>content-1</p>', '/* content-1 */']]);
});

test('suscribe with an interaction trigger registers a queue task that loads the content with forceShow', () => {
  mock.method(console, 'log', () => {});
  const cb = mock.fn();

  // The callback is stored as source text (queue.js), so the function object
  // itself is captured here to be able to run the original too.
  const originalToString = Function.prototype.toString;
  let registered = null;
  Function.prototype.toString = function () {
    const source = originalToString.call(this);
    if (!registered && source.includes('gsSDK.getContent')) {
      registered = this;
    }
    return source;
  };
  try {
    suscribe(content({ id: 'interaction', value: { id: 'added-to-cart' } }, 77), cb);
  } finally {
    Function.prototype.toString = originalToString;
  }

  assert.equal(cb.mock.callCount(), 0, 'nothing is shown until the interaction happens');
  const subscribers = JSON.parse(localStorage.getItem('gs_suscribers'));
  assert.deepEqual(Object.keys(subscribers), ['interaction-added-to-cart']);
  assert.deepEqual(subscribers['interaction-added-to-cart'][0].params, { contentKey: '77', cache: 0 });

  // The function handed to the queue asks the SDK for the content.
  const getContent = mock.fn();
  window.gsSDK = { getContent };
  assert.equal(typeof registered, 'function');
  registered({ contentKey: '77', cache: 0 });
  assert.deepEqual(getContent.mock.calls[0].arguments, ['77', { forceShow: true, cache: 0 }]);

  // End to end: the queue picks the interaction up and runs the stored callback.
  getContent.mock.resetCalls();
  localStorage.setItem('gs_queue', JSON.stringify([
    { type: 'interaction-added-to-cart', expirationDate: Date.now() + 60000 },
  ]));
  subscribeQueue();
  mock.timers.tick(500);

  assert.deepEqual(getContent.mock.calls.map((call) => call.arguments), [['77', { forceShow: true, cache: 0 }]]);
  assert.deepEqual(JSON.parse(localStorage.getItem('gs_suscribers')), {});
  assert.equal(localStorage.getItem('gs_queue'), '[]');
});

test('a cacheable content keeps its cache flag when the interaction trigger asks for it again', () => {
  mock.method(console, 'log', () => {});
  suscribe(content({ id: 'interaction', value: { id: 'added-to-cart' } }, 78), mock.fn(), { cache: 1 });

  const subscribers = JSON.parse(localStorage.getItem('gs_suscribers'));
  assert.deepEqual(subscribers['interaction-added-to-cart'].at(-1).params, { contentKey: '78', cache: 1 });

  // The stored source is what runs on a later page load: it has to forward the flag.
  const getContent = mock.fn();
  window.gsSDK = { getContent };
  const stored = eval('(' + subscribers['interaction-added-to-cart'].at(-1).callback + ')');
  stored({ contentKey: '78', cache: 1 });
  assert.deepEqual(getContent.mock.calls[0].arguments, ['78', { forceShow: true, cache: 1 }]);
});
