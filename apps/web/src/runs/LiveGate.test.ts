import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../app/runs/actions', () => ({
  cancelRunAction: vi.fn(),
  pauseRunAction: vi.fn(),
  resumeRunAction: vi.fn(),
  flagRunFormAction: vi.fn(),
}));

import { FLAG_COPY } from '../design/copy';
import { LIVE_GATE_REASONS } from './live-status';
import { LiveGate } from './LiveGate';
import { RunCancelControl } from './RunCancelControl';
import { RunFlagControl } from './RunFlagControl';
import { RunPauseControls } from './RunPauseControls';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';

/**
 * The controls as the page composes them for a Run in `active` state — which is what the
 * server passes whenever it renders any of them at all. A terminal Run gets `active:
 * false` and `flaggable: false`, and each control then removes itself, which is a stronger
 * answer than disabling one.
 */
function controls(active = true): React.JSX.Element {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(RunPauseControls, {
      runId: RUN_ID, procedureName: 'Terminated users', paused: false, pausePending: false,
      awaitingAuditor: false, pausable: active, runRevision: 4,
    }),
    React.createElement(RunCancelControl, {
      runId: RUN_ID, procedureName: 'Terminated users', active, cancelPending: false,
    }),
    React.createElement(RunFlagControl, { runId: RUN_ID, flaggable: active, flags: [] }),
  );
}

/** The whole surface, as the Live View page composes it. */
function surface(cursor: number | null, state = 'RUNNING'): string {
  // `children` goes in the props object, not as a third argument: `createElement`'s typed
  // overload requires a component's own required props to be present in `props`, and a
  // third-argument child does not satisfy it — which `tsc` catches and Vitest does not.
  return renderToStaticMarkup(React.createElement(LiveGate, {
    runId: RUN_ID,
    state,
    url: `/api/runs/${RUN_ID}/events`,
    cursor,
    readAt: '2026-09-10T09:00:00.000Z',
    href: `/runs/${RUN_ID}/live`,
    children: controls(cursor !== null),
  }));
}

describe('the live gate over Live View’s controls (Story 5.7)', () => {
  it('leaves every control usable while the Run is live', () => {
    // SSR renders before any effect, so this is the CONNECTING state: the gate is open,
    // exactly as it is once frames start arriving. A page that locked its controls until
    // the first frame arrived would be locked for the whole of a quiet Run's first second.
    const html = surface(7);
    expect(html).toContain('>Pause<');
    expect(html).toContain('>Cancel Run<');
    expect(html).not.toContain('aria-disabled');
    for (const sentence of Object.values(LIVE_GATE_REASONS)) expect(html).not.toContain(sentence);
  });

  it('leaves a Run that has already ended with no live control to disable', () => {
    // `cursor === null` is the server saying the Run is terminal: nothing to subscribe to,
    // and every control removes itself on the state the server read. So the gate's
    // `runEnded` reason has nothing to attach to HERE — its job is the window between the
    // terminal event arriving and that server read landing, which `live-drop.spec.ts`
    // proves in a browser by holding the re-read back.
    const html = surface(null, 'INCONCLUSIVE');
    expect(html).toContain('This Run has ended: INCONCLUSIVE.');
    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Cancel Run<');
    expect(html).not.toContain(FLAG_COPY.submit);
    expect(html).not.toContain('aria-disabled');
  });

  it('shows the ended Banner instead of the live one, and opens no stream', () => {
    const ended = surface(null, 'COMPLETED');
    expect(ended).not.toContain('data-live-status');
    expect(ended).toContain('Open Run Detail');
    const live = surface(3);
    expect(live).toContain('data-live-status');
    expect(live).toContain('data-live-seq="3"');
  });

  it('leaves the same controls untouched OUTSIDE a gate', () => {
    // Run Detail carries these components and is not a live-supervision surface, so the
    // default context is open and nothing about them changes.
    const html = renderToStaticMarkup(controls());
    expect(html).toContain('>Pause<');
    expect(html).toContain('>Cancel Run<');
    expect(html).not.toContain('aria-disabled');
    for (const sentence of Object.values(LIVE_GATE_REASONS)) expect(html).not.toContain(sentence);
  });
});
