import test from 'node:test';
import assert from 'node:assert/strict';
import { discardMethodologyAction, discardMethodologyPending, retainMethodologyAction, recoverMethodologyAction, retainMethodologyDraft, recoverMethodologyDraft, recoverMethodologyOrganisation, withdrawReplacedMethodologySession, METHODOLOGY_CUSTODY_BYTES } from '../src/methodology.ts';

const session = { identity: { id: 'admin-a', display_name: 'Admin' }, csrf_token: 'session-a' };
const command = { key: 'original-key', expected_revision: '7', supersedes: 'version-old', undo_of: 'version-first',
  assignment: { kind: 'engagement', client_id: 'client-a', engagement_id: 'engagement-a' },
  applicability: { audit_area: 'Revenue', period_start: '2025-01-01', period_end: '2025-12-31' },
  activation: { mode: 'active_tasks', available_at: 0 }, definition: { name: 'Unsent exact edit', templates: [{ content: '\uFEFF  Exact\r\n\t🧾 text\n' }] }, source: { kind: 'imported_proposal', reference: 'source-version', note: '  preserved\n' } };
const draft = (organisation = 'org-a') => ({ kind: 'edit', organisation_id: organisation, body: { command: structuredClone(command), availableAt: '2026-12-03T08:04', baseline: '{"immutable":"definition"}' } });
test.afterEach(() => discardMethodologyAction());

test('memory custody preserves exact unsent edit/lineage/activation and isolates clone mutations and organisation', () => {
  const original = draft();
  assert.equal(retainMethodologyDraft('org-a', session, original), true);
  original.body.command.definition.name = 'not retained';
  assert.deepEqual(recoverMethodologyDraft('org-a', session), draft());
  const recovered = recoverMethodologyDraft('org-a', session); recovered.body.availableAt = '';
  assert.deepEqual(recoverMethodologyDraft('org-a', session), draft());
  assert.equal(recoverMethodologyDraft('org-b', session), null);
  assert.equal(recoverMethodologyOrganisation(session), 'org-a');
  assert.equal(retainMethodologyDraft('org-b', session, draft()), false);
});
test('recall custody retains exact reason and expected version/revision/key through transient remount', () => {
  const recall = { kind: 'recall', organisation_id: 'org-a', body: { version: { id: 'saved-version', command }, reason: '\uFEFF  Exact unsent\n\t🧾 explanation\n', expected_revision: '9', key: 'recall-key' } };
  assert.equal(retainMethodologyDraft('org-a', session, recall), true);
  assert.deepEqual(recoverMethodologyDraft('org-a', session), recall);
  assert.equal(recoverMethodologyAction(session), null);
});
test('replacement by actor or exact session clears every former audience without resurrection', () => {
  for (const changed of [{ ...session, csrf_token: 'new-session' }, { ...session, identity: { ...session.identity, id: 'admin-b' } }]) {
    retainMethodologyDraft('org-a', session, draft()); retainMethodologyDraft('org-b', session, draft('org-b'));
    retainMethodologyAction({ kind: 'save', organisation_id: 'org-a', body: command }, session);
    withdrawReplacedMethodologySession(changed);
    assert.equal(recoverMethodologyOrganisation(session), null);
    assert.equal(recoverMethodologyAction(session), null);
  }
});
test('current organisation denial/cancel/success clears its draft and pending receipt, leaving other audiences', () => {
  retainMethodologyDraft('org-a', session, draft()); retainMethodologyDraft('org-b', session, draft('org-b'));
  retainMethodologyAction({ kind: 'save', organisation_id: 'org-a', body: command }, session);
  discardMethodologyPending('org-a', session);
  assert.deepEqual(recoverMethodologyDraft('org-a', session), draft());
  assert.equal(recoverMethodologyAction(session, 'org-a'), null);
  discardMethodologyAction('org-a');
  assert.equal(recoverMethodologyDraft('org-a', session), null);
  assert.deepEqual(recoverMethodologyDraft('org-b', session), draft('org-b'));
  retainMethodologyDraft('org-b', session, null);
  assert.equal(recoverMethodologyOrganisation(session), null);
});
test('audience capacity refuses new custody without evicting any draft or uncertain command', () => {
  for (let index = 0; index < 16; index++) assert.equal(retainMethodologyDraft(`org-${index}`, session, draft(`org-${index}`)), true);
  const action = { kind: 'save', organisation_id: 'org-0', body: command };
  assert.equal(retainMethodologyAction(action, session), true);
  assert.equal(retainMethodologyDraft('org-16', session, draft('org-16')), false);
  assert.equal(retainMethodologyAction({ ...action, organisation_id: 'org-16' }, session), false);
  for (let index = 0; index < 16; index++) assert.deepEqual(recoverMethodologyDraft(`org-${index}`, session), draft(`org-${index}`));
  assert.deepEqual(recoverMethodologyAction(session, 'org-0'), action);
  discardMethodologyAction('org-15'); assert.equal(retainMethodologyDraft('org-16', session, draft('org-16')), true);
});
test('serialized byte capacity rejects before mutation and still permits exact pending recovery and release', () => {
  const large = draft(); large.body.command.definition.name = '🧾'.repeat(Math.floor((METHODOLOGY_CUSTODY_BYTES - 4096) / 4));
  assert.equal(retainMethodologyDraft('org-a', session, large), true);
  const action = { kind: 'save', organisation_id: 'org-b', body: command };
  assert.equal(retainMethodologyAction(action, session), true);
  const bigger = structuredClone(large); bigger.body.command.definition.name += '🧾'.repeat(2048);
  assert.equal(retainMethodologyDraft('org-a', session, bigger), false);
  assert.equal(retainMethodologyAction({ ...action, organisation_id: 'org-a', body: large.body.command }, session), false);
  assert.deepEqual(recoverMethodologyDraft('org-a', session), large);
  assert.deepEqual(recoverMethodologyAction(session, 'org-b'), action);
  assert.equal(retainMethodologyAction(action, session), true);
  discardMethodologyAction('org-a');
  assert.deepEqual(recoverMethodologyAction(session, 'org-b'), action);
});
