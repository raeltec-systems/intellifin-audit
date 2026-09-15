import { describe, expect, it } from 'vitest';
import { isDraftSchedule, PERIOD_DERIVATION_RULES } from '@intellifin/domain';
import { ONCE_DEFAULT_START_TIME, scheduleEdit } from './schedule-edit';

const empty = { frequency: '', startTime: '' } as const;

describe('scheduleEdit', () => {
  it('fills an empty start time with 00:00 when Once is chosen, and says it generated it', () => {
    expect(scheduleEdit(empty, 'once', false)).toEqual({ fields: { frequency: 'once', startTime: ONCE_DEFAULT_START_TIME }, generated: true });
  });

  it('keeps a time the person typed', () => {
    expect(scheduleEdit({ frequency: 'monthly', startTime: '09:30' }, 'once', false)).toEqual({ fields: { frequency: 'once', startTime: '09:30' }, generated: false });
  });

  it('invents no time for a frequency whose time will mean something', () => {
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      expect(scheduleEdit(empty, frequency, false)).toEqual({ fields: { frequency, startTime: '' }, generated: false });
    }
  });

  it('takes a generated midnight away when Once is left', () => {
    // Once on an empty form generated 00:00; a recurring frequency must not inherit it.
    const once = scheduleEdit(empty, 'once', false);
    for (const frequency of ['daily', 'weekly', 'monthly', ''] as const) {
      expect(scheduleEdit(once.fields, frequency, once.generated)).toEqual({ fields: { frequency, startTime: '' }, generated: false });
    }
  });

  it('keeps a typed midnight when Once is left: the flag decides, never the value', () => {
    expect(scheduleEdit({ frequency: 'once', startTime: '00:00' }, 'weekly', false)).toEqual({ fields: { frequency: 'weekly', startTime: '00:00' }, generated: false });
  });

  it('keeps a generated time while the frequency stays Once', () => {
    const once = scheduleEdit(empty, 'once', false);
    expect(scheduleEdit(once.fields, 'once', once.generated)).toEqual(once);
  });

  it('fills a time the domain accepts, not a spelling the form would then refuse', () => {
    // Checked through the domain's own validator rather than a copy of its pattern.
    expect(isDraftSchedule({ frequency: 'once', startTime: ONCE_DEFAULT_START_TIME, periodDerivationRule: PERIOD_DERIVATION_RULES.once })).toBe(true);
  });
});
