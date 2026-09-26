import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunPauseLinkage } from '@intellifin/infrastructure';
import { PauseLinkageFacts, PauseLinkageHistory } from './PauseLinkage';
const entry: RunPauseLinkage = { eventId: 'event', sequence: 1, kind: 'pause', occurredAt: '2026-09-26T10:00:00Z', actorId: 'auditor', waitId: 'wait', planStepId: 'step-2', stepExecutionId: 'execution-3', attempt: 3, inFlight: true };
describe('exact pause and resume fields', () => {
  it('renders the stored step and attempt independently of current Run position', () => {
    const html = renderToStaticMarkup(React.createElement(PauseLinkageHistory, { entries: [entry, { ...entry, eventId: 'later', sequence: 3, kind: 'resume', planStepId: 'step-4', attempt: 1 }], total: 2, names: new Map([['auditor', 'Auditor Name']]) }));
    expect(html).toContain('step-2'); expect(html).toContain('step-4'); expect(html).toContain('execution-3'); expect(html).toContain('Auditor Name');
  });
  it('distinguishes an explicit between-unit pause from missing historical metadata', () => {
    const between = renderToStaticMarkup(React.createElement(PauseLinkageFacts, { entry: { ...entry, attempt: null, stepExecutionId: null, inFlight: false } }));
    const historical = renderToStaticMarkup(React.createElement(PauseLinkageFacts, { entry: { ...entry, planStepId: null, attempt: null, stepExecutionId: null, inFlight: null } }));
    expect(between).toContain('None'); expect(between).not.toContain('Not recorded');
    expect(historical).toContain('Not recorded'); expect(historical).not.toContain('step-2');
  });
});


it('exposes exact wait identities and continuation beyond the bounded page', () => {
  const html = renderToStaticMarkup(React.createElement(PauseLinkageHistory, {
    entries: [entry], total: 102, names: new Map(), firstHref: '/runs/run/timeline', nextHref: '/runs/run/timeline?pauseBefore=3#pause-resume-history',
  }));
  expect(html).toContain('Wait identifier'); expect(html).toContain('wait');
  expect(html).toContain('First page'); expect(html).toContain('Next page');
  expect(html).toContain('pauseBefore=3#pause-resume-history'); expect(html).toContain('102');
});
