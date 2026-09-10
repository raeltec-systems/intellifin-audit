import {
  FREQUENCIES,
  type DraftSchedule,
  type Frequency,
  type DraftSectionHeading,
} from '@intellifin/domain';
import type { ProcedureVersionView } from '@intellifin/application';

/**
 * One line per Builder section saying what is set, so a closed section still tells the
 * reader something.
 *
 * The Builder used to render nine open forms at once, which is nine questions asked
 * simultaneously of somebody who came to answer one. A section that can be closed has
 * to be able to say what is inside it without being opened, or closing it is just
 * hiding: "Records to test — LoanCore leavers export, 2 filters" is a sentence somebody
 * can act on; an empty grey bar is not.
 *
 * Everything here is DERIVED from the Draft the page already has. It reads no Template,
 * compiles nothing and stores nothing, so a summary can never disagree with the section
 * beneath it — the `AgentSummary` discipline, one altitude down.
 */

/**
 * Whether a section still needs the auditor.
 *
 * `todo` means the Draft cannot run without this and it is not set. `attention` means it
 * is set but something about it will stop the Run producing anything useful, which is
 * advice, not a refusal — the same distinction `procedureReadiness` draws and never
 * blocks a save with. `done` means it is set.
 */
export type SectionState = 'done' | 'todo' | 'attention' | 'reference';

export interface SectionSummary {
  readonly state: SectionState;
  /** One line, plain words, describing what is currently set. */
  readonly line: string;
}

const FREQUENCY_WORDS: Readonly<Record<Frequency, string>> = {
  once: 'Once, over the period above',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

/** `Every week at 00:00 UTC`, or the honest absence. */
export function scheduleLine(schedule: DraftSchedule | null): string {
  if (schedule === null) return 'Not set';
  // `Object.hasOwn` is unnecessary here — `frequency` is validated by `isDraftSchedule`
  // before it can reach a row — but the lookup is still written over a typed record so
  // an added frequency fails to compile rather than rendering `undefined at 00:00 UTC`.
  const word = FREQUENCIES.includes(schedule.frequency)
    ? FREQUENCY_WORDS[schedule.frequency]
    : 'Unknown frequency';
  return schedule.frequency === 'once' ? word : `${word} at ${schedule.startTime} UTC`;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A short, readable date. The Period is date-only in UTC, so no time is shown. */
function day(iso: string): string {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (parsed === null) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(parsed[2]) - 1];
  return month === undefined ? iso : `${Number(parsed[3])} ${month} ${parsed[1]}`;
}

/**
 * The plain summary for one section.
 *
 * `reference` is the two sections the Template writes: they are not a step anybody has
 * to take, so they never carry a "to do" marker and never count against the progress
 * line. Every other section answers a question, and its state says whether it has been
 * answered.
 */
export function sectionSummary(
  heading: DraftSectionHeading,
  draft: ProcedureVersionView,
): SectionSummary {
  switch (heading) {
    case 'Control':
    case 'Objective':
      return { state: 'reference', line: 'Set by the Template. Read it before you start.' };

    case 'Period and scope': {
      if (draft.period === null || draft.scope.trim() === '') {
        return { state: 'todo', line: 'Not set' };
      }
      return {
        state: 'done',
        line: `${day(draft.period.from)} to ${day(draft.period.to)}, UTC. ${draft.scope.trim()}`,
      };
    }

    case 'Population Source binding': {
      if (draft.sourceSnapshot === null) return { state: 'todo', line: 'No source chosen' };
      const filters = draft.inclusionRule.all.length;
      const which = filters === 0 ? 'every record' : `records matching ${count(filters, 'filter')}`;
      const line = `${draft.sourceSnapshot.displayName} — testing ${which}`;
      return {
        state:
          draft.sourceSnapshot.contract.declared_count_mechanism === 'none' ? 'attention' : 'done',
        line,
      };
    }

    case 'Target System selection': {
      if (draft.targets.length === 0) return { state: 'todo', line: 'No system chosen' };
      return {
        state: draft.targetBlockers.length === 0 ? 'done' : 'attention',
        line: draft.targets.map((target) => target.displayName).join(', '),
      };
    }

    case 'Audit Instructions': {
      const written = draft.instructions.filter((entry) => entry.text.trim() !== '').length;
      // Instructions are optional: a system the agent drives can be audited from the
      // Compliance Rule alone. An absent instruction is therefore not a "to do", and
      // marking it one would put a permanent red mark on a complete Draft.
      return written === 0
        ? { state: 'done', line: 'None written. The agent follows the Compliance Rule.' }
        : { state: 'done', line: `Written for ${count(written, 'system')}` };
    }

    case 'Compliance Rule conditions': {
      const rules = draft.complianceConditions.length;
      if (rules === 0) return { state: 'todo', line: 'No rule set' };
      return { state: 'done', line: count(rules, 'rule') };
    }

    case 'Evidence Requirements': {
      const items = draft.evidenceRequirements.length;
      if (items === 0) return { state: 'todo', line: 'Nothing captured' };
      return {
        state: 'done',
        line: draft.evidenceRequirements.map((requirement) => requirement.attributeName).join(', '),
      };
    }

    case 'Schedule': {
      if (draft.schedule === null) return { state: 'todo', line: 'Not set' };
      return {
        state: draft.evidenceBlockers.length === 0 ? 'done' : 'attention',
        line: scheduleLine(draft.schedule),
      };
    }
  }
}

/** How many of the steps somebody has to take are answered, and how many there are. */
export function builderProgress(
  headings: readonly DraftSectionHeading[],
  draft: ProcedureVersionView,
): { readonly done: number; readonly total: number } {
  const steps = headings
    .map((heading) => sectionSummary(heading, draft))
    .filter((summary) => summary.state !== 'reference');
  return { done: steps.filter((summary) => summary.state !== 'todo').length, total: steps.length };
}
