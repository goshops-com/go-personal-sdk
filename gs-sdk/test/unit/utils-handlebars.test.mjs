import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import Handlebars from 'handlebars/dist/handlebars.js';
import { resetDom } from './helpers/env.mjs';
import { renderTemplate, renderRaw } from '../../src/utils/handlebars.js';

beforeEach(() => resetDom());
afterEach(() => mock.restoreAll());

// ---------------------------------------------------------------------------
// Helpers registered on Handlebars (exercised through renderRaw, which does
// not rewrite the template).
// ---------------------------------------------------------------------------

test('recommendations helper iterates arrays and plain objects, and ignores other values', () => {
  const template = '{{#recommendations items}}<i>{{name}}</i>{{/recommendations}}';
  assert.equal(renderRaw(template, { items: [{ name: 'a' }, { name: 'b' }] }), '<i>a</i><i>b</i>');
  assert.equal(renderRaw(template, { items: { x: { name: 'c' }, y: { name: 'd' } } }), '<i>c</i><i>d</i>');
  assert.equal(renderRaw(template, { items: 'not-a-list' }), '');
});

test('recommendations helper skips inherited properties of an object', () => {
  const items = Object.create({ inherited: { name: 'no' } });
  items.own = { name: 'yes' };
  assert.equal(renderRaw('{{#recommendations items}}{{name}}{{/recommendations}}', { items }), 'yes');
});

test('chunk helper splits an array in groups of the given size', () => {
  const template = '{{#each (chunk items "2")}}[{{#each this}}{{this}}{{/each}}]{{/each}}';
  assert.equal(renderRaw(template, { items: [1, 2, 3, 4, 5] }), '[12][34][5]');
});

test('eq and ne helpers compare loosely', () => {
  const template = '{{#if (eq a b)}}same{{else}}different{{/if}}|{{#if (ne a b)}}ne{{else}}not-ne{{/if}}';
  assert.equal(renderRaw(template, { a: 1, b: '1' }), 'same|not-ne');
  assert.equal(renderRaw(template, { a: 1, b: 2 }), 'different|ne');
});

test('isYes helper maps "Yes" to the string true and anything else to false', () => {
  assert.equal(renderRaw('{{isYes a}}/{{isYes b}}', { a: 'Yes', b: 'yes' }), 'true/false');
});

test('divide helper divides two numbers', () => {
  assert.equal(renderRaw('{{divide a b}}', { a: 9, b: 2 }), '4.5');
});

test('trunc helper drops the decimals and returns 0 for non numeric values', () => {
  assert.equal(renderRaw('{{trunc a}}|{{trunc b}}|{{trunc c}}', { a: '12.99', b: -3.7, c: 'abc' }), '12|-3|0');
});

test('applyDiscount helper applies a percentage, capped by the optional limit', () => {
  assert.equal(renderRaw('{{applyDiscount price pct}}', { price: '200', pct: '10' }), '180');
  // 50% of 200 would be 100, but the limit caps the discount at 30.
  assert.equal(renderRaw('{{applyDiscount price pct limit}}', { price: 200, pct: 50, limit: '30' }), '170');
  // Below the limit the plain percentage is used.
  assert.equal(renderRaw('{{applyDiscount price pct limit}}', { price: 200, pct: 10, limit: 30 }), '180');
  assert.equal(renderRaw('{{applyDiscount price pct}}', { price: 'x', pct: 10 }), '0');
  assert.equal(renderRaw('{{applyDiscount price pct}}', { price: 10, pct: 'x' }), '0');
});

test('slice helper returns a portion of an array and an empty list for non arrays', () => {
  const template = '{{#each (slice items 1 3)}}{{this}}{{/each}}';
  assert.equal(renderRaw(template, { items: ['a', 'b', 'c', 'd'] }), 'bc');
  assert.equal(renderRaw(template, { items: 'abcd' }), '');
});

test('getDiscount helper returns the rounded discount percentage', () => {
  assert.equal(renderRaw('{{getDiscount price list}}', { price: '75', list: '100' }), '25');
  assert.equal(renderRaw('{{getDiscount price list}}', { price: 2, list: 3 }), '33');
  assert.equal(renderRaw('{{getDiscount price list}}', { price: 100, list: 100 }), '0');
  assert.equal(renderRaw('{{getDiscount price list}}', { price: 'x', list: 100 }), '0');
  assert.equal(renderRaw('{{getDiscount price list}}', { price: 10, list: 'x' }), '0');
});

// ---------------------------------------------------------------------------
// renderRaw / compile cache
// ---------------------------------------------------------------------------

test('renderRaw renders the template with the data as is', () => {
  assert.equal(renderRaw('Hi {{user.name}} <{{tag}}>', { user: { name: 'Ana' }, tag: '<b>' }), 'Hi Ana <&lt;b&gt;>');
});

