import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { POPULATION_CHECK_NAMES, adapterLookupColumn, classifyPlanTargets, authorizeActionRole, type ExecutablePlan, type JsonValue } from '@intellifin/domain';
import { RECORD_REVIEW_FILTERS, type RecordReviewCounts, type RecordReviewFilter, type RecordReviewQuery,
  type RecordReviewResult, type RecordReviewRow, type RecordReviewSelectionResult, type RecordReviewTarget } from '@intellifin/application';
import type { Database, Transaction } from '../db/client.js';
import { runReviewSnapshot, runReviewSnapshotRow, populationRow } from '../db/schema.js';
import { isUuidText } from '../db/identifier.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { DrizzleRunRepository } from './run-repository.js';

export const RECORD_REVIEW_MAX_ROWS = 10000;
export const RECORD_REVIEW_MAX_UNITS = 10000;
export const RECORD_REVIEW_TTL_MS = 600000;
type Header = typeof runReviewSnapshot.$inferSelect;
type Query = { filter: RecordReviewFilter; search: string; pageSize: number };
type SelectionInput = { runId: string; actorId: string; sourceOrdinal: number; listedRevision?: string };
type ReadySelection = Extract<RecordReviewSelectionResult, { status: 'ready' }>;
type Flat = { ordinal: number; key: string | null; disposition: string; duplicate: boolean; target_id: string | null;
  target_name: string; observation_id: string | null; work_item_id: string | null; account: string | null;
  captured_status: string | null; found: string | null; inspected: boolean; exception: boolean;
  pending: number; evidence_problem: boolean; evaluation_count: number; unevaluated: boolean };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const ADMISSION_BUSY = Symbol('record review admission busy');
const ADMISSION_EXPIRED = Symbol('record review admission expired');
const ADMISSION_TIMEOUT_MS = 10000;

function query(input: RecordReviewQuery): Query | null {
  if ((input.search !== undefined && typeof input.search !== 'string') || (input.cursor !== undefined && typeof input.cursor !== 'string')) return null;
  const filter = input.filter ?? 'all', search = (input.search ?? '').trim();
  const pageSize = input.pageSize ?? 25;
  if (!(RECORD_REVIEW_FILTERS as readonly string[]).includes(filter) || search.length > 120 ||
    Buffer.byteLength(search, 'utf8') > 480 || /[\u0000-\u001f\u007f]/u.test(search) || ![25, 50].includes(pageSize)) return null;
  return { filter: filter as RecordReviewFilter, search, pageSize };
}
function signature(header: Header, position: number): Buffer {
  return createHmac('sha256', Buffer.from(header.cursorKey, 'hex'))
    .update(JSON.stringify([1, header.snapshotId, header.actorId, header.runId, header.queryDigest, position])).digest();
}
function cursor(header: Header, position: number): string {
  const body = Buffer.alloc(20);
  Buffer.from(header.snapshotId.replaceAll('-', ''), 'hex').copy(body);
  body.writeUInt32BE(position, 16);
  return Buffer.concat([body, signature(header, position)]).toString('base64url');
}
function decode(value: string): { id: string; position: number; signature: Buffer } | null {
  if (!/^[A-Za-z0-9_-]{70}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 52 || bytes.toString('base64url') !== value) return null;
  const hex = bytes.subarray(0, 16).toString('hex');
  const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  return { id, position: bytes.readUInt32BE(16), signature: bytes.subarray(20) };
}

