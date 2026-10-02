import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AccessError, MAX_JSON_BYTES } from '../src/auth.ts';
import { KNOWLEDGE_CUSTODY_BYTES, discardKnowledgeCustody, discardKnowledgeOwner, discardUnsubmittedKnowledgeDrafts, knowledgeAudience, knowledgeEngagementScope, knowledgeRequestDeadline, recoverKnowledgeOutcome, parseKnowledgePage, parseKnowledgePeriod, parseKnowledgeReceipt, parseKnowledgeScope, parseKnowledgeView, parsePreference, readKnowledge, readKnowledgeExact, readKnowledgeSourceStatus, readPreference, recoverKnowledge, retainKnowledge, submitKnowledge, withdrawReplacedKnowledgeSession } from '../src/knowledge.ts';

const session = { identity: { id: 'actor-a', display_name: 'Actor A' }, csrf_token: 'exact-session' };
const scope = { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' };
const sourceScope = { kind: 'engagement', ...scope, owner_id: null };
const dependency = { kind: 'evidence', scope: sourceScope, evidence_id: 'original-a', storage_version: 'version-a', digest: 'a'.repeat(64) };
const text = '\ufeff  Registered source\r\n😀\r\n';
const record = { id: 'knowledge-a', revision: '9007199254740993', actor_id: 'actor-a', recorded_at: 1790899200, scope: sourceScope, kind: 'observation', text, period: { start: null, end: null }, certainty: 'source_states', uncertainty: null, dependencies: [dependency], source: { evidence_id: dependency.evidence_id, storage_version: dependency.storage_version, digest: dependency.digest, byte_start: 0, byte_end: Buffer.byteLength(text), original_size: Buffer.byteLength(text), partial: false, field_path: null }, direction: null, preference: null, supersedes: null };
const view = { record, status: 'current', status_reason: null, can_correct: false, can_exclude: true, can_forget: true, can_reuse: true, can_undo: false };
const page = { task_id: 'task-a', revision: '9007199254740994', execution_epoch: '12', methodology_binding_id: 'binding-a', items: [view], next_after: null, omissions: ['unknown_period', 'partial_source'] };
const privateView = { ...view, record: { ...record, id: 'preference-a', scope: { kind: 'personal', organisation_id: 'org-a', client_id: null, engagement_id: null, owner_id: 'actor-a' }, kind: 'preference', certainty: 'learned', text: 'Expanded inspection', dependencies: [], source: null, preference: { name: 'task_inspection_layout', value: 'expanded', inferred: true, rule: 'layout_repeat_v1', observation_ids: ['event-a', 'event-b'] } }, can_exclude: false, can_reuse: false, can_undo: true };
const preference = { organisation_id: 'org-a', owner_id: 'actor-a', revision: '3', current: privateView, publications: [], consumed_through: '2' };
const receipt = { event_id: 'mutation-a', revision: '9007199254740995', record: view, affected_ids: ['knowledge-a'], affected_destinations: [] };
const command = { kind: 'knowledge', scope, task_id: 'task-a', body: { key: 'request-a', expected_revision: page.revision, action: { kind: 'exclude', target: { id: record.id, revision: record.revision }, reason: 'Changed support' } } };
const draft = { mode: 'assert', target: null, text: '  exact draft\r\n', reason: '', uncertainty: 'Unknown completeness', start: '', end: '', destination_engagement_id: '', destination_task_id: '', expected_revision: page.revision, dependencies: [], predecessor_id: '', replacement_id: '', expected_source_revision: null };

test('knowledge preserves exact BOM/CRLF/emoji, source byte location, author and large revision', () => {
  assert.deepEqual(parseKnowledgeView(view), view);
  assert.deepEqual(parseKnowledgePage(page, 'task-a'), page);
  assert.equal(parseKnowledgeView({ ...view, private_token: 'not returned' }).private_token, undefined);
  for (const revision of ['01', 12, '-1', '9223372036854775808']) assert.throws(() => parseKnowledgeView({ ...view, record: { ...record, revision } }));
  for (const source of [{ ...record.source, byte_start: -1 }, { ...record.source, byte_end: 10485761 }, { ...record.source, byte_end: 16385, original_size: 20000 }, { ...record.source, digest: 'b'.repeat(64) }]) assert.throws(() => parseKnowledgeView({ ...view, record: { ...record, source } }));
});

test('scope and certainty parsing keep personal, firm, client and engagement distinct', () => {
  assert.deepEqual(parseKnowledgeScope(sourceScope), sourceScope);
  for (const patch of [{ kind: 'firm' }, { kind: 'personal', owner_id: null }, { kind: 'client' }, { owner_id: 'actor-a' }]) assert.throws(() => parseKnowledgeScope({ ...sourceScope, ...patch }));
  assert.throws(() => parseKnowledgeView({ ...view, record: { ...record, source: null } }));
  assert.throws(() => parseKnowledgeView({ ...view, record: { ...record, certainty: 'verified_true' } }));
  assert.throws(() => parseKnowledgeView({ ...view, record: { ...record, text: '\ud800' } }));
  const decision = { ...view, record: { ...record, kind: 'decision', certainty: 'user_directed', source: null, dependencies: [{ kind: 'guide', scope: sourceScope, command_id: 'guide-a', task_id: 'source-task', cycle_id: 'original-cycle' }], direction: { command_id: 'guide-a', task_id: 'source-task', cycle_id: 'original-cycle', standing: 'Received, not yet applied' } } };
  assert.deepEqual(parseKnowledgeView(decision), decision);
});

test('bounded pages enforce exact Task, stable ASCII order and honest page cursor', () => {
  assert.throws(() => parseKnowledgePage(page, 'other-task'), /audience/);
  assert.throws(() => parseKnowledgePage({ ...page, items: [view, view] }, 'task-a'));
  assert.throws(() => parseKnowledgePage({ ...page, next_after: record.id }, 'task-a'));
  assert.throws(() => parseKnowledgePage(page, 'task-a', record.id));
  const rows = Array.from({ length: 50 }, (_, i) => ({ ...view, record: { ...record, id: `k-${String(i).padStart(2, '0')}` } }));
  const bounded = { ...page, items: rows, next_after: 'k-49' };
  assert.deepEqual(parseKnowledgePage(bounded, 'task-a'), bounded);
  assert.throws(() => parseKnowledgePage({ ...bounded, items: [...rows].reverse() }, 'task-a'));
  assert.throws(() => parseKnowledgePage({ ...bounded, items: [...rows, { ...view, record: { ...record, id: 'k-50' } }] }, 'task-a'));
  assert.throws(() => parseKnowledgePage({ ...page, omissions: ['forbidden_source_count_12'] }, 'task-a'));
});

test('periods stay explicitly unknown and reject incomplete or invalid date ranges', () => {
  assert.deepEqual(parseKnowledgePeriod({ start: null, end: null }), { start: null, end: null });
  for (const [start, end] of [['2025-02-29', '2025-12-31'], ['2026-12-31', '2026-01-01'], ['2026-01-01', null], [null, '2026-12-31']]) assert.throws(() => parseKnowledgePeriod({ start, end }));
});

test('scan-limited partial pages advance only from a disclosed ordered record and never invent an empty cursor', () => {
  const partial = { ...page, next_after: record.id, omissions: ['scan_limit'] };
  assert.deepEqual(parseKnowledgePage(partial, 'task-a'), partial);
  const empty = { ...page, items: [], next_after: null, omissions: ['scan_limit'] };
  assert.deepEqual(parseKnowledgePage(empty, 'task-a'), empty);
  for (const count of [2, 49]) {
    const rows = Array.from({ length: count }, (_, i) => ({ ...view, record: { ...record, id: `k-${String(i).padStart(2, '0')}` } }));
    const bounded = { ...page, items: rows, next_after: rows.at(-1).record.id, omissions: ['bounded_page', 'scan_limit'] };
    assert.deepEqual(parseKnowledgePage(bounded, 'task-a'), bounded);
    assert.throws(() => parseKnowledgePage({ ...bounded, omissions: ['bounded_page'] }, 'task-a'));
    assert.throws(() => parseKnowledgePage({ ...bounded, items: [...rows].reverse() }, 'task-a'));
  }
  assert.throws(() => parseKnowledgePage({ ...partial, next_after: 'undisclosed-prefix-end' }, 'task-a'));
  assert.throws(() => parseKnowledgePage({ ...empty, next_after: 'undisclosed-prefix-end' }, 'task-a'));
  assert.throws(() => parseKnowledgePage(partial, 'task-a', record.id));
  assert.throws(() => parseKnowledgePage({ ...partial, omissions: [] }, 'task-a'));
});

test('only the allowlisted typed owner preference is disclosed privately', () => {
  assert.deepEqual(parsePreference(preference, 'org-a', 'actor-a'), preference);
  assert.throws(() => parsePreference(preference, 'org-a', 'actor-b'), /owner/);
  assert.throws(() => parsePreference(preference, 'org-b', 'actor-a'), /owner/);
  for (const patch of [{ name: 'arbitrary_private_text' }, { value: 'skip_review' }, { observation_ids: ['event-a', 'event-a'] }]) assert.throws(() => parsePreference({ ...preference, current: { ...privateView, record: { ...privateView.record, preference: { ...privateView.record.preference, ...patch } } } }, 'org-a', 'actor-a'));
  const published = { ...privateView, record: { ...privateView.record, id: 'publication-a', kind: 'published_preference', scope: sourceScope, certainty: 'explicit_preference', preference: { name: 'task_inspection_layout', value: 'expanded', inferred: false, rule: null, observation_ids: [] } }, can_undo: false };
  assert.deepEqual(parsePreference({ ...preference, publications: [published] }, 'org-a', 'actor-a').publications, [published]);
});

test('receipt parsing retains current status instead of reviving a corrected record', () => {
  const stale = { ...receipt, record: { ...view, status: 'invalidated', status_reason: 'Source corrected', can_exclude: false, can_forget: false, can_reuse: false } };
  assert.deepEqual(parseKnowledgeReceipt(stale), stale);
});

test('private knowledge drafts survive exact-owner remount in memory and clear on replacement and scope denial', () => {
  discardKnowledgeCustody(); const owner = knowledgeAudience(session, 'org-a', scope, 'task-a');
  assert.equal(retainKnowledge(owner, session, scope, { draft, pending: command }), true);
  const recovered = recoverKnowledge(owner, session); assert.deepEqual(recovered, { draft, pending: command });
  recovered.draft.text = 'changed'; assert.equal(recoverKnowledge(owner, session).draft.text, draft.text);
  discardKnowledgeCustody({ ...scope, engagement_id: 'other' }); assert.ok(recoverKnowledge(owner, session).pending);
  discardKnowledgeCustody(scope); assert.deepEqual(recoverKnowledge(owner, session), { draft: null, pending: null });
  retainKnowledge(owner, session, scope, { draft }); withdrawReplacedKnowledgeSession({ ...session, csrf_token: 'replacement' });
  assert.deepEqual(recoverKnowledge(owner, session), { draft: null, pending: null });
});

test('custody refuses prospective overflow without evicting uncertain commands or silently replacing drafts', () => {
  discardKnowledgeCustody(); const owner = knowledgeAudience(session, 'org-a', scope, 'task-a');
  assert.equal(retainKnowledge(owner, session, scope, { draft, pending: command }), true);
  assert.equal(retainKnowledge(owner, session, scope, { draft: { ...draft, text: 'x'.repeat(KNOWLEDGE_CUSTODY_BYTES) } }), false);
  assert.deepEqual(recoverKnowledge(owner, session), { draft, pending: command });
  for (let i = 0; i < 15; i++) assert.equal(retainKnowledge(`${owner}/${i}`, session, scope, { draft }), true);
  assert.equal(retainKnowledge(`${owner}/overflow`, session, scope, { draft }), false);
  assert.ok(recoverKnowledge(owner, session).pending);
  discardKnowledgeOwner(owner); assert.equal(retainKnowledge(`${owner}/overflow`, session, scope, { draft }), true);
  discardKnowledgeCustody();
});

test('knowledge reads use exact-session scope and reject delayed replacement before disclosing content', async () => {
  const previous = globalThis.fetch; const seen = [];
  try {
    globalThis.fetch = async (url, init) => { seen.push([url, init]); return Response.json(String(url).includes('/auth/session') ? { ...session, csrf_token: 'replacement' } : String(url).includes('/knowledge/verify?') ? { verified: true } : page); };
    await assert.rejects(readKnowledge(scope, 'task-a', session, new AbortController().signal), error => error instanceof AccessError && error.status === 412);
    assert.equal(seen[0][1].headers['X-Expected-Session'], session.csrf_token);
    assert.match(seen[0][0], /organisation_id=org-a&client_id=client-a/);
    assert.equal(seen[0][1].cache, 'no-store');
  } finally { globalThis.fetch = previous; }
});

test('exact lookup binds both record and revision independently of pagination', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async url => Response.json(String(url).includes('/auth/session') ? session : String(url).includes('/knowledge/verify?') ? { verified: true } : view);
    assert.deepEqual(await readKnowledgeExact(scope, 'task-a', { id: record.id, revision: record.revision }, session, new AbortController().signal, page), view);
    await assert.rejects(readKnowledgeExact(scope, 'task-a', { id: record.id, revision: '1' }, session, new AbortController().signal, page), /Invalid knowledge/);
    await assert.rejects(readKnowledgeExact(scope, 'task-a', { id: 'other', revision: record.revision }, session, new AbortController().signal, page), /Invalid knowledge/);
  } finally { globalThis.fetch = previous; }
});

