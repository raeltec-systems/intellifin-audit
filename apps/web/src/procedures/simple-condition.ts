import {
  findProcedureTemplate,
  parseCompliancePredicate,
  templateConditionText,
  type BoundarySemantics,
  type CompliancePredicate,
  type TemplateId,
} from '@intellifin/domain';

/**
 * Reading and writing a Compliance Rule condition in business language.
 *
 * The Compliance Rule is ONE string — `ComplianceConditionInput.text` — and the compiler
 * is the only thing that gives it meaning. This module does not add a second
 * representation beside it: it READS that string into the controls a simple editor can
 * show, and WRITES the controls back into a string the same compiler accepts. Switching
 * modes therefore cannot lose or reinterpret anything, because there is nothing else to
 * switch to. A text this module cannot read is not an error: it is a text the simple
 * controls cannot express, and the editor stays in advanced mode and says so.
 *
 * Every write is VERIFIED by re-reading it (`writeSimpleCondition` returns `null` when
 * the round trip disagrees), rather than by a character rule about which values can be
 * quoted. A rule that decided that by hand would be a second, quietly divergent copy of
 * the compiler's own tokenizer — and the values here are typed by a person, so the first
 * value nobody thought of is the one that would have broken it.
 *
 * Nothing here normalizes a value. Compiler 1 compares named-set members as EXACT
 * strings and corroboration permits no case folding, so `Disabled` and `disabled` are
 * two different statuses; the author chooses which one their Target System displays, and
 * this module carries it through byte for byte.
 */

/** The shapes the simple editor can show. Anything else stays in advanced mode. */
export type SimpleCondition =
  | {
      readonly kind: 'status-set';
      /** The declared Observation field the values are read from. */
      readonly field: string;
      /** `found = false or …` — a proven absence counts as Compliant. */
      readonly provenAbsence: boolean;
      readonly compliant: readonly string[];
      readonly exception: readonly string[];
    }
  | {
      readonly kind: 'disablement-window';
      readonly hours: string;
      readonly boundary: BoundarySemantics;
    };

/**
 * The disablement-window form, as compiler 1 recognizes it.
 *
 * The domain owns the authoritative copy inside `compileComplianceDraft` and does not
 * export it. This is the one copy in `apps/web`: `ComplianceRuleForm` had its own
 * inline duplicate, which is now this constant.
 */
export const DISABLEMENT_WINDOW_PATTERN =
  /^disabled_time\s*-\s*termination_time\s*(<=|<)\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?)h$/;

/** Words the compiler's grammar reserves; a value spelled as one must be quoted. */
const RESERVED = ['and', 'or', 'not', 'in', 'else', 'true', 'false', 'all', 'records'];

/** Why the simple editor is unavailable for this condition. Shown beside advanced mode. */
export const SIMPLE_UNAVAILABLE =
  'This condition is written in a form the simple editor cannot show, so it is shown as text. Editing the text here changes exactly what the rule says; the simple editor returns when the text is a status list or a disablement window again.';

/** Said when a typed value cannot be written into the rule text at all. */
export const VALUE_NOT_EXPRESSIBLE =
  'A status value cannot contain a line break, a tab or a control character. Remove it, or write this condition in advanced mode.';

/** Said above the two value lists, because exact matching is the rule and it surprises people. */
export const EXACT_VALUE_SENTENCE =
  'Values are compared EXACTLY, including capital letters: a Target System that displays "Disabled" does not match "disabled". Type each value as that system shows it. A status in neither list leaves the record Unevaluated rather than guessed.';

function isStatusSetPredicate(
  predicate: CompliancePredicate,
): { readonly field: string; readonly compliant: readonly string[]; readonly exception: readonly string[] } | null {
  return predicate.kind === 'named-set'
    ? { field: predicate.field, compliant: predicate.compliant, exception: predicate.exception }
    : null;
}

/** `found = false or <named-set>`, in that order — the proven-absence form. */
function isAbsenceOrStatusSet(predicate: CompliancePredicate): SimpleCondition | null {
  if (predicate.kind !== 'any' || predicate.expressions.length !== 2) return null;
  const [first, second] = predicate.expressions;
  if (first === undefined || second === undefined) return null;
  if (first.kind !== 'boolean' || first.field !== 'found' || first.value !== false) return null;
  const set = isStatusSetPredicate(second);
  return set === null ? null : { kind: 'status-set', provenAbsence: true, ...set };
}

function fromPredicate(predicate: CompliancePredicate): SimpleCondition | null {
  const absence = isAbsenceOrStatusSet(predicate);
  if (absence !== null) return absence;
  const set = isStatusSetPredicate(predicate);
  return set === null ? null : { kind: 'status-set', provenAbsence: false, ...set };
}

