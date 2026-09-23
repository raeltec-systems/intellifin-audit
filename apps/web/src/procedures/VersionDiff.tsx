import { ExecutablePlanSchema } from '@intellifin/domain';
import { ACTION_LABELS } from './plan-step-labels';
import { frozenFieldAbsentWord, frozenFieldWord } from '../design/plain-words';
import type { JsonValue, VersionSectionDiff } from '@intellifin/domain';
function Value({ value }: { value: JsonValue }): React.JSX.Element {
  if (value === null) return <span>Not set</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value !== 'object') return <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value === 'RULE' ? 'Rule-Classified' : value === 'AGENT_JUDGED' ? 'Agent-Judged' : String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ul className="ls-stack">{value.map((entry,index) => <li key={index}><Value value={entry} /></li>)}</ul> : <span>None</span>;
  return <dl className="ls-stack">{Object.entries(value).map(([key,entry]) => <div key={key}><dt><strong>{frozenFieldWord(key)}</strong></dt><dd><FieldValue field={key} value={entry} /></dd></div>)}</dl>;
}
/**
 * One frozen field, with the sentence its ABSENCE deserves when it has one.
 *
 * "Not set" is right for a field somebody could have filled. It was wrong for `model`,
 * which is unset until a platform configuration revision publishes one — the owner read
 * "Model: Not set" next to a writing assistant that had just worked and took the two for
 * the same model. The sentence lives in `plain-words.ts`, so this stays the renderer.
 */
function FieldValue({ field, value }: { field: string; value: JsonValue }): React.JSX.Element {
  const absent = value === null ? frozenFieldAbsentWord(field) : null;
  return absent === null ? <Value value={value} /> : <span data-absent-field={field}>{absent}</span>;
}
function PlanSteps({ value }: { value: JsonValue }): React.JSX.Element {
  if (value === null) return <p>No previous executable plan.</p>;
  const parsed = ExecutablePlanSchema.safeParse(value);
  if (!parsed.success) return <p>The previous executable plan could not be verified.</p>;
  const plan = parsed.data;
  const steps = (entries: typeof plan.sessionSteps) => <ol>{entries.map(step => <li key={step.id}><strong>{ACTION_LABELS[step.action]}</strong><p>{step.text}</p>{step.targetSystemId ? <p>Target System: {plan.inputs.targets.find(target => target.registrationId === step.targetSystemId)?.displayName ?? step.targetSystemId}</p> : null}</li>)}</ol>;
  return <div className="ls-stack"><h5>Session Steps</h5>{steps(plan.sessionSteps)}{plan.targetSystems.map(target => <section key={target.registrationId}><h5>{plan.inputs.targets.find(entry => entry.registrationId === target.registrationId)?.displayName ?? target.registrationId}</h5>{steps(target.planSteps)}</section>)}</div>;
}

/** What the section summary says about one stored section, per side of the comparison. */
export const DIFF_WORDS = { first: 'New', changed: 'Changed', unchanged: 'Unchanged' } as const;

/** The heading this section carries where a page gives it one. */
export const DIFF_HEADING = 'The stored section-by-section comparison';

/**
 * The stored diff, exactly as the version froze it.
 *
 * This is provenance, not the decision: the walkthrough's rule is to move implementation
 * detail into a deliberate technical view rather than delete it, so every section keeps
 * both of its frozen sides here while `WhatChanged` says, in words, what somebody
 * actually changed. The page renders it inside the one Technical details disclosure.
 *
 * A FIRST version's stored sections are all marked `changed` — `diffReviewedDefinitions`
 * writes that for a review with no baseline, and `isConsistentVersionReview` requires it
 * — so saying "Changed" there told an approver that fourteen sections had been changed by
 * somebody on a version with no predecessor at all. A first version's sections are NEW,
 * and every section starts closed: a first version used to force all fourteen open, which
 * is most of what made this page 13,887px tall.
 */
export function VersionDiff({ diff, first, headingId }: { readonly diff: readonly VersionSectionDiff[]; readonly first: boolean; readonly headingId?: string }): React.JSX.Element {
  const labelled = headingId === undefined ? { 'aria-label': DIFF_HEADING } : { 'aria-labelledby': headingId };
  return <section className="ls-stack" {...labelled} data-version-diff>
    {headingId === undefined ? null : <h3 className="ls-overline" id={headingId}>{DIFF_HEADING}</h3>}
    {diff.map(section => <details key={section.section}><summary>{section.section} · {first ? DIFF_WORDS.first : section.changed ? DIFF_WORDS.changed : DIFF_WORDS.unchanged}</summary>
    <div className="ls-stack">{!first ? <section><h4>Previous</h4>{section.section === 'Executable plan' ? <PlanSteps value={section.before} /> : <Value value={section.before} />}</section> : null}<section><h4>Submitted for review</h4>{section.section === 'Executable plan' ? <PlanSteps value={section.after} /> : <Value value={section.after} />}</section></div>
  </details>)}</section>;
}
