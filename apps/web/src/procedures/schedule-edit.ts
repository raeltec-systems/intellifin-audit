import type { Frequency } from '@intellifin/domain';

/** The start time a one-time Schedule is given when none has been typed. */
export const ONCE_DEFAULT_START_TIME = '00:00';

export interface ScheduleFields {
  readonly frequency: Frequency | '';
  readonly startTime: string;
}

/** The fields after a frequency change, and whether the start time is one the platform generated. */
export interface ScheduleEdit {
  readonly fields: ScheduleFields;
  readonly generated: boolean;
}

/**
 * The Schedule fields after the frequency control changes.
 *
 * A one-time Procedure has no automatic boundary, so its start time is kept for the
 * record and starts nothing — and a person who chose "Once" should not have to invent
 * one to save. Choosing it fills an EMPTY time with 00:00, the value P-1's Template
 * already pins. Every other frequency gets no invented time, because there the time
 * will mean something once a scheduler exists.
 *
 * `generated` says whether the CURRENT time is one this function filled in rather than
 * one the person typed, and it travels with the form: typing a time clears it, and
 * leaving Once takes a generated time away again, so a recurring frequency never
 * inherits a midnight nobody chose (a Codex finding on PR 38). A typed time survives
 * every frequency change.
 */
export function scheduleEdit(current: ScheduleFields, frequency: Frequency | '', generated: boolean): ScheduleEdit {
  if (frequency === 'once') {
    if (current.startTime === '') return { fields: { frequency, startTime: ONCE_DEFAULT_START_TIME }, generated: true };
    return { fields: { ...current, frequency }, generated };
  }
  if (generated) return { fields: { frequency, startTime: '' }, generated: false };
  return { fields: { ...current, frequency }, generated: false };
}