test('buffered knowledge revalidates exact query, source statuses and Task basis before disclosure', async () => {
  const previous = globalThis.fetch; const seen = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push([url, init]);
      if (String(url).includes('/knowledge/verify?')) return new Response(null, { status: 409 });
      return Response.json(String(url).includes('/auth/session') ? session : page);
    };
    await assert.rejects(readKnowledge(scope, 'task-a', session, new AbortController().signal, null, 'source', true), error => error instanceof AccessError && error.status === 409);
    const verification = seen.find(([url]) => url.includes('/knowledge/verify?'));
    assert.deepEqual(JSON.parse(verification[1].body), { query: { after: null, text: 'source', include_inactive: true }, expected_execution_epoch: page.execution_epoch, expected_methodology_binding_id: page.methodology_binding_id, items: [{ id: record.id, revision: record.revision, status: 'current' }], exact: false });
  } finally { globalThis.fetch = previous; }
});

test('mutation sends one captured exact command with actor/CSRF/session fencing and checks session after receipt', async () => {
  const previous = globalThis.fetch; const seen = [];
  try {
    globalThis.fetch = async (url, init) => { seen.push([url, init]); return Response.json(String(url).includes('/auth/session') ? session : receipt); };
    assert.deepEqual(await submitKnowledge(command, session, new AbortController().signal), receipt);
    const posts = seen.filter(([, init]) => init?.method === 'POST'); assert.equal(posts.length, 1);
    assert.deepEqual(JSON.parse(posts[0][1].body), command.body);
    assert.deepEqual(posts[0][1].headers, { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token });
    assert.equal(seen.at(-1)[0], '/api/auth/session');
  } finally { globalThis.fetch = previous; }
});

