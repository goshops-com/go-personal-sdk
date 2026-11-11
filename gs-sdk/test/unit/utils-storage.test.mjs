import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { resetDom, seedSession } from './helpers/env.mjs';
import * as storage from '../../src/utils/storage.js';

const SESSION_KEY = 'gs-v-1';

beforeEach(() => {
  resetDom();
  storage.configureStorage();
});

test('getToken returns {} without session and the stored object otherwise', () => {
  assert.deepEqual(storage.getToken(), {});
  seedSession({ token: 'abc' });
  assert.equal(storage.getToken().token, 'abc');
});

test('getToken returns a copy: mutating it does not leak into the next read', () => {
  seedSession({ token: 'abc' });
  const first = storage.getToken();
  first.token = 'changed';
  first.extra = true;
  const second = storage.getToken();
  assert.equal(second.token, 'abc');
  assert.equal('extra' in second, false);
});

test('session reads follow storage changes made outside the module (other tab)', () => {
  seedSession({ token: 'one' });
  assert.equal(storage.getToken().token, 'one');
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'two' }));
  assert.equal(storage.getToken().token, 'two');
  localStorage.removeItem(SESSION_KEY);
  assert.deepEqual(storage.getToken(), {});
});

test('getToken passes through non-object stored values and throws on broken JSON', () => {
  localStorage.setItem(SESSION_KEY, '"just-a-string"');
  assert.equal(storage.getToken(), 'just-a-string');
  localStorage.setItem(SESSION_KEY, '{broken');
  assert.throws(() => storage.getToken(), SyntaxError);
});

test('client id is stored and compared', () => {
  assert.equal(storage.checkSameClientId('c1'), false);
  storage.setClientId('c1');
  assert.equal(storage.checkSameClientId('c1'), true);
  assert.equal(storage.checkSameClientId('c2'), false);
});

