import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTree, decide, isSupportedVersion, inSample } from '../../src/utils/frontDecide.js';

const leaf = (x, o = null) => ({ f: 'current_url', o, x });
const and = (...c) => ({ t: 'and', c });
const or = (...c) => ({ t: 'or', c });

// ---------------------------------------------------------------------------
// Paridad con discover. La tabla sale de correr utils/targetEval.js (el
// evaluador del servidor) sobre el arbol de reglas original, con cada una de
// estas URLs como context.currentPage.location; aca se evalua el arbol ya
// normalizado (utils/contentFront.js normalizeRuleTree). Cada fila es
// [arbol, resultados]: un caracter por URL, 1 = matchea.
// ---------------------------------------------------------------------------

const LOCATIONS = [
  null, // el request no trae currentPage.location
  '',
  'https://shop.test/',
  'https://shop.test/sale',
  'https://shop.test/SALE?utm=1#top',
  'https://shop.test/ropa%20de%20ni%C3%B1o',
  'https://shop.test/ropa de niño',
  'https://shop.test/100%-off',
  '/sale',
  ' /sale ',
  'https://shop.test/Sale/zapatos?color=Rojo%20Oscuro&p=2',
];

const PARITY = [
  [{"t":"and","c":[{"f":"current_url","o":null,"x":"/sale"}]}, '00010000110'],
  [{"t":"and","c":[{"f":"current_url","o":"=","x":"/SALE"}]}, '00001000000'],
  [{"t":"and","c":[{"f":"current_url","o":"like","x":"sale"}]}, '00010000110'],
  [{"t":"and","c":[{"f":"current_url","o":"!=","x":"/sale"}]}, '11101111001'],
  [{"t":"and","c":[{"f":"current_url","o":"not_like","x":"ropa de niño"}]}, '11111001111'],
  [{"t":"and","c":[{"f":"current_url","o":null,"x":"ropa%20de%20ni%C3%B1o"}]}, '00000110000'],
  [{"t":"and","c":[{"f":"current_url","o":"like","x":"100%-off"}]}, '00000001000'],
  [{"t":"and","c":[{"f":"current_url","o":"like","x":" /sale"}]}, '00000000010'],
  [{"t":"and","c":[{"f":"current_url","o":"=","x":"Rojo Oscuro"}]}, '00000000001'],
  [{"t":"and","c":[{"f":"current_url","o":"!=","x":"rojo oscuro"}]}, '11111111111'],
  [{"t":"and","c":[{"f":"current_url","o":"in","x":"/sale"}]}, '00000000100'],
  [{"t":"and","c":[{"f":"current_url","o":"in","x":[" /SALE ","https://shop.test/"]}]}, '00100000100'],
  [{"t":"and","c":[{"f":"current_url","o":"not_in","x":["https://shop.test/ropa de niño"]}]}, '11111001111'],
  [{"t":"and","c":[{"f":"current_url","o":"in","x":["https://shop.test/ropa%20de%20ni%C3%B1o","/nada"]}]}, '00000110000'],
  [{"t":"and","c":[{"f":"current_url","o":"like_any","x":["SALE","ni%C3%B1o"]}]}, '00011110111'],
  [{"t":"and","c":[{"f":"current_url","o":"like_any","x":"  top "}]}, '00001000000'],
  [{"t":"and","c":[{"f":"current_url","o":"not_like_any","x":["/sale","%20"]}]}, '11100011000'],
  [{"t":"and","c":[{"f":"current_url","o":"not_like_any","x":["100%-OFF"]}]}, '11111110111'],
  [{"t":"and","c":[{"f":"current_url","o":"like_any","x":["ROJO oscuro","/nada"]}]}, '00000000001'],
  [{"t":"and","c":[{"f":"current_url","o":"not_in","x":"HTTPS://SHOP.TEST/SALE"}]}, '11101111111'],
  [{"t":"and","c":[]}, '11111111111'],
  [{"t":"or","c":[]}, '11111111111'],
  [{"t":"or","c":[{"f":"current_url","o":null,"x":"/sale"},{"f":"current_url","o":"not_like","x":"ropa de niño"}]}, '11111001111'],
  [{"t":"and","c":[{"f":"current_url","o":"like","x":"sale"},{"t":"or","c":[{"f":"current_url","o":"!=","x":"/sale"},{"f":"current_url","o":"like_any","x":["SALE","ni%C3%B1o"]}]}]}, '00010000110'],
  [{"t":"and","c":[{"t":"or","c":[]},{"t":"and","c":[{"f":"current_url","o":"not_in","x":["https://shop.test/ropa de niño"]},{"f":"current_url","o":"not_like_any","x":["/sale","%20"]}]}]}, '11100001000'],
  [{"t":"or","c":[{"t":"and","c":[{"f":"current_url","o":"=","x":"/SALE"},{"f":"current_url","o":"like","x":"sale"}]},{"t":"or","c":[{"t":"and","c":[]},{"f":"current_url","o":"in","x":"/sale"}]}]}, '11111111111'],
  [{"t":"or","c":[{"f":"current_url","o":"in","x":"/sale"},{"f":"current_url","o":"in","x":["https://shop.test/ropa%20de%20ni%C3%B1o","/nada"]}]}, '00000110100'],
  [{"t":"and","c":[{"f":"current_url","o":null,"x":"/sale"},{"f":"current_url","o":"!=","x":"/sale"}]}, '00000000000'],
];

