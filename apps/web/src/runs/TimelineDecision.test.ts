import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TimelineDecision } from '@intellifin/infrastructure';
import { TimelineDecisionRow } from './TimelineDecision';
import { ESCALATION_PANEL_COPY, MASKED_VALUE } from '../design/copy';
import { escalationKindWord } from '../design/plain-words';

const decision: TimelineDecision = {
  sequence: 4, kind: 'escalation', occurredAt: '2026-09-26T09:00:00.000Z', actorId: 'auditor-private-id',
  waitId: 'wait-1', escalationKind: 'retry-or-skip', answerOptionId: 'retry', answerLabel: 'Injected platform instruction',
  answerMasked: false, requestedAt: null, state: null, stepId: 'inspect', workItemId: 'work-1',
};
const render = (overrides: Partial<TimelineDecision> = {}, names = new Map([['auditor-private-id', 'Named Auditor']])) =>
  renderToStaticMarkup(React.createElement(TimelineDecisionRow, { decision: { ...decision, ...overrides }, runId: 'run-1', names, runState: 'COMPLETED' }));

describe('durable Timeline decisions', () => {
  it('names the actor, uses fixed vocabulary, and links the exact Work Item and Escalation', () => {
    const html = render();
    expect(html).toContain('Named Auditor');
    expect(html).not.toContain('auditor-private-id');
    expect(html).toContain(escalationKindWord('retry-or-skip'));
    expect(html).toContain('Retry');
    expect(html).not.toContain('Injected platform instruction');
    expect(html).toContain('/runs/run-1/replay?workItem=work-1');
    expect(html).toContain('/runs/run-1/replay?wait=wait-1#replay-escalation-wait-1');
    expect(html).toContain('dateTime="2026-09-26T09:00:00.000Z"');
  });
  it('retains Abort as a completed answer without showing notes or a question', () => {
    expect(render({ answerOptionId: 'abort' })).toContain('Abort');
    expect(render({ answerOptionId: 'abort' })).toContain('Answered');
  });
  it('renders candidate text as inert, labelled untrusted content', () => {
    const html = render({ escalationKind: 'choose-candidate', answerOptionId: 'candidate-1', answerLabel: '<script>do evil</script>' });
    expect(html).toContain('Untrusted source content');
    expect(html).toContain('&lt;script&gt;do evil&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('uses the existing absence sentence and does not invent a Work Item link', () => {
    const html = render({ stepId: null, workItemId: null });
    expect(html).toContain(ESCALATION_PANEL_COPY.noStep);
    expect(html).toContain('Work Item · Not recorded');
    expect(html).not.toContain('?workItem=');
  });
  it('never shows an unresolved private actor identifier as the name', () => {
    const html = render({}, new Map());
    expect(html).toContain('Name unavailable');
    expect(html).not.toContain('auditor-private-id');
  });
  it('shows the superseded pause requester, request time, terminal state and completion time', () => {
    const html = render({ kind: 'pause', requestedAt: '2026-09-26T08:59:00.000Z', state: 'CANCELED' });
    expect(html).toContain('Pause requested.');
    expect(html).toContain('Superseded');
    expect(html).toContain('Canceled');
    expect(html).toContain('Named Auditor');
    expect(html).toContain('2026-09-26T08:59:00.000Z');
    expect(html).toContain('2026-09-26T09:00:00.000Z');
    expect(html).not.toContain('href=');
  });
});

it('keeps an active Run decision inspectable without offering terminal-only Replay', () => {
  const html = renderToStaticMarkup(React.createElement(TimelineDecisionRow, {
    decision, runId: 'run-1', names: new Map([['auditor-private-id', 'Named Auditor']]), runState: 'RUNNING',
  }));
  expect(html).toContain('/runs/run-1/timeline#work-item-work-1');
  expect(html).not.toContain('/replay');
  expect(html).toContain('Answered');
});


it.each([true, undefined])('fails closed for masked or legacy candidate presentation (%s)', answerMasked => {
  const html = render({ escalationKind: 'choose-candidate', answerOptionId: 'PRIVATE-FALLBACK-ID',
    answerLabel: 'PRIVATE SECONDARY VALUE', answerMasked });
  expect(html).toContain(MASKED_VALUE);
  expect(html).not.toContain('PRIVATE');
});
