import { canonicalJson } from '../canonical-json.js';
import { DRAFT_SECTION_HEADINGS, type DraftSection } from './procedure-version.js';

export const CONTEXT_TEXT_LIMIT = 4000;
export interface DraftContextEdit {
  readonly risk: string | null;
  readonly control: string | null;
  readonly objective: string;
  readonly criterionReference: string | null;
}
export function isDraftContextEdit(value: unknown): value is DraftContextEdit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ['risk', 'control', 'objective', 'criterionReference'];
  if (Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))) return false;
  if (typeof v['objective'] !== 'string' || !v['objective'].trim()) return false;
  try {
    return keys.every(k => v[k] === null || (typeof v[k] === 'string' && v[k].length <= CONTEXT_TEXT_LIMIT && canonicalJson(v[k]).length > 0));
  } catch { return false; }
}
export function draftContext(sections: readonly DraftSection[]): DraftContextEdit {
  const text = (heading: string) => sections.find(s => s.heading === heading)?.content ?? null;
  return { risk: text('Risk'), control: text('Control'), objective: text('Objective') ?? '', criterionReference: text('Criterion reference') };
}
/** Only an explicit edit promotes legacy draft sections; never consult current Templates. */
export function withDraftContext(sections: readonly DraftSection[], edit: DraftContextEdit): readonly DraftSection[] {
  const context = new Map<string, string | null>([
    ['Risk', edit.risk], ['Control', edit.control], ['Objective', edit.objective], ['Criterion reference', edit.criterionReference],
  ]);
  return DRAFT_SECTION_HEADINGS.map(heading => ({
    heading, compiled: false,
    content: context.has(heading) ? context.get(heading)! : sections.find(s => s.heading === heading)?.content ?? null,
  }));
}
