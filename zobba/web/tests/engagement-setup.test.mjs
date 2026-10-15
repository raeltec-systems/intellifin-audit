import test from 'node:test';
import assert from 'node:assert/strict';
import { SETUP_LIMITS, draftProblem, establishedScope, isAccessLoss, parseOrganisationPage, parseSetup, parseSetupCommand, setupErrorText, setupOutbox } from '../src/engagement-setup.ts';
import { AccessError, readJson } from '../src/auth.ts';
import { OutboxStore, directionOutbox } from '../src/conversation-outbox.ts';

const question = { ordinal: 1, author: 'zobba', kind: 'question', content: 'Which client is this engagement for? Give the client’s name.', reply_to: 0, prompt: 'client', candidates: [], refusal: null };
const objective = { ordinal: 0, author: 'member', kind: 'objective', content: 'Review leaver access', reply_to: null, prompt: null, candidates: [], refusal: null };
const setup = { id: 's-a', organisation_id: 'org-a', key: 'key-a', objective: 'Review leaver access', state: 'client', candidates: [], client: null, new_client_name: null, period_start: null, period_end: null, established: null, messages: [objective, question] };
const receipt = { command_id: 'cmd-a', task_id: 'task-a', cycle_id: 'cycle-a', event_cursor: '1', status: 'received' };

test('a setup view is strictly parsed', () => {
  assert.deepEqual(parseSetup(setup), setup);
  const done = { ...setup, state: 'established', client: { client_id: 'c-a', client_name: 'Alder' }, period_start: '2026-01-01', period_end: '2026-12-31',
    established: { organisation_id: 'org-a', client_id: 'c-a', engagement_id: 'e-a', engagement_name: 'Audit 2026-01-01 to 2026-12-31', receipt } };
  assert.deepEqual(establishedScope(parseSetup(done)), { organisation_id: 'org-a', client_id: 'c-a', engagement_id: 'e-a' });
  for (const bad of [
    { ...setup, state: 'done' },
    { ...setup, state: 'established' },
    { ...done, state: 'confirm' },
    { ...done, established: { ...done.established, organisation_id: 'org-b' } },
    { ...setup, period_start: '2026-12-31', period_end: '2026-01-01' },
    { ...setup, period_start: '2026-01-01' },
    { ...setup, messages: [{ ...question, reply_to: null }] },
    { ...setup, messages: [{ ...objective, kind: 'question' }] },
    { ...setup, messages: [{ ...question, prompt: 'anything' }] },
    { ...setup, candidates: [{ client_id: 'c a', client_name: 'Alder' }] },
    { ...setup, new_client_name: ' Alder' },
    { ...setup, candidates: Array.from({ length: 21 }, (_, i) => ({ client_id: `c${i}`, client_name: 'Alder' })) },
  ]) assert.throws(() => parseSetup(bad), JSON.stringify(bad).slice(0, 80));
});

test('setup commands carry their whole meaning and nothing else', () => {
  assert.deepEqual(parseSetupCommand({ key: 'k', op: 'open', objective: 'Objective' }), { key: 'k', op: 'open', objective: 'Objective' });
  assert.deepEqual(parseSetupCommand({ key: 'k', op: 'new_client', setup_id: 's', accept: false }).accept, false);
  assert.equal(parseSetupCommand({ key: 'k', op: 'choose_client', setup_id: 's', client_id: 'c', client_name: 'Alder' }).client_name, 'Alder');
  assert.deepEqual(parseSetupCommand({ key: 'k', op: 'change_period', setup_id: 's' }), { key: 'k', op: 'change_period', setup_id: 's' });
  for (const bad of [
    { key: 'k', op: 'open', objective: 'x', extra: 1 },
    { key: 'k', op: 'text', setup_id: 's', content: 'x'.repeat(401) },
    { key: 'k', op: 'new_client', setup_id: 's', accept: 'yes' },
    { key: 'k', op: 'choose_client', setup_id: 's', client_id: 'bad id', client_name: 'Alder' },
    { key: 'k', op: 'choose_client', setup_id: 's', client_id: 'c' },
    { key: 'k', op: 'delete', setup_id: 's' },
    { key: 'bad key', op: 'cancel', setup_id: 's' },
  ]) assert.throws(() => parseSetupCommand(bad));
});