test('knowledge and preference ports preserve the ordinary 4 MiB response cap', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async url => String(url).includes('/auth/session') ? Response.json(session) : new Response(' '.repeat(MAX_JSON_BYTES + 1));
    await assert.rejects(readKnowledge(scope, 'task-a', session, new AbortController().signal), /response size/);
    await assert.rejects(readPreference('org-a', session, new AbortController().signal), /response size/);
  } finally { globalThis.fetch = previous; }
});

test('actual API omission response fixture passes the unchanged strict page and source parsers', async () => {
  const fixture = JSON.parse(readFileSync(new URL('fixtures/knowledge-omissions-wire.json', import.meta.url), 'utf8'));
  assert.deepEqual(parseKnowledgePage(fixture.page, 'task-a'), fixture.page);
  assert.deepEqual(fixture.page.omissions, ['unavailable_support', 'unknown_period']);
  assert.throws(() => parseKnowledgePage({ ...fixture.page, omissions: ['unavailable_support', 'unknown_period', 'unavailable_support'] }, 'task-a'));
  const previous = globalThis.fetch;
  let duplicate = false;
  try {
    globalThis.fetch = async url => Response.json(String(url).includes('/auth/session') ? session : String(url).includes('/verify?') ? { verified: true } : duplicate ? { ...fixture.source_status, omissions: ['partial_source', 'partial_source'] } : fixture.source_status);
    assert.deepEqual(await readKnowledgeSourceStatus(scope, 'original-a', session, new AbortController().signal), fixture.source_status);
    duplicate = true;
    await assert.rejects(readKnowledgeSourceStatus(scope, 'original-a', session, new AbortController().signal), /Invalid knowledge/);
  } finally { globalThis.fetch = previous; }
});


