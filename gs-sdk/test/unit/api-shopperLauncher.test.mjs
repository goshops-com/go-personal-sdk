import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { resetDom } from './helpers/env.mjs';
import { renderLauncher, launcherConfig, readableOn } from '../../src/api/shopperLauncher.js';

// Dibuja un botón con la config dada y lo devuelve.
const render = (config) => { const button = document.createElement('button'); renderLauncher(button, config); return button; };
const withLauncher = (launcher, extra = {}) => ({ color: '#123456', appearance: { launcher }, ...extra });

let originalMatchMedia;
beforeEach(() => { resetDom(); originalMatchMedia = window.matchMedia; });
afterEach(() => { window.matchMedia = originalMatchMedia; });

test('sin config ni apariencia el botón se ve como siempre: destellos, "Personal Shopper" y el violeta por defecto', () => {
  for (const config of [null, {}, { appearance: 'x' }]) {
    const button = render(config);
    assert.equal(button.textContent, 'Personal Shopper');
    assert.equal(button.querySelectorAll('svg path').length, 2, 'ícono de destellos');
    assert.equal(button.style.background, 'rgb(94, 64, 191)');
    assert.equal(button.style.color, 'rgb(255, 255, 255)');
    assert.equal(button.style.borderRadius, '24px');
    assert.equal(button.style.animation, '');
    assert.equal(button.getAttribute('aria-label'), 'Personal Shopper');
  }
});

test('usa el color de marca, el ícono y el texto configurados, con colores automáticos por contraste', () => {
  const button = render(withLauncher({ icon: 'bag', label: 'Te ayudo' }, { color: '#ffd400' }));
  assert.equal(button.textContent, 'Te ayudo');
  assert.equal(button.querySelectorAll('svg path').length, 2, 'ícono de bolsa');
  assert.equal(button.style.background, 'rgb(255, 212, 0)');
  assert.equal(button.style.color, 'rgb(31, 33, 40)', 'texto oscuro sobre amarillo');
  assert.equal(button.querySelector('svg').style.color, 'rgb(31, 33, 40)');
});

test('los colores elegidos le ganan al automático', () => {
  const button = render(withLauncher({ icon: 'chat', background: '#000000', iconColor: '#ff0000', textColor: '#00ff00' }));
  assert.equal(button.style.background, 'rgb(0, 0, 0)');
  assert.equal(button.style.color, 'rgb(0, 255, 0)');
  assert.equal(button.querySelector('svg').style.color, 'rgb(255, 0, 0)');
});

test('sin texto el botón es redondo y solo ícono; sin ícono es solo texto', () => {
  const round = render(withLauncher({ icon: 'gift', label: '' }));
  assert.equal(round.textContent, '');
  assert.equal(round.style.borderRadius, '50%');
  assert.equal(round.style.width, '52px');
  assert.equal(round.getAttribute('aria-label'), 'Personal Shopper', 'nombre accesible aunque no tenga texto');
  const text = render(withLauncher({ icon: 'none', label: 'Asistente' }));
  assert.equal(text.querySelector('svg'), null);
  assert.equal(text.textContent, 'Asistente');
});

test('una imagen https reemplaza al ícono; una URL que no es https usa el ícono por defecto', () => {
  const image = render(withLauncher({ icon: 'image', image: 'https://assets.test/logo.png', label: '' }));
  assert.equal(image.querySelector('img').src, 'https://assets.test/logo.png');
  assert.equal(image.querySelector('img').style.width, '28px');
  for (const bad of ['http://assets.test/logo.png', 'javascript:alert(1)', undefined]) {
    const button = render(withLauncher({ icon: 'image', image: bad }));
    assert.equal(button.querySelector('img'), null);
    assert.equal(button.querySelectorAll('svg path').length, 2);
  }
});

test('valores desconocidos vuelven a su default y nunca queda un botón vacío', () => {
  assert.deepEqual(launcherConfig(withLauncher({ icon: 'rocket', animation: 'spin', label: 3, background: 'red' })),
    { icon: 'sparkle', image: '', label: 'Personal Shopper', animation: 'none', background: '', iconColor: '', textColor: '' });
  assert.equal(launcherConfig(withLauncher({ icon: 'none', label: '  ' })).icon, 'sparkle');
  assert.equal(launcherConfig(withLauncher({ label: 'x'.repeat(40) })).label.length, 30);
  const button = render(withLauncher({ label: '<img src=x onerror=alert(1)>' }));
  assert.equal(button.querySelector('img'), null, 'el texto nunca se interpreta como HTML');
});

test('la animación de aparición agrega sus keyframes una sola vez y respeta el movimiento reducido', () => {
  const button = render(withLauncher({ animation: 'pop' }));
  assert.match(button.style.animation, /gp-shopper-pop/);
  render(withLauncher({ animation: 'fade' }));
  assert.equal(document.querySelectorAll('#gp-shopper-launcher-keyframes').length, 1);
  window.matchMedia = () => ({ matches: true });
  assert.equal(render(withLauncher({ animation: 'slide' })).style.animation, '');
});

test('readableOn elige blanco sobre oscuro, oscuro sobre claro y blanco ante un color inválido', () => {
  assert.equal(readableOn('#5e40bf'), '#ffffff');
  assert.equal(readableOn('#ffffff'), '#1f2128');
  assert.equal(readableOn('nope'), '#ffffff');
});
