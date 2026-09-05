import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { sha256Hex, sha256HexOfBytes } from '../sha256.js';
import { compareComplianceDecimals } from '../procedures/compliance-draft.js';
import { isExplicitPeriod, isGregorianDate, isRuleDecimal, type ExplicitPeriod, type InclusionRule, type ProcedureSourceSnapshot } from '../procedures/population-draft.js';

export const POPULATION_LIMITS = { bytes: 16 * 1024 * 1024, rows: 100000 } as const;
export interface PopulationRow { ordinal: number; values: Record<string, JsonValue>; disposition: 'included' | 'excluded' | 'indeterminate'; reasons: string[] }
export interface PopulationCheck { name: string; passed: boolean }
export interface PopulationResult { rows: PopulationRow[]; checks: PopulationCheck[]; rawDigest: string; rowsDigest: string | null; included: number; excluded: number; indeterminate: number; ready: boolean }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** Fatal UTF-8 decoding, without host APIs or replacement characters. */
export function decodePopulationUtf8(bytes: Uint8Array, maxBytes: number = POPULATION_LIMITS.bytes): string {
  if (bytes.length > maxBytes) throw new Error('Population byte limit');
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + 8192, bytes.length);
    // Keep a multibyte sequence together; decodeURIComponent rejects malformed UTF-8.
    while (end < bytes.length && end > start && (bytes[end]! & 0xc0) === 0x80) end--;
    if (end === start) throw new Error('Invalid population encoding');
    let encoded = '';
    for (let i = start; i < end; i++) encoded += '%' + bytes[i]!.toString(16).padStart(2, '0');
    chunks.push(decodeURIComponent(encoded));
    start = end;
  }
  const text = chunks.join('');
  if (text.charCodeAt(0) === 0xfeff || text.includes('\0')) throw new Error('Unsupported population encoding');
  return text;
}
/** RFC4180 quotes and embedded CR/LF; no trimming, guessing or header repair. */
export function parsePopulationCsv(text: string, onHeaders?: (headers:string[])=>void): Record<string, JsonValue>[] {
  const records: string[][] = [];
  let row: string[] = [], pieces: string[] = [], start = 0, quoted = false, closed = false;
  const finishField = (end: number) => { pieces.push(text.slice(start, end)); row.push(pieces.join('')); pieces = []; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { pieces.push(text.slice(start, i + 1)); i++; start = i + 1; }
        else { pieces.push(text.slice(start, i)); quoted = false; closed = true; start = i + 1; }
      }
    } else if (c === '"') { if (i !== start || pieces.length || closed) throw new Error('Malformed CSV'); quoted = true; start = i + 1; }
    else if (c === ',' || c === '\n' || c === '\r') {
      finishField(i);
      if (c !== ',') { if (c === '\r') { if (text[i + 1] !== '\n') throw new Error('Malformed CSV'); i++; } records.push(row); row = []; }
      start = i + 1;
    } else if (closed) throw new Error('Malformed CSV');
    if (records.length > POPULATION_LIMITS.rows + 2) throw new Error('Population row limit');
  }
  if (quoted) throw new Error('Malformed CSV');
  if (start < text.length || pieces.length || row.length || closed) { finishField(text.length); records.push(row); }
  if (records[0]?.[0]?.startsWith('# SYNTHETIC')) records.shift();
  const headers = records.shift();
  if (!headers?.length || headers.some(x => !x) || new Set(headers).size !== headers.length) throw new Error('Invalid CSV header');
  if (records.length > POPULATION_LIMITS.rows) throw new Error('Population row limit');
  onHeaders?.(headers);
  return records.map(values => { if (values.length !== headers.length) throw new Error('Invalid CSV row'); return Object.fromEntries(headers.map((h, i) => [h, values[i]!])) as Record<string, JsonValue>; });
}
export function populationUtcDate(value: unknown): string | null {
  if (isGregorianDate(value)) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !isGregorianDate(value.slice(0,10))) return null;
  const time = value.slice(11,19).split(':').map(Number);
  if (time[0]! > 23 || time[1]! > 59 || time[2]! > 59) return null;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return null;
  const ms = Date.parse(value); if (!Number.isFinite(ms)) return null;
  const date = new Date(ms).toISOString().slice(0,10); return isGregorianDate(date) ? date : null;
}
export function includePopulation(rows: Record<string, JsonValue>[], rule: InclusionRule, period: ExplicitPeriod): PopulationRow[] {
  return rows.map((values, index) => {
    const invalid: string[] = [], excluded: string[] = [];
    for (const predicate of rule.all) {
      const value = values[predicate.column]; let match = false;
      if (predicate.kind === 'text') {
        if (typeof value !== 'string' || value === '') { invalid.push(`Invalid text: ${predicate.column}`); continue; }
        match = value === predicate.value;
      } else if (predicate.kind === 'decimal') {
        if (!isRuleDecimal(value)) { invalid.push(`Invalid decimal: ${predicate.column}`); continue; }
        const c = compareComplianceDecimals(value, predicate.value);
        match = ({ eq:c===0, neq:c!==0, gt:c>0, gte:c>=0, lt:c<0, lte:c<=0 })[predicate.operator];
      } else {
        const date = populationUtcDate(value);
        if (date === null) { invalid.push(`Invalid date: ${predicate.column}`); continue; }
        match = date >= period.from && date <= period.to;
      }
      if (!match) excluded.push(`Outside inclusion rule: ${predicate.column} (${predicate.kind})`);
    }
    return { ordinal:index + 1, values, disposition: invalid.length ? 'indeterminate' : excluded.length ? 'excluded' : 'included', reasons: invalid.length ? [...invalid,...excluded] : excluded };
  });
}
export function reconcilePopulation(input: { bytes: Uint8Array; mediaType: string; declaration: unknown; source: ProcedureSourceSnapshot; period: ExplicitPeriod; rule: InclusionRule; zeroRecordPass: boolean; initiatedAt: string }): PopulationResult {
  const checks: PopulationCheck[] = [], rawDigest = sha256HexOfBytes(input.bytes);
  const check = (name: string, passed: boolean) => checks.push({name,passed});
  let rawRows: Record<string, JsonValue>[] = [], rowsDigest: string | null = null, metadata: Record<string,unknown> = {};
  let parsed = false, csvHeaders:string[]|null=null;
  try {
    const text = decodePopulationUtf8(input.bytes);
    if (/^text\/csv(?:;\s*charset=utf-8)?$/i.test(input.mediaType)) rawRows = parsePopulationCsv(text,headers=>{csvHeaders=headers;});
    else if (/^application\/json(?:;\s*charset=utf-8)?$/i.test(input.mediaType)) {
      const value: unknown = JSON.parse(text); if (!object(value)) throw new Error('Invalid response'); metadata = value;
      const keys = ['accounts','transactions','employees','approvals'].filter(key => Object.hasOwn(value,key));
      if (keys.length !== 1 || !Array.isArray(value[keys[0]!])) throw new Error('Invalid collection');
      const rows = value[keys[0]!] as unknown[];
      if (!rows.every(object)) throw new Error('Invalid row');
      canonicalJson(rows as JsonValue); rawRows = rows as Record<string,JsonValue>[];
    } else throw new Error('Unsupported media');
    if (rawRows.length > POPULATION_LIMITS.rows) throw new Error('Row limit');
    rowsDigest = sha256Hex(canonicalJson({ schema_version:1, rows:rawRows })); parsed = true;
  } catch { rawRows = []; }
  check('parse',parsed);
  let d = object(input.declaration) ? input.declaration : {};
  try { canonicalJson(d as JsonValue); } catch { d = {}; }
  const csv = input.source.contract.kind === 'versioned-file';
  check('declaration',d['schema_version'] === 1 && d['representation'] === (csv ? 'csv-raw-v1' : 'population-rows-v1'));
  check('response-contract',csv || (metadata['schema_version'] === d['schema_version'] && metadata['representation'] === d['representation'] && Array.isArray(metadata['schema']) && JSON.stringify(metadata['schema']) === JSON.stringify(d['schema'])));
  check('declared-count',Number.isSafeInteger(d['count']) && d['count'] === rawRows.length);
  check('declared-digest',d['sha256'] === (csv ? rawDigest : rowsDigest));
  check('declared-schema',Array.isArray(d['schema']) && JSON.stringify(d['schema']) === JSON.stringify(input.source.contract.declared_schema) && (csv ? JSON.stringify(csvHeaders)===JSON.stringify(d['schema']) : true) && rawRows.every(row => Object.keys(row).length===input.source.contract.declared_schema.length && input.source.contract.declared_schema.every(k => Object.hasOwn(row,k))));
  check('declared-period',isExplicitPeriod(d['effective_period']) && d['effective_period'].from <= input.period.from && d['effective_period'].to >= input.period.to && (csv || (isExplicitPeriod(metadata['effective_period']) && metadata['effective_period'].from===d['effective_period'].from && metadata['effective_period'].to===d['effective_period'].to)));
  // V1 is a complete response, not a pagination protocol. Unknown envelope fields
  // cannot silently introduce cursors, nested pagination, or another continuation.
  const envelopeKeys = new Set(['synthetic','title','schema_version','representation','source','generation','generated_at','effective_period','schema','complete','returned','declared_count_endpoint','count','sha256','accounts','transactions','employees','approvals']);
  check('complete-extraction',d['complete'] === true && (csv || (metadata['complete'] === true && Object.keys(metadata).every(key => envelopeKeys.has(key)))));
  check('generation',typeof d['generation'] === 'string' && d['generation'] !== '' && (csv || metadata['generation'] === d['generation']));
  check('source-identity',typeof d['source'] === 'string' && d['source'] !== '' && (csv || metadata['source'] === d['source']));
  check('freshness',typeof d['generated_at'] === 'string' && d['generated_at'].includes('T') && populationUtcDate(d['generated_at']) !== null && Date.parse(d['generated_at']) >= Date.parse(input.period.to+'T23:59:59.999Z') && Date.parse(d['generated_at']) <= Date.parse(input.initiatedAt) && (csv || metadata['generated_at'] === d['generated_at']));
  const rows = includePopulation(rawRows,input.rule,input.period);
  const included = rows.filter(r => r.disposition === 'included').length, excluded = rows.filter(r => r.disposition === 'excluded').length, indeterminate = rows.length - included - excluded;
  check('complete-inclusion',indeterminate === 0); check('nonempty-population',included > 0 || input.zeroRecordPass);
  return { rows, checks, rawDigest, rowsDigest, included, excluded, indeterminate, ready:checks.every(c=>c.passed) };
}
