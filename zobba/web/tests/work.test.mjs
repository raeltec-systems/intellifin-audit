import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionLabel, nextActionLabel, parseDirection, parseQuestion, parseWork } from '../src/work.ts';

const step = { ordinal: 0, kind: 'model_turn', status: 'proposed', intent_revision: '1', execution_epoch: '1', invocation_id: 'inv-a', operation_id: null, next_action: 'tool:send_exact', current_work: 'Model turn 1 proposed tools' };
const brief = { command_id: 'cmd-a', cycle_id: 'cycle-a', content: 'Objective', received_cursor: '1', applied_boundary: 0, applied_cursor: '2', superseded_by: null };
const work = { task_id: 'task-a', cycle_id: 'cycle-a', model_available: true, methodology_binding_id: 'binding-a', methodology_status: 'neutral', current_work: 'Model turn 1 proposed tools', next_action: 'tool:send_exact', next_action_invocation_id: 'inv-a', attention: null, steps: [step], briefs: [brief] };

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
