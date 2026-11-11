import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { resetDom, mockFetch, seedSession, flush } from './helpers/env.mjs';
import { setupContentSelector } from '../../src/utils/configure.js';

const API = 'https://go-discover-dev.goshops.ai';

beforeEach(() => {
  resetDom();
  delete window.contentId;
  delete window.selected;
  seedSession();
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

const hover = (element) => element.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
const leave = (element) => element.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));

/** Page under test + the elements the picker adds (style, tooltip, notification). */
async function setup(html, contentId = 'content-9') {
  document.body.innerHTML = html;
  await setupContentSelector(contentId);
  const [tooltip, notification] = [...document.body.children].slice(-2);
  const style = document.head.querySelector('style');
  return { tooltip, notification, style };
}

test('setupContentSelector adds the picker UI and remembers the content', async () => {
  const { tooltip, notification, style } = await setup('<div id="hero"></div>', 'content-1');

  assert.equal(window.contentId, 'content-1');
  assert.ok(style, 'a style element for the outline is added to head');
  assert.equal(tooltip.style.position, 'fixed');
  assert.equal(tooltip.style.bottom, '10px');
  assert.equal(notification.style.display, 'none');
  assert.equal(notification.style.top, '10px');
});

test('hovering an element with id selects it by id and outlines it', async () => {
  const { tooltip, style } = await setup('<section><div id="hero">Hero</div></section>');
  const hero = document.getElementById('hero');

  hover(hero);

  assert.equal(window.selected, '#hero');
  assert.equal(tooltip.textContent, 'Selected: #hero');
  assert.equal(style.textContent, '#hero { outline: 2px solid red !important; }');
  assert.equal(hero.getAttribute('data-original-id'), 'hero');

  // Hovering again keeps the original id.
  hover(hero);
  assert.equal(hero.getAttribute('data-original-id'), 'hero');
  assert.equal(window.selected, '#hero');
});

test('hovering an element without id selects it by class and gives it a temporary id', async () => {
  const { tooltip, style } = await setup('<div class="banner main">Banner</div>');
  const banner = document.querySelector('.banner');

  hover(banner);

  assert.match(banner.id, /^temp_id_\d+$/);
  assert.equal(style.textContent, `#${banner.id} { outline: 2px solid red !important; }`);
  assert.equal(window.selected, '.banner main');
  assert.equal(tooltip.textContent, 'Selected: .banner main');
});

test('hovering an element without id nor class selects it by its path from body', async () => {
  await setup('<main><p>first</p><p><span>target</span></p></main>');
  const span = document.querySelector('span');

  hover(span);

  assert.equal(window.selected, 'body > MAIN:nth-child(1) > P:nth-child(2) > SPAN:nth-child(1)');
  assert.equal(document.querySelector(window.selected), span);
});

test('only the hovered element is selected, not its ancestors', async () => {
  await setup('<div id="outer"><div id="inner">x</div></div>');

  hover(document.getElementById('inner'));

  assert.equal(window.selected, '#inner');
  assert.equal(document.getElementById('outer').getAttribute('data-original-id'), null);
});

test('leaving an element clears the outline, the tooltip and the temporary id', async () => {
  const { tooltip, style } = await setup('<div class="banner">Banner</div><div id="hero">Hero</div>');
  const banner = document.querySelector('.banner');
  const hero = document.getElementById('hero');

  hover(banner);
  leave(banner);
  assert.equal(banner.id, '');
  assert.equal(style.textContent, '');
  assert.equal(tooltip.textContent, '');

  hover(hero);
  leave(hero);
  assert.equal(hero.id, 'hero', 'a real id is kept');
  assert.equal(style.textContent, '');
});

test('clicking an element saves the selector and shows a notification for 10 seconds', async () => {
  const { notification } = await setup('<a id="cta" href="/somewhere">Buy</a>', 'content-42');
  const calls = mockFetch(() => ({ ok: true }));
  const cta = document.getElementById('cta');

  hover(cta);
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  cta.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'the link is not followed');
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/configure/content/content-42/selector`);
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[0].body, { selector: '#cta' });
  assert.equal(calls[0].headers.Authorization, 'Bearer token-1');

  assert.equal(notification.style.display, 'block');
  assert.equal(
    notification.textContent,
    "Success! The element '#cta' has been selected. You may now close this window.",
  );

  mock.timers.tick(9999);
  assert.equal(notification.style.display, 'block');
  mock.timers.tick(1);
  assert.equal(notification.style.display, 'none');
});
