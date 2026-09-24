import { adapterSearchKeys, type ExecutablePlan } from '@intellifin/domain';

import { MASKED_VALUE } from '../design/copy';

/**
 * How a Run names one of its source records, and what the frozen binding masks (UX-25).
 *
 * The record KEY is the Template's first frozen lookup column and the NAME is its second,
 * read from `PLAN_LOOKUP_COLUMNS` through `adapterSearchKeys` — P-1 declares `employee_id`
 * and `full_name`; the other Templates declare a key alone. A second table of "which field
 * is a person's name" would agree with the frozen one on every Template anybody tried.
 *
 * Masking is read from the Procedure Version's frozen source snapshot, never from the
 * binding as it stands today (FR-41): a field the binding designates sensitive is shown
 * as `MASKED_VALUE` everywhere a list or an inspector would otherwise print it.
 */
export interface RecordNaming {
  readonly keyColumn: string | null;
  readonly nameColumn: string | null;
  readonly keyMasked: boolean;
  readonly nameMasked: boolean;
  readonly sensitiveFields: readonly string[];
}

export const NO_RECORD_NAMING: RecordNaming = {
  keyColumn: null, nameColumn: null, keyMasked: false, nameMasked: false, sensitiveFields: [],
};

export function recordNaming(plan: ExecutablePlan | null): RecordNaming {
  if (plan === null) return NO_RECORD_NAMING;
  const keys = adapterSearchKeys(plan.inputs.templateId) ?? [];
  const sensitiveFields = plan.inputs.sourceSnapshot?.contract.sensitive_fields ?? [];
  const keyColumn = keys[0] ?? null;
  const nameColumn = keys[1] ?? null;
  return {
    keyColumn,
    nameColumn,
    keyMasked: keyColumn !== null && sensitiveFields.includes(keyColumn),
    nameMasked: nameColumn !== null && sensitiveFields.includes(nameColumn),
    sensitiveFields,
  };
}

/** One part of a record label: its text, and whether the binding masks it. */
export interface RecordLabelPart {
  readonly text: string;
  readonly masked: boolean;
}

export interface RecordLabelParts {
  readonly key: RecordLabelPart;
  /** `null` when the Template names records by key alone, or no name was recorded. */
  readonly name: RecordLabelPart | null;
}

export const UNNAMED_RECORD = 'Unnamed source record';

/**
 * The one rule for a record's label: the key, then the best permitted name.
 *
 * A masked part is `MASKED_VALUE` and never the value — the caller has nothing else to
 * print. A name the binding masks is still SAID to exist (`••••`), because leaving it out
 * would read as a record the source never named; a Template with no name column, or a
 * record whose name was not recorded, has no name part at all.
 */
export function recordLabelParts(
  record: { readonly key: string | null; readonly name?: string | null },
  naming: Pick<RecordNaming, 'keyMasked' | 'nameMasked' | 'nameColumn'>,
): RecordLabelParts {
  const key: RecordLabelPart = naming.keyMasked
    ? { text: MASKED_VALUE, masked: true }
    : { text: record.key === null || record.key.trim() === '' ? UNNAMED_RECORD : record.key, masked: false };
  if (naming.nameColumn === null) return { key, name: null };
  if (naming.nameMasked) return { key, name: { text: MASKED_VALUE, masked: true } };
  const name = record.name?.trim() ?? '';
  return { key, name: name === '' ? null : { text: name, masked: false } };
}

/** Parts already decided, as one string. */
export function labelPartsWords(parts: RecordLabelParts): string {
  return parts.name === null ? parts.key.text : `${parts.key.text} · ${parts.name.text}`;
}

/** The label as one string, for a pill, an `alt` text or a sentence. */
export function recordWords(
  record: { readonly key: string | null; readonly name?: string | null },
  naming: Pick<RecordNaming, 'keyMasked' | 'nameMasked' | 'nameColumn'>,
): string {
  return labelPartsWords(recordLabelParts(record, naming));
}
