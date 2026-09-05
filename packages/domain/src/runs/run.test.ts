import { describe, expect, it } from 'vitest';
import { periodOwner } from './run.js';
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
