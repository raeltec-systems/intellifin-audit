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
  DrizzleRunDetailRepository: class {},
  DrizzleRunRepository: class {},
  PostgresEvaluationReviewRepository: class {},
  PostgresWaitRepository: class {},
  readTimelineHead: vi.fn(),
  readPauseEntry: vi.fn(),
  readPauseHistory: vi.fn(),
  readRecordNames: vi.fn(),
  DrizzleActorNameReader: class {},
  DrizzleFrozenExecutionReader: class {},
}));

import type { RunWait } from '@intellifin/application';
import type { RunRecord } from '@intellifin/domain';
import { readPauseEntry, type Database } from '@intellifin/infrastructure';

import { PAUSE_COPY } from '../design/copy';
import { shortReference } from '../design/references';
import { PauseBanners } from './detail';
import { readPauseHold } from './pause-read';
import { PAUSE_WORDS, bannerHeldBeforeWords, bannerHeldInFlightWords, type PauseHoldRead } from './pause-words';

/**
 * The Paused banner's branch table (Story 5.4), which had no test at all.
 *
 * It is `OpenEscalationSection`'s table one component along, and the case that matters is
 * the one the sibling was already fixed for: a `PAUSED` Run whose wait cannot be read must
 * SAY SO rather than render nothing. `readOpenEscalation` returns every field `null` when
 * its role check refuses, so this is a state a reader reaches.
 */

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const READ_AT = new Date('2026-09-10T09:00:00.000Z');

const PAUSE: RunWait = {
  waitId: '019823ab-0000-7000-8000-000000000002',
  runId: RUN_ID,
  kind: 'pause',
  openedAt: '2026-09-10T08:55:00.000Z',
  // A user ID, which is what the wait row holds -- an address cannot enter the chain.
  openedBy: '019823ab-0000-7000-8000-000000000007',
  options: [],
  deadline: '2026-09-10T09:25:00.000Z',
  closedAt: null,
  closureKind: null,
  answerOptionId: null,
  actor: null,
} as unknown as RunWait;

function run(state: RunRecord['state'], pauseRequest: RunRecord['pauseRequest'] = null): RunRecord {
  return {
    runId: RUN_ID,
    procedureId: '019823ab-0000-7000-8000-000000000003',
    versionId: '019823ab-0000-7000-8000-000000000004',
    versionNumber: 1,
    procedureName: 'Terminated users',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-01',
    state,
    kind: 'STANDARD',
    initiatorId: '019823ab-0000-7000-8000-000000000005',
    initiatedAt: '2026-09-10T08:00:00.000Z',
    revision: 4,
    cancellation: null,
    pauseRequest,
    predecessorRunId: null,
  } as unknown as RunRecord;
}

const NAMES: ReadonlyMap<string, string> = new Map([
  ['019823ab-0000-7000-8000-000000000007', 'Daniel Okonjo'],
  ['019823ab-0000-7000-8000-000000000008', 'Amara Chen'],
]);

/** Where the pause holds the Run, as `readPauseHold` answers for an attempt it interrupted. */
const SUPERSEDED = '019823ab-0000-7000-8000-0000000000a1';
const HELD_SENTENCE = bannerHeldInFlightWords('“Inspect the record” for E-000102 on LoanCore', 2);
const HELD: PauseHoldRead = { kind: 'read', sentences: [HELD_SENTENCE], supersededStepExecutionId: SUPERSEDED, resume: 'restart', keys: [] };

function render(
  state: RunRecord['state'],
  pause: RunWait | null,
  pauseRequest: RunRecord['pauseRequest'] = null,
  hold: PauseHoldRead = HELD,
): string {
  return renderToStaticMarkup(
    React.createElement(PauseBanners, { run: run(state, pauseRequest), pause, hold, readAt: READ_AT, names: NAMES }),
  );
}

