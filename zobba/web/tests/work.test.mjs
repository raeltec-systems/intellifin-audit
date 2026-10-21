import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionLabel, gapReasonLabel, nextActionLabel, omissionLabel, parseDirection, parseInvestigation, parseQuestion, parseQuestionPage, parseWork, verifyAnswer } from '../src/work.ts';
import { OutboxStore, directionOutbox } from '../src/conversation-outbox.ts';
import { readFileSync } from 'node:fs';
const recordedAssessment = JSON.parse(readFileSync(new URL('./fixtures/task-assessment.json', import.meta.url), 'utf8'));

const step = { ordinal: 0, kind: 'model_turn', status: 'proposed', intent_revision: '1', execution_epoch: '1', invocation_id: 'inv-a', operation_id: null, next_action: 'tool:send_exact', current_work: 'Model turn 1 proposed tools', knowledge_omitted: 2, reason: null, estimated_input_tokens: '4096', actual_input_tokens: '3900' };
const brief = { command_id: 'cmd-a', cycle_id: 'cycle-a', content: 'Objective', received_cursor: '1', applied_boundary: 0, applied_cursor: '2', superseded_by: null };
const compaction = { sequence: 0, first_ordinal: 0, last_ordinal: 5, digest_sha256: 'a'.repeat(64), sources: [{ id: 'record-a', revision: '1', status: 'withdrawn' }], omissions: [{ category: 'steps_compacted', count: 6 }, { category: 'stale_sources', count: 1 }], estimated_tokens: '4096', created_at: '1767225600' };
const work = { task_id: 'task-a', cycle_id: 'cycle-a', model_available: true, methodology_binding_id: 'binding-a', methodology_status: 'neutral', current_work: 'Model turn 1 proposed tools', next_action: 'tool:send_exact', next_action_invocation_id: 'inv-a', attention: null, steps: [step], briefs: [brief], total_steps: 9, compactions: [compaction], total_compactions: 1, investigation: null, investigation_unavailable: false, assessment: null, assessment_unavailable: false };

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
    { ...work, compactions: [{ ...compaction, created_at: 1767225600 }] },
    { ...work, compactions: [{ ...compaction, created_at: undefined }] },
    { ...work, investigation_unavailable: undefined },
    { ...work, investigation_unavailable: 'no' },
    { ...work, assessment_unavailable: undefined },
    // Unavailable and present at once, with an assessment that parses alone.
    { ...work, assessment_unavailable: true, assessment: recordedAssessment },
  ]) assert.throws(() => parseWork(bad, 'task-a'));
  assert.equal(parseWork({ ...work, assessment: recordedAssessment }, 'task-a').assessment.total_facts, recordedAssessment.total_facts);
  // An unreadable investigation leaves the rest of the work view intact.
  assert.equal(parseWork({ ...work, investigation_unavailable: true }, 'task-a').investigation_unavailable, true);
});

const load = { invocation_id: 'inv-a', kind: 'load', ordinal: 0, version_id: 'skill-v1', resource_id: null, skill_id: 'ap-matching', skill_version: 'v1', name: 'AP matching', digest: 'd'.repeat(64), outcome: 'loaded', reason: null, job_id: null, methodology_binding_id: 'binding-a', execution_epoch: '1' };
const refused = { ...load, ordinal: 1, version_id: 'send-v1', skill_id: 'send', name: 'Send confirmations', digest: 'e'.repeat(64), outcome: 'unavailable', reason: 'tool_unavailable' };
const gap = { invocation_id: 'inv-a', ordinal: 0, source: 'platform', requirement_id: 'AP-2', kind: 'gap', text: 'No criteria', reason: 'criteria_missing', segments: [], methodology_binding_id: 'binding-a', execution_epoch: '1', open: false };
const statement = { ...gap, ordinal: 1, source: 'agent', kind: 'statement', reason: null, segments: [0], text: 'Two approvals were found.' };
const investigation = { methodology_binding_id: 'binding-a', method_status: 'resolved', method_version_ids: ['ap-method-v1'], skills: [load, refused], notes: [gap, statement], record: { invocation_id: 'inv-a', methodology_binding_id: 'binding-a', execution_epoch: '1', method_status: 'resolved', method_version_ids: ['ap-method-v1'], skills: [{ version_id: 'skill-v1', skill_id: 'ap-matching', skill_version: 'v1', digest: 'd'.repeat(64) }], provider: 'openai', model: 'fixture-model', profile_id: 'loopback', profile_revision: '1', catalogue_id: 'no-tools', catalogue_revision: '1', tools: [], gaps: 1, questions: 0, statements: 1, omitted_notes: 0, omitted_items: 0, discarded_requests: 0 }, open_questions: 0, total_skills: '2', total_notes: '2' };

