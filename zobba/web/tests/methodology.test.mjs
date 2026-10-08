import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessError } from '../src/auth.ts';
import { methodologyFailure, methodologyRefused, methodologyIssueLabel, applyMethodology, discardMethodologyAction, freezeMethodologyAction, recoverMethodologyAction, retainMethodologyAction, methodologyAudience, parseDefinition, parseMethodologyReceipt, parseMethodologySnapshot, parseSaveMethodology, parseTaskBasis, readMethodology, readTaskBasis, newMethodologyRequirement, inheritanceMode, inheritanceValue, methodologyLineageHead, methodologyEditCommand, methodologyReviewCommand } from '../src/methodology.ts';
import { parseCommand, parseMessage } from '../src/conversation.ts';

const session = { identity: { id: 'admin-a', display_name: 'Administrator' }, csrf_token: 'exact-session' };
const context = { audit_area: 'Revenue', period_start: '2025-01-01', period_end: '2025-12-31' };
const requirement = { id: 'support', label: 'Sufficient support', mandatory: true, criteria: ['Support the conclusion'], populations: null,
  evidence_checks: ['Inspect source completeness'], ratings: null, review_rules: ['Independent review'], templates: [{ id: 'paper', version: 'v1' }], suitable_skills: null };
const template = { id: 'paper', version: 'v1', name: 'Working paper', sections: [{ id: 'conclusion', title: 'Conclusion', content: '  Record criterion.\r\n\tList supporting evidence.\n', required: true }] };
const definition = { name: 'Firm standard', neutral_starter: false, default_context: context, requirements: [requirement], templates: [template] };
const command = { key: 'save-one', expected_revision: '9007199254740993', supersedes: null, undo_of: null,
  assignment: { kind: 'firm', client_id: null, engagement_id: null }, applicability: { audit_area: null, period_start: null, period_end: null },
  activation: { mode: 'new_tasks', available_at: 1790899200 }, definition, source: { kind: 'authored', reference: null, note: null } };
const impact = { id: 'impact-one', version_id: 'version-one', activation_mode: 'new_tasks', affected_tasks: '2', pending_tasks: '0', retained_tasks: '2', potentially_material: true, diff: ['Requirements changed'] };
const saved = { id: 'version-one', actor_id: 'admin-a', saved_at: 1790899200, revision: '9007199254740994', command, recalled: false };
const snapshot = { organisation_id: 'org-a', revision: '9007199254740994', versions: [saved], impacts: [impact], engagements: [{ client_id: 'client-a', client_name: 'Alder', engagement_id: 'engagement-a', engagement_name: 'Audit' }] };
const action = { kind: 'save', organisation_id: 'org-a', body: command };
const receipt = { event_id: 'event-one', organisation_id: 'org-a', actor_id: 'admin-a', version_id: 'version-one', revision: '9007199254740994', kind: 'save', impact };
const resolution = { status: 'resolved', context, version_ids: ['version-one'], neutral_source_version_ids: [], requirements: [{ requirement, source_version_ids: ['version-one'], field_sources: [{ field: 'criteria', version_ids: ['version-one'] }] }],
  templates: [{ template, source_version_id: 'version-one' }], issues: [], reason: 'Firm requirements with exact context' };
const binding = { id: 'binding-one', actor_id: 'admin-a', bound_at: 1790899200, execution_epoch: '0', candidate_version_ids: ['version-one'], context_command_id: null, resolution };
const basis = { task_id: 'task-a', current: binding, pending: null, history: [], notices: [], recalled: false };

test('methodology projections preserve exact attributed criteria/templates and large revisions, excluding unknown fields', () => {
  assert.deepEqual(parseSaveMethodology(command), command);
  assert.deepEqual(parseMethodologySnapshot(snapshot, 'org-a'), snapshot);
  assert.deepEqual(parseTaskBasis(basis, 'task-a'), basis);
  assert.throws(() => parseMethodologySnapshot(snapshot, 'org-b'), /audience/);
  assert.throws(() => parseTaskBasis(basis, 'task-b'), /audience/);
  assert.equal(JSON.stringify(parseMethodologySnapshot({ ...snapshot, secret: 'discard-me' }, 'org-a')).includes('discard-me'), false);
  assert.equal(parseTaskBasis({ ...basis, current: { ...binding, resolution: { ...resolution, status: 'incomplete', issues: ['Period missing'] } } }, 'task-a').current.resolution.status, 'incomplete');
});