test('a template is compiled once and reused on later renders', () => {
  const compile = mock.method(Handlebars, 'compile');
  const template = 'compile-once {{value}}';
  assert.equal(renderRaw(template, { value: 1 }), 'compile-once 1');
  assert.equal(renderRaw(template, { value: 2 }), 'compile-once 2');
  assert.equal(compile.mock.callCount(), 1);
});

test('a non string template (parsed AST) is compiled on every render', () => {
  const ast = Handlebars.parse('ast {{value}}');
  const compile = mock.method(Handlebars, 'compile');
  assert.equal(renderRaw(ast, { value: 1 }), 'ast 1');
  assert.equal(renderRaw(ast, { value: 2 }), 'ast 2');
  assert.equal(compile.mock.callCount(), 2);
});

test('the compiled template cache is emptied once it reaches 100 entries', () => {
  const first = 'cache-limit first {{value}}';
  renderRaw(first, { value: 0 });
  const compile = mock.method(Handlebars, 'compile');
  renderRaw(first, { value: 0 });
  assert.equal(compile.mock.callCount(), 0, 'still cached');

  // Enough distinct templates to overflow the cache whatever it already held.
  for (let i = 0; i < 100; i++) {
    assert.equal(renderRaw(`cache-limit ${i} {{value}}`, { value: i }), `cache-limit ${i} ${i}`);
  }
  assert.equal(compile.mock.callCount(), 100);

  renderRaw(first, { value: 0 });
  assert.equal(compile.mock.callCount(), 101, 'the first template was evicted and compiled again');
});