test('evaluateTree gives what the server gives, for every operator and URL of the table', () => {
  const seen = new Set();
  for (const [tree, expected] of PARITY) {
    assert.equal(expected.length, LOCATIONS.length);
    LOCATIONS.forEach((location, index) => {
      const result = evaluateTree(tree, location);
      assert.equal(result, expected[index] === '1', `${JSON.stringify(tree)} with ${JSON.stringify(location)}`);
      seen.add(result);
    });
  }
  assert.deepEqual([...seen].sort(), [false, true]);
});

test('a missing location is the empty string, like on the server', () => {
  assert.equal(evaluateTree(and(leaf('/sale')), undefined), false);
  assert.equal(evaluateTree(and(leaf('/sale', '!=')), undefined), true);
  assert.equal(evaluateTree(and(leaf('/sale', 'not_in')), null), true);
});

test('scalar operators are case sensitive and do not trim; null, = and like all mean "contains"', () => {
  const url = 'https://shop.test/Sale';
  for (const operator of [null, '=', 'like']) {
    assert.equal(evaluateTree(leaf('/Sale', operator), url), true);
    assert.equal(evaluateTree(leaf('/sale', operator), url), false);
    assert.equal(evaluateTree(leaf('/Sale ', operator), url), false);
  }
  for (const operator of ['!=', 'not_like']) {
    assert.equal(evaluateTree(leaf('/Sale', operator), url), false);
    assert.equal(evaluateTree(leaf('/sale', operator), url), true);
  }
});

test('scalar operators try the URL and the term raw and decoded, and survive a broken encoding', () => {
  // URL codificada, termino sin codificar.
  assert.equal(evaluateTree(leaf('a b'), 'https://shop.test/a%20b'), true);
  // URL sin codificar, termino codificado.
  assert.equal(evaluateTree(leaf('a%20b'), 'https://shop.test/a b'), true);
  // Los dos codificados, y los dos sin codificar.
  assert.equal(evaluateTree(leaf('a%20b'), 'https://shop.test/a%20b'), true);
  assert.equal(evaluateTree(leaf('a b'), 'https://shop.test/a b'), true);
  // decodeURIComponent tira con '%-': se usa el valor tal cual.
  assert.equal(evaluateTree(leaf('50%-off'), 'https://shop.test/50%-off?x=a%20b'), true);
  assert.equal(evaluateTree(leaf('a b'), 'https://shop.test/50%-off?x=a%20b'), false, 'a URL that cannot be decoded stays raw');
  assert.equal(evaluateTree(leaf('%E0%A4%A'), 'https://shop.test/%E0%A4%A'), true);
});

