import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessError, logout, parseSession } from '../src/auth.ts';
import { parseEngagement, parseEngagementPage, readEngagement, readEngagements } from '../src/engagements.ts';

const engagement = {
  organisation_id: 'org-a', organisation_name: 'Northstar', client_id: 'client-a',
  client_name: 'Alder Manufacturing', engagement_id: 'engagement-a',
  engagement_name: 'FY2026 audit', roles: ['auditor', 'admin'],
};

test('session bootstrap requires server identity and a nonempty CSRF token', () => {
  assert.equal(parseSession({ identity: { id: 'actor-a', display_name: 'Alex' }, csrf_token: 'opaque' }).identity.id, 'actor-a');
  for (const value of [null, {}, { identity: {}, csrf_token: 'opaque' },
    { identity: { id: 'actor-a', display_name: 'Alex' }, csrf_token: '' },
    { identity: { id: 'actor-a', display_name: null }, csrf_token: 'opaque' }]) {
    assert.throws(() => parseSession(value));
  }
});

test('engagement responses require every explicit scope and a current audit role', () => {
  assert.deepEqual(parseEngagement(engagement), engagement);
  for (const value of [null, {}, { ...engagement, client_id: '' }, { ...engagement, organisation_id: 1 },
    { ...engagement, engagement_name: null }, { ...engagement, roles: [] },
    { ...engagement, roles: ['provider-owner'] }, { ...engagement, roles: ['admin'] }]) {
    assert.throws(() => parseEngagement(value));
  }
});

test('a shaped response cannot silently change any selected scope identifier', async (context) => {
  for (const key of ['organisation_id', 'client_id', 'engagement_id']) {
    context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ...engagement, [key]: 'different' }), { status: 200 }));
    await assert.rejects(readEngagement(engagement, new AbortController().signal), /scope changed/);
    context.mock.restoreAll();
  }
});

test('scope IDs and Unicode label bounds match stored and HTTP contracts', () => {
  assert.equal(parseEngagement({ ...engagement, engagement_id: 'a'.repeat(128), engagement_name: '😀'.repeat(200) }).engagement_name.length, 400);
  assert.equal(parseEngagement({ ...engagement, engagement_name: '\ufeffAllowed' }).engagement_name, '\ufeffAllowed');
  for (const key of ['organisation_id', 'client_id', 'engagement_id']) {
    for (const invalid of ['a'.repeat(129), 'contains space', 'é', 'slash/id', 'a\n']) {
      assert.throws(() => parseEngagement({ ...engagement, [key]: invalid }));
    }
  }
  for (const key of ['organisation_name', 'client_name', 'engagement_name']) {
    for (const invalid of ['', ' ', ' leading', 'trailing ', '\u2003leading', 'trailing\u3000', '😀'.repeat(201), 'a\n', 'a\u007f', 'a\u0085']) {
      assert.throws(() => parseEngagement({ ...engagement, [key]: invalid }));
    }
  }
});

test('bounded pages preserve identical local IDs across scopes and request all cursor parts', async (context) => {
  const records = Array.from({ length: 50 }, (_, index) => ({ ...engagement, client_id: `client-${index}` }));
  const after = { organisation_id: 'org-a', client_id: 'client-49', engagement_id: 'engagement-a' };
  const page = { engagements: records, next_cursor: after };
  assert.deepEqual(parseEngagementPage(page), page);
  assert.deepEqual(parseEngagementPage({ engagements: [], next_cursor: null }), { engagements: [], next_cursor: null });
  for (const invalid of [{ engagements: records }, { ...page, engagements: [...records, engagement] },
    { ...page, next_cursor: {} }, { ...page, next_cursor: { ...after, client_id: 'different' } },
    { engagements: [engagement, engagement], next_cursor: null }]) {
    assert.throws(() => parseEngagementPage(invalid));
  }
  context.mock.method(globalThis, 'fetch', async (path) => {
    const url = new URL(path, 'https://localhost');
    assert.equal(url.pathname, '/api/engagements');
    assert.deepEqual(Object.fromEntries(url.searchParams), { after_organisation_id: 'org-a', after_client_id: 'client-49', after_engagement_id: 'engagement-a' });
    return new Response(JSON.stringify({ engagements: [engagement], next_cursor: null }));
  });
  assert.equal((await readEngagements(new AbortController().signal, after)).engagements.length, 1);
});

test('already expired logout is success while refusal and outage remain errors', async (context) => {
  const session = { identity: { id: 'actor-a', display_name: 'Alex' }, csrf_token: 'opaque' };
  for (const status of [204, 401, 403, 503]) {
    context.mock.method(globalThis, 'fetch', async () => new Response(null, { status }));
    const action = logout(session, new AbortController().signal);
    if ([204, 401].includes(status)) await action;
    else await assert.rejects(action, (error) => error instanceof AccessError && error.status === status);
    context.mock.restoreAll();
  }
});