test('Task basis retains legitimate history and notices beyond the configuration input limits', () => {
  const history = Array.from({ length: 201 }, (_, index) => ({ ...binding, id: `binding-${index}`, execution_epoch: String(index), context_command_id: `guide-${index}` }));
  const notices = Array.from({ length: 201 }, (_, index) => ({ id: `notice-${index}`, version_id: 'version-one', actor_id: 'admin-a', requested_at: 1790899200, impact }));
  const projected = parseTaskBasis({ ...basis, history, notices }, 'task-a');
  assert.deepEqual(projected.history, history);
  assert.deepEqual(projected.notices, notices);
  const impacts = notices.map(notice => ({ ...notice.impact, id: notice.id }));
  assert.deepEqual(parseMethodologySnapshot({ ...snapshot, impacts }, 'org-a').impacts, impacts);
  const issues = Array.from({ length: 102 }, (_, index) => `Requirement ${index} needs a criterion`);
  assert.deepEqual(parseTaskBasis({ ...basis, current: { ...binding, resolution: { ...resolution, status: 'incomplete', issues } } }, 'task-a').current.resolution.issues, issues);
  const engagements = Array.from({ length: 512 }, (_, index) => ({ ...snapshot.engagements[0], engagement_id: `engagement-${index}` }));
  assert.deepEqual(parseMethodologySnapshot({ ...snapshot, engagements }, 'org-a').engagements, engagements);
  const recallDiff = `Recalled: ${'r'.repeat(2000)}`;
  assert.equal(parseMethodologySnapshot({ ...snapshot, impacts: [{ ...impact, diff: [recallDiff] }] }, 'org-a').impacts[0].diff[0], recallDiff);
  const reason = `Explicit Task context supplied by Guide: ${'a'.repeat(3900)}\n  Preserve the explanation.\n`;
  assert.equal(parseTaskBasis({ ...basis, pending: { id: 'guide-a', actor_id: 'admin-a', requested_at: 1790899200, resolution, reason } }, 'task-a').pending.reason, reason);
  assert.throws(() => parseTaskBasis({ ...basis, history: Array(4097).fill(binding) }, 'task-a'));
  assert.throws(() => parseTaskBasis({ ...basis, notices: Array(257).fill(notices[0]) }, 'task-a'));
});

test('methodology refuses malformed dates, revisions, scopes, controls and unbounded definitions', () => {
  for (const expected_revision of ['01', '-1', '9223372036854775808', 9007199254740992]) assert.throws(() => parseSaveMethodology({ ...command, expected_revision }));
  for (const bad of [
    { ...command, assignment: { kind: 'firm', client_id: 'client-a', engagement_id: null } },
    { ...command, applicability: { ...context, period_start: '2025-02-29' } },
    { ...command, applicability: { ...context, period_end: null } },
    { ...command, applicability: { ...context, period_start: '2026-01-01' } },
    { ...command, definition: { ...definition, requirements: Array(101).fill(requirement) } },
    { ...command, definition: { ...definition, requirements: [requirement, requirement] } },
    { ...command, definition: { ...definition, name: ' leading' } },
    { ...command, definition: { ...definition, name: 'newline\nlabel' } },
    { ...command, definition: { ...definition, name: '\ud800' } },
  ]) assert.throws(() => parseSaveMethodology(bad));
});

test('Unicode label, source, criteria and template parsing matches Rust White_Space without trimming FEFF', () => {
  for (const accepted of ['\ufeff', '\ufeffFirm', 'Firm\ufeff', 'A\u00a0B', 'A\u3000B', '界'.repeat(200)]) {
    const value = { ...definition, name: accepted, default_context: { ...context, audit_area: accepted }, templates: [{ ...template, name: accepted, sections: [{ ...template.sections[0], title: accepted, content: accepted }] }], requirements: [{ ...requirement, label: accepted, criteria: [accepted] }] };
    assert.deepEqual(parseDefinition(value), value);
  }
  for (const bad of ['\u0085Firm', 'Firm\u0085', '\u00a0Firm', 'Firm\u3000', '界'.repeat(201)]) assert.throws(() => parseDefinition({ ...definition, name: bad }));
});