test('multi-value operators ignore case, trim the terms and accept a string or an array', () => {
  const url = 'https://shop.test/Sale';
  assert.equal(evaluateTree(leaf('  HTTPS://SHOP.TEST/SALE ', 'in'), url), true);
  assert.equal(evaluateTree(leaf(['/x', ' https://shop.test/sale'], 'in'), url), true);
  assert.equal(evaluateTree(leaf(['/sale'], 'in'), url), false, 'in is equality, not contains');
  assert.equal(evaluateTree(leaf(['/x', 'https://shop.test/sale'], 'not_in'), url), false);
  assert.equal(evaluateTree(leaf('/sale', 'not_in'), url), true);
  assert.equal(evaluateTree(leaf([' /SALE ', '/x'], 'like_any'), url), true);
  assert.equal(evaluateTree(leaf('/x', 'like_any'), url), false);
  assert.equal(evaluateTree(leaf(['/x', '/y'], 'not_like_any'), url), true);
  assert.equal(evaluateTree(leaf(['/x', 'SALE'], 'not_like_any'), url), false);
  // La URL no se recorta: solo los terminos.
  assert.equal(evaluateTree(leaf('/sale', 'in'), ' /sale '), false);
  // Terminos y URL, tal cual y decodificados.
  assert.equal(evaluateTree(leaf(['https://shop.test/a%20b'], 'in'), 'https://shop.test/a b'), true);
  assert.equal(evaluateTree(leaf(['https://shop.test/a b'], 'in'), 'https://shop.test/a%20b'), true);
  // Un termino que decodificado queda vacio se descarta solo en esa forma.
  assert.equal(evaluateTree(leaf(['%20'], 'like_any'), 'https://shop.test/a%20b'), true);
  assert.equal(evaluateTree(leaf(['%20'], 'like_any'), 'https://shop.test/a b'), false);
});

test('groups: and = all, or = any, and an empty group always matches, also when it is an or', () => {
  const yes = leaf('/sale');
  const no = leaf('/nope');
  const url = 'https://shop.test/sale';
  assert.equal(evaluateTree(and(), url), true);
  assert.equal(evaluateTree(or(), url), true);
  assert.equal(evaluateTree(and(yes, yes), url), true);
  assert.equal(evaluateTree(and(yes, no), url), false);
  assert.equal(evaluateTree(or(no, yes), url), true);
  assert.equal(evaluateTree(or(no, no), url), false);
  assert.equal(evaluateTree(and(or(no, and()), or(and(yes, or()), no)), url), true);
  assert.equal(evaluateTree(or(and(yes, no), and(no, or())), url), false);
  // Una hoja sola tambien es un arbol.
  assert.equal(evaluateTree(yes, url), true);
});

test('anything this SDK does not know for sure is unknown (null)', () => {
  const url = 'https://shop.test/sale';
  const unknown = [
    // campo
    { f: 'utm_source', o: '=', x: 'x' },
    { f: 'device', o: null, x: 'mobile' },
    { f: 'toString', o: null, x: 'x' },
    { o: null, x: '/sale' },
    { f: 7, o: null, x: '/sale' },
    // operador
    leaf('/sale', 'regex'),
    leaf('/sale', ''),
    leaf('/sale', 'LIKE'),
    leaf('/sale', { id: 'like' }),
    leaf('/sale', 5),
    { f: 'current_url', x: '/sale' },
    // termino
    leaf(''),
    leaf(5),
    leaf(null),
    leaf(undefined),
    leaf({ label: '/sale' }),
    leaf(['/sale'], 'like'),
    leaf(['/sale']),
    leaf([], 'in'),
    leaf('', 'in'),
    leaf('   ', 'like_any'),
    leaf(['/sale', ' '], 'in'),
    leaf(['/sale', 3], 'not_in'),
    leaf(null, 'not_like_any'),
    // nodo
    null,
    undefined,
    'current_url',
    7,
    [leaf('/sale')],
    {},
    { t: 'and' },
    { t: 'or', c: 'x' },
    { t: 'xor', c: [] },
    { t: 'AND', c: [] },
    { c: [] },
    { t: 'and', c: [], f: 'current_url' },
    { type: 'and', children: [] },
  ];
  for (const node of unknown) {
    assert.equal(evaluateTree(node, url), null, JSON.stringify(node));
    assert.equal(evaluateTree(and(leaf('/sale'), node), url), null, `inside a group: ${JSON.stringify(node)}`);
  }
  assert.equal(evaluateTree(leaf('/sale'), 5), null, 'a location that is not a string');
  assert.equal(evaluateTree(leaf('/sale'), { href: url }), null);
});