/** One server transaction, never retained across requests. Domain effects remain elsewhere. */
export class PostgresRecordReviewRepository {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  private async context(tx: Transaction, runId: string, actorId: string) {
    const role = await new DrizzleRoleRepository(tx).findRole(actorId);
    if (!authorizeActionRole(role, 'run.initiate').allowed) return { status: 'denied' as const };
    if (!isUuidText(runId)) return { status: 'missing' as const };
    const run = await new DrizzleRunRepository(tx).findRun(runId);
    if (!run) return { status: 'missing' as const };
    const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId, run.procedureId);
    if (!plan || adapterLookupColumn(plan.inputs.templateId) === null || classifyPlanTargets(plan).unsupported !== null) return { status: 'unavailable' as const };
    const [population] = await tx.execute<{ retrieved_count: number; count: number; declared_count: number | null; generated_at: string | null; checks: unknown; integrity_count: number }>(sql`
      SELECT s.retrieved_count,s.declared_count,s.generated_at,s.checks,
        (SELECT count(*)::int FROM run_evidence_integrity WHERE run_id=s.run_id) AS integrity_count,
        (SELECT count(*)::int FROM population_row p WHERE p.run_id=s.run_id) AS count
      FROM population_snapshot s WHERE s.run_id=${runId}::uuid`);
    if (!population || population.count !== population.retrieved_count) return { status: 'unavailable' as const };
    if (population.count > RECORD_REVIEW_MAX_ROWS || population.count * (classifyPlanTargets(plan).adapters.length + classifyPlanTargets(plan).agents.length) > RECORD_REVIEW_MAX_UNITS)
      return { status: 'too-large' as const };
    const checks = Array.isArray(population.checks) ? population.checks : [];
    const complete = checks.length === POPULATION_CHECK_NAMES.length && POPULATION_CHECK_NAMES.every(name => checks.filter(c=>c?.name===name && typeof c.passed==='boolean').length===1);
    const source = { sourceDeclaredCount: population.declared_count, sourceGeneratedAt: population.generated_at === null ? null : new Date(population.generated_at).toISOString(),
      sourceQuality: (complete ? checks.every(c=>c.passed) ? 'verified' : 'problems' : 'unknown') as RecordReviewCounts['sourceQuality'], runEvidenceProblems: population.integrity_count };
    return { status: 'ready' as const, role, plan, source, revision: await this.revision(tx, runId) };
  }

  private async revision(tx: Transaction, runId: string): Promise<string> {
    // Authoritative event sequence plus immutable insert counts catches progress even
    // before its notification arrives. No timestamp-nearest joins or UI result writes.
    const [row] = await tx.execute<{ revision: string }>(sql`
      SELECT md5(jsonb_build_array(r.state, coalesce(h.last_sequence,0), coalesce(v.revision,0),
        (SELECT count(*) FROM run_observation WHERE run_id=r.run_id),
        (SELECT count(*) FROM run_observation_evaluation WHERE run_id=r.run_id),
        (SELECT count(*) FROM run_evidence_integrity WHERE run_id=r.run_id))::text) AS revision
      FROM audit_run r LEFT JOIN audit_event_heads h ON h.aggregate_id=r.run_id::text
      LEFT JOIN run_result_review v ON v.run_id=r.run_id WHERE r.run_id=${runId}::uuid`);
    return row!.revision;
  }

  /** Live totals reuse the exact review projection without evicting a reader's paging snapshot. */
  async readSummary(input: { runId: string; actorId: string }) {
    return this.db.transaction(async tx => {
      const context = await this.context(tx, input.runId, input.actorId);
      if (context.status !== 'ready') return context;
      const rows = await this.project(tx, input.runId, context.plan);
      const [totals] = await tx.execute<{ observations: number; pending: number }>(sql`
        SELECT (SELECT count(*)::int FROM run_observation WHERE run_id=${input.runId}::uuid) AS observations,
          (SELECT count(*)::int FROM run_observation_evaluation e LEFT JOIN run_evaluation_review r
            ON r.run_id=e.run_id AND r.observation_id=e.observation_id AND r.condition_id=e.condition_id
            WHERE e.run_id=${input.runId}::uuid AND
              (CASE WHEN r.decision_id IS NULL THEN e.confirmation ELSE r.effective_confirmation END)='pending') AS pending`);
      return { status: 'ready' as const, counts: this.counts(rows, context.source, totals!),
        revision: context.revision, readAt: this.now().toISOString() };
    }, { isolationLevel: 'repeatable read' });
  }

  async readPage(input: RecordReviewQuery): Promise<RecordReviewResult> {
    const normalized = query(input);
    if (!normalized) return { status: 'invalid' };
    const admissionDeadline = performance.now() + ADMISSION_TIMEOUT_MS;
    // Cheap admission attempts do not consume the bounded SSI retry budget. Every
    // attempt starts a fresh snapshot and authorizes only after acquiring admission.
    let serializationRetries = 0;
    for (;;) {
      if (!input.cursor && performance.now() >= admissionDeadline) return { status: 'unavailable' };
      let admissionExpired = false;
      let admissionTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<typeof ADMISSION_EXPIRED>(resolve => {
        const expire = () => {
          const remaining = admissionDeadline - performance.now();
          if (remaining > 0) {
            admissionTimer = setTimeout(expire, Math.ceil(remaining));
            return;
          }
          admissionExpired = true;
          resolve(ADMISSION_EXPIRED);
        };
        if (!input.cursor) expire();
      });
      try {
        const pending = this.db.transaction(async tx => {
          if (!input.cursor) {
            // A timed-out attempt may still be queued for a pool connection. It must
            // finish without reading context or creating a late presentation copy.
            if (admissionExpired || performance.now() >= admissionDeadline) return ADMISSION_EXPIRED;
            // This must be the first statement: waiting after context() would retain
            // a stale Serializable snapshot and repeatedly redo expensive projection.
            const [admission] = await tx.execute<{ acquired: boolean }>(sql`
              SELECT pg_try_advisory_xact_lock(hashtextextended(${`record-review:${input.actorId}:${input.runId}`},0)) AS acquired`);
            if (admissionExpired || performance.now() >= admissionDeadline) return ADMISSION_EXPIRED;
            if (!admission?.acquired) return ADMISSION_BUSY;
            // Admission bounds only acquisition. Once accepted, await the coherent
            // transaction through commit/rollback, even if projection takes longer.
            clearTimeout(admissionTimer);
          }
          const context = await this.context(tx, input.runId, input.actorId);
          if (context.status !== 'ready') return context;
          const queryDigest = digest(JSON.stringify([1, context.role, normalized]));
          let header: Header;
          let position = 0;
          if (input.cursor) {
            const parsed = decode(input.cursor);
            if (!parsed) return { status: 'invalid' as const };
            const [stored] = await tx.select().from(runReviewSnapshot).where(and(
              eq(runReviewSnapshot.snapshotId, parsed.id), eq(runReviewSnapshot.runId, input.runId),
              eq(runReviewSnapshot.actorId, input.actorId)));
            if (!stored || stored.queryDigest !== queryDigest || !timingSafeEqual(signature(stored, parsed.position), parsed.signature))
              return { status: 'invalid' as const };
            if (stored.expiresAt.getTime() <= this.now().getTime()) return { status: 'expired' as const };
            position = parsed.position;
            if (position % normalized.pageSize !== 0 || position >= Math.max(1, stored.rowCount)) return { status: 'invalid' as const };
            header = stored;
          } else {
            const rows = await this.project(tx, input.runId, context.plan);
            const [totals] = await tx.execute<{ observations: number; pending: number }>(sql`
              SELECT (SELECT count(*)::int FROM run_observation WHERE run_id=${input.runId}::uuid) AS observations,
                (SELECT count(*)::int FROM run_observation_evaluation e LEFT JOIN run_evaluation_review r
                  ON r.run_id=e.run_id AND r.observation_id=e.observation_id AND r.condition_id=e.condition_id
                  WHERE e.run_id=${input.runId}::uuid AND
                    (CASE WHEN r.decision_id IS NULL THEN e.confirmation ELSE r.effective_confirmation END)='pending') AS pending`);
            const counts = this.counts(rows, context.source, totals!);
            const filtered = rows.filter(row => this.matches(row, normalized));
            // Remove only bounded expired cache entries; immutable audit/evidence rows
            // are unrelated. The per-owner eviction remains bounded independently.
            await tx.execute(sql`DELETE FROM run_review_snapshot WHERE snapshot_id IN (
              SELECT snapshot_id FROM run_review_snapshot WHERE expires_at <= ${this.now().toISOString()}::timestamptz ORDER BY expires_at LIMIT 100)`);
            const older = await tx.select({ id: runReviewSnapshot.snapshotId }).from(runReviewSnapshot)
              .where(and(eq(runReviewSnapshot.actorId, input.actorId), eq(runReviewSnapshot.runId, input.runId)))
              .orderBy(desc(runReviewSnapshot.createdAt), desc(runReviewSnapshot.snapshotId));
            for (const old of older.slice(1)) await tx.delete(runReviewSnapshot).where(eq(runReviewSnapshot.snapshotId, old.id));
            const at = this.now();
            header = { snapshotId: randomUUID(), actorId: input.actorId, runId: input.runId,
              createdAt: at, expiresAt: new Date(at.getTime() + RECORD_REVIEW_TTL_MS), revision: context.revision,
              queryDigest, cursorKey: randomBytes(32).toString('hex'), counts, rowCount: filtered.length };
            await tx.insert(runReviewSnapshot).values(header);
            for (let i=0;i<filtered.length;i+=250) await tx.insert(runReviewSnapshotRow).values(
              filtered.slice(i,i+250).map((row,index) => ({ snapshotId: header.snapshotId, position: i+index, row })));
          }
          const rows = await tx.select({ row: runReviewSnapshotRow.row }).from(runReviewSnapshotRow)
            .where(and(eq(runReviewSnapshotRow.snapshotId, header.snapshotId), gt(runReviewSnapshotRow.position, position-1)))
            .orderBy(asc(runReviewSnapshotRow.position)).limit(normalized.pageSize);
          return { status: 'ready' as const, rows: rows.map(r => r.row), counts: header.counts,
            filteredRows: header.rowCount, asOf: header.createdAt.toISOString(), expiresAt: header.expiresAt.toISOString(),
            revision: header.revision, changesAvailable: context.revision !== header.revision,
            currentEvidenceProblems: context.source.runEvidenceProblems,
            cursor: cursor(header, position), nextCursor: position+normalized.pageSize < header.rowCount ? cursor(header, position+normalized.pageSize) : null,
            previousCursor: position > 0 ? cursor(header, Math.max(0,position-normalized.pageSize)) : null,
            pageNumber: Math.floor(position/normalized.pageSize)+1, ...normalized };
        }, { isolationLevel: input.cursor ? 'repeatable read' : 'serializable' });
        // Promise.race observes even a late rejection from a queued transaction.
        // The callback fences above prevent any abandoned attempt from projecting.
        const result = await Promise.race([pending, timeout]);
        clearTimeout(admissionTimer);
        if (result === ADMISSION_EXPIRED) return { status: 'unavailable' };
        if (result !== ADMISSION_BUSY) return result;
        // Await the completed transaction before backing off: no pool connection or
        // database transaction is retained while another reader owns admission.
        const remaining = admissionDeadline - performance.now();
        if (remaining <= 0) return { status: 'unavailable' };
        await delay(Math.min(remaining, 25 + Math.random() * 50));
      } catch (error) {
        const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
        if (!['40001', '40P01'].includes(code ?? '') || serializationRetries++ >= 7) {
          // Drizzle errors may embed SQL parameters, including source labels and cursor
          // material. Preserve only a closed-format diagnostic, never the raw cause.
          throw new Error(`Record review read failed (${typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : 'unavailable'})`);
        }
      } finally {
        clearTimeout(admissionTimer);
      }
    }
  }

  async readSelection(input: SelectionInput): Promise<RecordReviewSelectionResult> {
    const result = await this.readSelectionWithDetails(input, async () => undefined);
    if (result.status !== 'ready') return result;
    return result.selection;
  }

  /** Compose selected facts/review header in this same short consistent read boundary. */
  async readSelectionWithDetails<T>(input: SelectionInput, read: (selection: ReadySelection, tx: Transaction) => Promise<T>): Promise<
    Exclude<RecordReviewSelectionResult, ReadySelection> | { status: 'ready'; selection: ReadySelection; detail: T }
  > {
    if (!Number.isSafeInteger(input.sourceOrdinal) || input.sourceOrdinal <= 0) return { status: 'invalid' };
    return this.db.transaction(async tx => {
      const context = await this.context(tx, input.runId, input.actorId);
      if (context.status !== 'ready') return context;
      const [source] = await tx.select({ values: populationRow.values }).from(populationRow)
        .where(and(eq(populationRow.runId, input.runId), eq(populationRow.ordinal, input.sourceOrdinal)));
      if (!source) return { status: 'missing' as const };
      const rows = await this.project(tx, input.runId, context.plan, input.sourceOrdinal);
      if (!rows[0]) return { status: 'missing' as const };
      const selection: ReadySelection = { status: 'ready', row: rows[0], sourceValues: source.values as Record<string, JsonValue>,
        conditions: context.plan.inputs.complianceConditions.map(c => ({ conditionId: c.conditionId, text: c.text })),
        scope: context.plan.inputs.scope, readAt: this.now().toISOString(), revision: context.revision,
        changedSinceList: input.listedRevision !== undefined && context.revision !== input.listedRevision };
      return { status: 'ready' as const, selection, detail: await read(selection, tx) };
    }, { isolationLevel: 'repeatable read' }).catch(() => { throw new Error('Record inspector read failed'); });
  }

  private counts(rows: readonly RecordReviewRow[], source: Pick<RecordReviewCounts, 'sourceDeclaredCount' | 'sourceGeneratedAt' | 'sourceQuality' | 'runEvidenceProblems'>, totals: { observations: number; pending: number }): RecordReviewCounts {
    const included = rows.filter(r => r.disposition === 'included');
    const linked = new Set(rows.flatMap(r=>r.targets.flatMap(t=>t.observationId ? [t.observationId] : [])));
    const unattributedObservations = Math.max(0, totals.observations-linked.size);
    return { ...source, sourceRows: rows.length, includedRows: included.length,
      excludedRows: rows.filter(r=>r.disposition==='excluded').length,
      indeterminateRows: rows.filter(r=>r.disposition==='indeterminate').length,
      fullyInspectedSubjects: included.filter(r=>r.targets.length>0 && r.targets.every(t=>t.inspected)).length,
      inspectedUnits: included.reduce((n,r)=>n+r.targets.filter(t=>t.inspected).length,0),
      requiredUnits: included.reduce((n,r)=>n+r.targets.length,0),
      exceptionRecords: unattributedObservations > 0 ? null : rows.filter(r=>r.targets.some(t=>t.exception)).length,
      unattributedObservations, pendingAssessments: totals.pending,
      evidenceProblemRecords: rows.filter(r=>r.duplicateIdentity || r.missingIdentity || r.targets.some(t=>t.evidenceProblem)).length };
  }
  private matches(row: RecordReviewRow, q: Query): boolean {
    const needle = q.search.toLocaleLowerCase('en');
    if (needle && ![row.recordLabel, ...row.targets.flatMap(t=>[t.targetName,t.account??'',t.capturedStatus??''])]
      .some(text=>text.toLocaleLowerCase('en').includes(needle))) return false;
    return q.filter === 'all' || (q.filter==='exceptions' && row.targets.some(t=>t.exception)) ||
      (q.filter==='needs-review' && row.targets.some(t=>t.pendingAssessments>0)) ||
      (q.filter==='evidence-problems' && (row.duplicateIdentity || row.missingIdentity || row.targets.some(t=>t.evidenceProblem))) ||
      (q.filter==='not-inspected' && row.disposition==='included' && row.targets.some(t=>!t.inspected));
  }

  /** SQL keeps source membership, exact opaque keys and frozen targets authoritative.
   * The optional ordinal filter is AFTER duplicate counting over the whole population. */
  private async project(tx: Transaction, runId: string, plan: ExecutablePlan, ordinal?: number): Promise<RecordReviewRow[]> {
    const flat = await tx.execute<Flat>(recordReviewProjectionQuery(runId, plan, ordinal));
    const rows = new Map<number, { sourceOrdinal: number; recordLabel: string; disposition: string; duplicateIdentity: boolean; missingIdentity: boolean; targets: RecordReviewTarget[] }>();
    for (const unit of flat) {
      let row = rows.get(unit.ordinal);
      if (!row) { row = { sourceOrdinal: unit.ordinal, recordLabel: unit.key || `Source row ${unit.ordinal}`,
        disposition: unit.disposition, duplicateIdentity: unit.duplicate, missingIdentity: !unit.key, targets: [] }; rows.set(unit.ordinal,row); }
      if (unit.target_id === null) continue; // Reference-only plans still retain every source row.
      row.targets.push({ targetId: unit.target_id, targetName: unit.target_name,
        observationId: unit.observation_id, workItemId: unit.work_item_id,
        account: unit.account, capturedStatus: unit.captured_status, found: unit.found,
        inspected: unit.inspected, exception: unit.exception, pendingAssessments: unit.pending,
        evidenceProblem: unit.evidence_problem,
        assessmentState: unit.disposition==='excluded' ? 'excluded' : unit.disposition==='indeterminate' ? 'unevaluated' : unit.exception ? 'exception' : unit.pending>0 ? 'needs-review' :
          !unit.inspected ? 'not-inspected' : unit.unevaluated || unit.evaluation_count<plan.inputs.complianceConditions.length ? 'unevaluated' : 'compliant' });
    }
    return [...rows.values()];
  }
}