/**
 * Read a condition's authored text as simple controls, or `null` when it has no simple
 * form.
 *
 * The Template's own pre-fill is PROSE, not an expression — the compiler recognizes it
 * by equality and uses the rule frozen beside it — so the prose is matched first and
 * read out of that frozen rule. Nothing is written back for it: opening the simple
 * editor on a Template default and changing nothing leaves the authored prose exactly as
 * the Template wrote it.
 */
export function readSimpleCondition(
  text: string,
  templateId: TemplateId,
  conditionId: string,
): SimpleCondition | null {
  const templateCondition = findProcedureTemplate(templateId).conditions.find(
    (candidate) => candidate.conditionId === conditionId,
  );
  if (templateCondition !== undefined && text === templateConditionText(templateCondition)) {
    const rule = templateCondition.rule;
    if (rule?.kind === 'predicate') return fromPredicate(rule.predicate);
    return null;
  }

  const window = DISABLEMENT_WINDOW_PATTERN.exec(text.trim());
  if (window) {
    return {
      kind: 'disablement-window',
      hours: window[2]!,
      boundary: window[1] === '<=' ? 'inclusive' : 'exclusive',
    };
  }

  const predicate = parseCompliancePredicate(text, templateId);
  return predicate === null ? null : fromPredicate(predicate);
}

/** One value as the grammar accepts it: a bare token where it can be, a quoted string otherwise. */
function valueToken(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) && !RESERVED.includes(value)
    ? value
    : JSON.stringify(value);
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCondition(left: SimpleCondition, right: SimpleCondition): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'disablement-window' && right.kind === 'disablement-window') {
    return left.hours === right.hours && left.boundary === right.boundary;
  }
  if (left.kind === 'status-set' && right.kind === 'status-set') {
    return (
      left.field === right.field &&
      left.provenAbsence === right.provenAbsence &&
      sameValues(left.compliant, right.compliant) &&
      sameValues(left.exception, right.exception)
    );
  }
  return false;
}

/**
 * Write simple controls back into condition text — or `null` when the result would not
 * read back as the same thing.
 *
 * The verification is a real round trip through {@link readSimpleCondition}, so a value
 * the compiler's tokenizer cannot carry (a line break, a tab, a control character) is
 * refused HERE rather than saved as something else. `conditionId` is passed so the round
 * trip is judged the way the editor will read it back.
 */
export function writeSimpleCondition(
  value: SimpleCondition,
  templateId: TemplateId,
  conditionId: string,
): string | null {
  let text: string;
  if (value.kind === 'disablement-window') {
    text = `disabled_time - termination_time ${value.boundary === 'inclusive' ? '<=' : '<'} ${value.hours}h`;
  } else {
    if (value.compliant.length === 0 || value.exception.length === 0) return null;
    if (value.compliant.some((entry) => value.exception.includes(entry))) return null;
    const set = `${value.field} in [${value.compliant.map(valueToken).join(', ')}] else [${value.exception.map(valueToken).join(', ')}]`;
    text = value.provenAbsence ? `found = false or ${set}` : set;
  }
  const read = readSimpleCondition(text, templateId, conditionId);
  return read !== null && sameCondition(read, value) ? text : null;
}

/** Said when a list the rule needs is empty. */
export const LISTS_INCOMPLETE =
  'Name at least one value that counts as Compliant and one that counts as an Exception. A rule with an empty list decides nothing.';

/** Said when one value is claimed by both lists. The compiler refuses it outright. */
export const VALUE_IN_BOTH_LISTS =
  'A value cannot be both Compliant and an Exception. Remove it from one of the two lists.';

/**
 * Why these status values cannot be written into the rule yet, or `null` when they can.
 *
 * The sentence lives here beside {@link writeSimpleCondition} so the editor cannot show
 * a reason that disagrees with the refusal it came from.
 */
export function statusSetProblem(
  value: SimpleCondition & { readonly kind: 'status-set' },
  templateId: TemplateId,
  conditionId: string,
): string | null {
  if (value.compliant.length === 0 || value.exception.length === 0) return LISTS_INCOMPLETE;
  if (value.compliant.some((entry) => value.exception.includes(entry))) return VALUE_IN_BOTH_LISTS;
  return writeSimpleCondition(value, templateId, conditionId) === null ? VALUE_NOT_EXPRESSIBLE : null;
}

/** One value per line. Blank lines are typing room, never values; nothing is trimmed away but surrounding whitespace. */
export function valueLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
