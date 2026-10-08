import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionLabel, nextActionLabel, parseDirection, parseQuestion, parseQuestionPage, parseWork, verifyAnswer } from '../src/work.ts';
import { OutboxStore, directionOutbox } from '../src/conversation-outbox.ts';

const step = { ordinal: 0, kind: 'model_turn', status: 'proposed', intent_revision: '1', execution_epoch: '1', invocation_id: 'inv-a', operation_id: null, next_action: 'tool:send_exact', current_work: 'Model turn 1 proposed tools', knowledge_omitted: 2, reason: null, estimated_input_tokens: '4096', actual_input_tokens: '3900' };
const brief = { command_id: 'cmd-a', cycle_id: 'cycle-a', content: 'Objective', received_cursor: '1', applied_boundary: 0, applied_cursor: '2', superseded_by: null };
const compaction = { sequence: 0, first_ordinal: 0, last_ordinal: 5, digest_sha256: 'a'.repeat(64), sources: [{ id: 'record-a', revision: '1', status: 'withdrawn' }], omissions: [{ category: 'steps_compacted', count: 6 }, { category: 'stale_sources', count: 1 }], estimated_tokens: '4096' };
const work = { task_id: 'task-a', cycle_id: 'cycle-a', model_available: true, methodology_binding_id: 'binding-a', methodology_status: 'neutral', current_work: 'Model turn 1 proposed tools', next_action: 'tool:send_exact', next_action_invocation_id: 'inv-a', attention: null, steps: [step], briefs: [brief], total_steps: 9, compactions: [compaction], total_compactions: 1 };

test('work projection is strictly parsed and bound to the requested Task', () => {
  assert.deepEqual(parseWork(work, 'task-a'), work);
  assert.throws(() => parseWork(work, 'task-b'));
  for (const bad of [
    { ...work, model_available: 'yes' },
    { ...work, next_action: 'tool:' },
    { ...work, next_action: 'run anything' },
    { ...work, attention: 'done' },
    { ...work, steps: [{ ...step, status: 'complete_objective' }] },
    { ...work, steps: [{ ...step, current_work: 'bad\u0000label' }] },
    { ...work, briefs: [{ ...brief, received_cursor: '-1' }] },
    { ...work, total_steps: 0 },
    { ...work, total_steps: '9' },
    { ...work, steps: [{ ...step, knowledge_omitted: -1 }] },
    { ...work, steps: [{ ...step, kind: 'tool_step', knowledge_omitted: 1 }] },
    { ...work, steps: [{ ...step, reason: 'model_wanted_to_stop' }] },
    { ...work, steps: [{ ...step, estimated_input_tokens: 4096 }] },
    { ...work, compactions: [{ ...compaction, first_ordinal: 6 }] },
    { ...work, compactions: [{ ...compaction, digest_sha256: 'summary text' }] },
    { ...work, compactions: [{ ...compaction, sources: [{ id: 'record-a', revision: '1', status: 'gone' }] }] },
    { ...work, compactions: [{ ...compaction, omissions: [{ category: 'model_summary', count: 1 }] }] },
    { ...work, compactions: [compaction], total_compactions: 0 },
  ]) assert.throws(() => parseWork(bad, 'task-a'));
});

test('direction is either one routed receipt or one durable question, never both', () => {
  const receipt = { command_id: 'cmd-b', task_id: 'task-a', cycle_id: 'cycle-a', event_cursor: '7', status: 'received' };
  const question = { id: 'q-a', key: 'key-a', content: 'Check the sample', candidates: [{ task_id: 'a', cycle_id: 'c1', objective: 'A' }, { task_id: 'b', cycle_id: 'c2', objective: 'B' }], answer: null };
  assert.equal(parseDirection({ outcome: 'routed', receipt, question: null }).receipt.task_id, 'task-a');
  assert.equal(parseDirection({ outcome: 'asked', receipt: null, question }).question.candidates.length, 2);
  assert.throws(() => parseDirection({ outcome: 'routed', receipt, question }));
  assert.throws(() => parseDirection({ outcome: 'asked', receipt: null, question: { ...question, candidates: question.candidates.slice(0, 1) } }), 'a question needs two or more candidates');
  assert.equal(parseQuestion({ ...question, answer: [{ task_id: 'a', cycle_id: 'c1', command_id: 'g-a', event_cursor: '9' }] }).answer.length, 1);
});

test('labels describe recorded facts without claiming completion', () => {
  assert.match(nextActionLabel('await_guidance'), /guidance/);
  assert.match(nextActionLabel('tool:send_exact'), /send_exact/);
  assert.match(attentionLabel('awaiting_guidance'), /not complete/);
  assert.equal(attentionLabel(null), null);
});

test('a question page says when more exist, and an answer must name exactly the selection', () => {
  const question = { id: 'q-a', key: 'key-a', content: 'Check', candidates: [{ task_id: 'a', cycle_id: 'c1', objective: 'A' }, { task_id: 'b', cycle_id: 'c2', objective: 'B' }, { task_id: 'c', cycle_id: 'c3', objective: 'C' }], answer: null };
  assert.equal(parseQuestionPage({ questions: [question], has_more: true }).has_more, true);
  assert.throws(() => parseQuestionPage({ questions: [question] }));
  const guide = id => ({ task_id: id, cycle_id: 'c', command_id: `g-${id}`, event_cursor: '9' });
  const answered = { ...question, answer: [guide('b'), guide('a')] };
  assert.equal(verifyAnswer(answered, 'q-a', ['a', 'b']).answer.length, 2);
  // Same count, different Tasks: refused rather than reported as delivered.
  assert.throws(() => verifyAnswer({ ...question, answer: [guide('a'), guide('c')] }, 'q-a', ['a', 'b']));
  assert.throws(() => verifyAnswer(answered, 'q-b', ['a', 'b']));
  assert.throws(() => verifyAnswer({ ...question, answer: null }, 'q-a', ['a']));
});

function memory() {
  const data = new Map();
  return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data };
}

test('directions persist in their own durable channel before transmission', async () => {
  const scope = { organisation_id: 'org-a', client_id: 'client-a', engagement_id: 'engagement-a' };
  const storage = memory();
  const directions = directionOutbox('actor-a', scope, () => storage);
  const commands = new OutboxStore('actor-a', scope, () => storage);
  await directions.reserve({ key: 'direction-a', content: 'Look at the sample' });
  assert.deepEqual((await directions.read()).map(item => item.command), [{ key: 'direction-a', content: 'Look at the sample' }]);
  assert.deepEqual(await commands.read(), [], 'the command channel never sees a direction');
  await assert.rejects(() => directions.reserve({ key: 'direction-a', content: 'Different meaning' }), /cannot change meaning/);
  await assert.rejects(() => directions.reserve({ key: 'direction-b', content: 'x', extra: true }));
  assert.equal((await directionOutbox('actor-b', scope, () => storage).read()).length, 0, 'bound to the actor');
  assert.equal((await directionOutbox('actor-a', { ...scope, engagement_id: 'engagement-b' }, () => storage).read()).length, 0, 'bound to the scope');
  await directions.remove('direction-a');
  assert.deepEqual(await directions.read(), []);
});