test('an unknown anywhere makes the whole tree unknown: nothing is short-circuited', () => {
  const url = 'https://shop.test/sale';
  const yes = leaf('/sale');
  const no = leaf('/nope');
  const unknown = { f: 'device', o: null, x: 'mobile' };
  // Un `or` que ya matchea y un `and` que ya no matchea igual quedan en null.
  assert.equal(evaluateTree(or(yes, unknown), url), null);
  assert.equal(evaluateTree(or(unknown, yes), url), null);
  assert.equal(evaluateTree(and(no, unknown), url), null);
  assert.equal(evaluateTree(and(unknown, no), url), null);
  assert.equal(evaluateTree(and(no, or(yes, and(yes, or(no, unknown)))), url), null);

  // Todos los hijos se visitan, tambien los que vienen despues de decidir.
  const visited = [];
  const spy = (node, name) => new Proxy(node, {
    get(target, key) {
      if (key === 'x') visited.push(name);
      return target[key];
    },
  });
  assert.equal(evaluateTree(or(spy(yes, 'a'), spy(no, 'b'), spy(yes, 'c')), url), true);
  assert.equal(evaluateTree(and(spy(no, 'd'), spy(yes, 'e')), url), false);
  assert.deepEqual(visited, ['a', 'b', 'c', 'd', 'e']);
});

test('an exception while evaluating is unknown, never thrown', () => {
  const throwing = new Proxy({}, {
    has() { throw new Error('boom'); },
    get() { throw new Error('boom'); },
  });
  assert.equal(evaluateTree(throwing, 'https://shop.test/'), null);
  assert.equal(evaluateTree(and(leaf('/'), throwing), 'https://shop.test/'), null);

  // Un arbol tan profundo que revienta la pila.
  let deep = and();
  for (let i = 0; i < 200000; i++) deep = and(deep);
  assert.equal(evaluateTree(deep, 'https://shop.test/'), null);
});

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

const entry = (overrides = {}) => ({
  id: 'content-1',
  name: 'Banner sale',
  rev: 1772600767000,
  t: [{ id: 'target-1', r: and(leaf('/sale')), v: [{ id: 'variant-1', w: 100, s: 24 }] }],
  ...overrides,
});
const withTarget = (overrides) => entry({ t: [{ ...entry().t[0], ...overrides }] });
const withVariant = (overrides) => withTarget({ v: [{ ...entry().t[0].v[0], ...overrides }] });

test('decide: match gives the target and the variant, no_match gives nothing else', () => {
  assert.deepEqual(decide(entry(), 'https://shop.test/sale'), {
    status: 'match',
    targetId: 'target-1',
    variantId: 'variant-1',
  });
  assert.deepEqual(decide(entry(), 'https://shop.test/'), { status: 'no_match' });
  assert.deepEqual(decide(entry({ name: null }), 'https://shop.test/sale').status, 'match');
  assert.deepEqual(decide(withTarget({ r: or() }), undefined).status, 'match', 'an empty group always matches');
  assert.deepEqual(decide(withVariant({ w: 0.5, s: 1 }), '/sale').status, 'match');
});

