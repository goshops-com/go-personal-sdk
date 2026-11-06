import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const clone = value => JSON.parse(JSON.stringify(value));

const createElement = ({ classes = '', text = '', attrs = {}, selectors = {}, closest = null, value } = {}) => {
  const classList = classes.split(/\s+/).filter(Boolean);
  classList.contains = className => classList.includes(className);

  return {
    className: classes,
    classList,
    textContent: text,
    value,
    getAttribute(name) {
      return Object.hasOwn(attrs, name) ? attrs[name] : null;
    },
    hasAttribute(name) {
      return Object.hasOwn(attrs, name);
    },
    querySelector(selector) {
      return selectors[selector]?.[0] || null;
    },
    querySelectorAll(selector) {
      return selectors[selector] || [];
    },
    closest() {
      return closest;
    },
  };
};

const createImage = image => createElement({
  attrs: {
    src: image?.src || null,
    alt: image?.alt || null,
  },
});

const createPrice = price => {
  const amount = createElement({ text: price.amount });
  const symbol = createElement({ text: price.symbol });
  return createElement({
    classes: price.classes,
    text: `${price.symbol} ${price.amount}`,
    selectors: {
      '.monto': [amount],
      '.sim': [symbol],
    },
  });
};

const createBadge = badge => {
  const selectors = {};
  if (badge.image) selectors.img = [createImage(badge.image)];
  if (badge.integer) selectors['.int'] = [createElement({ text: badge.integer })];
  if (badge.decimal) selectors['.dec'] = [createElement({ text: badge.decimal })];
  const slot = badge.slot ? createElement({ classes: badge.slot }) : null;
  return createElement({
    classes: badge.classes,
    text: badge.text,
    attrs: badge.attrs,
    selectors,
    closest: slot,
  });
};

const createPaymentDiscount = discount => {
  const image = createImage(discount.image);
  const price = createPrice(discount.price);
  const label = createElement({ attrs: { title: discount.image.alt } });
  return createElement({
    classes: discount.classes,
    text: `${discount.image.alt} ${discount.price.symbol} ${discount.price.amount}`,
    selectors: {
      img: [image],
      '.img': [label],
      '.precio': [price],
    },
  });
};

const createCard = card => {
  const prices = (card.prices || []).map(createPrice);
  const imageBadges = (card.imageBadges || []).map(createBadge);
  const discountBadges = (card.discountBadges || []).map(createBadge);
  const lowerBadges = (card.lowerBadges || []).map(createBadge);
  const discounts = (card.paymentDiscounts || []).map(createPaymentDiscount);
  const json = createElement({
    value: typeof card.data === 'string' ? card.data : JSON.stringify(card.data),
  });

  return createElement({
    classes: 'it',
    attrs: {
      'data-codprod': card.code,
      'data-codvar': card.variantCode,
      'data-disp': card.available ? '1' : '0',
    },
    selectors: {
      'input.json': [json],
      '.precios .precio': prices,
      '.cocardas .ico, .cocardas .promo-data': imageBadges,
      '.porcRebaja': discountBadges,
      '.cocardasTexto > *': lowerBadges,
      '.descuentosMDP > *': discounts,
    },
  });
};

class FixtureDOMParser {
  parseFromString(source) {
    const fixture = JSON.parse(source);
    const groups = fixture.groups.map(group => createElement({
      attrs: { 'data-codigo': group.code },
      selectors: { '.it': group.cards.map(createCard) },
    }));
    return createElement({ selectors: { '[data-codigo]': groups } });
  }
}

async function loadFenicioCards(fetch) {
  const path = new URL('../src/providers/fenicioCards.js', import.meta.url);
  const source = (await readFile(path, 'utf8')).replace(/export const /g, 'const ');
  const window = { location: { href: 'https://store.test/' } };
  const context = vm.createContext({
    DOMParser: FixtureDOMParser,
    Error,
    Map,
    Number,
    Object,
    Promise,
    Set,
    TypeError,
    URL,
    URLSearchParams,
    fetch,
    window,
  });

  vm.runInContext(
    `${source}\nglobalThis.__test = { getFenicioCards, parseFenicioCards };`,
    context,
  );
  return context.__test;
}

const response = body => ({
  ok: true,
  status: 200,
  text: async () => body,
});

