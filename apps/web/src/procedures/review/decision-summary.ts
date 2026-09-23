import type {
  CompiledComplianceCondition,
  DraftSchedule,
  DraftSectionHeading,
  EvidenceRequirement,
  FrozenPlanInputs,
  InclusionRule,
  ProcedureSourceSnapshot,
  ProcedureTargetSnapshot,
  TemplateId,
} from '@intellifin/domain';

import { readablePeriod } from '../../design/time';
import { countNoun } from '../../design/words';
import {
  COUNT_MECHANISM_WORDS,
  FILTER_COMPARISONS,
  SOURCE_KIND_WORDS,
  TARGET_KIND_WORDS,
  filterComparisonId,
} from '../../design/plain-words';
import { CONDITION_NOT_IN_WORDS, conditionSentence, fieldWords } from '../condition-words';
import { scheduleLine } from '../section-summary';
import {
  NONE,
  NOT_SET,
  NO_FIELDS_SENTENCE,
  NO_FILTERS_SENTENCE,
  SUMMARY_LABELS,
  readActionWord,
} from './review-words';

/**
 * What a manager is deciding about, derived from the version's own frozen inputs
 * (UI cleanup 2026-09-22, UX-33).
 *
 * Every function here READS the frozen authoring inputs and returns words. Nothing is
 * compiled, defaulted or inferred: a summary that could disagree with the contract
 * underneath it would be worse than no summary, because it is the one an approver
 * actually reads before an approval activates a Procedure. The `AgentSummary` discipline,
 * one altitude up.
 *
 * The source is `FrozenPlanInputs` — the exact projection `frozenPlanInputs` takes — so a
 * submitted version reads its submitted review and a version with no review yet reads the
 * same fields off its own row. Both are the same nineteen keys.
 */

/** One labelled fact of the summary. */
export interface ReviewFact {
  readonly label: string;
  readonly value: string;
}

/** The text a Template section carries, or `null` when it carries none. */
export function sectionText(
  inputs: Pick<FrozenPlanInputs, 'sections'>,
  heading: DraftSectionHeading,
): string | null {
  const content = inputs.sections.find((section) => section.heading === heading)?.content ?? null;
  return content === null || content.trim() === '' ? null : content;
}

/** `1–31 Aug 2026`, or the honest absence. The Period is date-only in UTC. */
export function periodWords(period: FrozenPlanInputs['period']): string {
  return period === null ? NOT_SET : readablePeriod(period);
}

/** `employee_id, full_name` → `employee id, full name`: a source's own field names, spaced. */
export function fieldList(fields: readonly string[]): string {
  return fields.length === 0 ? NO_FIELDS_SENTENCE : fields.map(fieldWords).join(', ');
}

/** Where the records come from, said the way the person who set the source up would say it. */
export function sourceFacts(source: ProcedureSourceSnapshot): readonly ReviewFact[] {
  const kind = source.contract.kind;
  const mechanism = source.contract.declared_count_mechanism;
  return [
    { label: SUMMARY_LABELS.arrival, value: SOURCE_KIND_WORDS[kind].label },
    { label: SUMMARY_LABELS.countMechanism, value: COUNT_MECHANISM_WORDS[mechanism].label },
    { label: SUMMARY_LABELS.fields, value: fieldList(source.contract.declared_schema) },
    {
      label: SUMMARY_LABELS.masked,
      value: source.contract.sensitive_fields.length === 0
        ? NONE
        : fieldList(source.contract.sensitive_fields),
    },
  ];
}

/**
 * One inclusion filter, in words: `department is exactly “Finance”`.
 *
 * The comparison label is `FILTER_COMPARISONS`' own — the list the Builder offers — so
 * the sentence an approver reads is the sentence the auditor chose from, and a reworded
 * comparison lands on both at once.
 */
export function filterSentence(predicate: InclusionRule['all'][number]): string {
  const comparison = FILTER_COMPARISONS.find((entry) => entry.id === filterComparisonId(predicate));
  const label = comparison?.label ?? predicate.kind;
  const field = fieldWords(predicate.column);
  return predicate.kind === 'within-period' ? `${field} ${label}` : `${field} ${label} “${predicate.value}”`;
}

