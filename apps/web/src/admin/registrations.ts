import {
  PERMITTED_READ_ACTIONS,
  TARGET_SYSTEM_KINDS,
  type PermittedReadAction,
  type TargetSystemKind,
} from '@intellifin/domain';
import type { ConnectivityState, RegistrationStatus } from '@intellifin/application';

/**
 * How the interface writes the registration vocabularies.
 *
 * The vocabularies themselves come from `@intellifin/domain` and
 * `@intellifin/application`, so a kind or an action added there appears here without
 * anybody remembering to add it — and one removed there stops being offerable. Only the
 * labels are ours: `versioned-file` is a stored value, "Versioned file" is what a person
 * reads.
 *
 * Every lookup below uses `Object.hasOwn`. These records are indexed by values that
 * arrive from a `<select>`, a checkbox, or a database row, and a plain lookup would
 * inherit `Object.prototype.toString` for the key `toString` and render a function.
 * That class of bug has now appeared five times in this repository.
 */

export const KIND_LABELS: Readonly<Record<TargetSystemKind, string>> = {
  web: 'Web',
  desktop: 'Desktop',
  api: 'API',
  'versioned-file': 'Versioned file',
};

export const UNKNOWN_LABEL = 'Unrecognized value';

export function kindLabel(value: string): string {
  return Object.hasOwn(KIND_LABELS, value)
    ? KIND_LABELS[value as TargetSystemKind]
    : UNKNOWN_LABEL;
}

export const ACTION_LABELS: Readonly<Record<PermittedReadAction, string>> = {
  navigate: 'Navigate',
  search: 'Search',
  'list-records': 'List records',
  'open-record': 'Open a record',
  'read-attribute': 'Read an attribute',
  'read-metadata': 'Read metadata',
  'read-file': 'Read a file',
  'capture-screenshot': 'Capture a screenshot',
};

export function actionLabel(value: string): string {
  return Object.hasOwn(ACTION_LABELS, value)
    ? ACTION_LABELS[value as PermittedReadAction]
    : UNKNOWN_LABEL;
}

export const STATUS_LABELS: Readonly<Record<RegistrationStatus, string>> = {
  active: 'Active',
  retired: 'Retired',
};

export function statusLabel(value: string): string {
  return Object.hasOwn(STATUS_LABELS, value)
    ? STATUS_LABELS[value as RegistrationStatus]
    : UNKNOWN_LABEL;
}

/**
 * What the connectivity column says.
 *
 * "Never probed" is a statement about this deployment, not a placeholder: the web
 * process does not contact a Target System at all, and the worker has nothing to probe
 * until the synthetic Northstar systems exist. A dash or an empty cell would let a
 * reader take it for "fine".
 */
export const CONNECTIVITY_LABELS: Readonly<Record<ConnectivityState, string>> = {
  'never-probed': 'Never probed',
  reachable: 'Reachable',
  unreachable: 'Unreachable',
};

export function connectivityLabel(value: string): string {
  return Object.hasOwn(CONNECTIVITY_LABELS, value)
    ? CONNECTIVITY_LABELS[value as ConnectivityState]
    : UNKNOWN_LABEL;
}

/** The sentence under a never-probed cell. It says why, so nobody reads it as a pass. */
export const NEVER_PROBED_SENTENCE =
  'No worker has observed this system yet. This page never contacts a Target System.';

export interface Option {
  readonly value: string;
  readonly label: string;
}

export const KIND_OPTIONS: readonly Option[] = TARGET_SYSTEM_KINDS.map((kind) => ({
  value: kind,
  label: KIND_LABELS[kind],
}));

export const ACTION_OPTIONS: readonly Option[] = PERMITTED_READ_ACTIONS.map((action) => ({
  value: action,
  label: ACTION_LABELS[action],
}));

export const STATUS_OPTIONS: readonly Option[] = (['active', 'retired'] as const).map(
  (status) => ({ value: status, label: STATUS_LABELS[status] }),
);

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

/** The first eight characters of a digest, for a table cell. The full value is on the row. */
export function shortDigest(digest: string): string {
  return digest.slice(0, 12);
}
