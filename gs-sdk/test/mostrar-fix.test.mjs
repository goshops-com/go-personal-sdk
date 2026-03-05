import { renderTemplate } from '../src/utils/handlebars.js';

// Simulate the Oechsle CSS template with spaced variable names
const cssTemplate = `.container { display: {{Mostrar Indicadores}}; } .name { display: {{Mostrar Nombre}}; } .price { display: {{Mostrar Precio}}; } .variant_{{gs_variantId}} { color: red; }`;

const variables = [
  { name: 'Mostrar Indicadores', type: { id: 'text' }, value: 'flex' },
  { name: 'Mostrar Nombre', type: { id: 'text' }, value: 'inline-block' },
  { name: 'Mostrar Precio', type: { id: 'text' }, value: 'flex' },
];

const data = { variantId: 'abc123' };

try {
  const result = renderTemplate(cssTemplate, variables, data);
  console.log('✓ CSS with spaced variable names rendered OK');
  console.log('  Result:', result);

  const checks = [
    ['flex for Indicadores', result.includes('display: flex')],
    ['inline-block for Nombre', result.includes('display: inline-block')],
    ['variantId replaced', result.includes('variant_abc123')],
  ];

  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? '✓' : '✗'} ${name}`);
    if (!pass) ok = false;
  }

  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log('✗ FAILED with error:', e.message);
  process.exit(1);
}
