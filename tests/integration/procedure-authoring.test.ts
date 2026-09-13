import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { draftContext } from '@intellifin/domain';
import {
  AUTHORING_IDENTITY,
  acceptAuthoringSuggestion,
  derivePlan,
  generateAuthoringSuggestion,
  planAuthoringInputs,
  procedureVersionRowVersion,
  rejectAuthoringSuggestion,
  setUserRole,
  transitionVersion,
  updateContextDraft,
  type AuthoringDraftFields,
  type ProcedureAuthoringModel,
  type ProcedureVersionRecord,
  type SessionSnapshot,
} from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleProcedureRepository,
  DrizzleRoleRepository,
  DrizzleUserDirectory,
  PostgresAuditChainReader,
  PostgresIdentityUnitOfWork,
  PostgresProceduresUnitOfWork,
  SystemClock,
  OpenAIProcedureAuthoringModel,
  parseAuthoringRecord,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

const databaseUrl = process.env.DATABASE_URL;

type EventRow = {
  event_type: string;
  actor_type: string;
  actor_id: string;
  sequence: number;
  payload: Record<string, unknown>;
};

type RequestRow = {
  request_id: string;
  version_id: string;
  actor_id: string;
  record: Record<string, unknown>;
};

function latch<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function identitySession(userId: string): SessionSnapshot {
  return { userId, sessionId: `session-${userId}` };
}

/** A deterministic test double labelled with the product's configured identity. No live provider call. */
function syntheticModel(
  proposedText: string,
  beforeResponse?: () => Promise<void>,
  calls?: { value: number },
): ProcedureAuthoringModel {
  return {
    identity: AUTHORING_IDENTITY,
    propose: async () => {
      if (calls) calls.value += 1;
      if (beforeResponse) await beforeResponse();
      return {
        proposal: { proposedText, clarifications: [] },
        usage: { inputTokens: 31, outputTokens: 17 },
      };
    },
  };
}

