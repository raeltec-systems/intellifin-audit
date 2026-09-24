import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EscalationOutcomeHost, visibleOutcome, type EscalationOutcome } from './EscalationOutcome';

/**
 * The confirmation of an answered Escalation, kept outside the panel it came from.
 *
 * What it does across a refresh is a browser fact (`live-escalation.spec.ts` and
 * `escalations.spec.ts` assert the confirmation after the panel is gone); what is decided
 * here is WHEN it may be shown, and that the host adds nothing to a page with no outcome.
 */

const ANSWERED: EscalationOutcome = {
  waitId: '019823ab-0000-7000-8000-000000000002',
  tone: 'success',
  title: 'Escalation answered.',
  body: 'The Run resumes with the Escalation answer recorded in its Timeline.',
};

describe('when an answered Escalation is confirmed', () => {
  it('shows nothing before anything was answered', () => {
    expect(visibleOutcome(null, null)).toBeNull();
    expect(visibleOutcome(null, ANSWERED.waitId)).toBeNull();
  });

  it('shows the confirmation while its own question is still on the page, and after it is gone', () => {
    expect(visibleOutcome(ANSWERED, ANSWERED.waitId)).toBe(ANSWERED);
    expect(visibleOutcome(ANSWERED, null)).toBe(ANSWERED);
  });

  it('steps aside when a different question opens, so it never reads as that answer', () => {
    expect(visibleOutcome(ANSWERED, '019823ab-0000-7000-8000-000000000099')).toBeNull();
  });

  it('adds nothing to the page until an answer is reported', () => {
    const html = renderToStaticMarkup(
      React.createElement(EscalationOutcomeHost, { openWaitId: null }, React.createElement('p', null, 'panel')),
    );
    expect(html).toBe('<p>panel</p>');
  });
});
