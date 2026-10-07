import test from 'node:test';
import assert from 'node:assert/strict';
import { establishedScope, parseSetup, parseSetupCommand, setupErrorText, setupOutbox } from '../src/engagement-setup.ts';
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
  for (const bad of [
    { key: 'k', op: 'open', objective: 'x', extra: 1 },
    { key: 'k', op: 'text', setup_id: 's', content: 'x'.repeat(401) },
    { key: 'k', op: 'new_client', setup_id: 's', accept: 'yes' },
    { key: 'k', op: 'choose_client', setup_id: 's', client_id: 'bad id' },
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

test('capacity refusals explain the reason', () => {
  assert.match(setupErrorText('engagement_setup_open_limit', 409), /8 engagement setups/);
  assert.match(setupErrorText('engagement_setup_daily_limit', 409), /20 engagements/);
  assert.match(setupErrorText(undefined, 0), /safe/);
});