describe.skipIf(!databaseUrl)('procedure writing assistance against PostgreSQL 18', () => {
  let sql: Sql;
  let db: Database;
  let proceduresUow: PostgresProceduresUnitOfWork;
  let repository: DrizzleProcedureRepository;
  const ids = new CryptoUuidV7Generator();
  const clock = new SystemClock();
  const procedureIds: string[] = [];

  const users = {
    admin: ids.next(),
    author: ids.next(),
    secondAuthor: ids.next(),
    manager: ids.next(),
    rateAuthor: ids.next(),
    revisionAuthor: ids.next(),
    failureAuthor: ids.next(),
  } as const;
  const allUsers = Object.values(users);

  beforeAll(async () => {
    sql = createSqlClient(databaseUrl!, { max: 12 });
    db = createDb(sql);
    proceduresUow = new PostgresProceduresUnitOfWork(db, { ids });
    repository = new DrizzleProcedureRepository(db);

    for (const [userId, role] of [
      [users.admin, 'poc-administrator'],
      [users.author, 'auditor'],
      [users.secondAuthor, 'auditor'],
      [users.manager, 'audit-manager'],
      [users.rateAuthor, 'auditor'],
      [users.revisionAuthor, 'auditor'],
      [users.failureAuthor, 'auditor'],
    ] as const) {
      await sql`
        INSERT INTO auth_user(id, name, email)
        VALUES (${userId}, ${`Synthetic ${role}`}, ${`${userId}@procedure-authoring.test`})
      `;
      await sql`INSERT INTO user_role(user_id, role) VALUES (${userId}, ${role})`;
    }
  });

  afterAll(async () => {
    for (const procedureId of new Set(procedureIds)) {
      // Jobs and notifications do not cascade from a version. Authoring requests do:
      // deleting the version below is the durable-receipt cleanup path under test.
      await sql`DELETE FROM pgboss.job WHERE data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id = ${procedureId})`;
      await sql`DELETE FROM notification WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id = ${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`;
    }
    for (const userId of allUsers) await sql`DELETE FROM user_role WHERE user_id = ${userId}`;
    for (const userId of allUsers) await sql`DELETE FROM auth_user WHERE id = ${userId}`;
    await sql.end({ timeout: 5 });
  });

  function authoringDependencies(model: ProcedureAuthoringModel | null) {
    return {
      roles: new DrizzleRoleRepository(db),
      unitOfWork: proceduresUow,
      ids,
      clock,
      model,
    };
  }

  function procedureDependencies() {
    return {
      roles: new DrizzleRoleRepository(db),
      unitOfWork: proceduresUow,
      ids,
    };
  }

  async function seedDraft(
    authorId: string = users.author,
    options: {
      readonly procedureId?: string;
      readonly versionNumber?: number;
      readonly authorship?: ProcedureVersionRecord['authorship'] | null;
    } = {},
  ): Promise<ProcedureVersionRecord> {
    const procedureId = options.procedureId ?? ids.next();
    const versionId = ids.next();
    const complete = activeRunVersion(procedureId, versionId, authorId, executablePlanInputs());
    const row: ProcedureVersionRecord = {
      ...complete,
      versionNumber: options.versionNumber ?? 1,
      state: 'DRAFT',
      authorship: options.authorship === undefined ? {
        createdBy: { type: 'human', id: authorId },
        responsibleAuthorId: authorId,
        humanAuthorIds: [authorId],
      } : options.authorship,
      decisions: [],
      frozenReview: null,
      submittedReview: null,
      lifecycle: null,
      sectionPreparation: null,
    };
    procedureIds.push(procedureId);
    await proceduresUow.execute(async ({ procedures }) => {
      if (row.versionNumber === 1) await procedures.insertProcedure(row);
      await procedures.insertVersion(row);
    });
    return row;
  }

  async function seedDraftPair(authorId: string): Promise<{ first: ProcedureVersionRecord; second: ProcedureVersionRecord }> {
    const procedureId = ids.next();
    const first = await seedDraft(authorId, { procedureId, versionNumber: 1 });
    const second = await seedDraft(authorId, { procedureId, versionNumber: 2 });
    return { first, second };
  }

  function draftInput(
    row: ProcedureVersionRecord,
    actorId: string,
    overrides: Partial<AuthoringDraftFields> = {},
  ): AuthoringDraftFields & { readonly session: SessionSnapshot; readonly correlationId: string } {
    return {
      procedureId: row.procedureId,
      versionId: row.versionId,
      expectedRowVersion: procedureVersionRowVersion(row),
      requestId: ids.next(),
      section: { kind: 'objective' },
      mode: 'improve',
      notes: 'State the objective precisely and preserve the complete population.',
      changes: 'Improve wording without changing scope or criteria.',
      session: identitySession(actorId),
      correlationId: ids.next(),
      ...overrides,
    };
  }

  function acceptanceInput(row: ProcedureVersionRecord, actorId: string, requestId: string, replacement: string) {
    return {
      procedureId: row.procedureId,
      versionId: row.versionId,
      expectedRowVersion: procedureVersionRowVersion(row),
      requestId,
      replacement,
      session: identitySession(actorId),
      correlationId: ids.next(),
    };
  }

  async function eventsFor(procedureId: string): Promise<EventRow[]> {
    return sql<EventRow[]>`
      SELECT event_type, actor_type, actor_id, sequence, payload
      FROM audit_events
      WHERE aggregate_id = ${procedureId}
      ORDER BY sequence
    `;
  }

  async function requestsFor(versionId: string): Promise<RequestRow[]> {
    return sql<RequestRow[]>`
      SELECT request_id, version_id, actor_id, record
      FROM procedure_authoring_request
      WHERE version_id = ${versionId}
      ORDER BY created_at, request_id
    `;
  }

  async function assertChain(procedureId: string): Promise<void> {
    expect(await new PostgresAuditChainReader(db).verify(procedureId)).toMatchObject({ valid: true });
  }

  it('serializes a concurrent generation receipt and makes one provider call', async () => {
    const row = await seedDraft();
    const entered = latch<void>();
    const release = latch<void>();
    const calls = { value: 0 };
    const model = syntheticModel('A precise objective for the complete population.', async () => {
      entered.resolve();
      await release.promise;
    }, calls);
    const input = draftInput(row, users.author);

    const first = generateAuthoringSuggestion(authoringDependencies(model), input);
    await entered.promise;
    let second: Awaited<typeof first>;
    try {
      second = await generateAuthoringSuggestion(authoringDependencies(model), input);
      expect(second).toMatchObject({ ok: true, suggestion: { requestId: input.requestId, state: 'pending', stale: false } });
      expect(calls.value).toBe(1);
    } finally {
      release.resolve();
    }

    const completed = await first;
    expect(completed).toMatchObject({ ok: true, suggestion: { requestId: input.requestId, state: 'ready', stale: false, proposedText: 'A precise objective for the complete population.' } });
    expect(calls.value).toBe(1);

    const stored = await requestsFor(row.versionId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ request_id: input.requestId, version_id: row.versionId, actor_id: users.author });
    expect(stored[0]?.record).toMatchObject({
      state: 'ready',
      identity: AUTHORING_IDENTITY,
      usage: { inputTokens: 31, outputTokens: 17 },
    });
    expect(JSON.stringify(stored[0]?.record)).not.toContain('preserve the complete population');

    const assistance = (await eventsFor(row.procedureId)).filter((event) => event.event_type === 'lifecycle.procedure-writing-assistance');
    expect(assistance).toHaveLength(2);
    expect(assistance.every((event) => event.actor_type === 'human' && event.actor_id === users.author)).toBe(true);
    expect(assistance.map((event) => event.payload['decision'])).toEqual(['requested', 'responded']);
    await assertChain(row.procedureId);
  });

  it('marks a suggestion stale when a human saves while the provider is pending', async () => {
    const row = await seedDraft();
    const entered = latch<void>();
    const release = latch<void>();
    const model = syntheticModel('The old provider wording.', async () => {
      entered.resolve();
      await release.promise;
    });
    const input = draftInput(row, users.author);
    const generation = generateAuthoringSuggestion(authoringDependencies(model), input);
    await entered.promise;

    const humanObjective = 'The human saved wording while the provider was still thinking.';
    try {
      const saved = await updateContextDraft(procedureDependencies(), {
        session: identitySession(users.author),
        correlationId: ids.next(),
        procedureId: row.procedureId,
        versionId: row.versionId,
        expectedRowVersion: procedureVersionRowVersion(row),
        edit: { ...draftContext(row.sections), objective: humanObjective },
      });
      expect(saved).toMatchObject({ ok: true, changed: true });
    } finally {
      release.resolve();
    }

    const completed = await generation;
    expect(completed).toMatchObject({ ok: true, suggestion: { state: 'ready', stale: true, proposedText: 'The old provider wording.' } });
    const current = (await repository.findVersion(row.versionId))!;
    expect(draftContext(current.sections).objective).toBe(humanObjective);
    if (!completed.ok) throw new Error(completed.reason);
    const accepted = await acceptAuthoringSuggestion(authoringDependencies(model), acceptanceInput(current, users.author, input.requestId, completed.suggestion.proposedText!));
    expect(accepted).toMatchObject({ ok: false, reason: expect.stringContaining('stale') });
    await assertChain(row.procedureId);
  });

  it('refuses acceptance after a pending request version is submitted', async () => {
    const row = await seedDraft();
    const entered = latch<void>();
    const release = latch<void>();
    const model = syntheticModel('A pending suggestion that must never edit a submitted version.', async () => {
      entered.resolve();
      await release.promise;
    });
    const input = draftInput(row, users.author);
    const generation = generateAuthoringSuggestion(authoringDependencies(model), input);
    await entered.promise;

    let submitted: Awaited<ReturnType<typeof transitionVersion>>;
    let refusal: Awaited<ReturnType<typeof acceptAuthoringSuggestion>>;
    let submittedRow!: ProcedureVersionRecord;
    try {
      submitted = await transitionVersion(procedureDependencies(), {
        session: identitySession(users.author),
        correlationId: ids.next(),
        procedureId: row.procedureId,
        versionId: row.versionId,
        expectedRowVersion: procedureVersionRowVersion(row),
      }, 'submit');
      expect(submitted).toMatchObject({ ok: true, state: 'SUBMITTED' });
      submittedRow = (await repository.findVersion(row.versionId))!;
      refusal = await acceptAuthoringSuggestion(authoringDependencies(model), acceptanceInput(submittedRow, users.author, input.requestId, 'This cannot be accepted after submission.'));
      expect(refusal).toEqual({ ok: false, reason: 'Only a Draft can be edited.' });
    } finally {
      release.resolve();
    }

    const submittedBeforeCompletion = structuredClone(submittedRow);
    const completed = await generation;
    expect(completed).toMatchObject({ ok: true, suggestion: { requestId: input.requestId, state: 'ready', stale: true, proposedText: 'A pending suggestion that must never edit a submitted version.' } });
    if (!completed.ok) throw new Error(completed.reason);
    expect(await repository.findVersion(row.versionId)).toEqual(submittedBeforeCompletion);

    const lateRefusal = await acceptAuthoringSuggestion(authoringDependencies(model), acceptanceInput(submittedRow, users.author, input.requestId, completed.suggestion.proposedText!));
    expect(lateRefusal).toEqual({ ok: false, reason: 'Only a Draft can be edited.' });
    expect(await repository.findVersion(row.versionId)).toEqual(submittedBeforeCompletion);
    const stored = await requestsFor(row.versionId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.record).toMatchObject({ state: 'ready', usage: { inputTokens: 31, outputTokens: 17 } });
    await assertChain(row.procedureId);
  });

  it('accepts a suggestion once, leaves duplicate acceptance idempotent, and re-derives before submission', async () => {
    const row = await seedDraft();
    const replacement = 'Use the approved objective wording for every production parameter.';
    const input = draftInput(row, users.author);
    const generated = await generateAuthoringSuggestion(authoringDependencies(syntheticModel(replacement)), input);
    expect(generated).toMatchObject({ ok: true, suggestion: { state: 'ready', stale: false, proposedText: replacement } });
    if (!generated.ok) throw new Error(generated.reason);

    const firstAcceptance = await acceptAuthoringSuggestion(authoringDependencies(syntheticModel(replacement)), acceptanceInput(row, users.author, input.requestId, replacement));
    expect(firstAcceptance).toMatchObject({ ok: true, alreadyApplied: false });
    const afterFirst = (await repository.findVersion(row.versionId))!;
    expect(draftContext(afterFirst.sections).objective).toBe(replacement);
    const secondAcceptance = await acceptAuthoringSuggestion(authoringDependencies(syntheticModel(replacement)), acceptanceInput(afterFirst, users.author, input.requestId, replacement));
    expect(secondAcceptance).toMatchObject({ ok: true, alreadyApplied: true, rowVersion: procedureVersionRowVersion(afterFirst) });
    const afterSecond = (await repository.findVersion(row.versionId))!;
    expect(procedureVersionRowVersion(afterSecond)).toBe(procedureVersionRowVersion(afterFirst));
    expect(draftContext(afterSecond.sections).objective).toBe(replacement);

    const assistance = (await eventsFor(row.procedureId)).filter((event) => event.event_type === 'lifecycle.procedure-writing-assistance');
    expect(assistance.filter((event) => event.payload['decision'] === 'accepted')).toHaveLength(1);
    expect((await eventsFor(row.procedureId)).filter((event) => event.event_type === 'lifecycle.procedure-draft-changed')).toHaveLength(1);

    const current = (await repository.findVersion(row.versionId))!;
    expect(current.planStatus).toBe('pending');
    expect(current.planInputDigest).toBeTruthy();
    expect(await derivePlan({ repository, unitOfWork: proceduresUow, ids, clock, model: null }, {
      schemaVersion: 1,
      versionId: current.versionId,
      inputDigest: current.planInputDigest!,
    })).toMatchObject({ ok: true, outcome: 'success' });
    const derived = (await repository.findVersion(row.versionId))!;
    expect(derived.planStatus).toBe('succeeded');
    expect(derived.planDerivable).toBe(true);
    expect(derived.compiledPlan?.inputs).toEqual(planAuthoringInputs(derived));

    expect(await transitionVersion(procedureDependencies(), {
      session: identitySession(users.author),
      correlationId: ids.next(),
      procedureId: row.procedureId,
      versionId: row.versionId,
      expectedRowVersion: procedureVersionRowVersion(derived),
    }, 'submit')).toMatchObject({ ok: true, state: 'SUBMITTED' });
    const events = await eventsFor(row.procedureId);
    expect(events.filter((event) => event.event_type === 'lifecycle.procedure-writing-assistance').every((event) => event.actor_type === 'human')).toBe(true);
    expect(generated.suggestion.proposedText).toBe(replacement);
    await assertChain(row.procedureId);
  });

  it('rejects a suggestion without changing the saved section or executable plan', async () => {
    const row = await seedDraft();
    const input = draftInput(row, users.author);
    const generated = await generateAuthoringSuggestion(authoringDependencies(syntheticModel('A draft that will be kept out of the Procedure.')), input);
    expect(generated).toMatchObject({ ok: true, suggestion: { state: 'ready' } });
    const before = (await repository.findVersion(row.versionId))!;
    const rejected = await rejectAuthoringSuggestion(authoringDependencies(syntheticModel('unused')), {
      procedureId: row.procedureId,
      versionId: row.versionId,
      requestId: input.requestId,
      session: identitySession(users.author),
      correlationId: ids.next(),
    });
    expect(rejected).toEqual({ ok: true });
    const after = (await repository.findVersion(row.versionId))!;
    expect(after).toEqual(before);
    expect((await requestsFor(row.versionId))[0]?.record).toMatchObject({ state: 'rejected' });
    expect(await rejectAuthoringSuggestion(authoringDependencies(null), {
      procedureId: row.procedureId,
      versionId: row.versionId,
      requestId: input.requestId,
      session: identitySession(users.author),
      correlationId: ids.next(),
    })).toEqual({ ok: true });
    expect((await eventsFor(row.procedureId)).filter((event) => event.event_type === 'lifecycle.procedure-draft-changed')).toHaveLength(0);
    expect((await eventsFor(row.procedureId)).filter((event) => event.event_type === 'lifecycle.procedure-writing-assistance' && event.payload['decision'] === 'rejected')).toHaveLength(1);
    await assertChain(row.procedureId);
  });

  it('keeps manual editing available when the authoring model is not configured', async () => {
    const row = await seedDraft();
    const input = draftInput(row, users.author);
    expect(await generateAuthoringSuggestion(authoringDependencies(null), input)).toEqual({
      ok: false,
      reason: 'Writing assistance is not configured. You can write, edit and save manually.',
    });
    expect(await requestsFor(row.versionId)).toHaveLength(0);

    const manualObjective = 'Manual writing remains the source of truth when no model is configured.';
    expect(await updateContextDraft(procedureDependencies(), {
      session: identitySession(users.author),
      correlationId: ids.next(),
      procedureId: row.procedureId,
      versionId: row.versionId,
      expectedRowVersion: procedureVersionRowVersion(row),
      edit: { ...draftContext(row.sections), objective: manualObjective },
    })).toMatchObject({ ok: true, changed: true });
    expect(draftContext((await repository.findVersion(row.versionId))!.sections).objective).toBe(manualObjective);
    await assertChain(row.procedureId);
  });

  it('persists and recovers a real-SDK streaming HTTP refusal without a second provider call', async () => {
    const row = await seedDraft(users.failureAuthor);
    const input = draftInput(row, users.failureAuthor, { section: { kind: 'scope' }, mode: 'draft', notes: 'Suggest to me', changes: '' });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_BODY', type: 'invalid_request_error' } }), {
      status: 401, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const deps = authoringDependencies(new OpenAIProcedureAuthoringModel('synthetic-key'));
      const seen = vi.fn(), first = await generateAuthoringSuggestion(deps, input, seen);
      expect(first).toMatchObject({ ok: true, suggestion: { state: 'failed', proposedText: null, message: expect.stringContaining('could not authenticate') } });
      const receipts = await requestsFor(row.versionId);
      expect(receipts).toHaveLength(1);
      expect(parseAuthoringRecord(receipts[0]!.record)).toMatchObject({ state: 'failed' });
      expect(await generateAuthoringSuggestion(deps, input, seen)).toEqual(first);
      expect(fetcher).toHaveBeenCalledTimes(1); expect(seen).not.toHaveBeenCalled();
      expect(procedureVersionRowVersion((await repository.findVersion(row.versionId))!)).toBe(procedureVersionRowVersion(row));
      expect(JSON.stringify(receipts) + JSON.stringify(await eventsFor(row.procedureId))).not.toMatch(/PRIVATE_PROVIDER_BODY|synthetic-key/);
      await assertChain(row.procedureId);
    } finally { vi.unstubAllGlobals(); }
  });

  it('records every human author, blocks a second author after a role change, and refuses an unknown actor', async () => {
    const row = await seedDraft();
    const replacement = 'The second auditor accepts this controlled objective wording.';
    const input = draftInput(row, users.secondAuthor);
    expect(await generateAuthoringSuggestion(authoringDependencies(syntheticModel(replacement)), input)).toMatchObject({ ok: true });
    const accepted = await acceptAuthoringSuggestion(authoringDependencies(null), acceptanceInput(row, users.secondAuthor, input.requestId, replacement));
    expect(accepted).toMatchObject({ ok: true, alreadyApplied: false });
    let current = (await repository.findVersion(row.versionId))!;
    expect(current.authorship?.humanAuthorIds).toEqual(expect.arrayContaining([users.author, users.secondAuthor]));
    expect(await derivePlan({ repository, unitOfWork: proceduresUow, ids, clock, model: null }, {
      schemaVersion: 1,
      versionId: current.versionId,
      inputDigest: current.planInputDigest!,
    })).toMatchObject({ ok: true, outcome: 'success' });
    current = (await repository.findVersion(row.versionId))!;

    const identityDependencies = {
      roles: new DrizzleRoleRepository(db),
      users: new DrizzleUserDirectory(db),
      unitOfWork: new PostgresIdentityUnitOfWork(db, { secret: 'procedure-authoring-test-secret', baseUrl: 'http://localhost:3000' }, { ids }),
    };
    expect(await setUserRole(identityDependencies, {
      session: identitySession(users.admin),
      correlationId: ids.next(),
      userId: users.secondAuthor,
      role: 'audit-manager',
      expectedRole: 'auditor',
    })).toMatchObject({ ok: true, priorRole: 'auditor', newRole: 'audit-manager' });

    expect(await transitionVersion(procedureDependencies(), {
      session: identitySession(users.author),
      correlationId: ids.next(),
      procedureId: row.procedureId,
      versionId: row.versionId,
      expectedRowVersion: procedureVersionRowVersion(current),
    }, 'submit')).toMatchObject({ ok: true, state: 'SUBMITTED' });
    const submitted = (await repository.findVersion(row.versionId))!;
    expect(await transitionVersion(procedureDependencies(), {
      session: identitySession(users.secondAuthor),
      correlationId: ids.next(),
      procedureId: row.procedureId,
      versionId: row.versionId,
      expectedRowVersion: procedureVersionRowVersion(submitted),
    }, 'approve')).toEqual({ ok: false, reason: 'You cannot approve a version you authored.' });
    expect(await transitionVersion(procedureDependencies(), {
      session: identitySession(users.manager),
      correlationId: ids.next(),
      procedureId: row.procedureId,
      versionId: row.versionId,
      expectedRowVersion: procedureVersionRowVersion(submitted),
    }, 'approve')).toMatchObject({ ok: true });

    const unknownAuthorRow = await seedDraft(users.author, { authorship: null });
    const unknownAuthorCalls = { value: 0 };
    expect(await generateAuthoringSuggestion(authoringDependencies(syntheticModel('Must not be called.', undefined, unknownAuthorCalls)), draftInput(unknownAuthorRow, users.author))).toEqual({
      ok: false,
      reason: 'The authorship of this draft could not be verified.',
    });
    expect(unknownAuthorCalls.value).toBe(0);
    expect(await requestsFor(unknownAuthorRow.versionId)).toHaveLength(0);

    const unknown = ids.next();
    const unknownRow = await seedDraft();
    const calls = { value: 0 };
    expect(await generateAuthoringSuggestion(authoringDependencies(syntheticModel('Must not be called.', undefined, calls)), draftInput(unknownRow, unknown))).toEqual({
      ok: false,
      reason: 'Your role does not permit this action.',
    });
    expect(calls.value).toBe(0);
    expect(await requestsFor(unknownRow.versionId)).toHaveLength(0);
    await assertChain(row.procedureId);
    await assertChain(unknownAuthorRow.procedureId);
    await assertChain(unknownRow.procedureId);
  });

  it('counts authoring requests across Procedure Versions for one actor', async () => {
    const { first, second } = await seedDraftPair(users.rateAuthor);
    const model = syntheticModel('A bounded rate-limit proposal.');
    for (let index = 0; index < 5; index += 1) {
      expect(await generateAuthoringSuggestion(authoringDependencies(model), draftInput(first, users.rateAuthor, { notes: `Request ${index + 1} on version one.` }))).toMatchObject({ ok: true });
    }
    expect(await generateAuthoringSuggestion(authoringDependencies(model), draftInput(second, users.rateAuthor, { notes: 'Request six on version two.' }))).toMatchObject({ ok: true });
    expect(await generateAuthoringSuggestion(authoringDependencies(model), draftInput(second, users.rateAuthor, { notes: 'Request seven must be refused.' }))).toEqual({
      ok: false,
      reason: 'The writing request limit has been reached. Try later or keep writing manually.',
    });
    expect(await requestsFor(first.versionId)).toHaveLength(5);
    expect(await requestsFor(second.versionId)).toHaveLength(1);
    await assertChain(first.procedureId);
  });

  it('persists revision feedback and explanation, forwards the working draft, and parses legacy receipts', async () => {
    const row = await seedDraft(users.revisionAuthor);
    type Prompt = Parameters<ProcedureAuthoringModel['propose']>[0];
    const prompts: Prompt[] = [];
    const model: ProcedureAuthoringModel = {
      identity: AUTHORING_IDENTITY,
      propose: async (input) => {
        prompts.push(input);
        return prompts.length === 1
          ? { proposal: { proposedText: 'Initial database-backed proposal.', clarifications: [] }, usage: { inputTokens: 31, outputTokens: 17 } }
          : {
            proposal: {
              proposedText: 'Revised database-backed proposal.',
              clarifications: [],
              explanation: 'The latest correction was applied to the supplied working draft.',
            },
            usage: { inputTokens: 37, outputTokens: 19 },
          };
      },
    };
    const firstRequestId = ids.next();
    const first = await generateAuthoringSuggestion(authoringDependencies(model), draftInput(row, users.revisionAuthor, {
      requestId: firstRequestId,
      changes: 'Start from the saved objective.',
    }));
    expect(first).toMatchObject({ ok: true, suggestion: { state: 'ready', proposedText: 'Initial database-backed proposal.' } });
    const workingDraft = `${'d'.repeat(8990)} USER EDITED TAIL`;
    const secondRequestId = ids.next();
    const secondInput = draftInput(row, users.revisionAuthor, {
      requestId: secondRequestId,
      mode: 'revise',
      changes: 'Keep the approved baseline and add the current evidence citation.',
      revision: { requestId: firstRequestId, draft: workingDraft },
    });
    const second = await generateAuthoringSuggestion(authoringDependencies(model), secondInput);
    if (!second.ok) throw new Error(second.reason);
    expect(second).toMatchObject({
      ok: true,
      suggestion: {
        state: 'ready',
        proposedText: 'Revised database-backed proposal.',
        explanation: 'The latest correction was applied to the supplied working draft.',
      },
    });
    expect(prompts[1]?.revision).toEqual({
      draft: workingDraft,
      history: [{ feedback: '', proposedText: 'Initial database-backed proposal.', clarifications: [] }],
    });

    const persisted = await requestsFor(row.versionId);
    const revisedRecord = persisted.find((record) => record.request_id === secondRequestId)?.record;
    expect(revisedRecord).toMatchObject({
      requestId: secondRequestId,
      explanation: 'The latest correction was applied to the supplied working draft.',
      revision: {
        requestId: firstRequestId,
        draft: workingDraft,
        feedback: secondInput.changes,
      },
      usage: { inputTokens: 37, outputTokens: 19 },
    });
    expect(JSON.stringify(revisedRecord)).toContain('USER EDITED TAIL');

    if (!revisedRecord) throw new Error('revision receipt was not persisted');
    const legacyRecord = structuredClone(revisedRecord);
    delete legacyRecord['explanation'];
    delete legacyRecord['revision'];
    const identity = legacyRecord['identity'];
    if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) throw new Error('receipt identity was not persisted');
    for (const promptVersion of ['guided-prose-v1', 'guided-test-design-v2']) {
      legacyRecord['identity'] = { ...identity, promptVersion };
      expect(parseAuthoringRecord(legacyRecord)).toMatchObject({
        requestId: secondRequestId,
        proposedText: 'Revised database-backed proposal.',
        identity: { promptVersion },
      });
    }
    await assertChain(row.procedureId);
  });
});
