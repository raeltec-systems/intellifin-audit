import { describe, expect, it } from 'vitest';
import { interpretRunConversationMessage, parseRunConversationMessageRequest, parseRunConversationQuestionAnchor,
  runConversationAnswerClarification, resolveRunConversationAnswer, runConversationQuestionDigest } from './run-conversation.js';
const anchor = { runId: '01990000-0000-7000-8000-000000000001', waitId: '01990000-0000-7000-8000-000000000002',
  raisedEventId: '01990000-0000-7000-8000-000000000003', kind: 'retry-or-skip' as const, runRevision: 2,
  openedAt: '2026-09-20T00:00:00.000Z', deadline: '2026-09-20T04:00:00.000Z', questionDigest: 'a'.repeat(64) };
const options = [{ id: 'retry', label: 'Retry this inspection' }, { id: 'skip', label: 'Skip this inspection' }, { id: 'abort', label: 'Abort' }];
const request = { runId: anchor.runId, idempotencyKey: anchor.waitId, selectedSourceOrdinal: null, replyToWaitId: anchor.waitId, questionAnchor: anchor, text: 'retry' };
describe('exact conversational question answers', () => {
  it('accepts only unique whole option IDs and labels, optionally explicitly prefixed', () => {
    for (const text of ['retry',' RETRY ', 'answer: Retry this inspection']) expect(resolveRunConversationAnswer(text, options)?.id).toBe('retry');
    for (const text of ['yes','okay','use the first choice','do not retry','retry if safe','"retry"','retry and skip','retry.', 'answer: answer: retry', 'answer: do not retry', 'answer: retry if safe'])
      expect(resolveRunConversationAnswer(text, options)).toBeNull();
    expect(resolveRunConversationAnswer('retry', [...options, { id: 'other', label: 'Retry' }])).toBeNull();
  });
  it('keeps bounded clarification complete and routes oversized vocabularies to the decision card', () => {
    const small = runConversationAnswerClarification({ anchor, question: 'Choose', subject: 'Record', options });
    for (const option of options) expect(small).toContain(`${option.label} (${option.id})`);
    const large = runConversationAnswerClarification({ anchor, question: 'Choose', subject: 'Record',
      options: Array.from({ length: 100 }, (_, i) => ({ id: `candidate-${i}`, label: 'x'.repeat(500) })) });
    expect(large.length).toBeLessThanOrEqual(4000);
    expect(large).toContain('No answer was proposed.');
    expect(large).toContain('all option labels and IDs in the existing decision card');
  });
  it('strictly validates Run, wait and full canonical anchor', () => {
    expect(parseRunConversationMessageRequest(request).ok).toBe(true);
    for (const changed of [{ ...anchor, kind: 'pause' }, { ...anchor, runRevision: '2' }, { ...anchor, deadline: 'tomorrow' },
      { ...anchor, questionDigest: null }, { ...anchor, extra: true }, { ...anchor, openedAt: anchor.deadline }])
      expect(parseRunConversationQuestionAnchor(changed)).toBeNull();
    expect(parseRunConversationMessageRequest({ ...request, replyToWaitId: anchor.runId }).ok).toBe(false);
    expect(parseRunConversationMessageRequest({ ...request, questionAnchor: { ...anchor, runId: anchor.waitId } }).ok).toBe(false);
  });
  it('binds complete option semantics, order, question and source provenance', () => {
    const original = { anchor, options, question: 'Which inspection?', raised: { stepId: 'inspect', evidenceIds: [anchor.waitId] } };
    const digest = runConversationQuestionDigest(original);
    expect(runConversationQuestionDigest({ options, question: original.question, raised: original.raised, anchor })).toBe(digest);
    for (const changed of [{ ...original, options: [...options].reverse() },
      { ...original, options: [{ ...options[0]!, consequence: 'changed meaning' }, ...options.slice(1)] },
      { ...original, question: 'Other question' }, { ...original, raised: { ...original.raised, stepId: 'other' } }])
      expect(runConversationQuestionDigest(changed)).not.toBe(digest);
  });
  it('keeps Run safety phrases ahead of finite question resolution', () => {
    expect(interpretRunConversationMessage(request).intent.kind).toBe('answer-request-proposal');
    expect(interpretRunConversationMessage({ ...request, text: 'Why is this unresolved?' }).intent.kind).toBe('question');
    expect(interpretRunConversationMessage({ ...request, text: 'flag' }).intent.kind).toBe('flag-proposal');
    for (const [text, kind] of [['stop the run','stop-confirmation'], ['pause now','answer-request-proposal']])
      expect(interpretRunConversationMessage({ ...request, text: text! }).intent.kind).toBe(kind);
    expect(interpretRunConversationMessage({ ...request, text: 'do not stop the run' }).execution).toBe('not-executed');
  });
});