test('getFenicioCards returns the endpoint HTML unchanged by default', async () => {
  const requests = [];
  const html = '<div data-codigo="A">native card</div>';
  const { getFenicioCards } = await loadFenicioCards(async (url, options) => {
    requests.push({ url, options });
    return response(html);
  });

  const result = await getFenicioCards([' A ', 'B', 'A'], {
    params: { paginaCatalogo: '12', filtro: ['sale', 'stock'] },
  });

  assert.equal(result, html);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.headers['X-Requested-With'], 'XMLHttpRequest');

  const query = new URLSearchParams(requests[0].url.split('?')[1]);
  assert.deepEqual(query.getAll('c[]'), ['A', 'B']);
  assert.equal(query.get('paginaCatalogo'), '12');
  assert.deepEqual(query.getAll('filtro'), ['sale', 'stock']);
});

test('getFenicioCards parses prices, image/lower badges and payment discounts', async () => {
  const fixture = JSON.stringify({
    groups: [{
      code: 'A',
      cards: [{
        code: 'A',
        variantCode: 'RED',
        available: true,
        data: {
          producto: { codigo: 'A', nombre: 'Product A' },
          variante: { codigo: 'RED' },
          precioMonto: 1274,
          moneda: { cod: 'UYU', sim: '$' },
        },
        prices: [
          { classes: 'precio venta', symbol: '$', amount: '1.274' },
          { classes: 'precio lista', symbol: '$', amount: '1.699' },
        ],
        imageBadges: [{
          classes: 'ico promo promo389',
          slot: 'ctm',
          integer: '25',
          decimal: '01',
          image: { src: '//cdn.test/promo.png', alt: '25% off' },
          attrs: { 'data-id': '389', 'data-fecha-fin': '2026-11-08' },
        }],
        discountBadges: [{ classes: 'porcRebaja', integer: '25' }],
        lowerBadges: [{ classes: 'nuevo', text: 'Nuevos' }],
        paymentDiscounts: [{
          classes: 'desc_25',
          image: { src: '//cdn.test/bank.svg', alt: 'Santander 15 Débito' },
          price: { classes: 'precio', symbol: '$', amount: '1.083' },
        }],
      }],
    }],
  });
  const { getFenicioCards } = await loadFenicioCards(async () => response(fixture));

  const groups = await getFenicioCards(['A', 'MISSING'], { responseType: 'parsed' });
  const result = clone(groups);

  assert.equal(result[0].cards[0].data.producto.nombre, 'Product A');
  assert.deepEqual(result[0].cards[0].prices.map(price => [price.type, price.amount]), [
    ['current', 1274],
    ['list', 1699],
  ]);
  assert.deepEqual(result[0].cards[0].badges.map(badge => [badge.placement, badge.kind]), [
    [{ area: 'over-image', container: 'cocardas', slot: 'ctm' }, 'promotion'],
    [{ area: 'over-image', container: 'porcRebaja', slot: null }, 'discount'],
    [{ area: 'below-image-line', container: 'cocardasTexto', slot: null }, 'nuevo'],
  ]);
  assert.equal(result[0].cards[0].badges[0].percentage, 25.01);
  assert.equal(result[0].cards[0].badges[0].image.url, '//cdn.test/promo.png');
  assert.equal(result[0].cards[0].paymentDiscounts[0].label, 'Santander 15 Débito');
  assert.deepEqual(result[0].cards[0].paymentDiscounts[0].placement, {
    area: 'below-card-line',
    container: 'descuentosMDP',
    slot: null,
  });
  assert.equal(result[0].cards[0].paymentDiscounts[0].price.amount, 1083);
  assert.deepEqual(result[1], { code: 'MISSING', cards: [] });
});

test('getFenicioCards makes direct requests without a shared queue', async () => {
  const started = [];
  const pending = [];
  const { getFenicioCards } = await loadFenicioCards((url) => {
    started.push(new URLSearchParams(url.split('?')[1]).get('c[]'));
    return new Promise(resolve => pending.push(() => resolve(response('html'))));
  });

  const requests = ['A', 'B', 'C', 'D', 'E', 'F'].map(code => getFenicioCards(code));
  assert.deepEqual(started, ['A', 'B', 'C', 'D', 'E', 'F']);
  pending.forEach(resolve => resolve());
  await Promise.all(requests);
});
