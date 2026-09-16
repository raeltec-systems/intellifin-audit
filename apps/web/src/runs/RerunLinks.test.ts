import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: vi.fn() }));
vi.mock('../../app/runs/actions', () => ({
  answerEscalationAction: vi.fn(),
  cancelRunAction: vi.fn(),
  pauseRunAction: vi.fn(),
  resumeRunAction: vi.fn(),
  rerunRunAction: vi.fn(),
  flagRunFormAction: vi.fn(),
}));
vi.mock('../server-session', () => ({ requireServerAction: vi.fn() }));
vi.mock('../bootstrap', () => ({ getRuntime: vi.fn() }));
vi.mock('@intellifin/infrastructure', () => ({
  CryptoUuidV7Generator: class { next(): string { return '019823ab-0000-7000-8000-00000000000f'; } },
  DrizzleActorNameReader: class {},
  DrizzleRunDetailRepository: class {},
  DrizzleRunRepository: class {},
  DrizzleRunStopReader: class {},
  PostgresEvaluationReviewRepository: class {},
  PostgresWaitRepository: class {},
  readTimelineHead: vi.fn(),
}));

import type { RunRecord } from '@intellifin/domain';

import { CancellationBanners, RerunLinksBanner } from './detail';

/**
 * The two Run Detail banners that name a PERSON (owner correction, 2026-09-15).
 *
 * Both printed a user id — the rerun banner's "started … by 019a…" and the cancellation
 * banner's "Canceled by 019a…" — on surfaces whose whole job is to say who did what.
 * `PauseBanners` was repaired for this in the Epic 5 review; these are its siblings, and a
 * rule landed on one sibling and not the others is the defect class that review found most.
 */

const NAMES: ReadonlyMap<string, string> = new Map([
  ['019823ab-0000-7000-8000-000000000007', 'Daniel Okonjo'],
]);

const SUCCESSOR = {
  runId: '019823ab-0000-7000-8000-000000000002',
  initiatedAt: '2026-09-10T08:55:00.000Z',
  initiatorId: '019823ab-0000-7000-8000-000000000007',
};

describe('the rerun banner', () => {
  it('names the person who started each successor, never their id', () => {
    const html = renderToStaticMarkup(React.createElement(RerunLinksBanner, { successors: [SUCCESSOR], names: NAMES }));
    expect(html).toContain('This Run has been rerun.');
    expect(html).toContain('by Daniel Okonjo');
    expect(html).not.toContain('by <span class="ls-mono">019823ab-0000-7000-8000-000000000007');
    expect(html).toContain('href="/runs/019823ab-0000-7000-8000-000000000002"');
  });

  it('shows the id, in monospace, only when no name is known for it', () => {
    const html = renderToStaticMarkup(React.createElement(RerunLinksBanner, { successors: [SUCCESSOR], names: new Map() }));
    expect(html).toContain('by <span class="ls-mono">019823ab-0000-7000-8000-000000000007</span>');
  });
});

function canceled(requestedBy: string, state: RunRecord['state'] = 'CANCELED'): RunRecord {
  return {
    runId: '019823ab-0000-7000-8000-000000000001',
    state,
    cancellation: { requestedBy, requestedAt: '2026-09-10T09:00:00.000Z', reason: 'Canceled by the auditor.' },
    pauseRequest: null,
  } as unknown as RunRecord;
}

describe('the cancellation banners', () => {
  it('name the person who canceled the Run', () => {
    const html = renderToStaticMarkup(
      React.createElement(CancellationBanners, { run: canceled('019823ab-0000-7000-8000-000000000007'), names: NAMES }),
    );
    expect(html).toContain('Canceled by Daniel Okonjo at 2026-09-10T09:00:00.000Z');
    expect(html).not.toContain('019823ab-0000-7000-8000-000000000007');
  });

  it('name the person who requested a cancellation still pending', () => {
    const html = renderToStaticMarkup(
      React.createElement(CancellationBanners, { run: canceled('019823ab-0000-7000-8000-000000000007', 'RUNNING'), names: NAMES }),
    );
    expect(html).toContain('Cancellation requested by Daniel Okonjo at 2026-09-10T09:00:00.000Z');
  });

  it('cannot have the sentence rewritten by a name that spells a replacement pattern', () => {
    // `String.prototype.replace` with a string pattern expands `$&`; the actor used to be
    // a UUID, which cannot contain one, and is a person's name now.
    const hostile = new Map([['019823ab-0000-7000-8000-000000000007', 'Fee $& review']]);
    const html = renderToStaticMarkup(
      React.createElement(CancellationBanners, { run: canceled('019823ab-0000-7000-8000-000000000007'), names: hostile }),
    );
    expect(html).toContain('Canceled by Fee $&amp; review at 2026-09-10T09:00:00.000Z');
    expect(html).not.toContain('{actor}');
  });

  it('fall back to the id when no name is known', () => {
    const html = renderToStaticMarkup(
      React.createElement(CancellationBanners, { run: canceled('019823ab-0000-7000-8000-0000000000ff'), names: NAMES }),
    );
    expect(html).toContain('Canceled by 019823ab-0000-7000-8000-0000000000ff at');
  });
});
