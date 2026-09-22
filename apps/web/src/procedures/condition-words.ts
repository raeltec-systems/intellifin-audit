import type { TemplateId } from '@intellifin/domain';

import { readSimpleCondition, type SimpleCondition } from './simple-condition';

/**
 * A Compliance Rule condition, said in audit language (UI cleanup 2026-09-21, UX-13,
 * UX-21, UX-24).
 *
 * The walkthrough met `found = false or account_status in [Disabled] else [Active]` as
 * the primary text of the Builder's criteria step, of the Exception view and of the
 * record inspector — the compiler's own grammar, in front of a person who has to explain
 * every condition to somebody else. `readSimpleCondition` already reads that grammar into
 * the shapes the simple editor shows; this turns those shapes into sentences, so the
 * Builder, the Exception and the inspector say ONE thing about a condition, and the
 * compiled text goes under Technical details.
 *
 * A condition the simple reader cannot express (compiler grammar the editor never
 * offered, or free prose the Template pinned) gets `null`, and the caller shows the
 * authored text as what it is — never a sentence this module guessed.
 *
 * Values are quoted EXACTLY. Compiler 1 compares named-set members as exact strings, so
 * `Disabled` and `disabled` are two statuses, and a sentence that lower-cased one would
 * describe a rule the version did not freeze.
 */

/** `account_status` → `account status`; a field name is the source's word, spaced out. */
export function fieldWords(field: string): string {
  return field.replaceAll('_', ' ').trim();
}

function oneOf(values: readonly string[]): string {
  if (values.length === 1) return `“${values[0]}”`;
  if (values.length === 2) return `“${values[0]}” or “${values[1]}”`;
  return `one of ${values.map((value) => `“${value}”`).join(', ')}`;
}

/** The sentence for a shape the simple editor can show. */
export function simpleConditionSentence(condition: SimpleCondition): string {
  if (condition.kind === 'disablement-window') {
    const within = condition.boundary === 'inclusive'
      ? `within ${condition.hours} hours of the termination time (exactly ${condition.hours} hours counts as acceptable)`
      : `in less than ${condition.hours} hours after the termination time`;
    return `Acceptable: the account was disabled ${within}. Exception: it was disabled later than that. A record with no disablement time or no termination time needs review.`;
  }
  const field = fieldWords(condition.field);
  const absence = condition.provenAbsence
    ? 'no record is found after every required search, or '
    : '';
  return `Acceptable: ${absence}the ${field} is ${oneOf(condition.compliant)}. Exception: the ${field} is ${oneOf(condition.exception)}. Any other ${field} needs review.`;
}

/**
 * The sentence for a condition's authored text, or `null` when it has no simple form.
 *
 * `templateId` and `conditionId` are what `readSimpleCondition` needs to recognise a
 * Template's own prose, which the compiler reads through the rule frozen beside it.
 */
export function conditionSentence(
  text: string,
  templateId: TemplateId,
  conditionId: string,
): string | null {
  const simple = readSimpleCondition(text, templateId, conditionId);
  return simple === null ? null : simpleConditionSentence(simple);
}

/** What a surface says beside a condition it cannot put into a sentence. */
export const CONDITION_NOT_IN_WORDS =
  'This criterion is written in the platform’s rule language and is shown as it was approved.';

/**
 * `C2` → `Condition 2` (UX-13, UX-15).
 *
 * A condition id is a stable identifier the compiler freezes; a reader meets it as the
 * number of a condition. Derived from the id itself rather than a list position, so the
 * criteria step, the readiness panel and any later surface call one condition by one name
 * even when a Draft's conditions are C1 and C3. An id outside the `C<n>` shape is quoted
 * as it was saved rather than renumbered.
 */
export function conditionLabel(conditionId: string): string {
  const numbered = /^C(\d+)$/u.exec(conditionId);
  return numbered === null ? `Condition “${conditionId}”` : `Condition ${Number(numbered[1])}`;
}
