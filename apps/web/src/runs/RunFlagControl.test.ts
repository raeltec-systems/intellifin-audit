import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../app/runs/actions', () => ({ flagRunFormAction: vi.fn() }));

import { FLAG_COPY } from '../design/copy';
import { RunFlagControl, type RunFlagView } from './RunFlagControl';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';

function render(props: { flaggable: boolean; flags: readonly RunFlagView[] }): string {
  return renderToStaticMarkup(React.createElement(RunFlagControl, { runId: RUN_ID, ...props }));
}

describe('the Flag to Audit Manager control', () => {
  it('states what a flag does and does not do, and offers an optional note', () => {
    const html = render({ flaggable: true, flags: [] });
    expect(html).toContain(FLAG_COPY.heading);
    // The one sentence an auditor needs before pressing it: nothing about the Run changes.
    expect(html).toContain(FLAG_COPY.explanation);
    expect(html).toContain(FLAG_COPY.noteLabel);
    expect(html).toContain(FLAG_COPY.noteHelp);
    expect(html).toContain(FLAG_COPY.submit);
  });

  it('carries the Run and the note as named form fields, so a real POST can submit them', () => {
    // The standing rule: JavaScript may enhance a control, never be its only path. Flag is
    // the one control on these surfaces that can honour it, because EXPERIENCE.md's
    // confirmation table does not list flagging and it therefore needs no dialog.
    //
    // Whether the RENDERED form actually posts is not assertable here: this test mocks the
    // Server Action, so React renders its "unexpectedly submitted" placeholder instead of
    // the action endpoint Next's compiler emits. `pause-resume.spec.ts` is what proves the
    // no-JavaScript path, in a context with `javaScriptEnabled: false`.
    const html = render({ flaggable: true, flags: [] });
    expect(html).toContain('<form');
    expect(html).toContain('name="runId"');
    expect(html).toContain(`value="${RUN_ID}"`);
    expect(html).toContain('name="note"');
  });

  it('bounds the note in the markup as well as in the command', () => {
    expect(render({ flaggable: true, flags: [] })).toContain('maxLength="500"');
  });

  it('says a Run has no flags in words rather than showing an empty list', () => {
    const html = render({ flaggable: true, flags: [] });
    expect(html).toContain(FLAG_COPY.none);
    expect(html).not.toContain('<ul');
  });

  it('names who flagged it and when, and shows the note back', () => {
    const html = render({
      flaggable: true,
      flags: [{
        flagId: 'flag-1',
        flaggedBy: 'Dana Mwansa',
        flaggedAt: '2026-09-07T10:00:00.000Z',
        note: 'The LoanCore step looks wrong.',
      }],
    });
    expect(html).toContain('Flagged by Dana Mwansa at 2026-09-07T10:00:00.000Z');
    expect(html).toContain('The LoanCore step looks wrong.');
  });

  it('shows a flag with no note without an empty quote block', () => {
    const html = render({
      flaggable: true,
      flags: [{ flagId: 'flag-1', flaggedBy: 'Dana Mwansa', flaggedAt: '2026-09-07T10:00:00.000Z', note: null }],
    });
    expect(html).toContain('Flagged by Dana Mwansa at');
    expect(html).not.toContain('ls-quote');
  });

  it('hides the form on a Run that cannot be flagged, and still shows its history', () => {
    const html = render({
      flaggable: false,
      flags: [{ flagId: 'flag-1', flaggedBy: 'Dana Mwansa', flaggedAt: '2026-09-07T10:00:00.000Z', note: null }],
    });
    expect(html).not.toContain('<form');
    expect(html).not.toContain(FLAG_COPY.submit);
    // A terminal Run's flags are still part of what happened, so they stay readable.
    expect(html).toContain('Flagged by Dana Mwansa at');
  });

  it('renders the note as TEXT, so a note containing markup cannot become markup', () => {
    const html = render({
      flaggable: true,
      flags: [{ flagId: 'flag-1', flaggedBy: 'Dana Mwansa', flaggedAt: '2026-09-07T10:00:00.000Z', note: '<script>alert(1)</script>' }],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
