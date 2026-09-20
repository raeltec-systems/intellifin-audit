import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  conversationBody,
  durableReceiptAccepted,
  RunConversation,
  unicodeLength,
  type RunConversationMessage,
} from './RunConversation';

const RUN_ID = '019823ab-0000-7000-8000-000000000101';
const MESSAGE_ID = '019823ab-0000-7000-8000-000000000102';
const ACTOR_ID = '019823ab-0000-7000-8000-000000000103';
const EVIDENCE_ID = '019823ab-0000-7000-8000-000000000104';

const message: RunConversationMessage = {
  schemaVersion: 1,
  messageId: MESSAGE_ID,
  runId: RUN_ID,
  sequence: 7,
  actorId: ACTOR_ID,
  actorName: 'Auditor Lee',
  source: 'auditor',
  kind: 'annotation',
  body: '<script>close finding()</script>\nPlease inspect the account.',
  contentState: 'available',
  sourceOrdinal: 3,
  createdAt: '2026-09-19T10:00:00.000Z',
  contextRevision: 'revision-3',
  links: [{ evidenceId: EVIDENCE_ID, locator: 'table:row:3' }],
};

describe('RunConversation', () => {
  it('renders inert escaped text with human labels, related links and bounded older history', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunConversation, {
        runId: RUN_ID,
        messages: [message],
        olderBefore: 6,
        onReadOlder: () => undefined,
        recordLinksFor: () => [{ href: `/runs/${RUN_ID}/evidence?selected=3`, label: 'Source record' }],
      }),
    );

    expect(html).toContain('&lt;script&gt;close finding()&lt;/script&gt;');
    expect(html).not.toContain('<script>close finding()</script>');
    expect(html).toContain('Auditor Lee');
    expect(html).toContain('Annotation');
    expect(html).toContain('2026-09-19T10:00:00.000Z');
    expect(html).toContain('Source record');
    expect(html).toContain(
      `/runs/${RUN_ID}/evidence/${EVIDENCE_ID}?locator=table%3Arow%3A3`,
    );
    expect(html).toContain('Recorded evidence');
    expect(html).toContain('opening evidence does not confirm a review');
    expect(html).toContain('Load older messages');
    expect(html).toContain('data-max-unicode-length="4000"');
    expect(html).toContain('method="post"');
    expect(html).not.toContain('Untrusted source content');
  });

  it('does not put an actor UUID in the normal message heading', () => {
    const uuidNamed = { ...message, actorName: ACTOR_ID };
    const html = renderToStaticMarkup(
      React.createElement(RunConversation, { runId: RUN_ID, messages: [uuidNamed] }),
    );
    expect(html).toContain('<p class="run-conversation__actor">Auditor</p>');
    expect(html).toContain(`<dt>Actor ID</dt><dd>${ACTOR_ID}</dd>`);
  });

  it('keeps removed content truthful and exposes no composer action without an injected sender', () => {
    const html = renderToStaticMarkup(
      React.createElement(RunConversation, {
        runId: RUN_ID,
        messages: [{ ...message, body: null, contentState: 'removed' }],
      }),
    );
    expect(html).toContain('Message content was removed.');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Messaging is unavailable for this Run.');
  });

  it('uses the durable append receipt and counts Unicode code points', () => {
    expect(durableReceiptAccepted({ ok: true, messageId: MESSAGE_ID, sequence: 8, replayed: false })).toBe(true);
    expect(durableReceiptAccepted({ ok: true, messageId: '', sequence: 8, replayed: false })).toBe(false);
    expect(durableReceiptAccepted({ ok: true, messageId: MESSAGE_ID, sequence: 0, replayed: false })).toBe(false);
    expect(durableReceiptAccepted({ status: 'queued' })).toBe(false);
    expect(unicodeLength('A🙂界')).toBe(3);
    expect(conversationBody({ ...message, body: null, contentState: 'unavailable' })).toContain('temporarily unavailable');
  });
  it('offers explicit Resume review only while the governed proposal is available', () => {
    const command = { commandId: MESSAGE_ID, kind: 'resume' as const, canConfirm: true,
      state: 'interpreted' as const, at: message.createdAt, sourceEventId: null,
      resumeAnchor: { waitId: MESSAGE_ID, pausedAt: message.createdAt, deadline: '2026-09-19T10:30:00.000Z', controlEpoch: 1 } };
    const render = (row: RunConversationMessage) => renderToStaticMarkup(React.createElement(RunConversation, {
      runId: RUN_ID, messages: [row], onReviewCommand: () => undefined,
    }));
    expect(render({ ...message, command })).toContain('Resume request: awaiting your confirmation');
    expect(render({ ...message, command })).toContain('Review Resume');
    expect(render({ ...message, command, body: null, contentState: 'removed' })).not.toContain('Review Resume');
    const applied = render({ ...message, command: { ...command, state: 'applied' } });
    expect(applied).toContain('Resume request: applied');
    expect(applied).not.toContain('Review Resume');
  });

  it('separates a proposal awaiting confirmation from a queued inspection pause', () => {
    const command = { commandId: MESSAGE_ID, kind: 'pause-after-inspection' as const,
      targetLabel: 'E-102 on LoanCore', canConfirm: true, state: 'interpreted' as const,
      at: message.createdAt, sourceEventId: null };
    const render = (row: RunConversationMessage) => renderToStaticMarkup(React.createElement(RunConversation, {
      runId: RUN_ID, messages: [row], onReviewCommand: () => undefined,
    }));
    const proposal = render({ ...message, kind: 'command-receipt', command });
    expect(proposal).toContain('awaiting your confirmation');
    expect(proposal).toContain('Review pause after inspection');
    const queued = render({ ...message, command: { ...command, state: 'queued' } });
    expect(queued).toContain('waiting for the named inspection to settle');
    expect(queued).not.toContain('Review pause after inspection');
    expect(queued).not.toContain('Pause request: applied');
    const removed = render({ ...message, command, body: null, contentState: 'removed' });
    expect(removed).not.toContain('Review pause after inspection');
  });

});

it('shows why a stale Stop proposal is unavailable without offering confirmation', () => {
  const html = renderToStaticMarkup(React.createElement(RunConversation, {
    runId: RUN_ID,
    messages: [{ ...message, kind: 'command-receipt', command: {
      commandId: MESSAGE_ID, kind: 'stop', state: 'interpreted', at: message.createdAt,
      sourceEventId: null, canConfirm: false, reason: 'The Run or proposal context changed.',
    } }],
    onReviewCommand: () => undefined,
  }));
  expect(html).toContain('Stop request: no longer available for confirmation');
  expect(html).toContain('The Run or proposal context changed.');
  expect(html).not.toContain('Review Stop');
});
