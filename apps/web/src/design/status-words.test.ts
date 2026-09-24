import { describe, expect, it } from 'vitest';

import { STATUS_VOCABULARY } from './status';
import {
  ASSESSMENT_MEANINGS,
  EVIDENCE_CHECK_MEANINGS,
  EXECUTION_MEANINGS,
  STATUS_COLUMN_WORDS,
  assessmentMeaning,
  evidenceChecksMeaning,
  executionMeaning,
  pendingAssessmentSentence,
} from './status-words';

/**
 * Every state a badge can show has a meaning beside it, and the meanings keep the three
 * families apart (UI cleanup 2026-09-21, UX-18).
 */
describe('status meanings', () => {
  it('cover every state of the three families the Run header shows', () => {
    expect(Object.keys(EXECUTION_MEANINGS).sort()).toEqual(
      Object.keys(STATUS_VOCABULARY['run-lifecycle'].states).sort(),
    );
    expect(Object.keys(ASSESSMENT_MEANINGS).sort()).toEqual(
      Object.keys(STATUS_VOCABULARY['result-outcome'].states).sort(),
    );
    expect(Object.keys(EVIDENCE_CHECK_MEANINGS).sort()).toEqual(
      Object.keys(STATUS_VOCABULARY['evidence-quality-gate'].states).sort(),
    );
  });

  it('are whole sentences a person can act on', () => {
    for (const sentence of [
      ...Object.values(EXECUTION_MEANINGS),
      ...Object.values(ASSESSMENT_MEANINGS),
      ...Object.values(EVIDENCE_CHECK_MEANINGS),
    ]) {
      expect(sentence.length).toBeGreaterThan(12);
      expect(sentence.trim().endsWith('.')).toBe(true);
    }
  });

  it('never let a passed evidence check read as a passed control', () => {
    expect(evidenceChecksMeaning('Passed')).toContain('not that the control passed');
    expect(assessmentMeaning('Pass')).not.toContain('evidence');
  });

  it('say what a finished test still needs from the reader', () => {
    expect(executionMeaning('Completed')).toBe('The test finished.');
    expect(assessmentMeaning('Pending Confirmation')).toContain('Your review');
    expect(pendingAssessmentSentence(1)).toBe('1 of the agent’s assessments needs your confirmation.');
    expect(pendingAssessmentSentence(3)).toBe('3 of the agent’s assessments need your confirmation.');
  });

  it('name the three questions, not the three tables', () => {
    expect(Object.values(STATUS_COLUMN_WORDS)).toEqual(['Execution', 'Assessment', 'Evidence checks']);
  });
});