/** Expired presentation copies are removed even when no auditor opens another page. */
export async function purgeExpiredRecordReviews(db: Database, now = new Date()): Promise<number> {
  const rows = await db.execute<{ snapshot_id: string }>(sql`DELETE FROM run_review_snapshot WHERE snapshot_id IN (
    SELECT snapshot_id FROM run_review_snapshot WHERE expires_at <= ${now.toISOString()}::timestamptz
    ORDER BY expires_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING snapshot_id`);
  return rows.length;
}
export function startRecordReviewExpiry(db: Database, onError: () => void): () => Promise<void> {
  let pending: Promise<void> | undefined;
  let stopping = false;
  const tick = () => {
    if (stopping || pending) return;
    pending = purgeExpiredRecordReviews(db).then(() => undefined).catch(onError).finally(() => { pending = undefined; });
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  tick();
  return async () => { stopping = true; clearInterval(timer); await pending; };
}

/** Same query used in production, exported for actual PostgreSQL EXPLAIN acceptance. */
export function recordReviewProjectionQuery(runId: string, plan: ExecutablePlan, ordinal?: number) {
    const key = adapterLookupColumn(plan.inputs.templateId)!;
    const classification = classifyPlanTargets(plan);
    const required = [...classification.adapters, ...classification.agents].sort((a,b)=>a.ordinal-b.ordinal);
    const targets = JSON.stringify(required.map(t=>({ id:t.target.registrationId, name:t.target.displayName, step:t.stepId,
      subject: t.target.contract.kind==='web' && plan.inputs.templateId!=='P-4' })));
    return sql`
      WITH source AS (
        SELECT p.ordinal,p.disposition, CASE WHEN jsonb_typeof(p.values->${key})='string' THEN p.values->>${key} ELSE NULL END AS key,
          count(*) FILTER (WHERE p.disposition='included') OVER (PARTITION BY p.values->${key}) AS duplicates
        FROM population_row p WHERE p.run_id=${runId}::uuid
      ), targets AS (SELECT value->>'id' AS id,value->>'name' AS name,value->>'step' AS step,(value->>'subject')::boolean AS subject,ordinality FROM jsonb_array_elements(${targets}::jsonb) WITH ORDINALITY),
      observations AS (
        SELECT o.target_system,o.population_record_key,count(*) AS count,min(o.observation_id::text)::uuid AS id
        FROM run_observation o JOIN run_work_item w ON w.work_item_id=o.work_item_id AND w.run_id=o.run_id AND w.registration_id=o.target_system
        JOIN targets t ON t.id=o.target_system AND t.step=w.step_id AND
          ((t.subject AND w.subject_key=o.population_record_key) OR (NOT t.subject AND w.subject_key IS NULL))
        WHERE o.run_id=${runId}::uuid GROUP BY o.target_system,o.population_record_key
      ), evaluated AS (
        SELECT e.observation_id,count(*)::int AS count,
          bool_or(coalesce(r.effective_value,e.value)='EXCEPTION') AS exception,
          bool_or(coalesce(r.effective_value,e.value)='UNEVALUATED') AS unevaluated,
          count(*) FILTER (WHERE (CASE WHEN r.decision_id IS NULL THEN e.confirmation ELSE r.effective_confirmation END)='pending')::int AS pending
        FROM run_observation_evaluation e LEFT JOIN run_evaluation_review r ON r.run_id=e.run_id AND r.observation_id=e.observation_id AND r.condition_id=e.condition_id
        WHERE e.run_id=${runId}::uuid GROUP BY e.observation_id
      ), checked AS (
        SELECT observation_id,bool_or(outcome='FAIL') AS failed,
          array_agg(check_name) FILTER (WHERE outcome='PASS') AS passed
        FROM run_observation_check WHERE run_id=${runId}::uuid GROUP BY observation_id
      ), units AS (
        SELECT s.*,t.id AS target_id,t.name AS target_name,t.ordinality,
          o.observation_id,o.work_item_id,o.found,o.coverage,o.corroboration,
          (SELECT a->>'normalizedValue' FROM jsonb_array_elements(coalesce(o.attributes,'[]'::jsonb)) a
            WHERE a->>'name' IN ('username','account_name','account_id') LIMIT 1) AS account,
          (SELECT a->>'normalizedValue' FROM jsonb_array_elements(coalesce(o.attributes,'[]'::jsonb)) a
            WHERE a->>'name' IN ('account_status','status','enabled') LIMIT 1) AS captured_status,
          coalesce(e.exception,false) AS exception,coalesce(e.pending,0) AS pending,
          coalesce(e.count,0) AS evaluation_count,coalesce(e.unevaluated,false) AS unevaluated,
          coalesce(((o.found='true' AND o.corroboration='MATCHED') OR (o.found='false' AND EXISTS (
            SELECT 1 FROM run_observation_absence a WHERE a.run_id=${runId}::uuid AND a.observation_id=o.observation_id AND a.proof IS NOT NULL
          ))) AND c.passed @> ARRAY['required-evidence','ambiguous-match','freshness',
            CASE WHEN o.found='false' THEN 'search-completeness' ELSE 'identity-corroboration' END],false) AS checks_complete,
          s.disposition='included' AND (s.duplicates>1 OR coalesce(s.key,'')='' OR (o.observation_id IS NOT NULL AND (coalesce(c.failed,false) OR o.found='ambiguous' OR
            o.corroboration='CONTRADICTORY' OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(o.evidence_ids) evidence(id)
              WHERE NOT EXISTS (SELECT 1 FROM run_evidence re WHERE re.run_id=${runId}::uuid AND re.evidence_id::text=evidence.id AND re.state='REGISTERED')
                OR EXISTS (SELECT 1 FROM run_evidence_integrity ri WHERE ri.run_id=${runId}::uuid AND ri.evidence_id::text=evidence.id)
            )))) AS evidence_problem
        FROM source s LEFT JOIN targets t ON true
        LEFT JOIN observations m ON m.target_system=t.id AND m.population_record_key=s.key AND m.count=1
          AND s.disposition='included' AND s.duplicates=1 AND coalesce(s.key,'')<>''
        LEFT JOIN run_observation o ON o.observation_id=m.id
        LEFT JOIN evaluated e ON e.observation_id=o.observation_id
        LEFT JOIN checked c ON c.observation_id=o.observation_id
        ${ordinal === undefined ? sql`` : sql`WHERE s.ordinal=${ordinal}`}
      ) SELECT ordinal,key,disposition,duplicates>1 AND disposition='included' AS duplicate,
        target_id,target_name,observation_id,work_item_id,account,captured_status,found,
        coalesce(disposition='included' AND coverage='COVERED' AND checks_complete AND NOT evidence_problem,false) AS inspected,
        exception,pending,evidence_problem,evaluation_count,unevaluated
      FROM units ORDER BY ordinal,ordinality`;
}

/** Read-only acceptance probe: the exact production SELECT, not a model of its joins. */
export async function explainRecordReviewProjection(db: Database, runId: string, plan: ExecutablePlan) {
  return db.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${recordReviewProjectionQuery(runId, plan)}`);
}
