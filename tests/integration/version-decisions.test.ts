import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { deriveExecutablePlan } from '@intellifin/domain';
import { derivePlan, updateEvidenceDraft, retryPlanDerivation, initialPlanDerivation, planAuthoringDigest, procedureVersionRowVersion, transitionVersion, deliverNotifications, type ProcedureVersionRecord, type ProceduresUnitOfWorkContext, type AuditUnitOfWork } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleProcedureRepository, DrizzleRoleRepository, PostgresProceduresUnitOfWork, DrizzleNotificationRepository, InAppNotificationSender, type Database, type Sql } from '@intellifin/infrastructure';
import { executablePlanInputs } from '../fixtures/executable-plan.js';
import { readFileSync } from 'node:fs';
const url = process.env['DATABASE_URL'];
const latch = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
describe.skipIf(!url)('transactional Procedure Version decisions', () => {
  let sql: Sql, db: Database, uow: PostgresProceduresUnitOfWork, repository: DrizzleProcedureRepository;
  const ids = new CryptoUuidV7Generator(), procedures: string[] = [], prefix = ids.next();
  const author = `${prefix}-author`, manager = `${prefix}-manager`, manager2 = `${prefix}-manager2`;
  beforeAll(async () => {
    sql = createSqlClient(url!, { max: 8 }); db = createDb(sql); uow = new PostgresProceduresUnitOfWork(db); repository = new DrizzleProcedureRepository(db);
    for (const [id, role] of [[author,'auditor'],[manager,'audit-manager'],[manager2,'audit-manager']] as const) {
      await sql`INSERT INTO auth_user(id,name,email) VALUES (${id},${id},${id + '@test.invalid'})`;
      await sql`INSERT INTO user_role(user_id,role) VALUES (${id},${role})`;
    }
  });
  afterAll(async () => {
    for (const id of procedures) { await sql`DELETE FROM notification WHERE procedure_id = ${id}`; await sql`DELETE FROM pgboss.job WHERE data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id = ${id})`; await sql`DELETE FROM procedure_version WHERE procedure_id = ${id}`; await sql`DELETE FROM procedure WHERE procedure_id = ${id}`; }
    for (const id of [author,manager,manager2]) await sql`DELETE FROM auth_user WHERE id = ${id}`;
    await sql.end({ timeout: 5 });
  });
  async function seed() {
    const plan = deriveExecutablePlan(executablePlanInputs()); if (!plan.ok) throw new Error(plan.reason);
    let row: ProcedureVersionRecord = { ...executablePlanInputs(), ...initialPlanDerivation(), procedureId: ids.next(), versionId: ids.next(), versionNumber: 1, state: 'DRAFT', compiledPlan: plan.plan, planStatus: 'succeeded', planDerivable: true, authorship: { createdBy: { type: 'human', id: author }, responsibleAuthorId: author, humanAuthorIds: [author] } };
    row = { ...row, planInputDigest: planAuthoringDigest(row) }; procedures.push(row.procedureId);
    await uow.execute(async ({ procedures: writer }) => { await writer.insertProcedure(row); await writer.insertVersion(row); }); return row;
  }
  function act(row: ProcedureVersionRecord, decision: 'submit'|'approve'|'reject'|'edit', actor: string, transaction: AuditUnitOfWork<ProceduresUnitOfWorkContext> = uow) {
    return transitionVersion({ roles: new DrizzleRoleRepository(db), unitOfWork: transaction, ids }, { session: { userId: actor, sessionId: actor }, correlationId: ids.next(), procedureId: row.procedureId, versionId: row.versionId, expectedRowVersion: procedureVersionRowVersion(row), rationale: 'Please clarify the Evidence Requirements.' }, decision);
  }
  it('writes submission to every manager and worker delivery is private and idempotent', async () => {
    const row = await seed(); expect(await act(row,'submit',author)).toMatchObject({ ok: true });
    const rows = await sql`SELECT * FROM notification WHERE version_id = ${row.versionId}`;
    const managers = await sql`SELECT user_id FROM user_role WHERE role = 'audit-manager'`;
    expect(rows.map(r => r.recipient_id).sort()).toEqual(managers.map(r => r.user_id).sort());
    expect(rows.every(r => r.delivered_at === null)).toBe(true);
    const notifications = new DrizzleNotificationRepository(db), sender = new InAppNotificationSender(db);
    expect((await notifications.deliveredFor({ userId: manager, sessionId: manager })).items).not.toContainEqual(expect.objectContaining({ versionId: row.versionId }));
    for (const n of (await notifications.pending(100)).filter(n => n.versionId === row.versionId)) { await sender.send(n); await sender.send(n); }
    expect((await notifications.deliveredFor({ userId: manager, sessionId: manager })).items.filter(n => n.versionId === row.versionId)).toHaveLength(1);
    expect((await notifications.deliveredFor({ userId: author, sessionId: author })).items.filter(n => n.versionId === row.versionId)).toHaveLength(0);
    await uow.execute(async ({ notifications: writer }) => { await writer!.enqueue({ sendKey: String(rows[0]!.send_key), recipientId: String(rows[0]!.recipient_id), procedureId: row.procedureId, versionId: row.versionId, procedureName: row.controlName, versionNumber: row.versionNumber, kind: 'submitted' }); });
    expect(await sql`SELECT * FROM notification WHERE version_id = ${row.versionId}`).toHaveLength(rows.length);
    expect(await act((await repository.findVersion(row.versionId))!,'approve',manager)).toMatchObject({ ok: true });
    await deliverNotifications(notifications, sender);
    expect((await notifications.deliveredFor({ userId: author, sessionId: author })).items.filter(n => n.versionId === row.versionId)).toMatchObject([{ kind: 'approved' }]);
  });
  it.each(['submit','approve','reject'] as const)('rolls %s state, event and notification back after the notification insert', async decision => {
    let row = await seed(); if (decision !== 'submit') { await act(row,'submit',author); row = (await repository.findVersion(row.versionId))!; }
    const beforeEvents = await sql`SELECT * FROM audit_events WHERE aggregate_id = ${row.procedureId}`, beforeNotifications = await sql`SELECT * FROM notification WHERE version_id = ${row.versionId}`;
    const failing: AuditUnitOfWork<ProceduresUnitOfWorkContext> = { execute: work => uow.execute(ctx => work({ ...ctx, notifications: { enqueue: async n => { await ctx.notifications!.enqueue(n); throw new Error('forced rollback'); } } })) };
    await expect(act(row,decision,decision === 'submit' ? author : manager,failing)).rejects.toThrow('forced rollback');
    expect(procedureVersionRowVersion((await repository.findVersion(row.versionId))!)).toBe(procedureVersionRowVersion(row));
    expect(await sql`SELECT * FROM audit_events WHERE aggregate_id = ${row.procedureId}`).toEqual(beforeEvents);
    expect(await sql`SELECT * FROM notification WHERE version_id = ${row.versionId}`).toEqual(beforeNotifications);
  });
  it('holds the first approval transaction open until the competing decision is blocked on its lock', async () => {
    const draft = await seed(); await act(draft,'submit',author); const submitted = (await repository.findVersion(draft.versionId))!;
    const entered = latch(), release = latch();
    const held: AuditUnitOfWork<ProceduresUnitOfWorkContext> = { execute: work => uow.execute(ctx => work({ ...ctx, procedures: { ...ctx.procedures,
      findLatestActiveVersion: id => ctx.procedures.findLatestActiveVersion!(id), recordSuccession: r => ctx.procedures.recordSuccession!(r), insertProcedure: r => ctx.procedures.insertProcedure(r), insertVersion: r => ctx.procedures.insertVersion(r), findVersion: id => ctx.procedures.findVersion(id), findVersionForUpdate: id => ctx.procedures.findVersionForUpdate(id), maxVersionNumber: id => ctx.procedures.maxVersionNumber(id), findPreviousVersion: (id,n) => ctx.procedures.findPreviousVersion!(id,n),
      updateVersion: async row => { await ctx.procedures.updateVersion(row); entered.resolve(); await release.promise; },
    } })) };
    const first = act(submitted,'approve',manager,held); await entered.promise;
    const second = act(submitted,'approve',manager2);
    try {
      const deadline = Date.now() + 10000; let blocked = false;
      while (Date.now() < deadline) { const waiting = await sql`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND (query LIKE '%procedure_version%' OR query LIKE '%pg_advisory_xact_lock%')`; if (waiting.length) { blocked = true; break; } await new Promise(r => setTimeout(r,25)); }
      expect(blocked).toBe(true);
    } finally { release.resolve(); }
    expect(await first).toMatchObject({ ok: true, state: 'ACTIVE' });
    expect(await second).toMatchObject({ ok: false, reason: expect.stringContaining('changed since') });
    const frozen = (await repository.findVersion(draft.versionId))!;
    expect(frozen.frozenReview?.approval.actorId).toBe(manager); expect(frozen.decisions).toHaveLength(2);
    expect(frozen.frozenReview?.definition.compiledPlan).toEqual(submitted.compiledPlan);
  });
  it('keeps the submitted baseline even if the previous Draft changes before approval', async () => {
    const prior = await seed();
    await uow.execute(async ({ procedures: writer }) => { await writer.updateVersion({ ...prior, scope: 'Saved prior scope without a derived plan', compiledPlan: null, planDerivable: false, planStatus: 'pending' }); });
    let successor: ProcedureVersionRecord = { ...prior, versionId: ids.next(), versionNumber: 2 };
    await uow.execute(async ({ procedures: writer }) => { await writer.insertVersion(successor); });
    expect(await act(successor,'submit',author)).toMatchObject({ ok: true });
    successor = (await repository.findVersion(successor.versionId))!;
    const snapshot = successor.submittedReview!;
    expect(snapshot.baseline?.versionId).toBe(prior.versionId);
    expect(snapshot.diff.find(s => s.section === 'Period and scope')?.before).toMatchObject({ scope: 'Saved prior scope without a derived plan' });
    await uow.execute(async ({ procedures: writer }) => { const current = (await writer.findVersionForUpdate(prior.versionId))!; await writer.updateVersion({ ...current, scope: 'A later change the Manager did not review' }); });
    expect(await act(successor,'approve',manager)).toMatchObject({ ok: true });
    expect((await repository.findVersion(successor.versionId))!.frozenReview?.diff).toEqual(snapshot.diff);
  });
  it('authorizes and submits with a one-connection pool without waiting for an outer role read', async () => {
    const row = await seed(), single = createSqlClient(url!,{max:1});
    try {
      const singleDb = createDb(single);
      const operation = transitionVersion({ roles:new DrizzleRoleRepository(singleDb),unitOfWork:new PostgresProceduresUnitOfWork(singleDb),ids },{session:{userId:author,sessionId:author},procedureId:row.procedureId,versionId:row.versionId,expectedRowVersion:procedureVersionRowVersion(row),correlationId:ids.next()},'submit');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { expect(await Promise.race([operation,new Promise((_,reject) => { timer=setTimeout(() => reject(new Error('one-connection transition deadlocked')),3000); })])).toMatchObject({ok:true}); } finally { clearTimeout(timer); }
    } finally { await single.end({timeout:1}); }
  });
  it('backfills only creation and human authored-definition events, excluding derivation actors', async () => {
    const dedicated = createSqlClient(url!, { max: 1 });
    const migration = readFileSync(new URL('../../packages/infrastructure/drizzle/0013_blue_warstar.sql', import.meta.url),'utf8');
    const start = migration.indexOf('UPDATE procedure_version AS version');
    const backfill = migration.slice(start, migration.indexOf('--> statement-breakpoint', start));
    try {
      await dedicated`CREATE TEMP TABLE procedure_version (version_id uuid, procedure_id uuid, authorship jsonb)`;
      await dedicated`CREATE TEMP TABLE audit_events (actor_type text, actor_id text, event_type text, aggregate_id text, payload jsonb)`;
      const procedureId = ids.next(), versionId = ids.next(), orphan = ids.next();
      await dedicated`INSERT INTO procedure_version VALUES (${versionId},${procedureId},NULL),(${orphan},${procedureId},NULL)`;
      for (const [actor,kind] of [[author,'lifecycle.procedure-created'],[manager,'lifecycle.procedure-draft-changed'],['worker','lifecycle.procedure-plan-started'],[manager2,'lifecycle.procedure-plan-retried']] as const) await dedicated`INSERT INTO audit_events VALUES ('human',${actor},${kind},${procedureId},${dedicated.json({ versionId })})`;
      await dedicated.unsafe(backfill);
      const rows = await dedicated`SELECT * FROM procedure_version ORDER BY version_id`;
      expect(rows.find(r => r.version_id === versionId)?.authorship).toEqual({ createdBy: { type:'human',id:author }, responsibleAuthorId: author, humanAuthorIds: [author,manager].sort() });
      expect(rows.find(r => r.version_id === orphan)?.authorship).toBeNull();
    } finally { await dedicated.end({ timeout:5 }); }
  });
  it('refuses an invalid predecessor instead of fabricating a first-version review', async () => {
    const prior = await seed(), successor = { ...prior, versionId: ids.next(), versionNumber: 2 };
    await uow.execute(async ctx => ctx.procedures.insertVersion(successor));
    await sql`UPDATE procedure_version SET decisions = '[{}]'::jsonb WHERE version_id = ${prior.versionId}`;
    expect(await act(successor,'submit',author)).toMatchObject({ok:false,reason:expect.stringContaining('previous Procedure Version could not be verified')});
    expect((await repository.findVersion(successor.versionId))?.state).toBe('DRAFT');
    expect(await sql`SELECT * FROM notification WHERE version_id = ${successor.versionId}`).toHaveLength(0);
  });
  it.each(['owner','duplicate','unknown-section','after','changed','first-before','later-flag'] as const)('rejects a contradictory durable review: %s', async corruption => {
    const draft = await seed(); await act(draft,'submit',author);
    const submitted = (await repository.findVersion(draft.versionId))!;
    const review = structuredClone(submitted.submittedReview!);
    const altered = JSON.parse(JSON.stringify(review));
    if (corruption === 'owner') altered.versionId = ids.next();
    if (corruption === 'duplicate') altered.diff[1] = altered.diff[0];
    if (corruption === 'unknown-section') altered.diff[0].section = 'Invented section';
    if (corruption === 'after') altered.diff[2].after.scope = 'Contradicts the compiled definition';
    if (corruption === 'changed') altered.diff[0].changed = false;
    if (corruption === 'first-before') altered.diff[0].before = 'Impossible first baseline';
    if (corruption === 'later-flag') { altered.baseline={versionId:ids.next(),versionNumber:1,revision:'a'.repeat(64)}; altered.diff.forEach((entry:{before:unknown;after:unknown;changed:boolean})=>{entry.before=entry.after;entry.changed=false;}); altered.diff[0].changed=true; }
    await sql`UPDATE procedure_version SET submitted_review = ${JSON.stringify(altered)}::jsonb WHERE version_id = ${draft.versionId}`;
    expect(await repository.findVersion(draft.versionId)).toBeNull();
    expect(await act(submitted,'approve',manager)).toMatchObject({ok:false});
    expect((await sql`SELECT state FROM procedure_version WHERE version_id = ${draft.versionId}`)[0]?.state).toBe('SUBMITTED');
  });
  it('paginates over 100 notices with exact timestamp ties, stable ordering and recipient privacy', async () => {
    const first = await seed(), second = await seed();
    const indexes = await sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'notification_pending_delivery_idx'`;
    expect(indexes[0]?.indexdef).toContain('(created_at, send_key) WHERE (delivered_at IS NULL)');
    const prefix = ids.next();
    await uow.execute(async ({notifications}) => {
      for (let i=0;i<109;i++) {
        const row = i % 2 ? first : second;
        await notifications.enqueue({sendKey:`${prefix}-${String(i).padStart(3,'0')}`,recipientId:i<105?manager2:author,procedureId:row.procedureId,versionId:row.versionId,procedureName:`${row.controlName} ${i%2?'first':'second'}`,versionNumber:row.versionNumber,kind:'submitted'});
      }
    });
    await sql`UPDATE notification SET delivered_at = '2099-01-01T00:00:00.123456Z'::timestamptz WHERE send_key LIKE ${prefix+'%'}`;
    const repository = new DrizzleNotificationRepository(db), session = {userId:manager2,sessionId:manager2};
    const page1 = await repository.deliveredFor(session);
    expect(page1.items).toHaveLength(100); expect(page1.nextCursor?.deliveredAt).toBe('2099-01-01T00:00:00.123456Z');
    const page2 = await repository.deliveredFor(session,page1.nextCursor!);
    const owned = [...page1.items,...page2.items].filter(n=>n.sendKey.startsWith(prefix));
    expect(owned).toHaveLength(105); expect(new Set(owned.map(n=>n.sendKey)).size).toBe(105);
    expect(owned.every(n=>n.recipientId===manager2)).toBe(true);
    expect(owned.map(n=>n.sendKey)).toEqual([...owned.map(n=>n.sendKey)].sort());
    expect(new Set(owned.map(n=>n.procedureName)).size).toBe(2);
    expect(owned.every(n=>n.createdAt && n.versionNumber===1)).toBe(true);
    const other = await repository.deliveredFor({userId:author,sessionId:author},page1.nextCursor!);
    expect(other.items.filter(n=>n.sendKey.startsWith(prefix))).toHaveLength(4);
    expect(other.items.every(n=>n.recipientId===author)).toBe(true);
  });
  it.each(['evidence-requirements','schedule'] as const)('records actual %s authorship while no-ops and derivation remain operational', async section => {
    let row = await seed();
    const dependencies = {roles:new DrizzleRoleRepository(db),unitOfWork:uow,ids};
    const request = (actor:string) => ({session:{userId:actor,sessionId:actor},correlationId:ids.next(),procedureId:row.procedureId,versionId:row.versionId,expectedRowVersion:procedureVersionRowVersion(row)});
    const evidence = () => row.evidenceRequirements.map(({platformCaptured:_,...fields})=>fields);
    if (section==='evidence-requirements') {
      expect(await updateEvidenceDraft(dependencies,{...request(author),edit:{section,requirements:[{attributeName:'Parameter',modelRead:false,groundedBy:['structural-snapshot'],screenshot:true,recordingSegment:false}]}})).toMatchObject({ok:true});
      row=(await repository.findVersion(row.versionId))!;
    }
    const unchanged = section==='schedule' ? {section,frequency:row.schedule!.frequency,startTime:row.schedule!.startTime} : {section,requirements:evidence()};
    expect(await updateEvidenceDraft(dependencies,{...request(manager),edit:unchanged})).toMatchObject({ok:true,changed:false});
    row=(await repository.findVersion(row.versionId))!; expect(row.authorship?.humanAuthorIds).toEqual([author]);
    const edit = section==='schedule' ? {section,frequency:'once' as const,startTime:'03:45'} : {section,requirements:evidence().map((entry,i)=>i===0?{...entry,recordingSegment:!entry.recordingSegment}:entry)};
    expect(await updateEvidenceDraft(dependencies,{...request(manager),edit})).toMatchObject({ok:true,changed:true});
    row=(await repository.findVersion(row.versionId))!; expect(row.authorship?.humanAuthorIds).toContain(manager);
    await uow.execute(async ({procedures})=>procedures.updateVersion({...row,planStatus:'failed',planFailureReason:'Synthetic interruption',compiledPlan:null,planDerivable:false}));
    row=(await repository.findVersion(row.versionId))!;
    expect(await retryPlanDerivation(dependencies,request(manager2))).toMatchObject({ok:true});
    row=(await repository.findVersion(row.versionId))!;
    expect(await derivePlan({repository,unitOfWork:uow,ids,clock:{now:()=>new Date()},model:null},{schemaVersion:1,versionId:row.versionId,inputDigest:row.planInputDigest!})).toMatchObject({ok:true,outcome:'success'});
    row=(await repository.findVersion(row.versionId))!;
    expect(row.authorship?.humanAuthorIds).toEqual([author,manager]);
    expect(await act(row,'submit',author)).toMatchObject({ok:true}); row=(await repository.findVersion(row.versionId))!;
    expect(await act(row,'approve',manager)).toMatchObject({ok:false,reason:'You cannot approve a version you authored.'});
  });
  it.each([
    {deliveredAt:'2026-02-30T00:00:00.123456Z',sendKey:'valid'},
    {deliveredAt:'0000-01-01T00:00:00.123456Z',sendKey:'valid'},
    {deliveredAt:'2026-01-01T00:00:00.123456Z',sendKey:'bad\u0000key'},
  ])('refuses malformed older-page cursor before SQL: %j', async cursor => {
    await expect(new DrizzleNotificationRepository(db).deliveredFor({userId:manager,sessionId:manager},cursor)).rejects.toThrow('Invalid notification cursor');
  });
});
