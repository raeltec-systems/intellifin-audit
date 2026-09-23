import { describe, expect, it } from 'vitest';

import type { OpenNotification } from '@intellifin/application';

import { BELL_KIND_WORDS, BELL_OPEN_ALL, bellBounded, bellItems } from './bell-items';

/**
 * The bell panel's rows (UI cleanup 2026-09-22, UX-32).
 *
 * The panel's only action was "Open notifications", so a bell showing "3" opened a menu
 * that said nothing about the three. The rows are built on the SERVER, which is what
 * keeps the countdown measured against the instant the count beside it was taken.
 */

const READ_AT = new Date('2026-09-16T10:00:00.000Z');

const ESCALATION: OpenNotification = {
  kind: 'escalation',
  recipientId: 'auditor-1',
  procedureId: 'p',
  versionId: 'v',
  procedureName: 'Terminated Users Retaining Access',
  versionNumber: 3,
  runId: '019823ab-0000-7000-8000-000000000001',
  waitId: '019823ab-0000-7000-8000-0000000000c1',
  escalationKind: 'choose-candidate',
  deadline: '2026-09-16T10:30:00.000Z',
};

const FLAG: OpenNotification = {
  kind: 'flag',
  recipientId: 'auditor-1',
  procedureId: 'p',
  versionId: 'v',
  procedureName: 'Segregation of Duties',
  versionNumber: 2,
  runId: '019823ab-0000-7000-8000-000000000002',
  flagId: '019823ab-0000-7000-8000-0000000000d1',
  flaggedBy: 'auditor-2',
  flaggedAt: '2026-09-16T09:00:00.000Z',
};

describe('the bell panel rows', () => {
  it('names the Procedure, says the question, and counts down to the deadline', () => {
    const [item] = bellItems([ESCALATION], new Map(), READ_AT);
    expect(item?.title).toBe('Terminated Users Retaining Access');
    expect(item?.kind).toBe(BELL_KIND_WORDS.escalation);
    // In words, never the stored kind.
    expect(item?.detail).toBe('Choose one of the grounded candidates, or mark the record ambiguous.');
    expect(item?.detail).not.toContain('choose-candidate');
    expect(item?.remaining).toBe('30 minutes');
    // The Run, where the panel that answers it is.
    expect(item?.href).toBe(`/runs/${ESCALATION.runId}`);
  });

  it('gives a flag no countdown, and names who raised it', () => {
    // A flag has no deadline: nothing times it out, and what stops it needing attention is
    // the Run ending. "0 minutes" would be a countdown that has already run out.
    const [item] = bellItems([FLAG], new Map([['auditor-2', 'Mira Haddad']]), READ_AT);
    expect(item?.remaining).toBeNull();
    expect(item?.kind).toBe(BELL_KIND_WORDS.flag);
    expect(item?.detail).toBe('Flagged by Mira Haddad');
    // Watch is where an Audit Manager was asked to look.
    expect(item?.href).toBe(`/runs/${FLAG.runId}/live`);
  });

  it('falls back to the id when no name resolves, which is honest about what is known', () => {
    const [item] = bellItems([FLAG], new Map(), READ_AT);
    expect(item?.detail).toBe('Flagged by auditor-2');
  });

  it('keys a row by its wait or its flag, never by the Run, which can hold both', () => {
    const items = bellItems([ESCALATION, { ...FLAG, runId: ESCALATION.runId }], new Map(), READ_AT);
    expect(new Set(items.map((item) => item.key)).size).toBe(2);
  });

  it('names an Escalation kind this build does not recognise rather than printing it', () => {
    // `Object.hasOwn`-guarded through `escalationQuestion`: a plain index answers
    // `'constructor'` with a function.
    const [item] = bellItems(
      [{ ...ESCALATION, escalationKind: 'constructor' as never }],
      new Map(),
      READ_AT,
    );
    expect(item?.detail).toContain('Unrecognised kind');
    expect(item?.detail).not.toContain('[native code]');
  });

  it('says how many it could not name, and keeps the link to the page that can', () => {
    expect(bellBounded(5, 12)).toBe('Showing 5 of 12.');
    // Two browser suites click this exact name; renaming it breaks both.
    expect(BELL_OPEN_ALL).toBe('Open notifications');
  });
});
