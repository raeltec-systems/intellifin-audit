import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initiateRun, NO_RUN_OWNER, RUN_ALREADY_ACTIVE, RUN_TOKEN_REUSED, type RunsUnitOfWorkContext, type AuditUnitOfWork } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleRoleRepository, DrizzleRunRepository, PostgresRunsUnitOfWork, PostgresProceduresUnitOfWork, PostgresAuditChainReader, SystemClock, type Database, type Sql } from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
const url = process.env.DATABASE_URL;
describe.skipIf(!url)('durable queued Run initiation', () => {
  let sql: Sql, db: Database, uow: PostgresRunsUnitOfWork;
  const ids = new CryptoUuidV7Generator(), author = `${ids.next()}-run-author`, procedures: string[] = [];
  const session = { userId: author, sessionId: author }, period = { from: '2026-08-01', to: '2026-08-31' };
  beforeAll(async () => {
    if (!['localhost','127.0.0.1','[::1]','postgres','db'].includes(new URL(url!).hostname)) throw new Error('Run tests require an isolated database');
    sql = createSqlClient(url!, { max: 6 }); db = createDb(sql); uow = new PostgresRunsUnitOfWork(db);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},${author},${author+'@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
  });
  afterAll(async () => {
    for (const id of procedures) {
      const runs = await sql`SELECT run_id::text FROM audit_run WHERE procedure_id=${id}`;
      for (const run of runs) { await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.run_id}`; await sql`DELETE FROM audit_events WHERE aggregate_id=${run.run_id}`; await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${run.run_id}`; }
      await sql`DELETE FROM run_result WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
      await sql`DELETE FROM run_evidence_package WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
      // Generation 32: a refusal row has no `run_id` and names the blocking Run in
      // `refused_run_id`, so the row is deleted by the subject Procedure it carries.
      await sql`DELETE FROM run_initiation_request WHERE procedure_id=${id}`;
      await sql`DELETE FROM audit_run WHERE procedure_id=${id}`;
      await sql`DELETE FROM procedure_succession WHERE procedure_id=${id}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${id}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${id}`;
    }
    // Generation 32: a refusal is DECIDED against the token, so a request naming a
    // Procedure this file never created still leaves a row — the unknown-owner case does
    // exactly that, and `procedure_id` carries no foreign key precisely so it can. Keyed on
    // the author, which owns every request row this file wrote whatever Procedure it named.
    await sql`DELETE FROM run_initiation_request WHERE initiator_id=${author}`;
    await sql`DELETE FROM auth_user WHERE id=${author}`; await sql.end({ timeout: 5 });
  });
  async function seed() { const row = activeRunVersion(ids.next(),ids.next(),author); procedures.push(row.procedureId); await new PostgresProceduresUnitOfWork(db).execute(async c => { await c.procedures.insertProcedure(row); await c.procedures.insertVersion(row); }); return row; }
  function start(procedureId: string, unitOfWork: AuditUnitOfWork<RunsUnitOfWorkContext> = uow, dates = period, requestToken = ids.next()) { return initiateRun({roles:new DrizzleRoleRepository(db),unitOfWork,ids,clock:new SystemClock()},{session,request:{procedureId,period:dates,requestToken}}); }

  /**
   * Drive a Run to a terminal state the way production does: sealed package first.
   *
   * Generation 21 refuses a Run that reaches a terminal state with no `run_evidence_package`
   * row (a deferred constraint trigger), which is the forcing function behind "run
   * SealPackage on EVERY terminal transition". These Runs never acquired anything, so their
   * package is SEALED over zero artifacts — which is the truth about them.
   */
  async function terminate(runId: string, state: 'COMPLETED' | 'CANCELED'): Promise<void> {
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
              VALUES(${runId},'SEALED',${state},now(),0,0,'[]'::jsonb,'[]'::jsonb) ON CONFLICT DO NOTHING`;
    // Generation 25 refuses a terminal Run with no Result, the same way generation 21
    // refuses one with no Evidence package. These Runs concluded nothing, so their
    // outcome is the §E.1 row their state matches: Canceled, or a Pass over an empty
    // population — which is the truth about them.
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,${state === 'CANCELED' ? 'CANCELED' : 'PASS'},${state === 'CANCELED' ? 'canceled' : 'pass'},true,${state},true,now(),NULL,'{}'::jsonb) ON CONFLICT DO NOTHING`;
    await sql`UPDATE audit_run SET state=${state} WHERE run_id=${runId}`;
  }

  it('stores identity, unchanged frozen bytes, one dispatch and a verifiable first Timeline event', async () => {
    const row = await seed(), before = await sql`SELECT compiled_plan::text, frozen_review::text FROM procedure_version WHERE version_id=${row.versionId}`;
    const result = await start(row.procedureId); expect(result.ok).toBe(true); if (!result.ok) return;
    const saved = await new DrizzleRunRepository(db).findRun(result.runId); expect(saved).toMatchObject({versionId:row.versionId,state:'QUEUED',kind:'STANDARD',period,initiatorId:author,authorizationRole:'auditor'});
    expect(saved!.runId[14]).toBe('7'); expect(saved!.correlationId[14]).toBe('7');
    expect(await sql`SELECT * FROM pgboss.job WHERE name='runs' AND data->>'runId'=${result.runId}`).toHaveLength(1);
    const events=await sql`SELECT sequence,payload FROM audit_events WHERE aggregate_id=${result.runId}`;
    expect(events).toHaveLength(1); expect(Number(events[0]!.sequence)).toBe(1); expect(events[0]!.payload).toMatchObject({priorState:null,state:'QUEUED'});
    expect(await new PostgresAuditChainReader(db).verify(result.runId)).toMatchObject({valid:true});
    expect(await sql`SELECT compiled_plan::text, frozen_review::text FROM procedure_version WHERE version_id=${row.versionId}`).toEqual(before);
    expect(await start(row.procedureId)).toMatchObject({ok:false,existingRunId:result.runId});
    expect(await start(row.procedureId,uow,{from:'2026-09-01',to:'2026-09-30'})).toMatchObject({ok:true});
  });
  it('rolls back Run, dispatch, event and chain head after queue or event failure', async () => {
    const row = await seed();
    for (const kind of ['queue','event']) {
      let attemptedRunId: string | undefined;
      const failing: AuditUnitOfWork<RunsUnitOfWorkContext> = { execute: work => uow.execute(c => work({...c,runs:{bindRequest:(actor,token,id)=>c.runs.bindRequest(actor,token,id),findRequest:(actor,token)=>c.runs.findRequest(actor,token),insert:async run=>{attemptedRunId=run.runId;return c.runs.insert(run);},findRun:id=>c.runs.findRun(id),findActive:(procedureId,dates)=>c.runs.findActive(procedureId,dates)},...(kind==='queue'?{dispatch:{enqueue:async job=>{await c.dispatch.enqueue(job);throw new Error('injected queue failure');}}}:{auditEvents:{append:async event=>{await c.auditEvents.append(event);throw new Error('injected Timeline failure');}}})})) };
      await expect(start(row.procedureId,failing)).rejects.toThrow('injected');
      expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${row.procedureId}`).toHaveLength(0);
      expect(attemptedRunId).toBeDefined();
      expect(await sql`SELECT * FROM pgboss.job WHERE name='runs' AND data->>'runId'=${attemptedRunId!}`).toHaveLength(0);
      expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${attemptedRunId!}`).toHaveLength(0);
      expect(await sql`SELECT * FROM audit_event_heads WHERE aggregate_id=${attemptedRunId!}`).toHaveLength(0);
      expect(await sql`SELECT * FROM run_initiation_request WHERE run_id=${attemptedRunId!}`).toHaveLength(0);
    }
  });
  it('observes a competing lock wait and allows exactly one active Run', async () => {
    const row = await seed(); let release!:()=>void, entered!:()=>void;
    const held = new Promise<void>(r=>release=r), ready=new Promise<void>(r=>entered=r);
    const first: AuditUnitOfWork<RunsUnitOfWorkContext> = {execute:work=>uow.execute(async c=>{const result=await work(c);entered();await held;return result;})};
    const a=start(row.procedureId,first); await ready; const b=start(row.procedureId);
    try { await expect.poll(async()=>Number((await sql`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`)[0]!.count)).toBeGreaterThan(0); } finally {release();}
    expect(await a).toMatchObject({ok:true}); expect(await b).toMatchObject({ok:false});
    expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${row.procedureId}`).toHaveLength(1);
    expect(await sql`SELECT * FROM pgboss.job WHERE name='runs' AND data->>'runId' IN (SELECT run_id::text FROM audit_run WHERE procedure_id=${row.procedureId})`).toHaveLength(1);
  });
  it('database uniqueness works without the command precheck and permits terminal reruns', async () => {
    const row=await seed(), result=await start(row.procedureId); if(!result.ok) throw new Error(result.reason);
    const saved=(await new DrizzleRunRepository(db).findRun(result.runId))!;
    expect(await new DrizzleRunRepository(db).insert({...saved,requestToken:ids.next(),runId:ids.next(),correlationId:ids.next()})).toBe(false);
    await terminate(result.runId, 'CANCELED');
    expect(await start(row.procedureId)).toMatchObject({ok:true});
  });
  it('rechecks revocation after the shared lock and audits the actual refusal', async () => {
    const row=await seed(); let entered!:()=>void,release!:()=>void;
    const ready=new Promise<void>(r=>entered=r), held=new Promise<void>(r=>release=r);
    const blocker=uow.execute(async()=>{entered();await held;}); await ready;
    const pending=start(row.procedureId);
    try {
      await expect.poll(async()=>Number((await sql`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`)[0]!.count)).toBeGreaterThan(0);
      await sql`DELETE FROM user_role WHERE user_id=${author}`;
    } finally { release(); await blocker; }
    try {
      expect(await pending).toMatchObject({ok:false}); expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${row.procedureId}`).toHaveLength(0);
      const denied=await sql`SELECT actor_type,actor_id,session_id,payload FROM audit_events WHERE event_type='security.denied' AND actor_id=${author}`;
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({actor_type:'human',actor_id:author,session_id:session.sessionId,payload:{action:'run.initiate',role:null}});
    }
    finally { await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`; }
  });
  it('resolves historical periods on the activated edge and ignores pending candidates', async () => {
    const first=await seed();
    const second={...activeRunVersion(first.procedureId,ids.next(),author),versionNumber:3,lifecycle:{requiresRegression:false,reason:'unchanged-configuration' as const,priorActiveVersionId:first.versionId,activatedAt:'2026-01-01T12:00:00.000Z',handoverAt:'2026-09-01T00:00:00.000Z'}};
    await new PostgresProceduresUnitOfWork(db).execute(async c=>{await c.procedures.insertVersion(second);await c.procedures.recordSuccession!({procedureId:first.procedureId,predecessorId:first.versionId,successorId:second.versionId,activatedAt:second.lifecycle.activatedAt,handoverAt:second.lifecycle.handoverAt});});
    const before=await start(first.procedureId), after=await start(first.procedureId,uow,{from:'2026-09-01',to:'2026-09-30'});
    if(!before.ok||!after.ok) throw new Error('Historical ownership failed');
    expect((await new DrizzleRunRepository(db).findRun(before.runId))?.versionId).toBe(first.versionId);
    expect((await new DrizzleRunRepository(db).findRun(after.runId))?.versionId).toBe(second.versionId);
    const candidate={...activeRunVersion(first.procedureId,ids.next(),author),versionNumber:2,state:'APPROVED' as const,lifecycle:{requiresRegression:true,reason:'changed-configuration' as const,priorActiveVersionId:second.versionId,activatedAt:null,handoverAt:null}};
    await new PostgresProceduresUnitOfWork(db).execute(async c=>{await c.procedures.insertVersion(candidate);await c.procedures.recordSuccession!({procedureId:first.procedureId,predecessorId:second.versionId,successorId:candidate.versionId,activatedAt:null,handoverAt:null});});
    const pending=await start(first.procedureId,uow,{from:'2026-10-01',to:'2026-10-31'}); if(!pending.ok) throw new Error(pending.reason);
    expect((await new DrizzleRunRepository(db).findRun(pending.runId))?.versionId).toBe(second.versionId);
  });
  it('refuses an unreadable frozen owner without inserting a Run or dispatch', async () => {
    const source=activeRunVersion(ids.next(),ids.next(),author), review=source.frozenReview!;
    const row={...source,frozenReview:{...review,definition:{...review.definition,inputs:{...review.definition.inputs,controlName:'Corrupted frozen input'}}}};
    procedures.push(row.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async c=>{await c.procedures.insertProcedure(row);await c.procedures.insertVersion(row);});
    let insertAttempts=0, dispatchAttempts=0;
    const observed: AuditUnitOfWork<RunsUnitOfWorkContext>={execute:work=>uow.execute(c=>work({...c,runs:{bindRequest:(actor,token,id)=>c.runs.bindRequest(actor,token,id),findRequest:(actor,token)=>c.runs.findRequest(actor,token),insert:async run=>{insertAttempts++;return c.runs.insert(run);},findRun:id=>c.runs.findRun(id),findActive:(id,dates)=>c.runs.findActive(id,dates)},dispatch:{enqueue:async job=>{dispatchAttempts++;await c.dispatch.enqueue(job);}}}))};
    expect(await start(row.procedureId,observed)).toMatchObject({ok:false,reason:expect.stringContaining('No executable Active version')});
    expect(insertAttempts).toBe(0); expect(dispatchAttempts).toBe(0);
    expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${row.procedureId}`).toHaveLength(0);
  });
  it('allows an Audit Manager and persists the locked authorization role', async () => {
    const row=await seed();
    await sql`UPDATE user_role SET role='audit-manager' WHERE user_id=${author}`;
    try {
      const result=await start(row.procedureId); if(!result.ok) throw new Error(result.reason);
      expect(await new DrizzleRunRepository(db).findRun(result.runId)).toMatchObject({state:'QUEUED',initiatorId:author,authorizationRole:'audit-manager'});
      expect(await sql`SELECT * FROM pgboss.job WHERE name='runs' AND data->>'runId'=${result.runId}`).toHaveLength(1);
    } finally { await sql`UPDATE user_role SET role='auditor' WHERE user_id=${author}`; }
  });
  it('replays the same token after terminal completion without consulting the current owner', async () => {
    const row=await seed(), token=ids.next(), first=await start(row.procedureId,uow,period,token);
    if(!first.ok) throw new Error(first.reason);
    await terminate(first.runId, 'CANCELED');
    const unavailable: AuditUnitOfWork<RunsUnitOfWorkContext>={execute:work=>uow.execute(c=>work({...c,procedures:{findPeriodOwner:async()=>{throw new Error('Owner must not be read during recovery');}}}))};
    expect(await start(row.procedureId,unavailable,period,token)).toEqual(first);
    expect(await start(row.procedureId,uow,{from:'2026-09-01',to:'2026-09-30'},token)).toMatchObject({ok:false,reason:expect.stringContaining('different Procedure or period')});
    expect(await start(row.procedureId)).toMatchObject({ok:true});
    expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${row.procedureId}`).toHaveLength(2);
  });
  it('names an existing active Run in the refusal, and REPLAYS that refusal for ever', async () => {
    // This test used to be called "links an existing active Run before checking an
    // unreadable current owner", and it pinned the OLD behaviour: the refusal BOUND the
    // caller's token to the other Run, so once that Run ended a replay of the same token
    // answered `ok: true` with its id — the same click meaning two different things, and
    // the second one walking the caller into a Run they did not initiate. The owner's
    // 2026-09-06 decision makes a token's answer explicit and stable; see
    // `docs/contracts/run-request-token-v1.md`.
    const row=await seed(), first=await start(row.procedureId); if(!first.ok) throw new Error(first.reason);
    const unavailable: AuditUnitOfWork<RunsUnitOfWorkContext>={execute:work=>uow.execute(c=>work({...c,procedures:{findPeriodOwner:async()=>{throw new Error('Owner must not hide the existing Run');}}}))};
    const duplicateToken=ids.next();
    const refusal=await start(row.procedureId,unavailable,period,duplicateToken);
    expect(refusal).toEqual({ok:false,reason:RUN_ALREADY_ACTIVE,existingRunId:first.runId});
    // The refusal is DECIDED, not re-derived: the row records the code and the Run it
    // named, and the caller's token is bound to no Run at all.
    expect(await sql`SELECT run_id, refusal, refused_run_id, procedure_id, period_from::text, period_to::text FROM run_initiation_request WHERE request_token=${duplicateToken}`)
      .toEqual([{run_id:null,refusal:'already-active',refused_run_id:first.runId,procedure_id:row.procedureId,period_from:period.from,period_to:period.to}]);
    // Stable while the blocking Run is active…
    expect(await start(row.procedureId,unavailable,period,duplicateToken)).toEqual(refusal);
    await terminate(first.runId, 'COMPLETED');
    // …and stable AFTER it ends. This is the assertion that changed: it used to expect
    // `first`. A replay never becomes an entry into somebody else's audit work, and it
    // never silently starts a Run the caller last heard was refused.
    expect(await start(row.procedureId,unavailable,period,duplicateToken)).toEqual(refusal);
    expect(await sql`SELECT run_id FROM audit_run WHERE procedure_id=${row.procedureId}`).toHaveLength(1);
    // A FRESH token is how the caller starts the Run they now want.
    expect(await start(row.procedureId,uow,period,ids.next())).toMatchObject({ok:true});
  });
  it('decides a no-owner refusal against the token, and never against another caller', async () => {
    // `no-owner` is the other refusal `createRun` can reach with a token in hand. Before
    // the decision was recorded, a replay after a version was activated would quietly
    // START a Run the caller had last been told was impossible.
    const procedureId=ids.next(), token=ids.next();
    // No such Procedure yet, which is the `no-owner` path — and the reason the subject
    // column carries NO foreign key: a request that names a Procedure which does not exist
    // is exactly the case this record has to be able to hold, and a foreign key would
    // answer the caller a framework 500 instead of the refusal sentence.
    const refused=await start(procedureId,uow,period,token);
    expect(refused).toEqual({ok:false,reason:NO_RUN_OWNER});
    expect(await sql`SELECT refusal, refused_run_id, procedure_id FROM run_initiation_request WHERE request_token=${token}`)
      .toEqual([{refusal:'no-owner',refused_run_id:null,procedure_id:procedureId}]);
    const row=activeRunVersion(procedureId,ids.next(),author); procedures.push(procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async c=>{await c.procedures.insertProcedure(row);await c.procedures.insertVersion(row);});
    // The world changed; the token's answer did not.
    expect(await start(procedureId,uow,period,token)).toEqual(refused);
    expect(await sql`SELECT run_id FROM audit_run WHERE procedure_id=${procedureId}`).toHaveLength(0);
    // The same token used for a DIFFERENT subject is still the reuse refusal, decided
    // against the subject stored on the record rather than against a Run it never had.
    expect(await start(procedureId,uow,{from:'2026-09-01',to:'2026-09-30'},token))
      .toEqual({ok:false,reason:RUN_TOKEN_REUSED});
    // And a fresh token now succeeds, because authorization and ownership are re-decided
    // on every request — only the TOKEN's answer is frozen.
    expect(await start(procedureId,uow,period,ids.next())).toMatchObject({ok:true});
  });
  it('does not swallow Run identity conflicts and rejects a version belonging to another Procedure', async () => {
    const first=await seed(), second=await seed(), result=await start(first.procedureId); if(!result.ok) throw new Error(result.reason);
    const saved=(await new DrizzleRunRepository(db).findRun(result.runId))!;
    await expect(new DrizzleRunRepository(db).insert({...saved,requestToken:ids.next(),period:{from:'2026-09-01',to:'2026-09-30'}})).rejects.toThrow();
    await expect(new DrizzleRunRepository(db).insert({...saved,requestToken:ids.next(),runId:ids.next(),procedureId:second.procedureId})).rejects.toThrow();
    expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${second.procedureId}`).toHaveLength(0);
  });
  it('refuses persisted succession metadata without its authoritative edge', async () => {
    const first=await seed(), source=activeRunVersion(first.procedureId,ids.next(),author);
    const second={...source,versionNumber:2,lifecycle:{...source.lifecycle!,reason:'unchanged-configuration' as const,priorActiveVersionId:first.versionId}};
    await new PostgresProceduresUnitOfWork(db).execute(c=>c.procedures.insertVersion(second));
    let dispatches=0;
    const observed: AuditUnitOfWork<RunsUnitOfWorkContext>={execute:work=>uow.execute(c=>work({...c,dispatch:{enqueue:async()=>{dispatches++;}}}))};
    expect(await start(first.procedureId,observed)).toMatchObject({ok:false,reason:expect.stringContaining('No executable Active version')});
    expect(dispatches).toBe(0); expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${first.procedureId}`).toHaveLength(0);
  });
  it('publishes Timeline notifications only after commit and never after rollback', async () => {
    const row=await seed(), messages: unknown[]=[];
    const listener=await sql.listen('run_timeline', payload=>messages.push(JSON.parse(payload)));
    try {
      for(const rollback of [false,true]) {
        let release!:()=>void, entered!:()=>void, attemptedId='';
        const held=new Promise<void>(r=>release=r), ready=new Promise<void>(r=>entered=r);
        const gated: AuditUnitOfWork<RunsUnitOfWorkContext>={execute:work=>uow.execute(async c=>{
          const result=await work({...c,runs:{bindRequest:(actor,token,id)=>c.runs.bindRequest(actor,token,id),findRequest:(actor,token)=>c.runs.findRequest(actor,token),findRun:id=>c.runs.findRun(id),findActive:(id,dates)=>c.runs.findActive(id,dates),insert:async run=>{attemptedId=run.runId;return c.runs.insert(run);}}});
          entered();await held;if(rollback) throw new Error('notification rollback');return result;
        })};
        const outcome=start(row.procedureId,gated,rollback?{from:'2026-10-01',to:'2026-10-31'}:period).then(value=>({value,error:null}),error=>({value:null,error}));
        await ready;
        const beforeProbe=ids.next();await sql.notify('run_timeline',JSON.stringify({probe:beforeProbe}));
        try { await expect.poll(()=>messages.some(m=>(m as {probe?:string}).probe===beforeProbe)).toBe(true); expect(messages).not.toContainEqual({runId:attemptedId,sequence:1}); } finally {release();}
        const settled=await outcome;
        if(rollback) expect(settled.error).toBeInstanceOf(Error); else expect(settled.value).toMatchObject({ok:true});
        const afterProbe=ids.next();await sql.notify('run_timeline',JSON.stringify({probe:afterProbe}));
        await expect.poll(()=>messages.some(m=>(m as {probe?:string}).probe===afterProbe)).toBe(true);
        if(rollback) expect(messages).not.toContainEqual({runId:attemptedId,sequence:1});
        else expect(messages).toContainEqual({runId:attemptedId,sequence:1});
      }
    } finally {await listener.unlisten();}
  });
  it('scopes tokens to the trusted initiator and refuses cross-Procedure token reuse', async () => {
    const first=await seed(), second=await seed(), token=ids.next(), result=await start(first.procedureId,uow,period,token);
    if(!result.ok) throw new Error(result.reason);
    expect(await start(second.procedureId,uow,period,token)).toMatchObject({ok:false,reason:expect.stringContaining('different Procedure or period')});
    const other=ids.next();
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${other},${other},${other+'@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${other},'auditor')`;
    try {
      const independent=await initiateRun({roles:new DrizzleRoleRepository(db),unitOfWork:uow,ids,clock:new SystemClock()},{session:{userId:other,sessionId:other},request:{procedureId:second.procedureId,period,requestToken:token}});
      expect(independent).toMatchObject({ok:true}); if(independent.ok) expect(independent.runId).not.toBe(result.runId);
    } finally {await sql`DELETE FROM auth_user WHERE id=${other}`;}
  });
  it('refuses malformed input and unknown owner before inserting', async () => {
    expect(await start(ids.next())).toMatchObject({ok:false});
    expect(await initiateRun({roles:new DrizzleRoleRepository(db),unitOfWork:uow,ids,clock:new SystemClock()},{session,request:{procedureId:ids.next(),requestToken:ids.next(),period:{...period,extra:'forged'}}})).toMatchObject({ok:false});
    const row=await seed(); expect(await start(row.procedureId,uow,{from:'2026-02-29',to:'2026-03-01'})).toMatchObject({ok:false});
    expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${row.procedureId}`).toHaveLength(0);
  });
});