test('decide: a tree that cannot be evaluated is unknown, with the reason', () => {
  const reasonOf = (r) => decide(withTarget({ r }), 'https://shop.test/sale');
  assert.deepEqual(reasonOf(and({ f: 'device', o: null, x: 'mobile' })), { status: 'unknown', reason: 'rules:field' });
  assert.deepEqual(reasonOf(or(leaf('/sale'), leaf('/sale', 'regex'))), { status: 'unknown', reason: 'rules:operator' });
  assert.deepEqual(reasonOf(and(leaf(['/sale']))), { status: 'unknown', reason: 'rules:term' });
  assert.deepEqual(reasonOf(and(leaf('', 'in'))), { status: 'unknown', reason: 'rules:term' });
  assert.deepEqual(reasonOf({ t: 'and' }), { status: 'unknown', reason: 'rules:group' });
  assert.deepEqual(reasonOf(null), { status: 'unknown', reason: 'rules:node' });
  assert.deepEqual(reasonOf(undefined), { status: 'unknown', reason: 'rules:node' });
  // Queda el primer motivo, aunque haya mas de uno.
  assert.deepEqual(reasonOf(and(leaf(5), { f: 'device' })), { status: 'unknown', reason: 'rules:term' });
  assert.deepEqual(decide(entry(), 42), { status: 'unknown', reason: 'rules:location' });
});

test('decide: any shape other than one target with one variant is unknown', () => {
  const target = entry().t[0];
  const variant = target.v[0];
  const cases = [
    [null, 'entry'],
    [undefined, 'entry'],
    ['content-1', 'entry'],
    [[entry()], 'entry'],
    [entry({ id: undefined }), 'entry'],
    [entry({ id: '' }), 'entry'],
    [entry({ id: 7 }), 'entry'],
    [entry({ name: undefined }), 'entry'],
    [entry({ name: 5 }), 'entry'],
    [entry({ rev: undefined }), 'entry'],
    [entry({ rev: '1772600767000' }), 'entry'],
    [entry({ rev: NaN }), 'entry'],
    [entry({ t: undefined }), 'targets'],
    [entry({ t: target }), 'targets'],
    [entry({ t: [] }), 'targets'],
    [entry({ t: [target, target] }), 'targets'],
    [entry({ t: [null] }), 'target'],
    [entry({ t: ['target-1'] }), 'target'],
    [withTarget({ id: undefined }), 'target'],
    [withTarget({ id: '' }), 'target'],
    [withTarget({ id: 9 }), 'target'],
    [withTarget({ v: undefined }), 'variants'],
    [withTarget({ v: variant }), 'variants'],
    [withTarget({ v: [] }), 'variants'],
    [withTarget({ v: [variant, { ...variant, id: 'variant-2' }] }), 'variants'],
    [withTarget({ v: [null] }), 'variant'],
    [withTarget({ v: ['variant-1'] }), 'variant'],
    [withVariant({ id: undefined }), 'variant'],
    [withVariant({ id: '' }), 'variant'],
    [withVariant({ id: 3 }), 'variant'],
    [withVariant({ w: undefined }), 'variant'],
    [withVariant({ w: '100' }), 'variant'],
    [withVariant({ w: 0 }), 'variant'],
    [withVariant({ w: NaN }), 'variant'],
    [withVariant({ s: undefined }), 'variant'],
    [withVariant({ s: '24' }), 'variant'],
    [withVariant({ s: 0 }), 'variant'],
  ];
  for (const [value, reason] of cases) {
    // Con una URL que matchea: la forma se valida antes de mirar las reglas.
    assert.deepEqual(decide(value, 'https://shop.test/sale'), { status: 'unknown', reason }, JSON.stringify(value));
  }
});

test('decide never throws', () => {
  const throwing = new Proxy({}, { get() { throw new Error('boom'); } });
  assert.deepEqual(decide(throwing, 'https://shop.test/sale'), { status: 'unknown', reason: 'error' });
  assert.deepEqual(decide(entry({ t: [throwing] }), 'https://shop.test/sale'), { status: 'unknown', reason: 'error' });
});

