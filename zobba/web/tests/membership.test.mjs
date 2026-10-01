import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessError } from '../src/auth.ts';
import { applyMembership, effectiveMembershipStatus, invitationLink, membershipExpiryInput, newInvitationSecret, parseInvitationPreview, parseMemberAssignmentPage, parseMembershipExpiry, parseMembershipReceipt, parseMembershipSnapshot, previewInvitation,
  parseOrganisationPage, readAdminOrganisations, readMembership, takeInvitationFragment } from '../src/membership.ts';

const session = { identity: { id: 'actor-admin', display_name: 'Admin' }, csrf_token: 'current-session' };
const org = { organisation_id: 'org-a', organisation_name: 'Northstar', version: '1' };
const assignment = { client_id: 'client-a', engagement_id: 'engagement-a' };
const member = { actor_id: 'actor-a', display_name: 'Auditor', roles: ['auditor'], active: true, expires_at: null, assignments: [assignment], assignments_count: 1, assignments_complete: true };
const invitation = { id: 'invite-a', recipient_email: 'Auditor@example.test', roles: ['auditor'], assignments: [assignment], inviter_actor_id: 'actor-admin', expires_at: 1800000000, status: 'pending' };
const engagement = { ...assignment, client_name: 'Alder', engagement_name: 'FY2026 audit' };
const snapshot = { ...org, members: [member], members_next_cursor: null, invitations: [invitation], invitations_next_cursor: null, engagements: [engagement], engagements_next_cursor: null };
const save = { kind: 'save', organisation_id: 'org-a', body: { key: 'key-a', expected_version: '1', actor_id: member.actor_id,
  roles: member.roles, active: member.active, expires_at: member.expires_at, assignments: [{ ...assignment, renew: false }], assignment_mode: 'replace' } };
const receipt = { event_id: 'event-a', organisation_id: 'org-a', actor_id: 'actor-admin', subject_actor_id: 'actor-a', invitation_id: null, version: '2', kind: 'save_member' };

test('admin projection accepts Admin-only membership independently from assigned audit access', () => {
  assert.deepEqual(parseOrganisationPage({ organisations: [org], next_cursor: null }), { organisations: [org], next_cursor: null });
  assert.deepEqual(parseMembershipSnapshot(snapshot, 'org-a'), snapshot);
  const admin = { ...member, roles: ['admin'], assignments: [], assignments_count: 0 };
  assert.deepEqual(parseMembershipSnapshot({ ...snapshot, members: [admin] }, 'org-a').members, [admin]);
  assert.deepEqual(parseMembershipSnapshot({ ...snapshot, members: [{ ...member, active: false, roles: [] }] }, 'org-a').members[0].roles, []);
  const privateFields = { ...snapshot, secret: 'never propagate unknown capability', invitations: [{ ...invitation, secret: 'never propagate unknown capability' }] };
  assert.equal(JSON.stringify(parseMembershipSnapshot(privateFields, 'org-a')).includes('never propagate'), false);
});

test('membership projections refuse foreign orgs, unbounded or duplicate lists and malformed authority', () => {
  assert.throws(() => parseMembershipSnapshot(snapshot, 'org-b'), /organisation changed/);
  assert.equal(parseOrganisationPage({ organisations: [{ ...org, version: '0' }], next_cursor: null }).organisations[0].version, '0');
  for (const invalid of [null, {}, { ...org, version: '01' }, { ...org, version: '9223372036854775808' }, { ...org, organisation_id: 'foreign/scope' }]) {
    assert.throws(() => parseOrganisationPage({ organisations: [invalid], next_cursor: null }));
  }
  for (const invalid of [
    { ...snapshot, members: [member, member] }, { ...snapshot, invitations: Array(51).fill(invitation) },
    { ...snapshot, engagements: [engagement, engagement] }, { ...snapshot, members_next_cursor: 'actor-a' },
    { ...snapshot, members: [{ ...member, assignments: Array(101).fill(assignment) }] },
    { ...snapshot, members: [{ ...member, assignments: [assignment, assignment] }] },
    { ...snapshot, members: [{ ...member, roles: ['provider-owner'] }] },
    { ...snapshot, members: [{ ...member, roles: ['admin', 'admin'] }] },
    { ...snapshot, members: [{ ...member, display_name: 'a'.repeat(201) }] },
    { ...snapshot, members: [{ ...member, active: 'true' }] },
    { ...snapshot, invitations: [{ ...invitation, recipient_email: 'a\n@b.test' }] },
    { ...snapshot, invitations: [{ ...invitation, status: 'sent' }] },
    { ...snapshot, invitations: [{ ...invitation, expires_at: Infinity }] },
    { ...snapshot, invitations: [{ ...invitation, expires_at: 0 }] },
    { ...snapshot, members: [{ ...member, expires_at: 253402300800 }] },
  ]) assert.throws(() => parseMembershipSnapshot(invalid, 'org-a'));
});

