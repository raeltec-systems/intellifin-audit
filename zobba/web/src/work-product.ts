// Story 24.4: firm-shaped work products with supported claims. Every response
// is strictly parsed. A version never changes; a claim's currency is derived
// by the server on every read; a quote this viewer may not read now is
// withheld (never stale). The platform, never the model, writes coverage
// lines, limitations and support. There is no confidence score anywhere.
import { AccessError, readJsonBody, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseSource } from './citation.ts';
import { cursor, identifier } from './conversation.ts';
import { parseScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import { array, blank, boolean, digest, exact, invalid, nullable, oneOf, record, text } from './assessment.ts';
import type { components } from './generated/api.ts';

export type WorkProductSummary = components['schemas']['WorkProductSummaryResponse'];
export type WorkProductShelf = components['schemas']['WorkProductShelfResponse'];
export type WorkProductVersion = components['schemas']['WorkProductVersionResponse'];
export type WorkProductSection = components['schemas']['WorkProductSectionResponse'];
export type WorkProductBlock = components['schemas']['WorkProductBlockResponse'];
export type WorkProductClaim = components['schemas']['WorkProductClaimResponse'];
export type WorkProductAssertion = components['schemas']['WorkProductAssertionResponse'];
export type WorkProductSupport = components['schemas']['WorkProductSupportResponse'];
export type WorkProductExport = components['schemas']['WorkProductExportResponse'];
export type WorkProductRefusal = components['schemas']['WorkProductRefusalItemResponse'];
export type WorkProductEditBlock = components['schemas']['WorkProductEditBlockRequest'];

export const kinds = ['working_paper', 'analysis', 'finding_summary', 'report_draft'] as const;
export const blockKinds = ['heading', 'narrative', 'claim', 'coverage', 'exceptions', 'limitations'] as const;
export const assertionKinds = ['outcome', 'count', 'conclusion', 'exception', 'fact', 'quote', 'period'] as const;
export const recordKinds = ['evaluation', 'revision', 'summary', 'effective_summary', 'exception', 'fact', 'original', 'basis'] as const;
export const measures = ['received_rows', 'distinct_subjects', 'in_scope', 'selected', 'excluded', 'scope_unknown', 'applicable', 'not_applicable', 'met', 'not_met', 'undetermined', 'execution_failed', 'not_evaluated', 'failing_subjects', 'failing_opportunities', 'meets_every_applicable', 'unresolved'] as const;
export const refusals = ['outcome_mismatch', 'count_mismatch', 'conclusion_mismatch', 'status_mismatch', 'fact_mismatch', 'quote_unverified', 'superseded_support', 'unsupported_figure', 'figure_in_narrative', 'verdict_without_record', 'unknown_record', 'stale_base', 'template_unbound', 'section_unknown', 'human_block_dropped', 'bound_exceeded'] as const;
export const refreshReasons = ['evaluation_revised', 'disposition_changed', 'summary_superseded', 'exception_status_changed', 'fact_superseded', 'source_withdrawn'] as const;
export const formats = ['docx', 'xlsx'] as const;

export const REVIEW_STATE = 'Draft';
export const JUDGMENT_LABEL = "Zobba's judgment — not checked against records";
export const NOT_COMPLETED = 'Not completed in this version.';
export const NEUTRAL_LABEL = 'Neutral starter (not firm methodology)';
export const FIGURE_RULE = 'statement_figures_v1';
export const RENDERER = 'zobba-export-v1';
export const AGENT_LABEL = 'Zobba (agent)';
export const SHELF_PAGE = 50;
export const MAX_BLOCKS = 64;
export const MAX_CLAIMS = 48;
export const MAX_ASSERTIONS = 8;
/** UTF-8 byte bounds of what a person may write in each kind of block. */
export const MAX_BYTES: Record<'heading' | 'narrative' | 'claim', number> = { heading: 500, narrative: 4000, claim: 1000 };
export const MEDIA_TYPE: Record<(typeof formats)[number], string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
/** The largest export this client accepts. */
export const MAX_EXPORT_BYTES = 16 * 1024 * 1024;

const prefixed = (prefix: string) => (value: unknown): string => {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}-[0-9a-f]{40}$`).test(value)) invalid();
  return value;
};
export const productId = prefixed('wp');
export const versionId = prefixed('wpv');
export const blockId = prefixed('blk');
export const exportId = prefixed('wpx');
function count(value: unknown): string { return cursor(value); }
const n = (value: string) => BigInt(value);
function label(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value || [...value].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
function section(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) invalid();
  return value;
}
export const bytes = (value: string) => new TextEncoder().encode(value).length;

export function parseSummary(value: unknown): WorkProductSummary {
  const v = record(value);
  const s: WorkProductSummary = {
    id: productId(v.id),
    task_id: identifier(v.task_id),
    title: label(v.title),
    kind: oneOf(v.kind, kinds),
    template: label(v.template, 400),
    template_id: identifier(v.template_id),
    template_version: identifier(v.template_version),
    neutral: boolean(v.neutral),
    version_id: versionId(v.version_id),
    version: count(v.version),
    author_kind: oneOf(v.author_kind, ['agent', 'human'] as const),
    review_state: oneOf(v.review_state, [REVIEW_STATE] as const),
    claims: count(v.claims),
    refresh: count(v.refresh),
    missing_required: array(v.missing_required, MAX_BLOCKS).map(section),
    recorded_us: nullable(v.recorded_us, cursor),
  };
  // A neutral template always says so; refresh counts only its own claims.
  if (n(s.version) < 1n || n(s.claims) > BigInt(MAX_CLAIMS) || n(s.refresh) > n(s.claims)
    || s.neutral !== s.template.endsWith(NEUTRAL_LABEL)
    || new Set(s.missing_required).size !== s.missing_required.length) invalid();
  return exact(v, s);
}

export function parseShelf(value: unknown): WorkProductShelf {
  const v = record(value);
  const s: WorkProductShelf = {
    products: array(v.products, SHELF_PAGE).map(parseSummary),
    total: count(v.total),
    next_cursor: nullable(v.next_cursor, productId),
  };
  // C-ordered by ID; a next page follows only a full page, from its last product.
  if (BigInt(s.products.length) > n(s.total)
    || s.products.some((p, i) => i > 0 && !(p.id > s.products[i - 1]!.id))
    || (s.next_cursor !== null && (s.products.length !== SHELF_PAGE || s.next_cursor !== s.products[s.products.length - 1]!.id))) invalid();
  return exact(v, s);
}

export function parseAssertion(value: unknown): WorkProductAssertion {
  const v = record(value);
  const a: WorkProductAssertion = {
    kind: oneOf(v.kind, assertionKinds),
    record_kind: oneOf(v.record_kind, recordKinds),
    record_id: identifier(v.record_id),
    record_digest: digest(v.record_digest),
    measure: nullable(v.measure, value => oneOf(value, measures)),
    criterion_id: nullable(v.criterion_id, identifier),
    value: nullable(v.value, value => text(value, 1000)),
    withheld: boolean(v.withheld),
    origin: nullable(v.origin, value => label(value, 64)),
    review: nullable(v.review, value => label(value, 64)),
    locator: nullable(v.locator, value => label(value, 512)),
    unit: nullable(v.unit, value => label(value, 64)),
    subject: nullable(v.subject, value => label(value, 128)),
    source: nullable(v.source, parseSource),
  };
  // Only a quote is ever withheld, and then it carries no value and no source.
  if ((a.withheld && (a.kind !== 'quote' || a.value !== null || a.source !== null))
    || (!a.withheld && a.value === null)
    || (a.kind === 'quote') !== (a.record_kind === 'original')
    || (a.kind === 'count') !== (a.measure !== null)
    || (a.kind === 'quote' && !a.withheld && (a.source === null || a.source.original_id !== a.record_id))
    || (a.kind !== 'quote' && a.source !== null)) invalid();
  return exact(v, a);
}

export function parseClaim(value: unknown): WorkProductClaim {
  const v = record(value);
  const c: WorkProductClaim = {
    number: count(v.number),
    current: boolean(v.current),
    refresh: array(v.refresh, refreshReasons.length).map(value => oneOf(value, refreshReasons)),
    refresh_words: array(v.refresh_words, refreshReasons.length).map(value => text(value, 300)),
    withheld: boolean(v.withheld),
    coverage: nullable(v.coverage, value => text(value, 1000)),
    support: array(v.support, MAX_ASSERTIONS).map(value => text(value, 2000)),
    assertions: array(v.assertions, MAX_ASSERTIONS).map(parseAssertion),
  };
  // Current exactly when nothing needs refresh; a withheld source never makes it stale.
  if (n(c.number) < 1n || c.assertions.length < 1 || c.current !== (c.refresh.length === 0)
    || c.refresh.length !== c.refresh_words.length || new Set(c.refresh).size !== c.refresh.length
    // A withheld claim has a withheld quote (a withdrawn quote is hidden too, but stale).
    || (c.withheld && !c.assertions.some(a => a.withheld))) invalid();
  return exact(v, c);
}

export function parseBlock(value: unknown): WorkProductBlock {
  const v = record(value);
  const b: WorkProductBlock = {
    id: blockId(v.id),
    section_id: section(v.section_id),
    kind: oneOf(v.kind, blockKinds),
    label: nullable(v.label, value => oneOf(value, ['judgment', 'narrative'] as const)),
    label_words: nullable(v.label_words, value => oneOf(value, [JUDGMENT_LABEL] as const)),
    text: nullable(v.text, value => text(value, MAX_BYTES.narrative)),
    record_id: nullable(v.record_id, identifier),
    author_kind: oneOf(v.author_kind, ['agent', 'human'] as const),
    author_id: identifier(v.author_id),
    author_label: nullable(v.author_label, label),
    authored_in_version: versionId(v.authored_in_version),
    claim: nullable(v.claim, parseClaim),
    lines: array(v.lines, 256).map(value => text(value, 1000)),
  };
  const writable = b.kind === 'heading' || b.kind === 'narrative' || b.kind === 'claim';
  if ((b.kind === 'narrative') !== (b.label !== null)
    || (b.label === 'judgment') !== (b.label_words !== null)
    || writable !== (b.text !== null)
    || (b.text !== null && writable && bytes(b.text) > MAX_BYTES[b.kind as 'heading' | 'narrative' | 'claim'])
    || (b.kind === 'coverage' || b.kind === 'exceptions') !== (b.record_id !== null)
    || (b.kind === 'claim') !== (b.claim !== null)
    || (b.author_kind === 'agent' && b.author_label !== AGENT_LABEL)) invalid();
  return exact(v, b);
}
export function parseVersion(value: unknown, expected?: { product: string; version: string }): WorkProductVersion {
  const v = record(value);
  const w: WorkProductVersion = {
    product: parseSummary(v.product),
    id: versionId(v.id),
    version: count(v.version),
    digest: digest(v.digest),
    predecessor_id: nullable(v.predecessor_id, versionId),
    author_kind: oneOf(v.author_kind, ['agent', 'human'] as const),
    author_label: nullable(v.author_label, label),
    title: label(v.title),
    kind: oneOf(v.kind, kinds),
    template: label(v.template, 400),
    figure_rule: oneOf(v.figure_rule, [FIGURE_RULE] as const),
    review_state: oneOf(v.review_state, [REVIEW_STATE] as const),
    sections: array(v.sections, MAX_BLOCKS).map(item => {
      const s = record(item);
      return exact(s, {
        id: section(s.id), title: label(s.title), required: boolean(s.required),
        not_completed: nullable(s.not_completed, value => oneOf(value, [NOT_COMPLETED] as const)),
        blocks: array(s.blocks, MAX_BLOCKS).map(parseBlock),
      });
    }),
    limitations: array(v.limitations, 256).map(value => text(value, 1000)),
    refresh: count(v.refresh),
    withheld: count(v.withheld),
    missing_required: array(v.missing_required, MAX_BLOCKS).map(section),
    newer_version_id: nullable(v.newer_version_id, versionId),
    recorded_us: nullable(v.recorded_us, cursor),
  };
  const blocks = w.sections.flatMap(s => s.blocks);
  const claims = blocks.filter(b => b.claim);
  const missing = w.sections.filter(s => s.not_completed !== null).map(s => s.id);
  if ((w.version === '1') !== (w.predecessor_id === null)
    || (expected && (w.product.id !== expected.product || w.id !== expected.version))
    || blocks.length > MAX_BLOCKS || claims.length > MAX_CLAIMS
    || new Set(blocks.map(b => b.id)).size !== blocks.length
    || new Set(w.sections.map(s => s.id)).size !== w.sections.length
    // Exactly one limitations block, and claims numbered 1..n in order.
    || blocks.filter(b => b.kind === 'limitations').length !== 1
    || claims.some((b, i) => b.claim!.number !== String(i + 1))
    // A required section with no content says so; the counts are this version's.
    || missing.join('\0') !== w.missing_required.join('\0')
    // (only the platform's limitations block may sit in a section with no content).
    || w.sections.some(s => s.not_completed !== null && (!s.required || s.blocks.some(b => b.kind !== 'limitations')))
    || BigInt(claims.filter(b => !b.claim!.current).length) !== n(w.refresh)
    || BigInt(claims.filter(b => b.claim!.withheld).length) !== n(w.withheld)
    // The newest version is announced, never swapped in.
    || (w.newer_version_id !== null) !== (w.product.version_id !== w.id)
    || (w.newer_version_id !== null && w.newer_version_id !== w.product.version_id)
    || (w.author_kind === 'agent' && w.author_label !== AGENT_LABEL)) invalid();
  return exact(v, w);
}

export function parseSupport(value: unknown, block: string): WorkProductSupport {
  const v = record(value);
  const s: WorkProductSupport = {
    block_id: blockId(v.block_id),
    statement: text(v.statement, MAX_BYTES.claim),
    claim: parseClaim(v.claim),
    items: array(v.items, MAX_ASSERTIONS).map(item => {
      const i = record(item);
      return exact(i, { pinned: parseAssertion(i.pinned), support: text(i.support, 2000) });
    }),
  };
  if (s.block_id !== block || s.items.length !== s.claim.assertions.length) invalid();
  return exact(v, s);
}

export function parseExport(value: unknown, version?: string): WorkProductExport {
  const v = record(value);
  const format = oneOf(v.format, formats);
  const e: WorkProductExport = {
    id: exportId(v.id),
    version_id: versionId(v.version_id),
    format,
    media_type: oneOf(v.media_type, [MEDIA_TYPE[format]] as const),
    renderer: oneOf(v.renderer, [RENDERER] as const),
    digest: digest(v.digest),
    size: count(v.size),
    withheld_digest: digest(v.withheld_digest),
    refresh_count: count(v.refresh_count),
    recorded_us: nullable(v.recorded_us, cursor),
  };
  if ((version && e.version_id !== version) || n(e.size) < 1n || n(e.size) > BigInt(MAX_EXPORT_BYTES)) invalid();
  return exact(v, e);
}

function route(scope: Scope, path: string, query?: Record<string, string>): string {
  parseScope(scope);
  const params = new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id, ...query });
  return `/engagements/${encodeURIComponent(scope.engagement_id)}/${path}?${params}`;
}
const productPath = (taskId: string, product: string) => `tasks/${identifier(taskId)}/work-products/${productId(product)}`;

/** One page of a shelf: the engagement's (no Task) or one Task's. The total is
 * exact over the whole shelf. */
export async function readShelf(scope: Scope, taskId: string | null, after: string | null, session: Session | null, signal: AbortSignal): Promise<WorkProductShelf> {
  const path = route(scope, taskId ? `tasks/${identifier(taskId)}/work-products` : 'work-products', after ? { cursor: productId(after) } : undefined);
  const shelf = parseShelf(await readSessionJson(path, session, signal));
  if (taskId && shelf.products.some(p => p.task_id !== taskId)) invalid();
  return shelf;
}
export async function readVersion(scope: Scope, taskId: string, product: string, version: string, session: Session | null, signal: AbortSignal): Promise<WorkProductVersion> {
  const path = route(scope, `${productPath(taskId, product)}/versions/${versionId(version)}`);
  return parseVersion(await readSessionJson(path, session, signal), { product, version });
}
export async function readSupport(scope: Scope, taskId: string, product: string, version: string, block: string, session: Session | null, signal: AbortSignal): Promise<WorkProductSupport> {
  const path = route(scope, `${productPath(taskId, product)}/versions/${versionId(version)}/claims/${blockId(block)}/support`);
  return parseSupport(await readSessionJson(path, session, signal), block);
}

function mutationHeaders(session: Session): Record<string, string> {
  return {
    Accept: 'application/json', 'Content-Type': 'application/json',
    'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token,
  };
}

export type EditResult =
  | { ok: true; version: WorkProductVersion }
  | { ok: false; status: number; error: string; head: string | null; refusals: WorkProductRefusal[] };

const editErrors = ['work_product_edit_invalid', 'access_denied', 'work_product_not_found', 'stale_base', 'work_product_refused', 'work_product_edit_conflict', 'work_product_capacity', 'work_product_unavailable', ...refusals] as const;

function parseRefusal(value: unknown): WorkProductRefusal {
  const v = record(value);
  return exact(v, {
    block: nullable(v.block, value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_BLOCKS ? value : invalid()),
    reason: oneOf(v.reason, refusals),
    words: text(v.words, 300),
    detail: typeof v.detail === 'string' && bytes(v.detail) <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v.detail) ? v.detail : invalid(),
  });
}

async function refusal(response: Response, allowed: readonly string[]): Promise<{ error: string; head: string | null; refusals: WorkProductRefusal[] }> {
  if (![400, 403, 404, 409, 503].includes(response.status)) {
    await response.body?.cancel().catch(() => {});
    throw new AccessError(response.status);
  }
  let body: Record<string, unknown> = {};
  try { body = record(await readJsonBody(response, 64 * 1024)); } catch { /* the status alone is definite */ }
  const error = typeof body.error === 'string' && allowed.includes(body.error) ? body.error : (response.status === 403 ? 'access_denied' : allowed[allowed.length - 1]!);
  let head: string | null = null, items: WorkProductRefusal[] = [];
  try {
    head = error === 'stale_base' && body.head != null ? versionId(body.head) : null;
    items = Array.isArray(body.refusals) ? array(body.refusals, MAX_BLOCKS + 1).map(parseRefusal) : [];
  } catch { head = null; items = []; }
  return { error, head, refusals: items };
}

/** A person's edit of the latest version: the blocks to keep, in order, with
 * new text for headings, narratives and claim sentences. Bound to this
 * session; the same key is never recorded twice. */
export async function saveEdit(scope: Scope, taskId: string, product: string, base: string, blocks: WorkProductEditBlock[], key: string, session: Session, signal: AbortSignal): Promise<EditResult> {
  const path = route(scope, `${productPath(taskId, product)}/versions`);
  const response = await fetch(`/api${path}`, {
    method: 'POST', signal, cache: 'no-store', credentials: 'same-origin', headers: mutationHeaders(session),
    body: JSON.stringify({ base_version: versionId(base), blocks, key }),
  });
  if (response.ok) {
    const version = parseVersion(await readJsonBody(response));
    if (version.product.id !== product || version.predecessor_id !== base || version.author_kind !== 'human') invalid();
    return { ok: true, version };
  }
  const r = await refusal(response, [...editErrors, 'work_product_unavailable']);
  return { ok: false, status: response.status, ...r };
}

export type ExportResult = { ok: true; export: WorkProductExport } | { ok: false; status: number; error: string };
const exportErrors = ['work_product_export_invalid', 'access_denied', 'work_product_not_found', 'work_product_export_conflict', 'export_scope_changed', 'work_product_export_integrity', 'work_product_export_unavailable'] as const;

/** Render one exact version as DOCX or XLSX, for this viewer's withheld set. */
export async function requestExport(scope: Scope, taskId: string, product: string, version: string, format: (typeof formats)[number], key: string, session: Session, signal: AbortSignal): Promise<ExportResult> {
  const path = route(scope, `${productPath(taskId, product)}/versions/${versionId(version)}/exports`);
  const response = await fetch(`/api${path}`, {
    method: 'POST', signal, cache: 'no-store', credentials: 'same-origin', headers: mutationHeaders(session),
    body: JSON.stringify({ format, key }),
  });
  if (response.ok) {
    const e = parseExport(await readJsonBody(response, 64 * 1024), version);
    if (e.format !== format) invalid();
    return { ok: true, export: e };
  }
  const r = await refusal(response, exportErrors);
  return { ok: false, status: response.status, error: r.error };
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export type DownloadResult = { ok: true; blob: Blob } | { ok: false; status: number; error: string };

/** The export's exact bytes, checked again here against its recorded size and
 * digest. Another viewer's export is refused (`export_scope_changed`). */
export async function downloadExport(scope: Scope, taskId: string, product: string, record: WorkProductExport, session: Session, signal: AbortSignal): Promise<DownloadResult> {
  const path = route(scope, `${productPath(taskId, product)}/exports/${exportId(record.id)}/content`);
  const response = await fetch(`/api${path}`, {
    signal, cache: 'no-store', credentials: 'same-origin', headers: { 'X-Expected-Session': session.csrf_token },
  });
  if (!response.ok) {
    const r = await refusal(response, exportErrors);
    return { ok: false, status: response.status, error: r.error };
  }
  const size = Number(record.size);
  if (!response.body || Number(response.headers.get('Content-Length') ?? 0) > size) { await response.body?.cancel(); invalid(); }
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > size) { await reader.cancel(); invalid(); }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  const blob = new Blob(chunks, { type: record.media_type });
  if (length !== size || await sha256(await blob.arrayBuffer()) !== record.digest) invalid();
  return { ok: true, blob };
}

// ------------------------------------------------------------------ edits

export interface DraftBlock { id: string; kind: string; text: string | null; original: string | null }

/** The edit body: every kept block by ID in order, with `text` only where it
 * changed. Platform blocks are kept without text; the limitations block is
 * kept anyway. */
export function editBlocks(draft: readonly DraftBlock[]): WorkProductEditBlock[] {
  return draft.map(b => b.text !== null && b.text !== b.original ? { block: blockId(b.id), text: b.text } : { block: blockId(b.id) });
}
/** A written block's text problem, or null: blank or over its byte bound. */
export function textProblem(kind: string, value: string): string | null {
  if (kind !== 'heading' && kind !== 'narrative' && kind !== 'claim') return null;
  if (blank.test(value)) return 'Write something here, or remove the block.';
  const max = MAX_BYTES[kind];
  return bytes(value) > max ? `This is ${bytes(value).toLocaleString('en-GB')} bytes; at most ${max.toLocaleString('en-GB')} are allowed.` : null;
}

// ------------------------------------------------------------------ words

export const kindLabel: Record<string, string> = {
  working_paper: 'Working paper', analysis: 'Analysis', finding_summary: 'Finding summary', report_draft: 'Report draft',
};
export const blockKindLabel: Record<string, string> = {
  heading: 'Heading', narrative: 'Narrative', claim: 'Claim', coverage: 'Coverage (platform)', exceptions: 'Exceptions (platform)', limitations: 'Limitations (platform)',
};
export const refusalLabel: Record<string, string> = {
  outcome_mismatch: 'the stated verdict is not the evaluation’s effective outcome',
  count_mismatch: 'the stated count is not the summary’s stored count',
  conclusion_mismatch: 'the stated conclusion is not the summary’s stored conclusion',
  status_mismatch: 'the stated status is not the exception’s derived status',
  fact_mismatch: 'the stated value is not the fact’s supported, grounded value',
  quote_unverified: 'the quote is not found at its location in the original',
  superseded_support: 'the record is not current: cite the current one',
  unsupported_figure: 'the sentence states a figure none of its records holds',
  figure_in_narrative: 'narrative and judgment may not state figures; figures belong in checked claims',
  verdict_without_record: 'a claim resting only on quotes may not state a verdict',
  unknown_record: 'the record is not one of this Task’s records',
  stale_base: 'a newer version was recorded first',
  template_unbound: 'the template is not part of the Task’s current method',
  section_unknown: 'the section is not one of the template’s sections',
  human_block_dropped: 'a person’s block may not be dropped',
  bound_exceeded: 'the work product is larger than allowed',
};
export const editErrorLabel: Record<string, string> = {
  work_product_edit_invalid: 'The edit is not complete. Nothing was saved.',
  access_denied: 'Only an assigned Auditor or Audit manager of this engagement may edit a work product. Nothing was saved.',
  work_product_not_found: 'That work product is not part of this Task. Nothing was saved.',
  stale_base: 'A newer version was recorded while you edited. Nothing was saved; open the newer version and edit that.',
  work_product_refused: 'The checks refused this edit. Nothing was saved.',
  work_product_edit_conflict: 'That request was already used for a different edit. Nothing was saved.',
  work_product_capacity: 'This work product holds the most versions it may hold. Nothing was saved.',
  work_product_unavailable: 'The edit could not be saved now. Nothing was saved; try again.',
};
export const exportErrorLabel: Record<string, string> = {
  work_product_export_invalid: 'The export request is not complete. Nothing was exported.',
  access_denied: 'You may not export this work product now.',
  work_product_not_found: 'That version is not part of this Task.',
  work_product_export_conflict: 'That request was already used for a different export.',
  export_scope_changed: 'What you may read changed since this export was made. Request a new export.',
  work_product_export_integrity: 'The stored export did not match its recorded digest. Nothing was downloaded.',
  work_product_export_unavailable: 'The export could not be made now. Nothing was recorded; try again.',
};
