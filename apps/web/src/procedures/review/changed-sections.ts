import {
  isDraftSchedule,
  isEvidenceRequirement,
  isInclusionRule,
  isProcedureSourceSnapshot,
  isProcedureTargetSnapshot,
  type JsonValue,
  type TemplateId,
  type VersionSectionDiff,
} from '@intellifin/domain';

import { SECTION_WORDS, TARGET_KIND_WORDS } from '../../design/plain-words';
import { conditionSentence } from '../condition-words';
import {
  evidenceWords,
  filterSentences,
  periodWords,
  plannedFrequencyWords,
  sourceFacts,
  type ReviewFact,
} from './decision-summary';
import { NOT_SET, NO_ADDRESS_SENTENCE, SUMMARY_LABELS, readActionWord, templateWords } from './review-words';

/**
 * What changed between the version under review and the one before it
 * (UI cleanup 2026-09-22, UX-33).
 *
 * The stored `VersionSectionDiff` carries two whole frozen structures per section and a
 * `changed` flag, and the old surface rendered both as nested definition lists — every
 * key of every envelope, for fourteen sections, expanded. An approver comparing two
 * versions wants to know what somebody CHANGED, which is a much shorter list: this reads
 * both sides into the same labelled facts the decision summary uses, and reports only the
 * facts whose words differ.
 *
 * A first version has no predecessor at all. The stored diff marks every one of its
 * sections `changed: true` — `isConsistentVersionReview` requires exactly that of a review
 * with no baseline — so nothing here may read that flag for a first version.
 */

/** The frozen sections that are a CONSEQUENCE of the authored ones, not an authored choice. */
export const TECHNICAL_DIFF_SECTIONS: readonly string[] = [
  'Executable plan',
  'Model and tool configuration',
  'Limits',
];

/** Said where a fact exists on only one side of the comparison. */
export const NOT_IN_PREVIOUS = 'Not in the previous version';
export const NOT_IN_THIS = 'Not in this version';

/** One fact that differs, as the words on each side. */
export interface FactChange {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/** One authored section that differs, and the facts inside it that do. */
export interface SectionChange {
  readonly section: string;
  readonly title: string;
  readonly facts: readonly FactChange[];
}

/**
 * The diff section names, mapped to the Builder's own titles.
 *
 * The domain's `sections()` keys and `DRAFT_SECTION_HEADINGS` are two vocabularies for
 * some of the same sections (`Target Systems` against `Target System selection`), so this
 * is the join. The three sections with no Builder step carry their own title, because
 * there is no auditor question they answer.
 */
const SECTION_HEADING: Readonly<Record<string, keyof typeof SECTION_WORDS>> = {
  Risk: 'Risk',
  'Criterion reference': 'Criterion reference',
  Control: 'Control',
  Objective: 'Objective',
  'Period and scope': 'Period and scope',
  'Population Source binding': 'Population Source binding',
  'Target Systems': 'Target System selection',
  'Audit Instructions': 'Audit Instructions',
  'Compliance Rule': 'Compliance Rule conditions',
  'Evidence Requirements': 'Evidence Requirements',
  Schedule: 'Schedule',
};

const TECHNICAL_TITLE: Readonly<Record<string, string>> = {
  'Executable plan': 'The step-by-step plan',
  'Model and tool configuration': 'Model and tool configuration',
  Limits: 'When it stops on its own',
};

/**
 * The title one diff section is shown under.
 *
 * `Object.hasOwn` on both tables: the section name arrives from a stored frozen review,
 * so a plain index would answer `'constructor'` with an inherited function. A section
 * name this build does not recognise keeps its own spelling, which is honest about what
 * the row holds.
 */
export function sectionTitle(section: string): string {
  if (Object.hasOwn(SECTION_HEADING, section)) return SECTION_WORDS[SECTION_HEADING[section]!].title;
  if (Object.hasOwn(TECHNICAL_TITLE, section)) return TECHNICAL_TITLE[section]!;
  return section;
}

function object(value: JsonValue): Readonly<Record<string, JsonValue>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null;
}