test('scope navigation drops only unsent drafts and preserves exact pending custody until true denial or replacement', () => {
  discardKnowledgeCustody(); const owner = knowledgeAudience(session, 'org-a', scope, 'task-a'), unsent = `${owner}/unsent`;
  retainKnowledge(owner, session, scope, { draft, pending: command }); retainKnowledge(unsent, session, scope, { draft });
  discardUnsubmittedKnowledgeDrafts(scope);
  assert.deepEqual(recoverKnowledge(owner, session), { draft, pending: command });
  assert.deepEqual(recoverKnowledge(unsent, session), { draft: null, pending: null });
  discardKnowledgeCustody(scope); assert.equal(recoverKnowledge(owner, session).pending, null);
  retainKnowledge(owner, session, scope, { pending: command }); withdrawReplacedKnowledgeSession({ ...session, csrf_token: 'new-session' });
  assert.equal(recoverKnowledge(owner, session).pending, null); discardKnowledgeCustody();
});

test('preference outcomes retain only attributable receipt and destinations under exact owner custody', () => {
  discardKnowledgeCustody(); const owner = knowledgeAudience(session, 'org-a');
  const outcome = { kind: 'undo', event_id: 'undo-event', revision: '7', affected_destinations: ['engagement-a', 'engagement-z'] };
  assert.equal(retainKnowledge(owner, session, null, { outcome }), true);
  assert.deepEqual(recoverKnowledgeOutcome(owner, session), outcome);
  const copy = recoverKnowledgeOutcome(owner, session); copy.affected_destinations.push('forged');
  assert.deepEqual(recoverKnowledgeOutcome(owner, session), outcome);
  discardUnsubmittedKnowledgeDrafts(scope); assert.deepEqual(recoverKnowledgeOutcome(owner, session), outcome);
  discardKnowledgeOwner(owner); assert.equal(recoverKnowledgeOutcome(owner, session), null);
});

test('only public source I/O requests receive the bounded 120 second deadline', () => {
  assert.equal(knowledgeRequestDeadline(command), 12000);
  assert.equal(knowledgeRequestDeadline({ kind: 'preference' }), 12000);
  assert.equal(knowledgeRequestDeadline({ kind: 'observe' }), 12000);
  assert.equal(knowledgeRequestDeadline({ kind: 'excerpt' }), 120000);
  assert.equal(knowledgeRequestDeadline({ kind: 'recover' }), 120000);
});


test('support references serialize only canonical scope identity from a wider Engagement projection', () => {
  const engagement = { ...scope, organisation_name: 'Display organisation', client_name: 'Display client', engagement_name: 'Display engagement', roles: ['audit_manager'] };
  const actual = knowledgeEngagementScope(engagement);
  assert.deepEqual(actual, sourceScope);
  assert.deepEqual(Object.keys(actual).sort(), ['client_id', 'engagement_id', 'kind', 'organisation_id', 'owner_id']);
  assert.throws(() => knowledgeEngagementScope({ ...engagement, engagement_id: '' }), /Invalid engagement scope/);
});
