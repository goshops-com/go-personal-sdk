import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

const gpRequests = [];
page.on('response', (res) => {
  const url = res.url();
  if (url.includes('gopersonal.ai') || url.includes('goshops.ai')) {
    gpRequests.push(`[${res.status()}] ${res.request().method()} ${url}`);
  }
});

console.log('Loading oechsle.pe with PROD SDK...');
await page.goto('https://www.oechsle.pe/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(12000);

// Close modals
await page.evaluate(() => {
  document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"]').forEach(el => {
    if (el.offsetHeight > 200) el.remove();
  });
  document.querySelectorAll('[class*="close"], [aria-label="close"], [aria-label="Close"]').forEach(btn => btn.click());
});
await page.waitForTimeout(1000);

// Screenshot the carousel
const gpEl = await page.$('[data-gopersonal="true"]');
if (gpEl) {
  await gpEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test/screenshot-oechsle-prod.png' });
  console.log('Carousel screenshot saved');

  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-gopersonal="true"]');
    if (!el) return null;
    return {
      id: el.id,
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      children: el.children.length,
      hasImages: el.querySelectorAll('img').length,
      hasLinks: el.querySelectorAll('a').length,
      text: el.textContent?.slice(0, 150),
    };
  });
  console.log('\nCarousel:', JSON.stringify(info, null, 2));
} else {
  console.log('✗ No gopersonal element found');
}

console.log('\n── GoPersonal requests ──');
for (const r of gpRequests) console.log('  ' + r);

const onlyData = gpRequests.filter(r => r.includes('onlyData=true'));
const variants = gpRequests.filter(r => r.includes('/variant/'));
const renderErrors = errors.filter(e => e.includes('Handlebars') || e.includes('Missing helper'));

console.log('\n── Verification ──');
console.log(`  ${onlyData.length > 0 ? '✓' : '✗'} POST onlyData=true: ${onlyData.length}`);
console.log(`  ${variants.length > 0 ? '✓' : '✗'} GET variants: ${variants.length}`);
console.log(`  ${renderErrors.length === 0 ? '✓' : '✗'} Render errors: ${renderErrors.length}`);
if (renderErrors.length > 0) renderErrors.forEach(e => console.log('    ' + e));

const allOk = onlyData.length > 0 && variants.length > 0 && renderErrors.length === 0 && gpEl;
console.log(`\n── ${allOk ? 'PASS' : 'FAIL'} ──\n`);

await browser.close();
process.exit(allOk ? 0 : 1);
