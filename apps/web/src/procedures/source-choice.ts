import { PLAN_LOOKUP_COLUMNS, isInclusionRule, type InclusionPredicate, type PopulationSourceKind, type TemplateId } from '@intellifin/domain';

import { SOURCE_KIND_WORDS } from '../design/plain-words';
import { fieldWords } from './condition-words';

/**
 * The evidence-source chooser's reading of the registered sources (UI cleanup
 * 2026-09-22, UX-11).
 *
 * The chat listed every source a deployment holds — twenty-eight on the owner's — with
 * its raw field names (`employee_id, termination_effective_date`) and asked the auditor
 * to type "select <exact name>". This puts the sources that can serve THIS procedure
 * first, says in words how each one's records arrive and which fields it provides, and
 * names what a source lacks, so the choice is a click on a row rather than a transcription.
 *
 * "Can serve" is decided by fields, never by a name: a source is suggested when it
 * declares every column the compiled plan needs to find each record — the Template's
 * lookup columns, which `completenessReason` refuses a plan without — and every column
 * the Draft's saved record filters read, which the population writer refuses a source
 * without. Nothing is guessed from a display name.
 */

/** The shape of a registered source this module reads; `PopulationSourceBinding` satisfies it. */
export interface ChoosableSource {
  readonly bindingId: string;
  readonly displayName: string;
  readonly kind: PopulationSourceKind;
  readonly declaredSchema: readonly string[];
  readonly digest: string;
}

export interface SourceChoice {
  readonly bindingId: string;
  readonly displayName: string;
  /** How the records arrive, in words (`SOURCE_KIND_WORDS`). */
  readonly arrives: string;
  /** Every declared field, spaced into words, in the source's own order. */
  readonly fields: readonly string[];
  /** Required fields this source does not declare, in words. Empty when it can serve. */
  readonly missing: readonly string[];
  /** Whether the Draft's saved record filters can be kept on this source. */
  readonly filtersFit: boolean;
}

export interface RankedSources {
  /** Sources declaring every required field, by name. */
  readonly suggested: readonly SourceChoice[];
  /** Every other source, by name, each saying what it lacks. */
  readonly other: readonly SourceChoice[];
}

/** The columns a source must declare for this procedure: lookup columns, then filter columns. */
export function requiredSourceFields(templateId: TemplateId, predicates: readonly InclusionPredicate[]): readonly string[] {
  const lookup = Object.hasOwn(PLAN_LOOKUP_COLUMNS, templateId) ? PLAN_LOOKUP_COLUMNS[templateId] : [];
  const fields: string[] = [];
  for (const column of [...lookup, ...predicates.map((predicate) => predicate.column)]) {
    if (column !== '' && !fields.includes(column)) fields.push(column);
  }
  return fields;
}

/** "Missing: termination effective date", or `null` when nothing is missing. */
export function missingFieldsSentence(missing: readonly string[]): string | null {
  return missing.length === 0 ? null : `Missing: ${missing.join(', ')}`;
}

function describe(source: ChoosableSource, required: readonly string[], predicates: readonly InclusionPredicate[]): SourceChoice {
  const words = Object.hasOwn(SOURCE_KIND_WORDS, source.kind) ? SOURCE_KIND_WORDS[source.kind].label : source.kind;
  return {
    bindingId: source.bindingId,
    displayName: source.displayName,
    arrives: words,
    fields: source.declaredSchema.map(fieldWords),
    missing: required.filter((column) => !source.declaredSchema.includes(column)).map(fieldWords),
    filtersFit: isInclusionRule({ schemaVersion: 1, all: predicates }, source.declaredSchema),
  };
}

function matches(choice: SourceChoice, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('en-GB');
  if (needle === '') return true;
  return [choice.displayName, choice.arrives, ...choice.fields].some((text) => text.toLocaleLowerCase('en-GB').includes(needle));
}

const byName = (left: SourceChoice, right: SourceChoice) =>
  left.displayName.localeCompare(right.displayName, 'en-GB') || left.bindingId.localeCompare(right.bindingId);

/** The sources a person can choose from, suggested first, filtered by what they typed. */
export function rankSources(
  sources: readonly ChoosableSource[],
  templateId: TemplateId,
  predicates: readonly InclusionPredicate[],
  query = '',
): RankedSources {
  const required = requiredSourceFields(templateId, predicates);
  const choices = sources.map((source) => describe(source, required, predicates)).filter((choice) => matches(choice, query));
  return {
    suggested: choices.filter((choice) => choice.missing.length === 0).sort(byName),
    other: choices.filter((choice) => choice.missing.length > 0).sort(byName),
  };
}

/** The chat's one-line description of a source, in the same words as the chooser row. */
export function sourceChoiceDescription(choice: SourceChoice): string {
  const missing = missingFieldsSentence(choice.missing);
  return `${choice.arrives}. Provides ${choice.fields.join(', ')}.${missing === null ? '' : ` ${missing}.`} Existing record filters are retained.`;
}

/** Why a row's Choose control is withdrawn: the saved filters read a field it lacks. */
export const FILTERS_DO_NOT_FIT =
  'Your record filters use a field this source does not provide. Change the filters under Which records to test first.';