/** Which of the source's records are tested, in words. */
export function filterSentences(rule: InclusionRule): readonly string[] {
  return rule.all.length === 0 ? [NO_FILTERS_SENTENCE] : rule.all.map(filterSentence);
}

/** A Target System, its kind, what the agent may do there and where it may go. */
export interface SystemAccess {
  readonly registrationId: string;
  readonly displayName: string;
  readonly kindWord: string;
  /** The registered read actions, in words. */
  readonly actions: readonly string[];
  /** Web addresses, or the desktop application identity — the same frozen slot. */
  readonly reach: readonly string[];
  /** The credential the version names, by reference only. */
  readonly credentialRef: string;
  /** What the auditor told the agent to do here, verbatim, or `null` for none. */
  readonly instruction: string | null;
}

export function systemAccess(
  targets: readonly ProcedureTargetSnapshot[],
  instructions: FrozenPlanInputs['instructions'],
): readonly SystemAccess[] {
  return targets.map((target) => {
    const instruction = instructions.find((entry) => entry.registrationId === target.registrationId);
    const text = instruction?.text.trim() ?? '';
    return {
      registrationId: target.registrationId,
      displayName: target.displayName,
      kindWord: TARGET_KIND_WORDS[target.contract.kind],
      actions: target.contract.permitted_actions.map(readActionWord),
      reach: target.contract.allowed_origins,
      credentialRef: target.contract.credential_ref,
      instruction: text === '' ? null : text,
    };
  });
}

/** A criterion, said in audit language where the shared reader can express it. */
export interface Criterion {
  readonly conditionId: string;
  /** The audit sentence, or `null` for a condition only the rule language can express. */
  readonly sentence: string | null;
  /** What the version approved, verbatim. Shown when there is no sentence. */
  readonly text: string;
  /** Whether the agent judges this one, in which case certainty decides. */
  readonly agentJudged: boolean;
}

export function criteria(
  conditions: readonly CompiledComplianceCondition[],
  templateId: TemplateId,
): readonly Criterion[] {
  return conditions.map((condition) => ({
    conditionId: condition.conditionId,
    sentence: conditionSentence(condition.text, templateId, condition.conditionId),
    text: condition.text,
    agentJudged: condition.status === 'AGENT_JUDGED',
  }));
}

/** What an approver is told beside a criterion the audit reader cannot express. */
export const CRITERION_FALLBACK_SENTENCE = CONDITION_NOT_IN_WORDS;

/** What proof is kept for one captured value, in words rather than flags. */
export function evidenceWords(requirement: EvidenceRequirement): string {
  const parts: string[] = [];
  if (requirement.groundedBy.includes('structural-snapshot')) {
    parts.push('the page structure it was read from');
  }
  if (requirement.groundedBy.includes('source-file-excerpt')) {
    parts.push('the source file it was read from');
  }
  if (requirement.screenshot) parts.push('a screenshot of the page');
  if (requirement.recordingSegment) parts.push('a clip of the session recording');
  if (parts.length === 0) {
    return requirement.modelRead
      ? 'Nothing is kept that matches this value: the agent’s reading is accepted on its own.'
      : 'Nothing is kept that matches this value.';
  }
  const kept = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}`;
  return requirement.modelRead
    ? `Kept: ${kept}. The agent’s reading is accepted without a matching proof.`
    : `Kept: ${kept}.`;
}

/**
 * How often this is MEANT to run.
 *
 * `scheduleLine` is the Builder's own sentence for a saved frequency, read rather than
 * restated. Nothing in this build starts a Run by itself, which is what the sentences in
 * `run-start-words.ts` say beside it.
 */
export function plannedFrequencyWords(schedule: DraftSchedule | null): string {
  return scheduleLine(schedule);
}

/** `3 criteria`, `2 systems` — the counts the summary leads each list with. */
export function reviewCounts(inputs: FrozenPlanInputs): readonly ReviewFact[] {
  return [
    { label: 'Systems', value: countNoun(inputs.targets.length, 'system') },
    { label: 'Criteria', value: countNoun(inputs.complianceConditions.length, 'criterion', 'criteria') },
    {
      label: 'Evidence items',
      value: countNoun(inputs.evidenceRequirements.length, 'evidence item'),
    },
  ];
}
