import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  INITIATE_RUN_ANCHOR,
  initiateRunHref,
  NO_AUTOMATIC_RUNS_SENTENCE,
  plannedFrequencyLine,
  RUN_STARTS_ON_CONFIRM_SENTENCE,
  SCHEDULE_NOT_SAVED_LINE,
  SCHEDULE_TIME_STARTS_NOTHING_SENTENCE,
  START_RUN_LINK_LABEL,
} from './run-start-words';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** The four surfaces that say how a Run starts. */
const SURFACES = {
  'the Initiate Run box': '../runs/InitiateRunForm.tsx',
  'the Schedule step': '../procedures/EvidenceScheduleForm.tsx',
  'the Review step': '../procedures/DraftBuilder.tsx',
  'the Active version card': '../procedures/VersionStatus.tsx',
} as const;

const SENTENCES = [
  RUN_STARTS_ON_CONFIRM_SENTENCE,
  NO_AUTOMATIC_RUNS_SENTENCE,
  SCHEDULE_TIME_STARTS_NOTHING_SENTENCE,
  START_RUN_LINK_LABEL,
];

describe('initiateRunHref', () => {
  it('lands on the Initiate Run box', () => {
    expect(initiateRunHref('p-1')).toBe(`/procedures/p-1#${INITIATE_RUN_ANCHOR}`);
  });

  it('carries a suggested period as the query the Procedure page reads', () => {
    expect(initiateRunHref('p-1', { from: '2026-08-01', to: '2026-08-31' })).toBe(
      `/procedures/p-1?from=2026-08-01&to=2026-08-31#${INITIATE_RUN_ANCHOR}`,
    );
  });

  it('names the box the form actually renders, spelled once', () => {
    // A renamed box would otherwise leave every link to it landing at the top of the
    // page with nothing saying so. The form sets its `id` from the constant, and its
    // lost-response retry link is built the same way.
    const form = read(SURFACES['the Initiate Run box']);
    expect(form).toContain('id={INITIATE_RUN_ANCHOR}');
    expect(form).not.toContain('"initiate-run"');
    expect(form).not.toContain('#initiate-run');
  });

  it('links the Review step and the Active version card through it', () => {
    for (const surface of ['the Review step', 'the Active version card'] as const) {
      expect(read(SURFACES[surface]), surface).toContain('initiateRunHref(');
    }
  });
});

describe('the run-start sentences', () => {
  it.each(Object.entries(SURFACES))('%s reads them from this module', (_surface, path) => {
    expect(read(path)).toContain("from '../design/run-start-words'");
  });

  it.each(SENTENCES)('is nowhere retyped: %s', (sentence) => {
    // A sentence typed inline in a component drifts from the other three the first time
    // one of them is reworded.
    for (const [surface, path] of Object.entries(SURFACES)) {
      expect(read(path), surface).not.toContain(sentence);
    }
  });

  it('says a Run starts on confirmation and that nothing runs by itself', () => {
    expect(RUN_STARTS_ON_CONFIRM_SENTENCE).toContain('as soon as you confirm');
    expect(NO_AUTOMATIC_RUNS_SENTENCE).toContain('Nothing runs by itself');
    expect(SCHEDULE_TIME_STARTS_NOTHING_SENTENCE).toContain('does not start a Run');
  });
});

/**
 * UX-14: the saved frequency read as a plan, on the Procedure page's version card and
 * on the Schedule step's own readback — the same words in both places.
 */
describe('the saved frequency is read as a plan, never a promise', () => {
  it.each(['once', 'daily', 'weekly', 'monthly'] as const)('names %s and says nothing runs by itself', (frequency) => {
    const line = plannedFrequencyLine(frequency);
    expect(line).toBe(`Planned: ${frequency} (nothing runs by itself yet)`);
    expect(line).toContain('nothing runs by itself');
  });

  it('has a distinct sentence for no saved Schedule at all', () => {
    expect(SCHEDULE_NOT_SAVED_LINE.length).toBeGreaterThan(0);
    expect(SCHEDULE_NOT_SAVED_LINE).not.toBe(plannedFrequencyLine('weekly'));
  });

  it.each([
    ['the Procedure page version card', '../../app/procedures/[id]/page.tsx'],
    ['the Schedule step', '../procedures/EvidenceScheduleForm.tsx'],
  ] as const)('%s reads the frequency line from this module, never retyping it', (_surface, path) => {
    const source = read(path);
    expect(source).toContain('plannedFrequencyLine');
    expect(source).not.toContain('nothing runs by itself yet)');
  });
});