test('exact Save retries retain frozen key, body, schedule and actor with pre/post session checks', async t => {
  const frozen = freezeMethodologyAction(action), calls = [];
  assert.equal(Object.isFrozen(frozen.body.definition.requirements[0]), true);
  assert.throws(() => { frozen.body.activation.available_at++; }, TypeError);
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    calls.push({ path, ...init });
    if (path.endsWith('/auth/session')) return Response.json(session);
    assert.equal(path, '/api/methodology/organisations/org-a/save');
    assert.equal(init.headers['X-Expected-Session'], session.csrf_token);
    assert.equal(init.headers['X-Expected-Actor'], session.identity.id);
    assert.equal(init.headers['X-CSRF-Token'], session.csrf_token);
    return Response.json(receipt);
  });
  await applyMethodology(frozen, session, new AbortController().signal);
  await applyMethodology(frozen, session, new AbortController().signal);
  assert.equal(calls.length, 6); assert.equal(calls[1].body, calls[4].body);
  for (const change of [{ organisation_id: 'org-b' }, { actor_id: 'other' }, { kind: 'recall' }, { version_id: 'wrong' }]) assert.throws(() => parseMethodologyReceipt({ ...receipt, ...change }, session, frozen));
});

test('replaced session fences initial Save and post-response receipt disclosure', async t => {
  let posts = 0, reads = 0;
  t.mock.method(globalThis, 'fetch', async (_path, init) => { if (init.method === 'POST') posts++; return new Response(null, { status: 412 }); });
  await assert.rejects(applyMethodology(action, session, new AbortController().signal), e => e instanceof AccessError && e.status === 412);
  assert.equal(posts, 0); t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async (_path, init) => {
    if (init.method === 'POST') { posts++; return Response.json(receipt); }
    return Response.json(++reads === 1 ? session : { ...session, csrf_token: 'replacement' });
  });
  await assert.rejects(applyMethodology(action, session, new AbortController().signal), e => e instanceof AccessError && e.status === 412);
  assert.equal(posts, 1);
});

test('current metadata and Task reads bind exact session and scope before publication', async t => {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    paths.push(path); assert.equal(init.headers['X-Expected-Session'], session.csrf_token);
    assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'same-origin');
    return Response.json(path.endsWith('/auth/session') ? session : path.includes('/tasks/') ? basis : snapshot);
  });
  await readMethodology('org-a', session, new AbortController().signal);
  await readTaskBasis({ organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' }, 'task-a', session, new AbortController().signal);
  assert.equal(paths[2], '/api/engagements/engagement-a/tasks/task-a/methodology?organisation_id=org-a&client_id=client-a');
  assert.notEqual(methodologyAudience(session, 'org-a'), methodologyAudience({ ...session, csrf_token: 'next' }, 'org-a'));
  assert.notEqual(methodologyAudience(session, 'org-a'), methodologyAudience(session, 'org-b'));
});

test('optional Create and Guide context survive exact command recovery while controls refuse context', () => {
  const create = { key: 'create-a', kind: 'create', task_id: null, cycle_id: null, content: 'Prepare work', context };
  assert.deepEqual(parseCommand(create), create);
  const omitted = { ...create }; delete omitted.context;
  assert.deepEqual(parseCommand(omitted), omitted);
  assert.deepEqual(parseCommand({ ...create, context: { ...context, audit_area: '\ufeffRevenue' } }).context.audit_area, '\ufeffRevenue');
  assert.throws(() => parseCommand({ ...create, context: { ...context, period_start: '2025-02-29' } }));
  assert.throws(() => parseCommand({ ...create, context: { ...context, policy_override: true } }));
  const guide = { ...create, kind: 'guide', task_id: 'task-a', cycle_id: 'cycle-a' };
  assert.deepEqual(parseCommand(guide), guide);
  assert.deepEqual(parseCommand({ ...guide, context: {} }).context, { audit_area: null, period_start: null, period_end: null });
  assert.throws(() => parseCommand({ ...guide, kind: 'pause', content: null }));
});


