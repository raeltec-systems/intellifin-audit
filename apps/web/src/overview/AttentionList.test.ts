import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { OpenNotification } from '@intellifin/application';
import type {
  PendingResultRow,
  RunStopFacts,
  StoppedRunRow,
  SubmittedVersionRow,
} from '@intellifin/infrastructure';

import { AttentionList, attentionTotal, type AttentionCounts } from './AttentionList';
import {
  ATTENTION_GROUPS,
  ATTENTION_GROUP_ORDER,
  ATTENTION_NOT_YET_LISTED,
  MANAGER_ATTENTION_ORDER,
  overviewBounded,
} from './overview-words';
import { FRESHNESS_ADVICE } from '../runs/stop-reason';

/**
 * The Overview's attention list, rendered for real, server-side.
 *
 * The properties under test are properties of the MARKUP: which rows appear, in which
 * order, what each one says about the person accountable, and — the whole of RUN-04 —
 * whether a Run that stopped says why. A test over a projection function would prove none
 * of them.
 */

const READ_AT = new Date('2026-09-16T10:00:00.000Z');

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const OTHER_RUN_ID = '019823ab-0000-7000-8000-000000000002';

const ESCALATION: OpenNotification = {
  kind: 'escalation',
  recipientId: 'auditor-1',
  procedureId: '019823ab-0000-7000-8000-0000000000a1',
  versionId: '019823ab-0000-7000-8000-0000000000b1',
  procedureName: 'Terminated Users Retaining Access',
  versionNumber: 3,
  runId: RUN_ID,
  waitId: '019823ab-0000-7000-8000-0000000000c1',
  escalationKind: 'choose-candidate',
  deadline: '2026-09-16T10:30:00.000Z',
};

const FLAG: OpenNotification = {
  kind: 'flag',
  recipientId: 'auditor-1',
  procedureId: '019823ab-0000-7000-8000-0000000000a2',
  versionId: '019823ab-0000-7000-8000-0000000000b2',
  procedureName: 'Segregation of Duties',
  versionNumber: 2,
  runId: OTHER_RUN_ID,
  flagId: '019823ab-0000-7000-8000-0000000000d1',
  flaggedBy: 'auditor-2',
  flaggedAt: '2026-09-16T09:00:00.000Z',
};

const VERSION: SubmittedVersionRow = {
  versionId: '019823ab-0000-7000-8000-0000000000b3',
  procedureId: '019823ab-0000-7000-8000-0000000000a3',
  controlName: 'Privileged Access Review',
  versionNumber: 4,
  submittedAt: '2026-09-15T08:00:00.000Z',
  submittedBy: 'auditor-2',
  authorId: 'auditor-2',
};

/**
 * A finished test whose conclusion is waiting on the reader (UI cleanup 2026-09-22, UX-01).
 *
 * The list used to exclude these and say so in a footnote claiming a Result awaiting
 * confirmation could not exist in this release. It can — Story 4.9 holds an Agent-Judged
 * Result open until a person decides each proposal — so the footnote was false about the
 * single most actionable thing this platform can show somebody.
 */
const PENDING: PendingResultRow = {
  runId: '019823ab-0000-7000-8000-000000000004',
  procedureId: '019823ab-0000-7000-8000-0000000000a5',
  procedureName: 'Segregation of Duties',
  versionNumber: 2,
  period: { from: '2026-08-01', to: '2026-08-31' },
  initiatorId: 'auditor-1',
  initiatedAt: '2026-09-15T09:00:00.000Z',
  resultAt: '2026-09-15T09:04:00.000Z',
  pendingEvaluations: 3,
};

const STOPPED: StoppedRunRow = {
  runId: '019823ab-0000-7000-8000-000000000003',
  procedureId: '019823ab-0000-7000-8000-0000000000a4',
  procedureName: 'Terminated Users Retaining Access',
  versionNumber: 1,
  period: { from: '2026-09-01', to: '2026-09-15' },
  state: 'INCONCLUSIVE',
  initiatorId: 'auditor-1',
  initiatedAt: '2026-09-15T10:00:00.000Z',
  endedAt: '2026-09-15T10:00:12.000Z',
};

/** The production case: a snapshot generated on the first, a period ending two weeks later. */
const STALE_SNAPSHOT: RunStopFacts = {
  runId: STOPPED.runId,
  state: 'INCONCLUSIVE',
  initiatedAt: STOPPED.initiatedAt,
  period: STOPPED.period,
  stop: { stage: 'population', diagnostic: 'freshness' },
  timedOutWait: null,
  snapshotGeneratedAt: '2026-09-01T00:00:00.000Z',
  gateChecks: 0,
  gateFailed: 0,
  outcomeRow: 'gate-failed',
};

