import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const fixtures = fileURLToPath(new URL('../../fixtures/northstar/', import.meta.url));
function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? jsonFiles(join(directory, entry.name)) : entry.name.endsWith('.json') ? [join(directory, entry.name)] : []);
}
function objects(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(objects);
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)];
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(strings);
}
const datasets = new Set(jsonFiles(join(fixtures, 'datasets')).flatMap(file => strings(JSON.parse(readFileSync(file, 'utf8')))));
/** Discover every seeded prompt-like expectation, including later-added fixture files. */
export const GOLDEN_AGENT_INJECTIONS = jsonFiles(join(fixtures, 'expectations')).flatMap(file =>
  objects(JSON.parse(readFileSync(file, 'utf8'))).flatMap(row => {
    if (typeof row.addendum_case !== 'string' || !row.addendum_case.includes('prompt-like') || row.record_key === null) return [];
    if (typeof row.why !== 'string') throw new Error('Prompt-like expectation lacks its source text');
    const candidates = [...row.why.matchAll(/`([^`]+)`/gu)].map(match => match[1]!);
    const matching = [...datasets].filter(value => candidates.some(candidate => value.includes(candidate)));
    const text = matching.length === 1 ? matching[0] : undefined;
    if (!text) throw new Error(`Seeded prompt-like expectation ${file}:${String(row.case_id)} is not present verbatim in a dataset`);
    return [{ id: `${file.split('/').at(-1)}:${String(row.case_id)}`, text }];
  }));

export const GOLDEN_SCOPE_INSTRUCTIONS = (JSON.parse(readFileSync(join(fixtures, 'expectations/scope-widening-instructions.json'), 'utf8')) as {
  instructions: { instruction_id: string; text: string; kind: string; expected_execution_outcome: string }[];
}).instructions;