test('each bounded membership page validates its final cursor, including compound engagement scope', () => {
  const organisations = Array.from({ length: 50 }, (_, index) => ({ ...org, organisation_id: `org-${index}` }));
  assert.equal(parseOrganisationPage({ organisations, next_cursor: 'org-49' }).next_cursor, 'org-49');
  assert.throws(() => parseOrganisationPage({ organisations, next_cursor: 'org-48' }));
  const engagements = Array.from({ length: 50 }, (_, index) => ({ ...engagement, client_id: `client-${index}` }));
  const paged = { ...snapshot, engagements, engagements_next_cursor: 'client-49.engagement-a' };
  assert.equal(parseMembershipSnapshot(paged, 'org-a').engagements_next_cursor, 'client-49.engagement-a');
  for (const engagements_next_cursor of ['client-48.engagement-a', 'client-49/engagement-a', 'client-49.engagement-a.extra']) {
    assert.throws(() => parseMembershipSnapshot({ ...paged, engagements_next_cursor }, 'org-a'));
  }
});

test('membership reads bind the expected session and omit cleared pagination values', async context => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    calls++;
    assert.equal(options.headers['X-Expected-Session'], session.csrf_token);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    const url = new URL(path, 'https://localhost');
    if (calls === 1) {
      assert.equal(url.pathname, '/api/membership/organisations'); assert.equal(url.search, '?after=org-a');
      return Response.json({ organisations: [org], next_cursor: null });
    }
    assert.equal(url.pathname, '/api/membership/organisations/org-a');
    assert.deepEqual(Object.fromEntries(url.searchParams), { members_after: 'actor-z', engagements_after: 'client-a.engagement-a' });
    return Response.json(snapshot);
  });
  await readAdminOrganisations(session, new AbortController().signal, 'org-a');
  await readMembership('org-a', session, new AbortController().signal, { members_after: 'actor-z', invitations_after: undefined, engagements_after: 'client-a.engagement-a' });
  assert.equal(calls, 2);
});

test('each Save and exact retry verifies current session, retains its exact body and verifies receipt audience', async context => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, ...options });
    if (path.endsWith('/auth/session')) { assert.equal(options.headers['X-Expected-Session'], session.csrf_token); return Response.json(session); }
    assert.equal(path, '/api/membership/organisations/org-a/members');
    assert.equal(options.headers['X-CSRF-Token'], session.csrf_token);
    assert.equal(options.headers['X-Expected-Actor'], session.identity.id);
    return Response.json(receipt);
  });
  const original = JSON.stringify(save);
  assert.deepEqual(await applyMembership(save, session, new AbortController().signal), receipt);
  assert.deepEqual(await applyMembership(save, session, new AbortController().signal), receipt);
  assert.equal(JSON.stringify(save), original);
  assert.equal(calls.length, 6);
  assert.equal(calls[1].body, calls[4].body);
  assert.deepEqual(calls.map(item => item.method ?? 'GET'), ['GET', 'POST', 'GET', 'GET', 'POST', 'GET']);
  for (const changed of [{ actor_id: 'actor-other' }, { organisation_id: 'org-b' }, { subject_actor_id: 'actor-other' }, { kind: 'invite' }, { invitation_id: 'unexpected' }]) {
    assert.throws(() => parseMembershipReceipt({ ...receipt, ...changed }, session, save), /audience/);
  }
});

test('obsolete-session retry sends no POST and a changed post-response session cannot expose a receipt', async context => {
  let posts = 0;
  context.mock.method(globalThis, 'fetch', async (_path, options) => {
    if (options.method === 'POST') posts++;
    return new Response(null, { status: 412 });
  });
  await assert.rejects(applyMembership(save, session, new AbortController().signal), error => error instanceof AccessError && error.status === 412);
  assert.equal(posts, 0);
  context.mock.restoreAll();
  let reads = 0;
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    if (options.method === 'POST') { posts++; return Response.json(receipt); }
    reads++;
    return Response.json(reads === 1 ? session : { ...session, identity: { ...session.identity, id: 'actor-other' } });
  });
  await assert.rejects(applyMembership(save, session, new AbortController().signal), error => error instanceof AccessError && error.status === 412);
  assert.equal(posts, 1);
});

test('private invitations use random bounded fragment secrets and scrub even malformed input from history', () => {
  const secrets = Array.from({ length: 8 }, () => newInvitationSecret());
  assert.equal(new Set(secrets).size, secrets.length);
  for (const secret of secrets) assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  const calls = [], history = { replaceState: (...args) => calls.push(args) };
  const location = { pathname: '/invitation', search: '', hash: `#invitation=${secrets[0]}` };
  assert.equal(takeInvitationFragment(location, history), secrets[0]);
  assert.deepEqual(calls, [[null, '', '/invitation']]);
  assert.equal(invitationLink(secrets[0], 'https://localhost:8443'), `https://localhost:8443/invitation#invitation=${secrets[0]}`);
  assert.equal(takeInvitationFragment({ ...location, hash: '#invitation=bad%0Avalue' }, history), null);
  assert.equal(calls.length, 2);
  assert.equal(takeInvitationFragment({ ...location, hash: '#workspace' }, history), null);
  assert.equal(calls.length, 2);
  assert.throws(() => invitationLink('bad value', 'https://localhost'));
});

