import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { jsonResponse, mockFetch, resetDom } from './helpers/env.mjs';
import { getFenicioCards, parseFenicioCards } from '../../src/providers/fenicioCards.js';

const NATIVE_DATA = {
  moneda: { cod: 'UYU', sim: '$' },
  producto: { codigo: 'A1' },
  variante: { codigo: 'ROJO' },
};

const attr = (value) => JSON.stringify(value).replace(/"/g, '&quot;');

// Markup with the shape Fenicio answers on /catalogo/cargar-variantes.
const FULL_CARD = `
  <div class="it" data-codprod="A1" data-codvar="ROJO" data-disp="1">
    <input type="hidden" class="json" value="${attr(NATIVE_DATA)}">
    <div class="cocardas">
      <div class="dfl">
        <span class="ico nuevo">Nuevo</span>
        <span class="ico promo promo12" data-id="77" data-fecha-fin="2026-12-31"><img src="/promo.png" alt="3x2"></span>
      </div>
      <div class="ctm"><span class="promo-data grupo5"> Grupo
        especial </span></div>
    </div>
    <div class="porcRebaja"><span class="int">25</span><span class="dec">5</span></div>
    <div class="cocardasTexto"><span class="envio-gratis">Envío gratis</span><span class="ico fn-hidden"></span></div>
    <div class="precios">
      <span class="precio lista"><span class="sim">$</span> <span class="monto">1.299,90</span></span>
      <span class="precio venta"><span class="sim">US$</span><span class="monto">999</span></span>
      <span class="precio cuota">sin monto</span>
    </div>
    <div class="descuentosMDP">
      <div class="desc_42"><span class="img" title="Visa"><img data-src="/visa.png"></span><span class="precio venta"><span class="monto">899,00</span></span></div>
      <div class="otro">Solo texto</div>
    </div>
  </div>`;

const html = (...groups) => groups.map(([code, cards]) => `<div data-codigo="${code}">${cards}</div>`).join('');

beforeEach(() => resetDom());

test('parseFenicioCards reads the identity, availability and native data of a card', () => {
  const [group] = parseFenicioCards(html(['A1', FULL_CARD]));
  assert.equal(group.code, 'A1');
  assert.equal(group.cards.length, 1);

  const [card] = group.cards;
  assert.equal(card.code, 'A1');
  assert.equal(card.variantCode, 'ROJO');
  assert.equal(card.available, true);
  assert.deepEqual(card.data, NATIVE_DATA);
});

test('parseFenicioCards parses list, current and other prices with the card currency', () => {
  const [{ cards: [card] }] = parseFenicioCards(html(['A1', FULL_CARD]));

  assert.deepEqual(card.prices, [
    {
      type: 'list',
      amount: 1299.9,
      amountText: '1.299,90',
      formatted: '$ 1.299,90',
      currency: { code: 'UYU', symbol: '$' },
      classes: ['precio', 'lista'],
    },
    {
      type: 'current',
      amount: 999,
      amountText: '999',
      formatted: 'US$999',
      currency: { code: 'UYU', symbol: 'US$' },
      classes: ['precio', 'venta'],
    },
    {
      type: 'other',
      amount: null,
      amountText: 'sin monto',
      formatted: 'sin monto',
      currency: { code: 'UYU', symbol: '$' },
      classes: ['precio', 'cuota'],
    },
  ]);
});

test('parseFenicioCards understands thousands and decimal separators', () => {
  const price = (text) => `<span class="precio venta"><span class="monto">${text}</span></span>`;
  const amounts = ['1.299', '12.5', '1,299.50', '2.500.000', '$ 45', '-', '10,5'];
  const card = `<div class="it"><div class="precios">${amounts.map(price).join('')}</div></div>`;

  const [{ cards: [parsed] }] = parseFenicioCards(html(['A1', card]));

  assert.deepEqual(parsed.prices.map((item) => item.amount), [1299, 12.5, 1299.5, 2500000, 45, null, 10.5]);
});

test('parseFenicioCards classifies the badges and where Fenicio places them', () => {
  const [{ cards: [card] }] = parseFenicioCards(html(['A1', FULL_CARD]));

  assert.deepEqual(card.badges, [
    {
      placement: { area: 'over-image', container: 'cocardas', slot: 'dfl' },
      kind: 'nuevo',
      label: 'Nuevo',
      image: null,
      percentage: null,
      promotionId: null,
      groupId: null,
      endsAt: null,
      classes: ['ico', 'nuevo'],
    },
    {
      placement: { area: 'over-image', container: 'cocardas', slot: 'dfl' },
      kind: 'promotion',
      label: '3x2',
      image: { url: '/promo.png', alt: '3x2' },
      percentage: null,
      promotionId: '77',
      groupId: null,
      endsAt: '2026-12-31',
      classes: ['ico', 'promo', 'promo12'],
    },
    {
      placement: { area: 'over-image', container: 'cocardas', slot: 'ctm' },
      kind: 'group',
      label: 'Grupo especial',
      image: null,
      percentage: null,
      promotionId: null,
      groupId: '5',
      endsAt: null,
      classes: ['promo-data', 'grupo5'],
    },
    {
      placement: { area: 'over-image', container: 'porcRebaja', slot: null },
      kind: 'discount',
      label: null,
      image: null,
      percentage: 25.5,
      promotionId: null,
      groupId: null,
      endsAt: null,
      classes: ['porcRebaja'],
    },
    {
      placement: { area: 'below-image-line', container: 'cocardasTexto', slot: null },
      kind: 'envio-gratis',
      label: 'Envío gratis',
      image: null,
      percentage: null,
      promotionId: null,
      groupId: null,
      endsAt: null,
      classes: ['envio-gratis'],
    },
    {
      placement: { area: 'below-image-line', container: 'cocardasTexto', slot: null },
      kind: 'custom',
      label: null,
      image: null,
      percentage: null,
      promotionId: null,
      groupId: null,
      endsAt: null,
      classes: ['ico', 'fn-hidden'],
    },
  ]);
});

test('parseFenicioCards covers the remaining badge variants', () => {
  const card = `
    <div class="it">
      <div class="cocardas">
        <span class="ico sale">Sale</span>
        <span class="ico outlet">Outlet</span>
        <span class="ico promo9">Promo</span>
        <span class="ico grupo">Grupo</span>
      </div>
      <div class="porcRebaja"><span class="int">30</span> % OFF</div>
      <div class="porcRebaja"><span class="int">abc</span></div>
      <div class="porcRebaja">Liquidación</div>
    </div>`;

  const [{ cards: [parsed] }] = parseFenicioCards(html(['A1', card]));
  const summary = parsed.badges.map(({ kind, label, percentage, promotionId, groupId }) => ({ kind, label, percentage, promotionId, groupId }));

  assert.deepEqual(summary, [
    { kind: 'sale', label: 'Sale', percentage: null, promotionId: null, groupId: null },
    { kind: 'outlet', label: 'Outlet', percentage: null, promotionId: null, groupId: null },
    { kind: 'promotion', label: 'Promo', percentage: null, promotionId: '9', groupId: null },
    { kind: 'group', label: 'Grupo', percentage: null, promotionId: null, groupId: null },
    { kind: 'discount', label: '30 % OFF', percentage: 30, promotionId: null, groupId: null },
    { kind: 'discount', label: 'abc', percentage: null, promotionId: null, groupId: null },
    { kind: 'discount', label: 'Liquidación', percentage: null, promotionId: null, groupId: null },
  ]);
});

test('parseFenicioCards reads the payment method discounts', () => {
  const [{ cards: [card] }] = parseFenicioCards(html(['A1', FULL_CARD]));

  assert.deepEqual(card.paymentDiscounts, [
    {
      id: '42',
      placement: { area: 'below-card-line', container: 'descuentosMDP', slot: null },
      label: 'Visa',
      image: { url: '/visa.png', alt: null },
      price: {
        type: 'current',
        amount: 899,
        amountText: '899,00',
        formatted: '899,00',
        currency: { code: 'UYU', symbol: '$' },
        classes: ['precio', 'venta'],
      },
      classes: ['desc_42'],
    },
    {
      id: null,
      placement: { area: 'below-card-line', container: 'descuentosMDP', slot: null },
      label: 'Solo texto',
      image: null,
      price: null,
      classes: ['otro'],
    },
  ]);
});

test('parseFenicioCards falls back to the native data, and survives cards without it', () => {
  const fromData = `<div class="it" data-disp="0"><input class="json" value="${attr(NATIVE_DATA)}"></div>`;
  const broken = '<div class="it"><input class="json" value="{not json"><div class="precios"><span class="precio">10</span></div></div>';
  const empty = '<div class="it"><input class="json" value=""></div>';

  const [{ cards }] = parseFenicioCards(html(['A1', fromData + broken + empty]));

  assert.deepEqual(
    cards.map(({ code, variantCode, available, data }) => ({ code, variantCode, available, data })),
    [
      { code: 'A1', variantCode: 'ROJO', available: false, data: NATIVE_DATA },
      { code: null, variantCode: null, available: null, data: null },
      { code: null, variantCode: null, available: null, data: null },
    ],
  );
  assert.deepEqual(cards[1].prices[0].currency, { code: null, symbol: null });
  assert.deepEqual(cards[2], {
    code: null, variantCode: null, available: null, data: null, prices: [], badges: [], paymentDiscounts: [],
  });
});

test('parseFenicioCards groups by product code, in the order requested', () => {
  const card = (variant) => `<div class="it" data-codvar="${variant}"></div>`;
  const source = html(['B2', card('b-1')], ['A1', card('a-1')], ['', card('ignored')], ['B2', card('b-2') + card('b-3')]);
  const variants = (groups) => groups.map((group) => [group.code, group.cards.map((item) => item.variantCode)]);

  assert.deepEqual(variants(parseFenicioCards(source)), [['B2', ['b-1', 'b-2', 'b-3']], ['A1', ['a-1']]]);
  assert.deepEqual(
    variants(parseFenicioCards(source, [' A1 ', 'ZZ', 'B2', 'A1', null])),
    [['A1', ['a-1']], ['ZZ', []], ['B2', ['b-1', 'b-2', 'b-3']]],
  );
  assert.deepEqual(variants(parseFenicioCards(source, 'A1')), [['A1', ['a-1']]]);
  assert.deepEqual(parseFenicioCards(''), []);
});

test('getFenicioCards validates its arguments before asking anything', async () => {
  const calls = mockFetch(() => '');

  await assert.rejects(getFenicioCards('A1', null), { name: 'TypeError', message: 'getFenicioCards options must be an object' });
  await assert.rejects(getFenicioCards('A1', ['html']), /options must be an object/);
  await assert.rejects(getFenicioCards('A1', 'parsed'), /options must be an object/);
  await assert.rejects(getFenicioCards([]), { name: 'TypeError', message: 'getFenicioCards requires at least one product code' });
  await assert.rejects(getFenicioCards([null, undefined, '  ']), /at least one product code/);
  await assert.rejects(getFenicioCards(undefined), /at least one product code/);
  await assert.rejects(getFenicioCards('A1', { responseType: 'json' }), { name: 'TypeError', message: 'getFenicioCards responseType must be "html" or "parsed"' });
  await assert.rejects(getFenicioCards('A1', { params: 'pagina=1' }), /options\.params must be an object or URLSearchParams/);
  await assert.rejects(getFenicioCards('A1', { params: [['pagina', 1]] }), /options\.params must be an object or URLSearchParams/);

  assert.equal(calls.length, 0);
});

test('getFenicioCards asks the storefront for the cards and returns the HTML untouched', async () => {
  const body = html(['A1', FULL_CARD]);
  const calls = mockFetch(() => body);

  const result = await getFenicioCards([' A1 ', 'B2', 'A1', 7, null]);

  assert.equal(result, body);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/catalogo/cargar-variantes?c%5B%5D=A1&c%5B%5D=B2&c%5B%5D=7&paginaCatalogo=');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(calls[0].headers, { 'X-Requested-With': 'XMLHttpRequest' });
});

test('getFenicioCards merges extra query params without letting them replace the codes', async () => {
  const calls = mockFetch(() => '');
  const query = () => {
    const [path, search] = calls.at(-1).url.split('?');
    assert.equal(path, '/catalogo/cargar-variantes');
    return [...new URLSearchParams(search)];
  };

  await getFenicioCards('A1', {
    params: { paginaCatalogo: 3, tags: ['a', null, 'b'], c: 'X', 'c[]': 'Y', skip: undefined, none: null, flag: false },
  });
  assert.deepEqual(query(), [['c[]', 'A1'], ['paginaCatalogo', '3'], ['tags', 'a'], ['tags', 'b'], ['flag', 'false']]);

  const params = new URLSearchParams();
  params.append('orden', 'precio');
  params.append('orden', 'nombre');
  params.append('c[]', 'Y');
  await getFenicioCards(['A1', 'B2'], { params });
  assert.deepEqual(query(), [['c[]', 'A1'], ['c[]', 'B2'], ['paginaCatalogo', ''], ['orden', 'precio'], ['orden', 'nombre']]);
});

test('getFenicioCards parses the answer when responseType is "parsed"', async () => {
  mockFetch(() => html(['B2', '<div class="it" data-codprod="B2" data-codvar="V"></div>'], ['A1', FULL_CARD]));

  const groups = await getFenicioCards(['A1', 'C3', 'B2'], { responseType: 'parsed' });

  assert.deepEqual(groups.map((group) => [group.code, group.cards.length]), [['A1', 1], ['C3', 0], ['B2', 1]]);
  assert.equal(groups[0].cards[0].prices[0].amount, 1299.9);
});

test('getFenicioCards rejects with the HTTP status when the storefront fails', async () => {
  mockFetch(() => jsonResponse('Service Unavailable', { status: 503 }));

  await assert.rejects(getFenicioCards('A1', { responseType: 'parsed' }), (error) => {
    assert.equal(error.message, 'Fenicio cards request failed with status 503');
    assert.equal(error.status, 503);
    return true;
  });
});