function at(value: JsonValue, key: string): JsonValue {
  const record = object(value);
  return record !== null && Object.hasOwn(record, key) ? record[key]! : null;
}

function text(value: JsonValue): string {
  if (value === null) return NOT_SET;
  if (typeof value === 'string') return value.trim() === '' ? NOT_SET : value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return NOT_SET;
}

/** Registration id to display name, taken from whichever side of the diff names it. */
export function systemNames(diff: readonly VersionSectionDiff[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const section = diff.find((entry) => entry.section === 'Target Systems');
  for (const side of [section?.before, section?.after]) {
    if (!Array.isArray(side)) continue;
    for (const entry of side) {
      const id = at(entry as JsonValue, 'registrationId');
      const name = at(entry as JsonValue, 'displayName');
      if (typeof id === 'string' && typeof name === 'string') names.set(id, name);
    }
  }
  return names;
}

function nameOf(names: ReadonlyMap<string, string>, id: JsonValue): string {
  return typeof id === 'string' ? (names.get(id) ?? id) : 'Unnamed system';
}

/**
 * One side of one section, as the labelled facts the summary already says in words.
 *
 * Every branch is guarded by the DOMAIN's own validator where one exists, so a stored
 * value this build cannot read falls back to the section's own name rather than being
 * half-read into a sentence that claims more than the row holds.
 */
export function sectionFacts(
  section: string,
  value: JsonValue,
  templateId: TemplateId,
  names: ReadonlyMap<string, string>,
): readonly ReviewFact[] {
  switch (section) {
    case 'Risk':
    case 'Criterion reference':
    case 'Objective':
      return [{ label: sectionTitle(section), value: text(value) }];
    case 'Control':
      return [
        { label: SUMMARY_LABELS.procedureName, value: text(at(value, 'name')) },
        { label: SUMMARY_LABELS.template, value: templateWords(text(at(value, 'templateId'))) },
        { label: SUMMARY_LABELS.controlStatement, value: text(at(value, 'definition')) },
      ];
    case 'Period and scope': {
      const period = at(value, 'period');
      return [
        {
          label: SUMMARY_LABELS.period,
          value:
            typeof at(period, 'from') === 'string' && typeof at(period, 'to') === 'string'
              ? periodWords({ from: at(period, 'from') as string, to: at(period, 'to') as string })
              : NOT_SET,
        },
        { label: SUMMARY_LABELS.scope, value: text(at(value, 'scope')) },
      ];
    }
    case 'Population Source binding': {
      const source = at(value, 'source');
      const rule = at(value, 'inclusionRule');
      const facts: ReviewFact[] = [];
      if (isProcedureSourceSnapshot(source)) {
        facts.push({ label: SUMMARY_LABELS.source, value: source.displayName }, ...sourceFacts(source));
      } else {
        facts.push({ label: SUMMARY_LABELS.source, value: NOT_SET });
      }
      if (isInclusionRule(rule)) {
        facts.push({ label: SUMMARY_LABELS.filters, value: filterSentences(rule).join('; ') });
      }
      facts.push(
        { label: SUMMARY_LABELS.passesEmpty, value: text(at(value, 'zeroRecordPass')) },
        { label: SUMMARY_LABELS.duplicates, value: text(at(value, 'allowVersionedDuplicates')) },
      );
      return facts;
    }
    case 'Target Systems': {
      if (!Array.isArray(value)) return [{ label: sectionTitle(section), value: NOT_SET }];
      return value.filter(isProcedureTargetSnapshot).map((target) => ({
        label: target.displayName,
        value: `${TARGET_KIND_WORDS[target.contract.kind]}; may ${target.contract.permitted_actions.map(readActionWord).join(', ')}; ${target.contract.allowed_origins.join(', ') || NO_ADDRESS_SENTENCE}`,
      }));
    }
    case 'Audit Instructions': {
      if (!Array.isArray(value)) return [{ label: sectionTitle(section), value: NOT_SET }];
      return value.map((entry) => ({
        label: `Instructions for ${nameOf(names, at(entry as JsonValue, 'registrationId'))}`,
        value: text(at(entry as JsonValue, 'text')),
      }));
    }
    case 'Compliance Rule': {
      const conditions = at(value, 'conditions');
      const facts: ReviewFact[] = [
        { label: SUMMARY_LABELS.certainty, value: text(at(value, 'confidenceThreshold')) },
      ];
      if (!Array.isArray(conditions)) return facts;
      for (const entry of conditions) {
        const id = at(entry as JsonValue, 'conditionId');
        const body = at(entry as JsonValue, 'text');
        if (typeof id !== 'string' || typeof body !== 'string') continue;
        facts.push({ label: id, value: conditionSentence(body, templateId, id) ?? body });
      }
      return facts;
    }
    case 'Evidence Requirements': {
      if (!Array.isArray(value)) return [{ label: sectionTitle(section), value: NOT_SET }];
      return value.map((entry) =>
        isEvidenceRequirement(entry)
          ? { label: entry.attributeName, value: evidenceWords(entry) }
          : { label: text(at(entry as JsonValue, 'attributeName')), value: NOT_SET },
      );
    }
    case 'Schedule':
      return [
        {
          label: SUMMARY_LABELS.howOften,
          value: isDraftSchedule(value) ? plannedFrequencyWords(value) : NOT_SET,
        },
      ];
    default:
      return [{ label: sectionTitle(section), value: 'Changed' }];
  }
}

/** The facts of one section that differ, in the submitted version's order. */
export function factChanges(
  section: string,
  before: JsonValue,
  after: JsonValue,
  templateId: TemplateId,
  names: ReadonlyMap<string, string>,
): readonly FactChange[] {
  const previous = new Map(
    sectionFacts(section, before, templateId, names).map((fact) => [fact.label, fact.value]),
  );
  const current = new Map(
    sectionFacts(section, after, templateId, names).map((fact) => [fact.label, fact.value]),
  );
  const changes: FactChange[] = [];
  for (const [label, value] of current) {
    const was = previous.get(label) ?? NOT_IN_PREVIOUS;
    if (was !== value) changes.push({ label, before: was, after: value });
  }
  for (const [label, value] of previous) {
    if (!current.has(label)) changes.push({ label, before: value, after: NOT_IN_THIS });
  }
  return changes;
}

/** Every authored section that differs, and how many changed only in the frozen contract. */
export interface VersionChanges {
  readonly sections: readonly SectionChange[];
  /**
   * How many sections changed with nothing to show in words.
   *
   * Two kinds land here: the three sections that are a CONSEQUENCE of the authored ones
   * (`TECHNICAL_DIFF_SECTIONS`), and an authored section whose only difference is a
   * frozen technical field the summary does not read — a compiler version, a schema
   * version. Counting the second is what stops a changed section being dropped in
   * SILENCE: the sentence beside this number points at Technical details, where the
   * whole stored diff is, rather than leaving a reader with "nothing changed".
   */
  readonly technicalChanged: number;
}

export function versionChanges(
  diff: readonly VersionSectionDiff[],
  templateId: TemplateId,
): VersionChanges {
  const names = systemNames(diff);
  const changed = diff.filter((section) => section.changed);
  const sections: SectionChange[] = [];
  let technicalChanged = 0;
  for (const section of changed) {
    if (TECHNICAL_DIFF_SECTIONS.includes(section.section)) {
      technicalChanged += 1;
      continue;
    }
    const facts = factChanges(section.section, section.before, section.after, templateId, names);
    if (facts.length === 0) technicalChanged += 1;
    else sections.push({ section: section.section, title: sectionTitle(section.section), facts });
  }
  return { sections, technicalChanged };
}