test('uncertain in-memory Save custody survives a same-session remount and clears for a changed audience', () => {
  retainMethodologyAction(action, session);
  assert.deepEqual(recoverMethodologyAction(session), action);
  assert.equal(Object.isFrozen(recoverMethodologyAction(session).body.activation), true);
  assert.equal(recoverMethodologyAction({ ...session, csrf_token: 'replaced' }), null);
  assert.equal(recoverMethodologyAction(session), null);
  retainMethodologyAction(action, session); discardMethodologyAction();
  assert.equal(recoverMethodologyAction(session), null);
});


test('conversation echo preserves submitted context without inventing resolved defaults', () => {
  const echo = { command_id: 'create-receipt', key: 'create-a', author_id: 'admin-a', author_label: 'Admin', kind: 'create', task_id: 'task-a', cycle_id: 'cycle-a', target_task_id: null, target_cycle_id: null, content: 'Prepare work', received_cursor: '1', applied_cursor: null };
  assert.equal('context' in parseMessage(echo, '1'), false);
  assert.deepEqual(parseMessage({ ...echo, context }, '1').context, context);
  assert.deepEqual(parseMessage({ ...echo, kind: 'guide', target_task_id: 'task-a', target_cycle_id: 'cycle-a', context }, '1').context, context);
  assert.throws(() => parseMessage({ ...echo, kind: 'pause', content: null, target_task_id: 'task-a', target_cycle_id: 'cycle-a', context }, '1'));
});


test('methodology limitations use human requirement labels while unknown codes have a safe inspection path', () => {
  const labels = new Map([['discovery-0', 'Revenue completeness']]);
  assert.equal(methodologyIssueLabel('missing_criteria:discovery-0', labels), 'Define evaluation criteria for Revenue completeness.');
  assert.equal(methodologyIssueLabel('missing_review_rules:discovery-0', labels), 'Define review and issuance rules for Revenue completeness.');
  assert.equal(methodologyIssueLabel('missing_criteria', labels), 'Evaluation criteria have not been defined.');
  assert.equal(methodologyIssueLabel('missing_template:paper:v2', labels), 'Template paper (v2) is unavailable. Provide its exact saved content.');
  assert.match(methodologyIssueLabel('conflicting_default_context', labels), /defaults disagree/);
  assert.match(methodologyIssueLabel('unresolved_applicability:version-1', labels), /audit area and business period/);
  assert.match(methodologyIssueLabel('future_unknown_code', labels), /recorded limitation code/);
});


test('a first 429 refusal releases the draft while a throttled uncertain retry keeps exact request custody', () => {
  const refused = new AccessError(429);
  assert.equal(methodologyRefused(refused), true);
  assert.equal(methodologyRefused(refused, true), false);
  assert.match(methodologyFailure(refused), /edit is retained/);
  assert.match(methodologyFailure(refused, true), /original delivery remains unconfirmed/);
  assert.equal(methodologyRefused(new AccessError(503)), false);
  assert.equal(methodologyRefused(new Error('Network interrupted')), false);
});