function render(
  overrides: {
    open?: readonly OpenNotification[];
    pending?: readonly PendingResultRow[];
    versions?: readonly SubmittedVersionRow[];
    order?: readonly (typeof ATTENTION_GROUP_ORDER)[number][];
    stopped?: readonly StoppedRunRow[];
    stops?: ReadonlyMap<string, RunStopFacts>;
    names?: ReadonlyMap<string, string>;
    counts?: Partial<AttentionCounts>;
  } = {},
): string {
  const open = overrides.open ?? [];
  const pending = overrides.pending ?? [];
  const versions = overrides.versions ?? [];
  const stopped = overrides.stopped ?? [];
  return renderToStaticMarkup(
    React.createElement(AttentionList, {
      open,
      pending,
      versions,
      stopped,
      stops: overrides.stops ?? new Map(),
      names: overrides.names ?? new Map(),
      counts: {
        open: open.length,
        pending: pending.length,
        versions: versions.length,
        stopped: stopped.length,
        ...overrides.counts,
      },
      readAt: READ_AT,
      ...(overrides.order === undefined ? {} : { order: overrides.order }),
    }),
  );
}

describe('the Overview attention list', () => {
  it('says why a stopped Run stopped, in words, and never as a code', () => {
    // The finding: a page of "Inconclusive · No conclusion issued" read as "all the runs
    // failed", with the reason — a stale snapshot — only on the Timeline tab, in monospace.
    const html = render({ stopped: [STOPPED], stops: new Map([[STOPPED.runId, STALE_SNAPSHOT]]) });
    expect(html).toContain('The source snapshot was generated on 2026-09-01, before the period ended on 2026-09-15.');
    expect(html).toContain(FRESHNESS_ADVICE);
    expect(html).not.toContain('>freshness<');
  });

  it('gives a stopped Run its lifecycle badge, its period, and one way onward', () => {
    const html = render({ stopped: [STOPPED] });
    expect(html).toContain('Inconclusive');
    expect(html).toContain(`href="/runs/${STOPPED.runId}"`);
    // The revised Formats row: a readable period on an ordinary surface, not the
    // machine spelling `2026-09-01 → 2026-09-15` the row used to print.
    expect(html).toContain('1–15 Sep 2026');
    expect(html).not.toContain('2026-09-01 → 2026-09-15');
    expect(html).toContain(ATTENTION_GROUPS.stopped);
  });

  it('says nothing about a stopped Run whose facts could not be read', () => {
    // Nothing wrong rather than something wrong: the Runs table's own rule.
    const html = render({ stopped: [STOPPED] });
    expect(html).not.toContain('ls-stop-reason');
  });

  it('names every person, and shows an id in monospace only when no name is known', () => {
    const names = new Map([
      ['auditor-1', 'Daniel Okonjo'],
      ['auditor-2', 'Mira Haddad'],
    ]);
    const html = render({ open: [FLAG], versions: [VERSION], stopped: [STOPPED], names });
    expect(html).toContain('Daniel Okonjo');
    expect(html).toContain('Mira Haddad');
    expect(html).not.toContain('>auditor-1<');
    expect(html).not.toContain('>auditor-2<');
    const unnamed = render({ stopped: [STOPPED] });
    expect(unnamed).toContain('<span class="ls-mono">auditor-1</span>');
  });

  it('asks the open Escalation\'s question in words and counts down to its deadline', () => {
    const html = render({ open: [ESCALATION] });
    expect(html).toContain('Choose one of the grounded candidates, or mark the record ambiguous.');
    // Thirty minutes, measured to the instant the page was read, so the server and a
    // reload agree about what "remaining" means.
    expect(html).toContain('30 minutes');
    expect(html).toContain('Awaiting Auditor');
    expect(html).toContain(`href="/runs/${ESCALATION.runId}"`);
    // The stored kind is a key, never a word a reader meets.
    expect(html).not.toContain('choose-candidate');
  });

  it('names an Escalation kind this build does not recognise rather than printing it', () => {
    // The lookup is keyed by a value read out of the database, so it is `Object.hasOwn`
    // guarded: a plain index would return an inherited function for `constructor`.
    const html = render({
      open: [{ ...ESCALATION, escalationKind: 'constructor' as never }],
    });
    expect(html).toContain('Unrecognised kind');
    expect(html).not.toContain('[native code]');
  });

  it('sends a flagged Run to Live View and says who raised the flag', () => {
    const html = render({ open: [FLAG] });
    expect(html).toContain(`href="/runs/${FLAG.runId}/live"`);
    expect(html).toContain(ATTENTION_GROUPS.flag);
    expect(html).toContain('2026-09-16T09:00:00.000Z');
  });

  it('sends a submitted version to its review surface, with who submitted and who wrote it', () => {
    const html = render({ versions: [VERSION], names: new Map([['auditor-2', 'Mira Haddad']]) });
    expect(html).toContain(`href="/procedures/${VERSION.procedureId}/versions/${VERSION.versionId}"`);
    expect(html).toContain('Submitted');
    expect(html).toContain('Privileged Access Review');
    expect(html).toContain('2026-09-15T08:00:00.000Z');
  });

  it('says a submission time or an author is unrecorded rather than showing a gap', () => {
    const html = render({ versions: [{ ...VERSION, submittedAt: null, submittedBy: null, authorId: null }] });
    expect(html).toContain('The submission time was not recorded.');
    expect(html).toContain('No author is recorded on this version.');
  });

  it('never prints a raw Run identifier, and names each Run by a short reference', () => {
    // UX-02: the list used to print the full UUID under every row through `Identifier`.
    const html = render({ open: [FLAG, ESCALATION], pending: [PENDING], stopped: [STOPPED] });
    // Never as TEXT. The full value still rides in `title` and in the row's `href`, which
    // is `Reference`'s own contract: nothing is lost, it is moved out of the way of the
    // name a person actually reads.
    for (const id of [RUN_ID, OTHER_RUN_ID, STOPPED.runId, PENDING.runId]) {
      expect(html).not.toContain(`>${id}<`);
    }
    // And the monospace identifier the row used to end with is gone entirely.
    expect(html).not.toContain('ls-identifier');
    // The last eight hexadecimal characters, which is what `Reference` renders.
    expect(html).toContain(RUN_ID.replaceAll('-', '').slice(-8));
    expect(html).toContain(STOPPED.runId.replaceAll('-', '').slice(-8));
  });

  it("renders the groups in EXPERIENCE.md's order", () => {
    const html = render({
      open: [FLAG, ESCALATION],
      pending: [PENDING],
      versions: [VERSION],
      stopped: [STOPPED],
    });
    const positions = ATTENTION_GROUP_ORDER.map((group) => html.indexOf(ATTENTION_GROUPS[group]));
    expect(positions.every((at) => at !== -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('says how many it did not show, per group, from the exact counts', () => {
    const html = render({
      stopped: [STOPPED],
      counts: { stopped: 7 },
    });
    expect(html).toContain(overviewBounded(1, 7));
    // A group that fits says nothing: a note claiming "1 of 1" is noise.
    expect(render({ stopped: [STOPPED] })).not.toContain('Showing the first');
  });

  it('lists a finished test whose assessments are waiting, with the exact number left', () => {
    // UX-01. Proven by mutation: drop the `pending` group from `AttentionList` and this
    // fails on every assertion below.
    const html = render({ pending: [PENDING], names: new Map([['auditor-1', 'Daniel Okonjo']]) });
    expect(html).toContain(ATTENTION_GROUPS.pending);
    expect(html).toContain('Pending Confirmation');
    expect(html).toContain('Segregation of Duties');
    // The exact count, in the same sentence the Run's own Result tab uses.
    expect(html).toContain('3 of the agent’s assessments need your confirmation.');
    // One action, and it is the Result tab, which is where the confirming happens.
    expect(html).toContain(`href="/runs/${PENDING.runId}/result"`);
    expect(html).toContain('Daniel Okonjo');
    expect(html).toContain('1–31 Aug 2026');
  });

  it('counts one waiting assessment as one, not as three', () => {
    const html = render({ pending: [{ ...PENDING, pendingEvaluations: 1 }] });
    expect(html).toContain('1 of the agent’s assessments needs your confirmation.');
  });

  it('leads an Audit Manager with the versions awaiting their approval', () => {
    // EXPERIENCE.md's role-landing decision. The group MOVES; nothing is added, hidden or
    // rendered twice, and the stopped group is still last.
    const html = render({
      open: [ESCALATION, FLAG],
      pending: [PENDING],
      versions: [VERSION],
      stopped: [STOPPED],
      order: MANAGER_ATTENTION_ORDER,
    });
    const positions = MANAGER_ATTENTION_ORDER.map((group) => html.indexOf(ATTENTION_GROUPS[group]));
    expect(positions.every((at) => at !== -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html.indexOf(ATTENTION_GROUPS.version)).toBeLessThan(
      html.indexOf(ATTENTION_GROUPS.escalation),
    );
    expect(html.indexOf(ATTENTION_GROUPS.stopped)).toBe(Math.max(...positions));
  });

  it('says how many waiting assessments it did not show', () => {
    const html = render({ pending: [PENDING], counts: { pending: 9 } });
    expect(html).toContain(overviewBounded(1, 9));
  });

  it('says which attention kinds this release cannot list at all', () => {
    // A list missing three of the contract's seven kinds with nothing saying so lets a
    // reader take a short list for a quiet platform.
    expect(render({ stopped: [STOPPED] })).toContain(ATTENTION_NOT_YET_LISTED);
    // And it no longer claims a Result awaiting CONFIRMATION cannot be listed: that had
    // stopped being true, and the group above proves it.
    expect(ATTENTION_NOT_YET_LISTED).not.toContain('awaiting confirmation');
    expect(ATTENTION_NOT_YET_LISTED).toContain('this release cannot submit one');
  });
});

describe('the attention total', () => {
  it('counts every group, and is zero only when every group is empty', () => {
    expect(attentionTotal({ open: 0, pending: 0, versions: 0, stopped: 0 })).toBe(0);
    expect(attentionTotal({ open: 0, pending: 0, versions: 0, stopped: 3 })).toBe(3);
    expect(attentionTotal({ open: 2, pending: 4, versions: 1, stopped: 3 })).toBe(10);
    // A pending Result alone is enough to make the list non-empty: the Overview decides
    // between this list and "Nothing needs attention" from exactly this number.
    expect(attentionTotal({ open: 0, pending: 1, versions: 0, stopped: 0 })).toBe(1);
  });
});
