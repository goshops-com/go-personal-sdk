import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const localSdk = readFileSync('./dist/gs-sdk.js', 'utf-8');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

// Intercept prod SDK and serve local build
await page.route('**/gs-sdk.js', async (route) => {
  console.log('  [INTERCEPTED] ' + route.request().url());
  await route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: localSdk,
  });
});

// Collect console errors
const errors = [];
const logs = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.text().includes('go personal') || msg.text().includes('Missing helper') || msg.text().includes('onlyData')) {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  }
});

// Collect network requests to gopersonal
const gpRequests = [];
page.on('response', (res) => {
  const url = res.url();
  if (url.includes('gopersonal.ai') || url.includes('goshops.ai')) {
    gpRequests.push(`[${res.status()}] ${res.request().method()} ${url}`);
  }
});

console.log('\n── Loading oechsle.pe with local SDK ──');
await page.goto('https://www.oechsle.pe/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(10000);

console.log('\n── GoPersonal network requests ──');
for (const r of gpRequests) console.log('  ' + r);

console.log('\n── SDK logs ──');
for (const l of logs) console.log('  ' + l);

const handlebarsErrors = errors.filter(e => e.includes('Missing helper') || e.includes('Handlebars') || e.includes('renderTemplate'));
console.log('\n── Handlebars/render errors ──');
if (handlebarsErrors.length === 0) {
  console.log('  ✓ No Handlebars errors');
} else {
  for (const e of handlebarsErrors) console.log('  ✗ ' + e);
}

// Check if onlyData=true was used
const onlyDataRequests = gpRequests.filter(r => r.includes('onlyData=true'));
const variantGets = gpRequests.filter(r => r.includes('/variant/'));
console.log('\n── Flow verification ──');
console.log(`  ${onlyDataRequests.length > 0 ? '✓' : '✗'} POST with onlyData=true: ${onlyDataRequests.length} requests`);
console.log(`  ${variantGets.length > 0 ? '✓' : '✗'} GET variant templates: ${variantGets.length} requests`);

// Check all requests succeeded
const failedRequests = gpRequests.filter(r => !r.startsWith('[200]') && !r.startsWith('[201]') && !r.startsWith('[204]'));
console.log(`  ${failedRequests.length === 0 ? '✓' : '✗'} All GP requests succeeded`);
if (failedRequests.length > 0) {
  for (const f of failedRequests) console.log('    ' + f);
}

const allOk = handlebarsErrors.length === 0 && onlyDataRequests.length > 0 && variantGets.length > 0 && failedRequests.length === 0;
console.log(`\n── Result: ${allOk ? 'PASS' : 'FAIL'} ──\n`);

await browser.close();
process.exit(allOk ? 0 : 1);
