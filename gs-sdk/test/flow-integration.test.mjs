import { renderTemplate, renderRaw } from '../src/utils/handlebars.js';

const BASE_URL = 'https://discover.gopersonal.ai';
const PROJECT = '661ef9b2e2e8dc1201433001';
const CONTENT_KEY = 'reco-home';

const TOKEN = process.env.GS_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwcm9qZWN0IjoiNjYxZWY5YjJlMmU4ZGMxMjAxNDMzMDAxIiwic2Vzc2lvbklkIjoiNjlhODc5YzZlMDYxYzA3NTE3MmVjMzAzIiwiZXhwIjoxNzcyNzM1MzAyLCJpYXQiOjE3NzI2NDg5MDJ9.oM_asUbPDugkJxoq3NxvbDMsd9nl8iCahmFZAemogxM';

async function postContentOnlyData() {
  const params = new URLSearchParams({ project: PROJECT, onlyData: 'true' });
  const url = `${BASE_URL}/personal/content/${CONTENT_KEY}?${params}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      context: {
        network: { downlink: 10, effectiveType: '4g' },
        screen: { width: 940, height: 934 },
        settings: { locale: 'en-US', timezoneOffset: 180 },
        currentPage: {
          customerId: '', type: 'home', cache: 0, provider: 'WooCommerce',
          location: 'https://ufojeans.com.uy/',
          referrer: 'https://www.google.com/',
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`POST failed: ${res.status} — ${await res.text()}`);
  return res.json();
}

async function getVariantTemplate(variantId) {
  const url = `${BASE_URL}/public/cached-content/${PROJECT}/variant/${variantId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET variant failed: ${res.status} — ${await res.text()}`);
  return res.json();
}

async function main() {
  let passed = 0;
  let failed = 0;

  function assert(name, ok, detail) {
    if (ok) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}`); if (detail) console.log(`    ${detail}`); failed++; }
  }

  // Step 1: POST with onlyData=true
  console.log('\n── Step 1: POST with onlyData=true ──');
  const postResult = await postContentOnlyData();
  const data = postResult.data;

  assert('Response has data', !!data);
  assert('data.variantId exists', typeof data.variantId === 'string');
  assert('data.contentKey matches', data.contentKey === CONTENT_KEY);
  assert('data.session exists', typeof data.session === 'object');
  assert('data.recommendations is array', Array.isArray(data.recommendations));
  assert('data.hasRecommendationsBlockFlag is bool', typeof data.hasRecommendationsBlockFlag === 'boolean');
  assert('data.target exists', typeof data.target === 'string');
  assert('data.recoImpressionId exists', typeof data.recoImpressionId === 'string');
  assert('data.contentName exists', typeof data.contentName === 'string');
  assert('data.contentId exists', typeof data.contentId === 'string');

  console.log(`  variantId: ${data.variantId}`);
  console.log(`  recommendations: ${data.recommendations.length} items`);

  // Step 2: GET variant template
  console.log('\n── Step 2: GET variant template ──');
  const variantResponse = await getVariantTemplate(data.variantId);

  assert('Response has variant', !!variantResponse.variant);
  assert('variant has templateValue', !!variantResponse.variant?.templateValue);
  assert('templateValue has html', typeof variantResponse.variant?.templateValue?.html === 'string');
  assert('templateValue has css', typeof variantResponse.variant?.templateValue?.css === 'string');
  assert('templateValue has js', typeof variantResponse.variant?.templateValue?.js === 'string');
  assert('templateValue has variables', Array.isArray(variantResponse.variant?.templateValue?.variables));
  assert('Response has selector', typeof variantResponse.selector === 'string');
  assert('Response has selectorPosition', typeof variantResponse.selectorPosition === 'string');
  assert('Response has type', typeof variantResponse.type === 'string');
  assert('Response has contentKey', variantResponse.contentKey === CONTENT_KEY);

  const templateValue = variantResponse.variant.templateValue;
  const variables = templateValue.variables || [];

  console.log(`  html: ${templateValue.html.length} chars, css: ${templateValue.css.length} chars, js: ${templateValue.js.length} chars`);
  console.log(`  variables: ${variables.length}, selector: ${variantResponse.selector}, type: ${variantResponse.type}`);

  // Step 3: Render with Handlebars
  console.log('\n── Step 3: Render with Handlebars ──');

  let renderedHtml, renderedCss, renderedJs;
  let renderError = null;

  try {
    renderedHtml = templateValue.html ? renderTemplate(templateValue.html, variables, data) : '';
    renderedCss = templateValue.css ? renderRaw(templateValue.css, { gs_variantId: data.variantId }) : '';
    renderedJs = templateValue.js ? renderTemplate(templateValue.js, variables, data) : '';
  } catch (e) {
    renderError = e;
  }

  assert('Render completed without errors', !renderError, renderError?.stack);

  if (!renderError) {
    assert('Rendered HTML is non-empty', renderedHtml.length > 0);
    assert('Rendered CSS is non-empty', renderedCss.length > 0);
    assert('Rendered JS is non-empty', renderedJs.length > 0);
    assert('HTML contains data-gopersonal', renderedHtml.includes('data-gopersonal'));
    assert('CSS contains variantId', renderedCss.includes(data.variantId));
    assert('HTML has no unresolved {{', !renderedHtml.match(/\{\{[^{].*?\}\}/),
      `Found: ${renderedHtml.match(/\{\{[^{].*?\}\}/)}`);
    assert('CSS has no unresolved {{', !renderedCss.match(/\{\{[^{].*?\}\}/),
      `Found: ${renderedCss.match(/\{\{[^{].*?\}\}/)}`);

    // Product data may be in HTML or JS (depends on template design)
    if (data.hasRecommendationsBlockFlag && data.recommendations.length > 0) {
      const firstProduct = data.recommendations[0];
      const combined = renderedHtml + renderedJs;
      assert('Product data in rendered output (HTML or JS)',
        combined.includes(firstProduct.name) || combined.includes(firstProduct.url),
        `Looking for "${firstProduct.name}" in ${renderedHtml.length}ch HTML + ${renderedJs.length}ch JS`);
    }

    // Content object for addContentToWebsite
    const content = {
      key: variantResponse.contentKey || CONTENT_KEY,
      contentValue: { html: renderedHtml, css: renderedCss, js: renderedJs },
      selector: variantResponse.selector,
      selectorPosition: variantResponse.selectorPosition,
      mobileSelector: variantResponse.mobileSelector,
      type: variantResponse.type,
      frequency: variantResponse.frequency,
      notAutomatic: variantResponse.notAutomatic,
      experienceId: variantResponse.experienceId,
    };

    assert('Content object has all required fields',
      content.key && content.contentValue && content.selector && content.type);

    console.log(`\n  rendered: html=${renderedHtml.length}ch, css=${renderedCss.length}ch, js=${renderedJs.length}ch`);
    console.log('\n── Rendered HTML ──');
    console.log(renderedHtml.slice(0, 500) + (renderedHtml.length > 500 ? '...' : ''));
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