function memory() {
  const data = new Map();
  return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data };
}

test('setup requests persist in a channel keyed by actor and organisation', async () => {
  const storage = memory();
  const outbox = setupOutbox('actor-a', 'org-a', () => storage);
  await outbox.reserve({ key: 'setup-a', op: 'open', objective: 'Review leaver access' });
  assert.equal((await outbox.read()).length, 1);
  await assert.rejects(() => outbox.reserve({ key: 'setup-a', op: 'open', objective: 'Changed' }), /cannot change meaning/);
  assert.equal((await setupOutbox('actor-b', 'org-a', () => storage).read()).length, 0, 'bound to the actor');
  assert.equal((await setupOutbox('actor-a', 'org-b', () => storage).read()).length, 0, 'bound to the organisation');
  const scope = { organisation_id: 'org-a', client_id: 'organisation', engagement_id: 'setup' };
  assert.equal((await new OutboxStore('actor-a', scope, () => storage).read()).length, 0, 'never an engagement command');
  assert.equal((await directionOutbox('actor-a', scope, () => storage).read()).length, 0, 'never a direction');
  await outbox.remove('setup-a');
  assert.deepEqual(await outbox.read(), []);
});

test('capacity refusals explain the reason with the server limits', () => {
  assert.match(setupErrorText('engagement_setup_open_limit', 409), /8 engagement setups/);
  assert.match(setupErrorText('engagement_setup_daily_limit', 409, { ...SETUP_LIMITS, established_per_day: 5 }), /set up 5 engagements/);
  assert.match(setupErrorText(undefined, 0), /safe/);
});

test('each setup refusal code reaches AccessError.code and its own reason', async () => {
  const previous = globalThis.fetch;
  const cases = [
    [409, 'engagement_setup_conflict', /no longer matches the setup/],
    [409, 'engagement_setup_open_limit', /8 engagement setups open/],
    [409, 'engagement_setup_daily_limit', /20 engagements here today/],
    [409, 'engagement_setup_message_limit', /200-message limit/],
    [409, 'engagement_setup_confirm_failed', /could not be created/],
    [403, 'access_denied', /no longer have an auditor/],
    [403, 'engagement_setup_request_rejected', /security check/],
    [404, 'engagement_setup_not_found', /no longer available/],
  ];
  try {
    for (const [status, code, reason] of cases) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: code }), { status, headers: { 'Content-Type': 'application/json' } });
      const error = await readJson('/organisations/org/engagement-setups', undefined, { method: 'POST' }).then(() => null, failure => failure);
      assert.ok(error instanceof AccessError, code);
      assert.deepEqual([error.status, error.code], [status, code]);
      assert.match(setupErrorText(error.code, error.status), reason, code);
    }
  } finally { globalThis.fetch = previous; }
  // Only a real loss of authority ends the workspace.
  assert.equal(isAccessLoss(403, 'access_denied'), true);
  assert.equal(isAccessLoss(403, undefined), true);
  assert.equal(isAccessLoss(403, 'engagement_setup_request_rejected'), false);
  assert.equal(isAccessLoss(404, 'engagement_setup_not_found'), false);
  assert.equal(isAccessLoss(409, 'engagement_setup_conflict'), false);
});

test('organisation pages carry the server limits and refuse a disagreement', () => {
  const page = { organisations: [{ organisation_id: 'org-a', organisation_name: 'Northstar' }], more: true, limits: SETUP_LIMITS };
  assert.deepEqual(parseOrganisationPage(page), page);
  assert.throws(() => parseOrganisationPage({ ...page, limits: { ...SETUP_LIMITS, answer_bytes: 500 } }));
  assert.throws(() => parseOrganisationPage({ ...page, more: 'yes' }));
  assert.throws(() => parseOrganisationPage({ organisations: [], limits: SETUP_LIMITS }));
});

test('draft lengths are checked in UTF-8 bytes before anything is reserved', () => {
  assert.equal(draftProblem('x'.repeat(400), 'answer'), null);
  assert.match(draftProblem('é'.repeat(201), 'answer'), /402 bytes; the limit is 400 bytes/);
  assert.equal(draftProblem('界'.repeat(1333), 'objective'), null);
  assert.match(draftProblem('界'.repeat(1334), 'objective'), /4002 bytes/);
});
