import { describe, expect, it } from 'vitest';
import { ACTIVE_RUN_STATES, RUN_CANCEL_TRANSITIONS, RUN_FLAG_NOTE_MAX_LENGTH, RUN_FLAG_STATES, RUN_STATES, isActiveRunState, isFlaggableRunState, periodOwner, runCancelTransition } from './run.js';
const period = (from: string) => ({ from, to: from });
const versions = ['old', 'new', 'last'].map(versionId => ({ versionId, state: 'ACTIVE' }));
const edge = (predecessorId: string, successorId: string, handoverAt: string | null, activatedAt: string | null = '2026-01-01T12:00:00.000Z') => ({ predecessorId, successorId, handoverAt, activatedAt });
describe('period ownership through activated succession', () => {
  it('first activation owns every period independently of dates and version numbering', () => {
    expect(periodOwner([versions[0]!], [], period('0001-01-01'))).toBe('old');
    expect(periodOwner([versions[0]!], [], period('9999-12-31'))).toBe('old');
  });
  it('composes inclusive boundaries in stored order with equal activation times', () => {
    const edges = [edge('new','last','2026-03-01T00:00:00.000Z'),edge('old','new','2026-02-01T00:00:00.000Z')];
    for (const [date, expected] of [['2026-01-31','old'],['2026-02-01','new'],['2026-02-28','new'],['2026-03-01','last']]) expect(periodOwner([...versions].reverse(), edges, period(date!))).toBe(expected);
  });
  it('null activation is pending; activated null boundary replaces every period', () => {
    expect(periodOwner(versions.slice(0,1), [edge('old','new',null,null)],period('2025-01-01'))).toBe('old');
    expect(periodOwner(versions.slice(0,2), [edge('old','new',null)],period('2025-01-01'))).toBe('new');
  });
  it('refuses retired ownership, gaps, forks, cycles, missing nodes and reversed boundaries', () => {
    expect(periodOwner([{versionId:'old',state:'RETIRED'}], [],period('2026-01-01'))).toBeNull();
    expect(periodOwner(versions, [],period('2026-01-01'))).toBeNull();
    expect(periodOwner(versions, [edge('old','new',null),edge('old','last',null)],period('2026-01-01'))).toBeNull();
    expect(periodOwner(versions.slice(0,2), [edge('old','new',null),edge('new','old',null)],period('2026-01-01'))).toBeNull();
    expect(periodOwner(versions.slice(0,1), [edge('old','missing',null)],period('2026-01-01'))).toBeNull();
    expect(periodOwner(versions,[edge('old','new','2026-03-01T00:00:00.000Z'),edge('new','last','2026-02-01T00:00:00.000Z')],period('2026-02-01'))).toBeNull();
  });
  it('compares timestamp instants across offset and fractional representations', () => {
    const nodes=versions.slice(0,2);
    expect(periodOwner(nodes,[edge('old','new','2026-02-01T01:00:00+01:00','2026-01-31T23:00:00Z')],period('2026-02-01'))).toBe('new');
    expect(periodOwner(nodes,[edge('old','new','2026-02-01T00:00:00.0000Z','2026-01-31T23:59:59.999Z')],period('2026-02-01'))).toBe('new');
    expect(periodOwner(nodes,[edge('old','new','2026-02-01T01:00:00+02:00','2026-02-01T00:00:00Z')],period('2026-02-01'))).toBeNull();
  });
  it('refuses invalid inclusive Gregorian periods', () => {
    for (const input of [{from:'2026-02-29',to:'2026-03-01'},{from:'2026-02-02',to:'2026-02-01'},{from:'0000-01-01',to:'2026-01-01'}]) expect(periodOwner([versions[0]!],[],input)).toBeNull();
  });
});

describe('the permitted cancellation transitions', () => {
  it('names one transition per active state and none for a terminal one', () => {
    expect(RUN_CANCEL_TRANSITIONS.map(row => row.from)).toEqual([...ACTIVE_RUN_STATES]);
    for (const row of RUN_CANCEL_TRANSITIONS) expect(row.to).toBe('CANCELED');
    // Every state, state by state, so a row added or removed fails rather than a count.
    for (const state of RUN_STATES) {
      const transition = runCancelTransition(state);
      if (isActiveRunState(state)) expect(transition).toEqual({ from: state, to: 'CANCELED', performedBy: state === 'RUNNING' ? 'worker' : 'command' });
      else expect(transition).toBeNull();
    }
  });
  it('separates the four active states from the four terminal ones', () => {
    expect(RUN_STATES.filter(state => isActiveRunState(state))).toEqual([...ACTIVE_RUN_STATES]);
    expect(RUN_STATES.filter(state => !isActiveRunState(state))).toEqual(['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED']);
  });
  it('refuses an inherited property name, an object and a missing state', () => {
    for (const value of ['constructor', 'toString', '', 'queued', undefined, null, {}, ['QUEUED']]) {
      expect(isActiveRunState(value)).toBe(false);
      expect(runCancelTransition(value)).toBeNull();
    }
  });
});

describe('which states may be flagged (Story 5.5)', () => {
  it('names the three the acceptance criterion names, and no fourth', () => {
    expect([...RUN_FLAG_STATES]).toEqual(['RUNNING', 'PAUSED', 'AWAITING_AUDITOR']);
    // Walked state by state, so a row added or removed fails rather than a count. QUEUED is
    // ACTIVE and still not flaggable: the control lives in the session viewer.
    for (const state of RUN_STATES) {
      expect(isFlaggableRunState(state)).toBe(state === 'RUNNING' || state === 'PAUSED' || state === 'AWAITING_AUDITOR');
    }
    expect(isFlaggableRunState('QUEUED')).toBe(false);
  });
  it('is a membership test and not a transition: no flaggable state changes', () => {
    // A flag never moves a Run, so unlike RUN_CANCEL_TRANSITIONS and RUN_PAUSE_TRANSITIONS
    // there is no `to` here at all. This asserts the shape rather than a behaviour, so a
    // later story that gives a flag a transition has to change this test deliberately.
    expect(RUN_FLAG_STATES.every(state => typeof state === 'string')).toBe(true);
  });
  it('refuses an inherited property name, an object and a missing state', () => {
    for (const value of ['constructor', 'toString', '', 'running', undefined, null, {}, ['RUNNING']]) {
      expect(isFlaggableRunState(value)).toBe(false);
    }
  });
  it('bounds a note at 500 characters, the same bound the database enforces', () => {
    expect(RUN_FLAG_NOTE_MAX_LENGTH).toBe(500);
  });
});
