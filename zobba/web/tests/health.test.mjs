import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHealth } from '../src/health.ts';

test('the real API contract distinguishes live, ready, and unavailable', () => {
  assert.equal(parseHealth({ service: 'api', status: 'live', schema_version: null }, 'live', 200).status, 'live');
  assert.equal(parseHealth({ service: 'api', status: 'ready', schema_version: 3 }, 'ready', 200).status, 'ready');
  assert.equal(parseHealth({ service: 'api', status: 'unavailable', schema_version: null }, 'ready', 503).status, 'unavailable');
});

test('bad HTTP status, schema, service, or payload can never become ready', () => {
  const ready = { service: 'api', status: 'ready', schema_version: 3 };
  for (const payload of [null, [], {}, '<html>Error</html>', { ...ready, service: 'worker' },
    { ...ready, schema_version: null }, { ...ready, schema_version: 2 }, { ...ready, schema_version: 4 },
    { ...ready, status: 'live' }]) {
    assert.throws(() => parseHealth(payload, 'ready', 200));
  }
  assert.throws(() => parseHealth(ready, 'ready', 503));
  assert.throws(() => parseHealth(ready, 'ready', 500));
  assert.throws(() => parseHealth(ready, 'live', 200));
  assert.throws(() => parseHealth({ ...ready, status: 'unavailable' }, 'ready', 200));
  assert.throws(() => parseHealth({ ...ready, status: 'live' }, 'live', 200));
  assert.throws(() => parseHealth({ ...ready, status: 'unavailable' }, 'ready', 503));
  assert.throws(() => parseHealth({ ...ready, status: 'unavailable', schema_version: null }, 'live', 503));
});
