import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initiateRun, type RunsUnitOfWorkContext, type AuditUnitOfWork } from '@intellifin/application';
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
      await sql`DELETE FROM run_initiation_request WHERE run_id IN (SELECT run_id FROM audit_run WHERE procedure_id=${id})`;
      await sql`DELETE FROM audit_run WHERE procedure_id=${id}`;
      await sql`DELETE FROM procedure_succession WHERE procedure_id=${id}`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${id}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${id}`;
    }
    await sql`DELETE FROM auth_user WHERE id=${author}`; await sql.end({ timeout: 5 });
  });
  async function seed() { const row = activeRunVersion(ids.next(),ids.next(),author); procedures.push(row.procedureId); await new PostgresProceduresUnitOfWork(db).execute(async c => { await c.procedures.insertProcedure(row); await c.procedures.insertVersion(row); }); return row; }
  function start(procedureId: string, unitOfWork: AuditUnitOfWork<RunsUnitOfWorkContext> = uow, dates = period, requestToken = ids.next()) { return initiateRun({roles:new DrizzleRoleRepository(db),unitOfWork,ids,clock:new SystemClock()},{session,request:{procedureId,period:dates,requestToken}}); }
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
      const failing: AuditUnitOfWork<RunsUnitOfWorkContext> = { execute: work => uow.execute(c => work({...c,runs:{bindRequest:(actor,token,id)=>c.runs.bindRequest(actor,token,id),findRequest:(actor,token)=>c.runs.findRequest(actor,token),insert:async run=>{attemptedRunId=run.runId;return c.runs.insert(run);},findActive:(procedureId,dates)=>c.runs.findActive(procedureId,dates)},...(kind==='queue'?{dispatch:{enqueue:async job=>{await c.dispatch.enqueue(job);throw new Error('injected queue failure');}}}:{auditEvents:{append:async event=>{await c.auditEvents.append(event);throw new Error('injected Timeline failure');}}})})) };
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
    await sql`UPDATE audit_run SET state='CANCELED' WHERE run_id=${result.runId}`;
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
    const observed: AuditUnitOfWork<RunsUnitOfWorkContext>={execute:work=>uow.execute(c=>work({...c,runs:{bindRequest:(actor,token,id)=>c.runs.bindRequest(actor,token,id),findRequest:(actor,token)=>c.runs.findRequest(actor,token),insert:async run=>{insertAttempts++;return c.runs.insert(run);},findActive:(id,dates)=>c.runs.findActive(id,dates)},dispatch:{enqueue:async job=>{dispatchAttempts++;await c.dispatch.enqueue(job);}}}))};
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
    await sql`UPDATE audit_run SET state='CANCELED' WHERE run_id=${first.runId}`;
    const unavailable: AuditUnitOfWork<RunsUnitOfWorkContext>={execute:work=>uow.execute(c=>work({...c,procedures:{findPeriodOwner:async()=>{throw new Error('Owner must not be read during recovery');}}}))};
    expect(await start(row.procedureId,unavailable,period,token)).toEqual(first);
    expect(await start(row.procedureId,uow,{from:'2026-09-01',to:'2026-09-30'},token)).toMatchObject({ok:false,reason:expect.stringContaining('different Procedure or period')});
    expect(await start(row.procedureId)).toMatchObject({ok:true});
    expect(await sql`SELECT * FROM audit_run WHERE procedure_id=${row.procedureId}`).toHaveLength(2);
  });
  it('links an existing active Run before checking an unreadable current owner', async () => {
    const row=await seed(), first=await start(row.procedureId); if(!first.ok) throw new Error(first.reason);
    const unavailable: AuditUnitOfWork<RunsUnitOfWorkContext>={execute:work=>uow.execute(c=>work({...c,procedures:{findPeriodOwner:async()=>{throw new Error('Owner must not hide the existing Run');}}}))};
    const duplicateToken=ids.next();
    expect(await start(row.procedureId,unavailable,period,duplicateToken)).toMatchObject({ok:false,existingRunId:first.runId});
    await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${first.runId}`;
    expect(await start(row.procedureId,unavailable,period,duplicateToken)).toEqual(first);
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
          const result=await work({...c,runs:{bindRequest:(actor,token,id)=>c.runs.bindRequest(actor,token,id),findRequest:(actor,token)=>c.runs.findRequest(actor,token),findActive:(id,dates)=>c.runs.findActive(id,dates),insert:async run=>{attemptedId=run.runId;return c.runs.insert(run);}}});
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