test('the strict "eq" passed as a compile option is not the one used when rendering', () => {
  // src/utils/handlebars.js passes `{ helpers: { eq: (a, b) => a === b } }` to
  // Handlebars.compile. Handlebars ignores `helpers` at compile time, so the
  // loose global helper is the one that runs. Flagged as suspicious.
  const compile = mock.method(Handlebars, 'compile');
  const template = 'strict-eq {{#if (eq a b)}}same{{else}}different{{/if}}';
  const rendered = renderRaw(template, { a: 1, b: '1' });

  const options = compile.mock.calls[0].arguments[1];
  assert.equal(typeof options.helpers.eq, 'function');
  assert.equal(options.helpers.eq(1, '1'), false);
  assert.equal(options.helpers.eq('a', 'a'), true);
  assert.equal(rendered, 'strict-eq same');
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

const textVar = (name, value) => ({ name, type: { id: 'text' }, value });

test('renderTemplate replaces template variables, including names with spaces', () => {
  const html = renderTemplate(
    '<h1>{{title}}</h1><p>{{sub title}}</p>',
    [textVar('title', 'Hello'), textVar('sub title', 'World')],
    { variantId: 'v1' },
  );
  assert.equal(html, '<h1>Hello</h1><p>World</p>');
});

test('renderTemplate works without data', () => {
  assert.equal(renderTemplate('<b>{{title}}</b>{{gs_contentName}}', [textVar('title', 'T')]), '<b>T</b>');
});

test('renderTemplate keeps dotted paths, block helpers and isYes calls untouched', () => {
  const html = renderTemplate(
    '{{session.name}}|{{#if show}}on{{/if}}|{{isYes flag}}|{{ isYes flag}}',
    [textVar('show', true), textVar('flag', 'Yes')],
    { session: { name: 'Ana' } },
  );
  assert.equal(html, 'Ana|on|true|true');
});

test('renderTemplate removes the blocks between ignore_start and ignore_end', () => {
  const html = renderTemplate(
    'a<!-- ignore_start --><p>{{title}}</p>\n<!-- ignore_end -->b<!-- ignore_start -->x<!-- ignore_end -->c',
    [textVar('title', 'T')],
    {},
  );
  assert.equal(html, 'abc');
});

test('renderTemplate outputs gs_recommendations unescaped', () => {
  const html = renderTemplate('<div>{{gs_recommendations}}</div>', [], { gs_recommendations: '<ul><li>1</li></ul>' });
  assert.equal(html, '<div><ul><li>1</li></ul></div>');
});

test('renderTemplate exposes the content metadata as gs_ variables', () => {
  const html = renderTemplate(
    '{{gs_variantId}}|{{gs_targetId}}|{{gs_recoImpressionId}}|{{gs_contentName}}|{{gs_contentId}}|{{impressionId}}',
    [],
    { variantId: 'v1', target: 't1', recoImpressionId: 'r1', contentName: 'Banner', contentId: 'c1', impressionId: 'i1' },
  );
  assert.equal(html, 'v1|t1|r1|Banner|c1|i1');
  assert.equal(renderTemplate('[{{gs_contentName}}{{gs_contentId}}{{impressionId}}]', [], {}), '[]');
});

test('renderTemplate serializes list variables and skips the recommendation settings', () => {
  const html = renderTemplate(
    '{{{items}}}|{{gs_strategy}}|{{gs_count}}',
    [
      { name: 'items', type: { id: 'list' }, value: ['a', 'b'] },
      { name: 'gs_strategy', type: { id: 'gs_recoStrategy' }, value: 'best_sellers' },
      { name: 'gs_count', type: { id: 'gs_recoCount' }, value: 8 },
    ],
    {},
  );
  assert.equal(html, '["a","b"]||');
});

test('renderTemplate uses the default value of a customer property until the API resolves it', () => {
  const variables = [
    { name: 'name', type: { id: 'customer_property' }, value: { id: 'firstName' }, defaultValue: 'friend' },
    { name: 'city', type: { id: 'customer_property' }, value: { id: 'city' } },
    { name: 'points', type: { id: 'customer_property' }, value: { id: 'points' }, defaultValue: 0 },
  ];
  assert.equal(renderTemplate('Hi {{name}} from [{{city}}] with {{points}}', variables, {}), 'Hi friend from [] with 0');
});

test('renderTemplate takes the resolved customer property from data.variables', () => {
  const variables = [
    { name: 'name', type: { id: 'customer_property' }, value: { id: 'firstName' }, defaultValue: 'friend' },
    { name: 'city', type: { id: 'customer_property' }, value: { id: 'city' }, defaultValue: 'somewhere' },
    { name: 'tier', type: { id: 'customer_property' }, value: { id: 'tier' }, defaultValue: 'basic' },
  ];
  const data = {
    variables: [
      { name: 'name', type: { id: 'customer_property' }, value: 'Ana' },
      // Not resolved (old API): the property object comes back as the value.
      { name: 'city', type: { id: 'customer_property' }, value: { id: 'city' }, defaultValue: 'somewhere' },
      { name: 'tier', type: { id: 'customer_property' }, value: null },
    ],
  };
  assert.equal(renderTemplate('{{name}}|{{city}}|[{{tier}}]', variables, data), 'Ana|somewhere|[]');
});

test('renderTemplate overrides social proof and strategy variables with the values in data.variables', () => {
  const variables = [
    textVar('views', '0'),
    textVar('strategy', 'default'),
    textVar('other', 'kept'),
    textVar('nested', 'default'),
  ];
  const data = {
    variables: [
      { name: 'views', type: { id: 'social_proof' }, value: 42 },
      { name: 'strategy', type: { id: 'select', options: [{ type: 'strategy' }] }, value: 'best_sellers' },
      { name: 'nested', type: { id: 'select' }, options: [{ type: { id: 'strategy' } }], value: 'trending' },
      // Any other type is ignored: the template value stays.
      { name: 'other', type: { id: 'text' }, value: 'overridden' },
      { name: 'other', type: { id: 'select', options: 'not-a-list' }, value: 'overridden' },
      null,
    ],
  };
  assert.equal(
    renderTemplate('{{views}}|{{strategy}}|{{nested}}|{{other}}', variables, data),
    '42|best_sellers|trending|kept',
  );
});

test('renderTemplate serializes a list coming from a strategy variable in data.variables', () => {
  const data = {
    variables: [{ name: 'ids', type: { id: 'list', options: [{ type: 'strategy' }] }, value: [1, 2] }],
  };
  assert.equal(renderTemplate('{{{ids}}}', [], data), '[1,2]');
});

test('renderTemplate maps product property variables onto each recommended item', () => {
  const variables = [
    { name: 'productTitle', type: { id: 'product_property' }, value: { id: 'name' } },
    { name: 'productImage', type: { id: 'product_property' }, value: { id: 'image' } },
    textVar('heading', 'For you'),
  ];
  const data = {
    hasRecommendationsBlockFlag: true,
    recommendations: [
      { name: 'Shoe', imgs: [{ url: 'https://img/shoe.png' }, { url: 'https://img/shoe-2.png' }] },
      { name: 'Hat', imgs: [] },
      { name: 'Sock' },
    ],
  };
  const html = renderTemplate(
    '<h2>{{heading}}</h2>{{#recommendations items}}<a data-img="{{productImage}}">{{productTitle}}</a>{{/recommendations}}',
    variables,
    data,
  );
  assert.equal(
    html,
    '<h2>For you</h2><a data-img="https://img/shoe.png">Shoe</a><a data-img="">Hat</a><a data-img="">Sock</a>',
  );
  assert.equal(data.recommendations[0].productTitle, 'Shoe');
});

test('renderTemplate without the recommendations flag does not expose items', () => {
  const html = renderTemplate(
    '[{{#recommendations items}}x{{/recommendations}}]',
    [{ name: 'productTitle', type: { id: 'product_property' }, value: { id: 'name' } }],
    { recommendations: [{ name: 'Shoe' }] },
  );
  assert.equal(html, '[]');
});
