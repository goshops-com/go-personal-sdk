import { renderTemplate, renderRaw } from '../src/utils/handlebars.js';

let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertIncludes(name, actual, expected) {
  if (actual.includes(expected)) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    console.log(`    expected to include: ${JSON.stringify(expected)}`);
    console.log(`    actual:              ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── renderRaw tests (helpers) ──────────────────────────────

console.log('\n── renderRaw & helpers ──');

assert('eq helper (true)',
  renderRaw('{{#if (eq a b)}}yes{{else}}no{{/if}}', { a: 1, b: 1 }),
  'yes'
);

assert('eq helper (false)',
  renderRaw('{{#if (eq a b)}}yes{{else}}no{{/if}}', { a: 1, b: 2 }),
  'no'
);

assert('ne helper (true)',
  renderRaw('{{#if (ne a b)}}yes{{else}}no{{/if}}', { a: 1, b: 2 }),
  'yes'
);

assert('ne helper (false)',
  renderRaw('{{#if (ne a b)}}yes{{else}}no{{/if}}', { a: 1, b: 1 }),
  'no'
);

assert('isYes helper (Yes)',
  renderRaw('{{isYes val}}', { val: 'Yes' }),
  'true'
);

assert('isYes helper (No)',
  renderRaw('{{isYes val}}', { val: 'No' }),
  'false'
);

assert('divide helper',
  renderRaw('{{divide a b}}', { a: 10, b: 4 }),
  '2.5'
);

assert('trunc helper',
  renderRaw('{{trunc val}}', { val: '3.99' }),
  '3'
);

assert('trunc helper (NaN)',
  renderRaw('{{trunc val}}', { val: 'abc' }),
  '0'
);

assert('applyDiscount helper (10% off 1000)',
  renderRaw('{{applyDiscount price pct}}', { price: '1000', pct: '10' }),
  '900'
);

assert('applyDiscount helper with limit',
  renderRaw('{{applyDiscount price pct limit}}', { price: '1000', pct: '50', limit: '100' }),
  '900'
);

assert('applyDiscount helper (invalid)',
  renderRaw('{{applyDiscount price pct}}', { price: 'abc', pct: '10' }),
  '0'
);

assert('getDiscount helper',
  renderRaw('{{getDiscount price listPrice}}', { price: '80', listPrice: '100' }),
  '20'
);

assert('getDiscount helper (same price)',
  renderRaw('{{getDiscount price listPrice}}', { price: '100', listPrice: '100' }),
  '0'
);

assert('slice helper',
  renderRaw('{{#each (slice items 0 2)}}{{this}} {{/each}}', { items: ['a', 'b', 'c', 'd'] }),
  'a b '
);

assert('slice helper (not array)',
  renderRaw('{{#each (slice items 0 2)}}{{this}}{{/each}}', { items: 'not-an-array' }),
  ''
);

assert('chunk helper',
  renderRaw('{{#each (chunk items 2)}}[{{#each this}}{{this}}{{/each}}]{{/each}}', { items: ['a','b','c','d'] }),
  '[ab][cd]'
);

assert('recommendations helper (array)',
  renderRaw('{{#recommendations items}}{{name}} {{/recommendations}}', { items: [{ name: 'A' }, { name: 'B' }] }),
  'A B '
);

assert('recommendations helper (object)',
  renderRaw('{{#recommendations items}}{{name}} {{/recommendations}}', { items: { x: { name: 'X' }, y: { name: 'Y' } } }),
  'X Y '
);

// ── renderTemplate tests ───────────────────────────────────

console.log('\n── renderTemplate ──');

const basicVars = [
  { name: 'title', type: { id: 'text' }, value: 'Hello World' },
  { name: 'price', type: { id: 'number' }, value: '99' },
];

assert('basic variable substitution',
  renderTemplate('{{title}} costs {{price}}', basicVars, {}),
  'Hello World costs 99'
);

assert('list variable is JSON stringified (HTML-escaped by Handlebars double curly)',
  renderTemplate('{{myList}}', [
    { name: 'myList', type: { id: 'list' }, value: ['a', 'b'] }
  ], {}),
  '[&quot;a&quot;,&quot;b&quot;]'
);

assert('skips gs_recoStrategy and gs_recoCount',
  renderTemplate('{{title}}', [
    { name: 'title', type: { id: 'text' }, value: 'ok' },
    { name: 'strat', type: { id: 'gs_recoStrategy' }, value: 'skip' },
    { name: 'count', type: { id: 'gs_recoCount' }, value: '5' },
  ], {}),
  'ok'
);

assert('sets gs_variantId and gs_targetId',
  renderTemplate('{{gs_variantId}}-{{gs_targetId}}', [], { variantId: 'v1', target: 't1' }),
  'v1-t1'
);

assert('sets gs_contentName and gs_contentId',
  renderTemplate('{{gs_contentName}}-{{gs_contentId}}', [], { contentName: 'cn', contentId: 'ci' }),
  'cn-ci'
);

assert('session data accessible',
  renderTemplate('{{session.userId}}', [], { session: { userId: 'u123' } }),
  'u123'
);

assert('gs_recommendations triple-stache (unescaped)',
  renderTemplate('{{gs_recommendations}}', [], { gs_recommendations: '<b>html</b>' }),
  '<b>html</b>'
);

// ── renderTemplate with recommendations block ──────────────

console.log('\n── renderTemplate with recommendations ──');

const recoVars = [
  { name: 'productName', type: { id: 'product_property' }, value: { id: 'name' } },
  { name: 'productImage', type: { id: 'product_property' }, value: { id: 'image' } },
];

const recoData = {
  hasRecommendationsBlockFlag: true,
  recommendations: [
    { name: 'Shirt', price: 50, imgs: [{ url: 'shirt.jpg' }] },
    { name: 'Pants', price: 80, imgs: [{ url: 'pants.jpg' }] },
  ],
};

const recoResult = renderTemplate(
  '{{#recommendations items}}{{productName}}-{{productImage}} {{/recommendations}}',
  recoVars,
  recoData
);
assert('product_property mapping + image',
  recoResult,
  'Shirt-shirt.jpg Pants-pants.jpg '
);

// ── transformTemplate (via renderTemplate) ─────────────────

console.log('\n── transformTemplate (indirectly) ──');

assert('ignore_start/end blocks removed',
  renderTemplate('before<!-- ignore_start -->hidden<!-- ignore_end -->after', [], {}),
  'beforeafter'
);

// ── Summary ────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
