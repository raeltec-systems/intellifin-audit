import type { Frequency } from '@intellifin/domain';

/** The start time a one-time Schedule is given when none has been typed. */
export const ONCE_DEFAULT_START_TIME = '00:00';

export interface ScheduleFields {
  readonly frequency: Frequency | '';
  readonly startTime: string;
}

/**
 * The Schedule fields after the frequency control changes.
 *
 * A one-time Procedure has no automatic boundary, so its start time is kept for the
 * record and starts nothing — and a person who chose "Once" should not have to invent
 * one to save. Choosing it fills an EMPTY time with 00:00, the value P-1's Template
 * already pins; a time the person typed is kept, and every other frequency leaves the
 * field alone, because there the time will mean something once a scheduler exists.
 */
export function scheduleEdit(current: ScheduleFields, frequency: Frequency | ''): ScheduleFields {
  if (frequency === 'once' && current.startTime === '') return { frequency, startTime: ONCE_DEFAULT_START_TIME };
  return { ...current, frequency };
}