describe('the Paused banner', () => {
  it('names the PERSON who paused the Run, never their user id', () => {
    // EXPERIENCE.md's row is "Paused by Daniel Okonjo at {time}". The wait holds an id,
    // and the banner printed it: the platform speaking its own language on the one
    // surface whose job is to name the person accountable. `ActorNameReader` exists for
    // exactly this, and `pause-resume.spec.ts` pinned the id as the expected text.
    const html = render('PAUSED', PAUSE);
    expect(html).toContain('Paused by Daniel Okonjo at');
    expect(html).not.toContain('019823ab-0000-7000-8000-000000000007');
    expect(html).toContain('Resumes on your action');
    expect(html).not.toContain(PAUSE_COPY.unreadable);
  });

  it('shows the id only when no name is known for it, which is honest about what is known', () => {
    const html = render('PAUSED', { ...PAUSE, openedBy: '019823ab-0000-7000-8000-0000000000ff' } as unknown as RunWait);
    expect(html).toContain('Paused by 019823ab-0000-7000-8000-0000000000ff at');
  });

  it('cannot have its sentence rewritten by a name that spells a replacement pattern', () => {
    // `String.prototype.replace` with a string pattern expands `$&` in the REPLACEMENT.
    const hostile = new Map([['019823ab-0000-7000-8000-000000000007', 'Fee $& review']]);
    const html = renderToStaticMarkup(
      React.createElement(PauseBanners, { run: run('PAUSED'), pause: PAUSE, hold: HELD, readAt: READ_AT, names: hostile }),
    );
    expect(html).toContain('Paused by Fee $&amp; review at');
    expect(html).not.toContain('{actor}');
  });

  it('shows a countdown, not only two absolute timestamps', () => {
    // EXPERIENCE.md asks for one in three places (115, 149, 292): "Paused (30 min) and
    // Awaiting Auditor (4 h) show a countdown". The pause opened at 08:55 with a 30-minute
    // window, and the server read at 09:00, so 25 minutes remain — counted from `readAt`
    // so the first client render matches the server's rather than reporting a hydration
    // mismatch on what is only a clock.
    //
    // It is a `role="timer"` and NOT a live region: one that announced itself would read
    // the time out once a second for the whole wait, which is the Story 4.8 defect.
    const html = render('PAUSED', PAUSE);
    expect(html).toContain('role="timer"');
    expect(html).toContain('00:25:00');
    expect(html).not.toContain('aria-live');
    // The absolute instants stay beside it: the countdown says how long, the stamps say
    // when, and an auditor reading a sealed record needs the second.
    expect(html).toContain('2026-09-10T09:25:00.000Z');
  });

  it('says a PAUSED Run whose wait cannot be read is paused, rather than rendering nothing', () => {
    // The whole point. `readOpenEscalation` answers all-nulls on an authorization denial,
    // and `pause` is null whenever the row is missing, closed, or not of kind `pause`.
    for (const unreadable of [null, { ...PAUSE, openedBy: null } as unknown as RunWait]) {
      const html = render('PAUSED', unreadable);
      expect(html).toContain(PAUSE_COPY.unreadable);
      expect(html).not.toBe('');
    }
  });

  it('shows the request while it is still unhonoured, and only while the Run is active', () => {
    const request = {
      requestedBy: '019823ab-0000-7000-8000-000000000008',
      requestedAt: '2026-09-10T08:59:00.000Z',
      reason: null,
      sessionId: '019823ab-0000-7000-8000-000000000006',
    };
    expect(render('RUNNING', null, request as unknown as RunRecord['pauseRequest'])).toContain('Amara Chen');
    // A terminal Run carrying a leftover marker was never paused; the Timeline records it
    // as superseded, and repeating it here would assert a hold that never happened.
    expect(render('COMPLETED', null, request as unknown as RunRecord['pauseRequest'])).toBe('');
  });

  it('renders nothing in a state that holds no pause', () => {
    expect(render('RUNNING', null)).toBe('');
    expect(render('COMPLETED', null)).toBe('');
  });

  // Story 10.6, legacy 5.4: the banner names where the pause holds the Run.
  it('says where the pause holds the Run, and names the attempt it superseded', () => {
    const html = render('PAUSED', PAUSE);
    expect(html).toContain(HELD_SENTENCE);
    expect(html).toContain(`Step Execution <span class="ls-mono">${shortReference(SUPERSEDED)}</span>`);
    expect(html).toContain(`title="${SUPERSEDED}"`);
    expect(html).not.toContain(PAUSE_WORDS.holdUnreadable);
  });

  it('says a hold it could not read is unreadable, never an absence', () => {
    // A PAUSED Run IS held somewhere, so a banner that named no step would claim the pause
    // holds it nowhere. `none` cannot reach a PAUSED banner from `readPauseHold`; if a
    // caller passed it anyway, the banner still says it could not read the hold.
    for (const hold of [{ kind: 'unreadable' }, { kind: 'none' }] as const) {
      const html = render('PAUSED', PAUSE, null, hold);
      expect(html).toContain(PAUSE_WORDS.holdUnreadable);
      expect(html).toContain('Paused by Daniel Okonjo at');
    }
  });

  it('keeps the paused banner readable when the actual hold lookup fails', async () => {
    vi.mocked(readPauseEntry).mockRejectedValueOnce(new Error('lookup unavailable'));
    const hold = await readPauseHold({} as Database, run('PAUSED'), PAUSE, null);
    expect(hold).toEqual({ kind: 'unreadable' });
    expect(readPauseEntry).toHaveBeenCalledWith({}, RUN_ID, PAUSE.waitId);
    const html = render('PAUSED', PAUSE, null, hold);
    expect(html).toContain(PAUSE_WORDS.holdUnreadable);
    expect(html).toContain('Paused by Daniel Okonjo at');
  });

  // Screenshot review, 2026-09-26: the banner's last line said "The agent restarts the
  // current Step" directly under "No Step Execution was in flight." A pause between units
  // STARTS the step it holds the Run before.
  it('ends with what Resume does for the hold it read', () => {
    const inFlight = render('PAUSED', PAUSE);
    expect(inFlight).toContain(PAUSE_WORDS.resumeRestarts);
    expect(inFlight).not.toContain(PAUSE_WORDS.resumeUnknown);

    const before: PauseHoldRead = {
      kind: 'read',
      sentences: [bannerHeldBeforeWords('“Sign in to the Target System” on LoanCore'), PAUSE_WORDS.noStepInFlight],
      supersededStepExecutionId: null,
      resume: 'start',
      keys: [],
    };
    const between = render('PAUSED', PAUSE, null, before);
    expect(between).toContain(PAUSE_WORDS.noStepInFlight);
    expect(between).toContain(PAUSE_WORDS.resumeStarts);
    expect(between).not.toContain('restarts the current Step');

    // Where the record does not say, the banner keeps the sentence it always had.
    for (const hold of [{ kind: 'unreadable' }, { kind: 'none' }] as const) {
      expect(render('PAUSED', PAUSE, null, hold)).toContain(PAUSE_WORDS.resumeUnknown);
    }
    const unknown: PauseHoldRead = { kind: 'read', sentences: [PAUSE_WORDS.holdsNotRecorded], supersededStepExecutionId: null, resume: 'unknown', keys: [] };
    expect(render('PAUSED', PAUSE, null, unknown)).toContain(PAUSE_WORDS.resumeUnknown);
  });

  it('says nothing about a hold while the pause is only requested', () => {
    const request = {
      requestedBy: '019823ab-0000-7000-8000-000000000008',
      requestedAt: '2026-09-10T08:59:00.000Z',
      reason: null,
      sessionId: '019823ab-0000-7000-8000-000000000006',
    };
    const html = render('RUNNING', null, request as unknown as RunRecord['pauseRequest']);
    expect(html).not.toContain(HELD_SENTENCE);
    expect(html).not.toContain(PAUSE_WORDS.holdUnreadable);
  });
});
