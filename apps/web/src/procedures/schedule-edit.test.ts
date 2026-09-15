import { describe, expect, it } from 'vitest';
import { isDraftSchedule, PERIOD_DERIVATION_RULES } from '@intellifin/domain';
import { ONCE_DEFAULT_START_TIME, scheduleEdit } from './schedule-edit';

describe('scheduleEdit', () => {
  it('fills an empty start time with 00:00 when Once is chosen', () => {
    expect(scheduleEdit({ frequency: '', startTime: '' }, 'once')).toEqual({ frequency: 'once', startTime: ONCE_DEFAULT_START_TIME });
  });

  it('keeps a time the person typed', () => {
    expect(scheduleEdit({ frequency: 'monthly', startTime: '09:30' }, 'once')).toEqual({ frequency: 'once', startTime: '09:30' });
  });

  it('invents no time for a frequency whose time will mean something', () => {
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      expect(scheduleEdit({ frequency: '', startTime: '' }, frequency)).toEqual({ frequency, startTime: '' });
    }
  });

  it('keeps the time when the frequency is cleared', () => {
    expect(scheduleEdit({ frequency: 'once', startTime: '00:00' }, '')).toEqual({ frequency: '', startTime: '00:00' });
  });

  it('fills a time the domain accepts, not a spelling the form would then refuse', () => {
    // Checked through the domain's own validator rather than a copy of its pattern.
    expect(isDraftSchedule({ frequency: 'once', startTime: ONCE_DEFAULT_START_TIME, periodDerivationRule: PERIOD_DERIVATION_RULES.once })).toBe(true);
  });
});
