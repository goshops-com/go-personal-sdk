import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const localSdk = readFileSync('./dist/gs-sdk.js', 'utf-8');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

await page.route('**/gs-sdk.js', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: localSdk,
  });
});

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

console.log('Loading oechsle.pe with local SDK...');
await page.goto('https://www.oechsle.pe/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(12000);

// Close any modals/popups
await page.evaluate(() => {
  // Remove overlay modals
  document.querySelectorAll('.vtex-modal-layout-0-x-paper, .vtex-store-components-3-x-closeButtonContainer, [class*="modal"], [class*="popup"], [class*="overlay"]').forEach(el => {
    if (el.offsetHeight > 200) el.remove();
  });
  // Click close buttons
  document.querySelectorAll('[class*="close"], [aria-label="close"], [aria-label="Close"]').forEach(btn => btn.click());
});
await page.waitForTimeout(1000);

// Find and scroll to gopersonal element
const gpEl = await page.$('[data-gopersonal="true"]');
if (gpEl) {
  await gpEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test/screenshot-carousel.png' });
  console.log('Carousel screenshot saved');

  // Get info about the carousel
  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-gopersonal="true"]');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      id: el.id,
      width: rect.width,
      height: rect.height,
      children: el.children.length,
      innerHTML: el.innerHTML.slice(0, 500),
      hasImages: el.querySelectorAll('img').length,
      hasLinks: el.querySelectorAll('a').length,
    };
  });
  console.log('\nCarousel info:', JSON.stringify(info, null, 2));
} else {
  console.log('No gopersonal element found!');
}

// Also take a full page screenshot without modals
await page.screenshot({ path: 'test/screenshot-oechsle-clean.png', fullPage: true });
console.log('Full page screenshot saved');

const renderErrors = errors.filter(e => e.includes('Handlebars') || e.includes('Missing helper') || e.includes('renderTemplate'));
if (renderErrors.length > 0) {
  console.log('\nRender errors:');
  for (const e of renderErrors) console.log('  ✗ ' + e);
} else {
  console.log('\n✓ No render errors');
}

await browser.close();