test('invitation issue and acceptance put secrets only in an explicit POST body', async context => {
  const secret = newInvitationSecret(), posted = [];
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path.includes(secret), false);
    if (!options.method) return Response.json(session);
    const body = JSON.parse(options.body); posted.push({ path, body });
    return Response.json({ ...receipt, subject_actor_id: path.endsWith('/accept') ? session.identity.id : null, invitation_id: 'invite-a', kind: path.endsWith('/accept') ? 'accept' : 'invite' });
  });
  const issue = { kind: 'issue', organisation_id: 'org-a', body: { key: 'issue-key', expected_version: '1', recipient_email: 'Auditor@example.test', roles: ['auditor'], assignments: [assignment], expires_in_seconds: 300, secret } };
  await applyMembership(issue, session, new AbortController().signal);
  const accept = { kind: 'accept', organisation_id: 'org-a', body: { key: 'accept-key', secret } };
  await applyMembership(accept, session, new AbortController().signal);
  assert.deepEqual(posted, [{ path: '/api/membership/organisations/org-a/invitations', body: issue.body }, { path: '/api/membership/invitations/accept', body: accept.body }]);
});

test('authenticated invitation preview validates fixed access, bounds assignments and sends its secret only in a body', async context => {
  const secret = newInvitationSecret();
  const terms = { organisation_id: 'org-a', organisation_name: 'Northstar', recipient_email: 'Auditor@example.test', roles: ['auditor'], assignments: [engagement], expires_at: 1800000000 };
  const paths = [];
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    paths.push(path); assert.equal(path.includes(secret), false);
    if (path.endsWith('/auth/session')) return Response.json(session);
    assert.equal(path, '/api/membership/invitations/preview'); assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-CSRF-Token'], session.csrf_token); assert.equal(options.headers['X-Expected-Actor'], session.identity.id);
    assert.deepEqual(JSON.parse(options.body), { secret }); return Response.json(terms);
  });
  assert.deepEqual(await previewInvitation(secret, session, new AbortController().signal), terms);
  assert.equal(paths.length, 3);
  for (const invalid of [{ ...terms, roles: [] }, { ...terms, roles: ['provider-admin'] }, { ...terms, assignments: Array(101).fill(engagement) }, { ...terms, assignments: [engagement, engagement] }]) {
    assert.throws(() => parseInvitationPreview(invalid));
  }
});

test('membership expiry renewal uses explicit bounded UTC values and shows effective status', () => {
  assert.equal(effectiveMembershipStatus({ active: true, expires_at: 100 }, 100), 'Expired');
  assert.equal(effectiveMembershipStatus({ active: true, expires_at: 101 }, 100), 'Active');
  assert.equal(effectiveMembershipStatus({ active: true, expires_at: null }, 100), 'Active');
  assert.equal(effectiveMembershipStatus({ active: false, expires_at: 101 }, 100), 'Inactive');
  assert.equal(parseMembershipExpiry('9999-12-31T23:59:59'), 253402300799);
  assert.equal(membershipExpiryInput(253402300799), '9999-12-31T23:59:59');
  assert.equal(membershipExpiryInput(null), '');
  for (const invalid of ['', '1970-01-01T00:00:00', '2026-02-30T00:00', '10000-01-01T00:00:00', '2026-10-01', '2026-10-01T00:00:00Z']) assert.equal(parseMembershipExpiry(invalid), null);
});

test('legacy assignments remain bounded with an explicit incomplete projection and independently checked pages', () => {
  const existing = Array.from({ length: 100 }, (_, index) => ({ client_id: 'client-a', engagement_id: `engagement-${index}` }));
  const legacy = { ...member, assignments: existing, assignments_count: 101, assignments_complete: false };
  assert.deepEqual(parseMembershipSnapshot({ ...snapshot, members: [legacy] }, 'org-a').members[0], legacy);
  for (const invalid of [{ ...legacy, assignments_complete: true }, { ...legacy, assignments_count: 99 }, { ...member, assignments_count: 2 }, { ...member, assignments_complete: false }]) {
    assert.throws(() => parseMembershipSnapshot({ ...snapshot, members: [invalid] }, 'org-a'));
  }
  const details = { organisation_id: 'org-a', actor_id: 'actor-a', version: '1', total: 101, assignments: [{ ...engagement, expires_at: 1800000000 }], next_cursor: null };
  assert.deepEqual(parseMemberAssignmentPage(details, 'org-a', 'actor-a'), details);
  assert.throws(() => parseMemberAssignmentPage(details, 'org-b', 'actor-a'), /audience/);
  assert.throws(() => parseMemberAssignmentPage(details, 'org-a', 'actor-other'), /audience/);
  assert.throws(() => parseMemberAssignmentPage({ ...details, assignments: Array(51).fill(details.assignments[0]) }, 'org-a', 'actor-a'));
});