test('method and skill use is strictly parsed and never claims completion', () => {
  assert.deepEqual(parseWork({ ...work, investigation, attention: 'method_question' }, 'task-a').investigation, investigation);
  assert.deepEqual(parseInvestigation(investigation), investigation);
  for (const bad of [
    { ...investigation, method_status: 'complete' },
    { ...investigation, skills: [{ ...load, kind: 'install' }] },
    { ...investigation, skills: [{ ...load, outcome: 'loaded', reason: 'disabled' }] },
    { ...investigation, skills: [{ ...refused, reason: null }] },
    { ...investigation, skills: [{ ...load, digest: 'not a digest' }] },
    { ...investigation, skills: [{ ...load, resource_id: 'x' }] },
    { ...investigation, notes: [{ ...gap, kind: 'complete' }] },
    { ...investigation, notes: [{ ...gap, reason: null }] },
    { ...investigation, notes: [{ ...gap, reason: 'everything_fine' }] },
    { ...investigation, notes: [{ ...gap, segments: [0] }] },
    { ...investigation, notes: [{ ...gap, text: '   ' }] },
    { ...investigation, notes: [{ ...gap, text: 'x'.repeat(1001) }] },
    { ...investigation, open_questions: -1 },
    // Only a question can be open; the totals cover at least the listed entries.
    { ...investigation, notes: [{ ...gap, open: true }] },
    { ...investigation, notes: [{ ...gap, open: undefined }] },
    { ...investigation, total_skills: '1' },
    { ...investigation, total_notes: 2 },
    { ...investigation, record: { ...investigation.record, omitted_notes: -1 } },
  ]) assert.throws(() => parseInvestigation(bad));
  const question = { ...gap, ordinal: 2, source: 'agent', kind: 'question', reason: null, text: 'Which period?', open: true };
  assert.equal(parseInvestigation({ ...investigation, notes: [gap, question], open_questions: 1, total_notes: '40' }).notes[1].open, true);
  // Names are bounded in code points: 200 astral characters are 400 UTF-16 units.
  assert.equal(parseInvestigation({ ...investigation, skills: [{ ...load, name: '\u{1F600}'.repeat(200) }] }).skills[0].name.length, 400);
  assert.throws(() => parseInvestigation({ ...investigation, skills: [{ ...load, name: '\u{1F600}'.repeat(201) }] }));
  // A Rust-valid note made of U+FEFF is not blank (JavaScript trim would say it is).
  assert.equal(parseInvestigation({ ...investigation, notes: [{ ...gap, text: '\ufeff' }] }).notes[0].text, '\ufeff');
  assert.throws(() => parseWork({ ...work, investigation: undefined }, 'task-a'));
  assert.match(attentionLabel('method_question'), /guidance/);
  assert.equal(gapReasonLabel('criteria_missing'), 'criteria missing');
  assert.match(omissionLabel('skills_budget'), /skill/);
});

test('the worker-produced investigation fixture is the exact API JSON and parses unchanged', () => {
  const real = JSON.parse(readFileSync(new URL('./fixtures/task-investigation.json', import.meta.url), 'utf8'));
  assert.deepEqual(parseInvestigation(real), real);
  assert.ok(real.notes.some(n => n.kind === 'question' && n.source === 'agent'));
  assert.ok(real.notes.some(n => n.kind === 'gap' && n.source === 'platform' && n.reason === 'criteria_missing'));
  assert.ok(real.skills.some(s => s.kind === 'script' && s.outcome === 'completed'));
  assert.ok(!JSON.stringify(real).includes('complete_objective'));
  assert.throws(() => parseInvestigation({ ...real, notes: [{ ...real.notes[0], kind: 'complete' }] }));
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