test('isTokenValid: missing, fresh, older than 24h and broken sessions', (t) => {
  assert.equal(storage.isTokenValid(), false);
  seedSession();
  assert.equal(storage.isTokenValid(), true);
  seedSession({ ts: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  assert.equal(storage.isTokenValid(), false);
  t.mock.method(console, 'log', () => {});
  localStorage.setItem(SESSION_KEY, '{broken');
  assert.equal(storage.isTokenValid(), false);
});

test('getSession adds the vuuid; setSession stamps ts unless asked to keep it', () => {
  assert.deepEqual(storage.getSession(), {});
  storage.setVUUID('vuuid-1');
  assert.equal(storage.getVUUID(), 'vuuid-1');

  const saved = storage.setSession({ token: 't' });
  assert.ok(saved.ts instanceof Date);
  assert.equal(storage.getSession().vuuid, 'vuuid-1');
  assert.equal(storage.getSession().token, 't');

  storage.setSession({ token: 't2', ts: '2020-01-01T00:00:00.000Z' }, true);
  assert.equal(JSON.parse(localStorage.getItem(SESSION_KEY)).ts, '2020-01-01T00:00:00.000Z');
});

test('addDataToSession updates one field and is a no-op without session', () => {
  assert.deepEqual(storage.addDataToSession('customer_id', '1'), {});
  assert.equal(localStorage.getItem(SESSION_KEY), null);
  seedSession({ token: 't' });
  storage.addDataToSession('customer_id', '42');
  const stored = JSON.parse(localStorage.getItem(SESSION_KEY));
  assert.equal(stored.customer_id, '42');
  assert.equal(stored.token, 't');
  assert.equal(storage.getSession().customer_id, '42');
});

test('clearSession removes the session and the per-session lists', () => {
  seedSession();
  localStorage.setItem('gs_content_seen', '{}');
  storage.setContentImpression('content-1', 'imp-1');
  storage.addSeenContent('content-1');
  storage.clearSession();
  for (const key of [SESSION_KEY, 'gs_content_seen', 'gs_content_impressions', 'gs_seen_contents']) {
    assert.equal(localStorage.getItem(key), null, key);
  }
});

test('GA ids accepted/rejected round trip', () => {
  storage.setGAIdAccepted('GA-1');
  storage.setGAIdRejected('GA-2');
  assert.equal(storage.getGAIdAccepted(), 'GA-1');
  assert.equal(storage.getGAIdRejected(), 'GA-2');
});

test('cookie fallback mirrors the session into a cookie and restores it', () => {
  storage.configureStorage({ cookieFallback: true });
  storage.setClientId('c1');
  storage.setVUUID('v1');
  assert.match(document.cookie, /gs-v-1-clientId=c1/);
  assert.match(document.cookie, /gs_vuuid=v1/);

  // localStorage lost (e.g. ITP): the value comes back from the cookie.
  localStorage.clear();
  assert.equal(storage.getVUUID(), 'v1');
  assert.equal(localStorage.getItem('gs_vuuid'), 'v1');
  assert.equal(storage.checkSameClientId('c1'), true);

  storage.setSession({ token: 't' });
  assert.match(document.cookie, /gs-v-1=/);
  storage.clearSession();
  assert.doesNotMatch(document.cookie, /gs-v-1=/);
});

test('cookie fallback: disabled by default, undecodable cookie ignored, oversized value dropped', () => {
  storage.setVUUID('v1');
  assert.equal(document.cookie, '');

  storage.configureStorage({ cookieFallback: true });
  document.cookie = 'gs_vuuid=%E0%A4%A; Path=/';
  localStorage.clear();
  assert.equal(storage.getVUUID(), null);

  // Other cookies present, but not ours.
  document.cookie = 'gs_vuuid=; Path=/; Max-Age=0';
  document.cookie = 'unrelated=1; Path=/';
  assert.equal(storage.getVUUID(), null);

  storage.setVUUID('small');
  assert.match(document.cookie, /gs_vuuid=small/);
  storage.setVUUID('x'.repeat(5000));
  assert.doesNotMatch(document.cookie, /gs_vuuid=/);
  assert.equal(localStorage.getItem('gs_vuuid').length, 5000);
});

test('cookie size is measured without TextEncoder too', () => {
  const original = globalThis.TextEncoder;
  globalThis.TextEncoder = undefined;
  try {
    storage.configureStorage({ cookieFallback: true });
    storage.setVUUID('ñandú');
    assert.match(document.cookie, /gs_vuuid=/);
    storage.setVUUID('ñ'.repeat(2000));
    assert.doesNotMatch(document.cookie, /gs_vuuid=/);
  } finally {
    globalThis.TextEncoder = original;
  }
});

test('content impressions: first id wins, overwrite replaces, keyed per session', () => {
  seedSession({ sessionId: 's1' });
  assert.equal(storage.getContentImpression(''), null);
  assert.equal(storage.getContentImpression('c1'), null);

  storage.setContentImpression('c1', 'imp-1');
  storage.setContentImpression('c1', 'imp-2');
  assert.equal(storage.getContentImpression('c1'), 'imp-1');
  storage.setContentImpression('c1', 'imp-3', true);
  assert.equal(storage.getContentImpression('c1'), 'imp-3');

  storage.setContentImpression('', 'x');
  storage.setContentImpression('c2', '');
  assert.equal(storage.getContentImpression('c2'), null);

  // New session: the previous list is dropped.
  seedSession({ sessionId: 's2' });
  assert.equal(storage.getContentImpression('c1'), null);
  assert.equal(localStorage.getItem('gs_content_impressions'), null);
});

test('removeContentImpression undoes a stored impression only while it is still that one', (t) => {
  seedSession({ sessionId: 's1' });
  storage.setContentImpression('c1', 'imp-1');
  storage.removeContentImpression('', 'imp-1');
  storage.removeContentImpression('c1', 'another-id');
  assert.equal(storage.getContentImpression('c1'), 'imp-1');
  storage.removeContentImpression('c1', 'imp-1');
  assert.equal(storage.getContentImpression('c1'), null);

  storage.setContentImpression('c2', 'imp-2');
  const error = t.mock.method(console, 'error', () => {});
  t.mock.method(window.Storage.prototype, 'setItem', () => { throw new Error('quota'); });
  storage.removeContentImpression('c2', 'imp-2');
  assert.equal(error.mock.callCount(), 1);
});

test('content impressions keep only the newest 200 and survive broken storage', (t) => {
  seedSession({ sessionId: 's1' });
  for (let i = 0; i < 205; i++) {
    storage.setContentImpression(`c${i}`, `imp-${i}`);
  }
  assert.equal(storage.getContentImpression('c0'), null);
  assert.equal(storage.getContentImpression('c204'), 'imp-204');
  assert.equal(Object.keys(JSON.parse(localStorage.getItem('gs_content_impressions')).items).length, 200);

  localStorage.setItem('gs_content_impressions', '{broken');
  assert.equal(storage.getContentImpression('c204'), null);

  const error = t.mock.method(console, 'error', () => {});
  t.mock.method(window.Storage.prototype, 'setItem', () => { throw new Error('quota'); });
  storage.setContentImpression('c-new', 'imp-new');
  assert.equal(error.mock.callCount(), 1);
});

test('seen contents: unique ordered ids, capped at 100, reset with the session', (t) => {
  seedSession({ sessionId: 's1' });
  assert.deepEqual(storage.getSeenContents(), []);
  assert.equal(storage.addSeenContent(''), false);
  assert.equal(storage.addSeenContent(11), true);
  assert.equal(storage.addSeenContent('11'), false);
  assert.equal(storage.addSeenContent('22'), true);
  assert.deepEqual(storage.getSeenContents(), ['11', '22']);

  const copy = storage.getSeenContents();
  copy.push('mutated');
  assert.deepEqual(storage.getSeenContents(), ['11', '22']);

  for (let i = 0; i < 105; i++) storage.addSeenContent(`id-${i}`);
  const seen = storage.getSeenContents();
  assert.equal(seen.length, 100);
  assert.equal(seen.at(-1), 'id-104');
  assert.equal(seen.includes('11'), false);

  localStorage.setItem('gs_seen_contents', '{broken');
  assert.deepEqual(storage.getSeenContents(), []);

  localStorage.setItem('gs_seen_contents', JSON.stringify({ sessionId: 's1', items: ['a'] }));
  seedSession({ sessionId: 's2' });
  assert.deepEqual(storage.getSeenContents(), []);
  assert.equal(localStorage.getItem('gs_seen_contents'), null);

  const error = t.mock.method(console, 'error', () => {});
  t.mock.method(window.Storage.prototype, 'setItem', () => { throw new Error('quota'); });
  assert.equal(storage.addSeenContent('zz'), false);
  assert.equal(error.mock.callCount(), 1);
});

test('per-session lists are not cleared while there is no session id yet', () => {
  localStorage.setItem('gs_seen_contents', JSON.stringify({ sessionId: 'old', items: ['a'] }));
  localStorage.setItem('gs_content_impressions', JSON.stringify({ sessionId: 'old', items: { c: 'i' } }));
  assert.deepEqual(storage.getSeenContents(), []);
  assert.equal(storage.getContentImpression('c'), null);
  assert.notEqual(localStorage.getItem('gs_seen_contents'), null);
  assert.notEqual(localStorage.getItem('gs_content_impressions'), null);
});
