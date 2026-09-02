import {
  DECLARED_COUNT_MECHANISMS,
  POPULATION_SOURCE_KINDS,
  type DeclaredCountMechanism,
  type PopulationSourceKind,
} from '@intellifin/domain';
import { BINDING_STATUSES, type BindingStatus } from '@intellifin/application';

/**
 * How the interface writes the Population Source binding vocabularies.
 *
 * The vocabularies themselves come from `@intellifin/domain` and
 * `@intellifin/application`, so a kind or a mechanism added there appears here without
 * anybody remembering to add it — and one removed there stops being offerable. Only the
 * labels are ours: `read-only-api` is a stored value, "Read-only API" is what a person
 * reads.
 *
 * Every lookup below uses `Object.hasOwn`. These records are indexed by values that
 * arrive from a `<select>` or from a database row, and a plain lookup would inherit
 * `Object.prototype.toString` for the key `toString` and render a function. That class of
 * bug has now appeared five times in this repository, which is why it is a rule in
 * CLAUDE.md rather than a comment.
 */

export const BINDING_KIND_LABELS: Readonly<Record<PopulationSourceKind, string>> = {
  'manual-upload': 'Manual upload',
  'versioned-file': 'Versioned file',
  'read-only-api': 'Read-only API',
};

export const UNKNOWN_LABEL = 'Unrecognized value';

export function bindingKindLabel(value: string): string {
  return Object.hasOwn(BINDING_KIND_LABELS, value)
    ? BINDING_KIND_LABELS[value as PopulationSourceKind]
    : UNKNOWN_LABEL;
}

/**
 * How the count mechanism reads.
 *
 * `none` is written as a statement of absence rather than as a blank or a dash: a reader
 * takes an empty cell for "fine", and this is the one value that stops every Procedure
 * bound to this source from being submitted.
 */
export const MECHANISM_LABELS: Readonly<Record<DeclaredCountMechanism, string>> = {
  'cover-sheet': 'Signed cover sheet',
  'count-endpoint': 'Count endpoint',
  none: 'None declared',
};

export function mechanismLabel(value: string): string {
  return Object.hasOwn(MECHANISM_LABELS, value)
    ? MECHANISM_LABELS[value as DeclaredCountMechanism]
    : UNKNOWN_LABEL;
}

export const BINDING_STATUS_LABELS: Readonly<Record<BindingStatus, string>> = {
  active: 'Active',
  retired: 'Retired',
};

export function bindingStatusLabel(value: string): string {
  return Object.hasOwn(BINDING_STATUS_LABELS, value)
    ? BINDING_STATUS_LABELS[value as BindingStatus]
    : UNKNOWN_LABEL;
}


export interface Option {
  readonly value: string;
  readonly label: string;
}

export const BINDING_KIND_OPTIONS: readonly Option[] = POPULATION_SOURCE_KINDS.map((kind) => ({
  value: kind,
  label: BINDING_KIND_LABELS[kind],
}));

export const MECHANISM_OPTIONS: readonly Option[] = DECLARED_COUNT_MECHANISMS.map(
  (mechanism) => ({ value: mechanism, label: MECHANISM_LABELS[mechanism] }),
);

export const BINDING_STATUS_OPTIONS: readonly Option[] = BINDING_STATUSES.map((status) => ({
  value: status,
  label: BINDING_STATUS_LABELS[status],
}));

/** `true` for the one mechanism that stops every Procedure bound to this source. */
export function declaresNoCount(mechanism: string): boolean {
  return mechanism === 'none';
}

/** A textarea holds one value per line. Blank lines are not values. */
export function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function listToLines(values: readonly string[]): string {
  return values.join('\n');
}