// ---------------------------------------------------------------------------
// Version y muestra
// ---------------------------------------------------------------------------

test('isSupportedVersion: only version 1 of the listing block', () => {
  assert.equal(isSupportedVersion({ v: 1, mode: 'on', sample: 1 }), true);
  for (const value of [{ v: 2 }, { v: '1' }, { v: 0 }, {}, { mode: 'on' }, null, undefined, 1, 'v1', [{ v: 1 }]]) {
    assert.equal(isSupportedVersion(value), false, JSON.stringify(value));
  }
});

const sessionIds = (count, make = (i) => `session-${i}`) => Array.from({ length: count }, (_, i) => make(i));

test('inSample: 1 is everybody, 0 is nobody, and anything invalid is nobody', () => {
  for (const id of sessionIds(200)) {
    assert.equal(inSample(id, 1), true);
    assert.equal(inSample(id, 0), false);
  }
  for (const sample of [-0.1, 1.01, 5, NaN, Infinity, '1', '0.5', null, undefined, true, {}]) {
    assert.equal(inSample('session-1', sample), false, String(sample));
  }
  for (const id of ['', null, undefined, 7, {}, ['session-1']]) {
    assert.equal(inSample(id, 1), false, String(id));
  }
});

test('inSample is deterministic per session, and a bigger sample never drops a session', () => {
  // Valores fijos del hash (FNV-1a 32 + fmix32 sobre "gsfd:" + id): si cambia
  // el hash, cambia quien esta en la muestra de cada proyecto.
  const ids = ['session-1', 'session-2', '665f1c2ab7e4d90012a3b4c5', 'a', 'ñandú-✓'];
  const first = ids.map((id) => [0.1, 0.25, 0.5, 0.75, 0.9].map((sample) => inSample(id, sample)));
  for (let round = 0; round < 3; round++) {
    assert.deepEqual(ids.map((id) => [0.1, 0.25, 0.5, 0.75, 0.9].map((sample) => inSample(id, sample))), first);
  }
  assert.deepEqual(first, [
    [false, true, true, true, true],
    [true, true, true, true, true],
    [false, false, true, true, true],
    [false, false, true, true, true],
    [false, false, false, false, true],
  ]);

  for (const id of sessionIds(500)) {
    let inside = false;
    for (let sample = 0; sample <= 1.0001; sample += 0.05) {
      const now = inSample(id, Math.min(sample, 1));
      assert.ok(now || !inside, `${id} left the sample at ${sample}`);
      inside = now;
    }
    assert.equal(inside, true);
  }
});

test('inSample spreads the sessions roughly evenly, also for ids that look alike', () => {
  const hex = (i) => (0x665f1c2ab7e4 + i).toString(16).padStart(12, '0') + 'd90012a3b4c5';
  const families = {
    sequential: sessionIds(20000),
    objectIds: sessionIds(20000, hex),
    uuids: sessionIds(20000, (i) => `3f2b8c1e-7a4d-4e9b-8f${String(i % 100).padStart(2, '0')}-${String(i).padStart(12, '0')}`),
  };
  for (const [name, ids] of Object.entries(families)) {
    for (const sample of [0.01, 0.1, 0.5, 0.9]) {
      const share = ids.filter((id) => inSample(id, sample)).length / ids.length;
      assert.ok(Math.abs(share - sample) < 0.015, `${name} at ${sample}: ${share}`);
    }
    // Diez franjas iguales: ninguna se aleja mas de un 15% de lo esperado.
    const buckets = new Array(10).fill(0);
    for (const id of ids) {
      let bucket = 0;
      while (bucket < 9 && !inSample(id, (bucket + 1) / 10)) bucket++;
      buckets[bucket]++;
    }
    for (const count of buckets) {
      assert.ok(Math.abs(count - ids.length / 10) < ids.length / 10 * 0.15, `${name}: ${buckets.join(',')}`);
    }
  }
});