test('Undo, historical Edit and revision recovery follow exact successor links across overlapping independent packages', () => {
  const version = (id, revision, supersedes, name) => ({ ...saved, id, revision, command: { ...command, supersedes, definition: { ...definition, name } } });
  const a1 = version('a1', '1', null, 'A original');
  const a2 = version('a2', '2', 'a1', 'A current');
  const b1 = version('b1', '3', null, 'Independent B');
  const b2 = version('b2', '4', 'b1', 'Independent B current');
  const overlapping = { ...snapshot, revision: '4', versions: [b2, a1, b1, a2] };
  assert.equal(methodologyLineageHead(overlapping.versions, a1.id).id, a2.id);
  const undo = methodologyEditCommand(overlapping, a1.id, true, 'undo-a');
  assert.equal(undo.supersedes, a2.id); assert.equal(undo.undo_of, a1.id);
  assert.deepEqual(undo.definition, a1.command.definition);
  const historicalEdit = methodologyEditCommand(overlapping, a1.id, false, 'edit-a');
  assert.equal(historicalEdit.supersedes, a2.id); assert.deepEqual(historicalEdit.definition, a2.command.definition);
  historicalEdit.definition.name = 'Retained unsaved A edit';
  const a3 = version('a3', '5', a2.id, 'Concurrent A edit');
  const b3 = version('b3', '6', b2.id, 'Later independent B');
  const latest = { ...overlapping, revision: '6', versions: [...overlapping.versions, a3, b3] };
  const reviewed = methodologyReviewCommand(latest, historicalEdit, 'review-a');
  assert.equal(reviewed.supersedes, a3.id); assert.equal(reviewed.expected_revision, '6');
  assert.equal(reviewed.definition.name, 'Retained unsaved A edit');
  assert.deepEqual(reviewed.assignment, a1.command.assignment);
  assert.deepEqual(reviewed.applicability, a1.command.applicability);
  assert.equal(methodologyLineageHead(latest.versions, b1.id).id, b3.id);
  assert.equal(methodologyLineageHead([a1, { ...a2, command: { ...a2.command, supersedes: 'a1' } }, { ...a3, command: { ...a3.command, supersedes: 'a1' } }], 'a1'), null);
  assert.throws(() => methodologyReviewCommand({ ...latest, versions: [] }, historicalEdit, 'missing'));
});

test('optional label and field behavior preserve untouched null, supplied values and explicit empty arrays', () => {
  const untouched = newMethodologyRequirement('new-rule');
  assert.equal(untouched.label, null);
  assert.equal(parseSaveMethodology({ ...command, definition: { ...definition, requirements: [untouched] } }).definition.requirements[0].label, null);
  for (const [values, expected] of [[null, 'inherit'], [[], 'clear'], [['Criterion'], 'value']]) assert.equal(inheritanceMode(values), expected);
  assert.equal(inheritanceValue('inherit', ['Criterion'], ''), null);
  assert.deepEqual(inheritanceValue('clear', ['Criterion'], ''), []);
  assert.deepEqual(inheritanceValue('value', null, ''), ['']);
  assert.deepEqual(inheritanceValue('clear', [{ id: 'paper', version: 'v1' }], { id: '', version: '' }), []);
  const optionalClear = { ...requirement, mandatory: false, criteria: [], templates: [], suitable_skills: [], review_rules: null };
  const parsed = parseSaveMethodology({ ...command, definition: { ...definition, requirements: [optionalClear] } });
  assert.deepEqual(parsed.definition.requirements[0], optionalClear);
  const mandatoryClear = { ...optionalClear, mandatory: true };
  assert.deepEqual(parseDefinition({ ...definition, requirements: [mandatoryClear] }).requirements[0], mandatoryClear);
});

test('mixed adopted and neutral basis keeps exact neutral field and template source attribution without changing status', () => {
  const mixed = { ...resolution, status: 'resolved', neutral_source_version_ids: ['starter-one'],
    requirements: [{ requirement, source_version_ids: ['starter-one', 'version-one'], field_sources: [{ field: 'criteria', version_ids: ['starter-one'] }, { field: 'review_rules', version_ids: ['version-one'] }] }],
    templates: [{ template, source_version_id: 'starter-one' }] };
  assert.deepEqual(parseTaskBasis({ ...basis, current: { ...binding, resolution: mixed } }, 'task-a').current.resolution, mixed);
  const maximumSources = [...Array.from({ length: 128 }, (_, index) => `starter-${index}`), 'builtin_neutral_v1'];
  assert.deepEqual(parseTaskBasis({ ...basis, current: { ...binding, resolution: { ...mixed, neutral_source_version_ids: maximumSources } } }, 'task-a').current.resolution.neutral_source_version_ids, maximumSources);
  assert.throws(() => parseTaskBasis({ ...basis, current: { ...binding, resolution: { ...mixed, neutral_source_version_ids: [...maximumSources, 'extra'] } } }, 'task-a'));
});
