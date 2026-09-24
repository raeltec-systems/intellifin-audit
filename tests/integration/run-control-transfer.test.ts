import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquireRunControlLease, releaseRunControlLease, renewRunControlLease,
  answerEscalation, raiseEscalation, proposeRunControlTransfer, confirmRunControlTransfer, recoverRunControlTransferReceipt, setUserRunControlTransferGrant, setUserRole, type IdentityUnitOfWorkContext,
  initiateRun, pauseRun, performPause, resumeRun, cancelRun, type AuditUnitOfWork,
} from '@intellifin/application';
import {
  createDb, createSqlClient, createAuditEventWriter, CryptoUuidV7Generator,
  DrizzleRoleRepository, DrizzleRoleWriter, DrizzlePermissionGrantWriter, DrizzleUserDirectory, PostgresRunControlTransferRepository, ConversationContentCipher, PostgresProceduresUnitOfWork, PostgresRunControlLeaseRepository,
  PostgresRunsUnitOfWork, PostgresWaitRepository, PostgresRunCancellationRepository, PostgresAuditChainReader, readRunControlLease, SystemClock,
  type Database, type Sql, type Transaction,
} from '@intellifin/infrastructure';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { PostgresRunConversationRepository } from '../../packages/infrastructure/src/runs/run-conversation-repository.js';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('explicit manager transfer against PostgreSQL', () => {
  let client: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const actor = ids.next();
  const other = ids.next();
  const manager = ids.next(), manager2 = ids.next(), admin = ids.next();
  const managerSession = { userId: manager, sessionId: manager + '-session' };
  const adminSession = { userId: admin, sessionId: admin + '-session' };
  const cipher = new ConversationContentCipher('11'.repeat(32));
  const procedureId = ids.next();
  const versionId = ids.next();
  const runs: string[] = [];
  const session = { userId: actor, sessionId: `${actor}-control` };
  const otherSession = { userId: other, sessionId: `${other}-control` };

  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1)))
      throw new Error('Controller tests require an isolated local or CI database');
    client = createSqlClient(url!, { max: 8 }); db = createDb(client);
    await client`INSERT INTO auth_user(id,name,email) VALUES (${actor},'Controller auditor',${actor+'@test.invalid'}),(${other},'Second controller auditor',${other+'@test.invalid'})`;
    await client`INSERT INTO user_role(user_id,role) VALUES (${actor},'auditor'),(${other},'auditor')`;
    await client`INSERT INTO auth_user(id,name,email) VALUES (${manager},'Transfer manager',${manager+'@test.invalid'}),(${manager2},'Other manager',${manager2+'@test.invalid'}),(${admin},'Grant administrator',${admin+'@test.invalid'})`;
    await client`INSERT INTO user_role(user_id,role) VALUES (${manager},'audit-manager'),(${manager2},'audit-manager'),(${admin},'poc-administrator')`;
    const version = activeRunVersion(procedureId, versionId, actor);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version); await context.procedures.insertVersion(version);
    });
  });

  afterAll(async () => {
    if (!client) return;
    try {
      for (const runId of runs) await client.begin(async tx => {
        await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
        await tx`DELETE FROM notification WHERE run_id=${runId}`;
        await tx`DELETE FROM run_wait WHERE run_id=${runId}`;
        await tx`DELETE FROM run_result WHERE run_id=${runId}`;
        await tx`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await tx`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await tx`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
        // The retained fence can only disappear with its Run, never as lease cleanup.
        await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
      });
      await client`DELETE FROM run_initiation_request WHERE initiator_id IN (${actor},${other})`;
      await client`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await client`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await client.begin(async tx => {
        // Platform grant events belong to the shared hash chain. Retain them after
        // removing fixture accounts, just like the administration integration suite.
        await tx`DELETE FROM auth_user WHERE id IN (${actor},${other},${manager},${manager2},${admin})`;
      });
      const chain = await new PostgresAuditChainReader(db).verify('platform');
      expect(chain.valid).toBe(true);
      if (!chain.valid) throw new Error('Fixture cleanup damaged the platform audit chain');
      expect(chain.eventCount).toBeGreaterThan(0);
    } finally { await client.end({ timeout: 5 }); }
  });

  function leaseDeps(transaction?: Transaction, allowEnrollment = true) {
    const connection = transaction ?? db;
    const unitOfWork: AuditUnitOfWork = transaction
      ? { execute: work => work({ auditEvents: createAuditEventWriter(transaction, new SystemClock(), ids) }) }
      : new PostgresRunsUnitOfWork(db);
    return { roles: new DrizzleRoleRepository(connection), unitOfWork,
      repository: new PostgresRunControlLeaseRepository(connection), ids, allowEnrollment };
  }
  const waitDeps = () => ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db),
    repository: new PostgresWaitRepository(db), ids, clock: new SystemClock() });

  async function start(state: 'RUNNING' | 'QUEUED' = 'RUNNING'): Promise<string> {
    const month = String((runs.length % 12) + 1).padStart(2, '0');
    const year = 2026 + Math.floor(runs.length / 12);
    const outcome = await initiateRun(waitDeps(), { session, request: {
      procedureId, requestToken: ids.next(), period: { from: `${year}-${month}-01`, to: `${year}-${month}-28` },
    } });
    if (!outcome.ok) throw new Error(outcome.reason);
    runs.push(outcome.runId);
    await client`UPDATE audit_run SET state=${state} WHERE run_id=${outcome.runId}`;
    return outcome.runId;
  }

  function identityDeps(transaction?: Transaction) {
    const connection = transaction ?? db;
    const unitOfWork: AuditUnitOfWork<IdentityUnitOfWorkContext> = { execute: work => connection.transaction(tx => work({
      auditEvents: createAuditEventWriter(tx,new SystemClock(),ids), roles: new DrizzleRoleWriter(tx), permissions: new DrizzlePermissionGrantWriter(tx),
      users: { createUser: async () => { throw new Error('Fixture must not create user'); } }, sessions: { revokeSession: async () => {} },
    })) };
    return { roles: new DrizzleRoleRepository(connection), users: new DrizzleUserDirectory(db), unitOfWork };
  }
  function transferDeps(transaction?: Transaction, contentCipher: ConversationContentCipher | null = cipher) {
    return { ...leaseDeps(transaction), repository: new PostgresRunControlTransferRepository(transaction ?? db,contentCipher) };
  }
  async function grant(granted: boolean, userId = manager, transaction?: Transaction) {
    const [row] = await client`SELECT revision FROM user_permission_grant WHERE user_id=${userId} AND permission='run.control-transfer'`;
    const outcome = await setUserRunControlTransferGrant(identityDeps(transaction), { session: adminSession, correlationId: ids.next(),userId,granted,expectedGrantRevision:Number(row?.revision ?? 0) });
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome;
  }
  async function proposal(runId: string, who = managerSession, expectedEpoch = 1) {
    const request = {runId,expectedEpoch,requestKey:ids.next(),reason:'The recorded controller is unavailable.'};
    const outcome = await proposeRunControlTransfer(transferDeps(),{session:who,request});
    if(!outcome.ok)throw new Error(outcome.reason);
    return {...outcome,request};
  }
  async function setup(state: 'RUNNING' | 'QUEUED' = 'RUNNING') {
    const runId = await start(state);
    await grant(true);
    expect(await acquireRunControlLease(leaseDeps(),{session,request:{runId,expectedEpoch:0}})).toMatchObject({ok:true});
    return runId;
  }
  const confirm = (runId: string,commandId: string,transaction?: Transaction,who=managerSession) => confirmRunControlTransfer(transferDeps(transaction),{session:who,request:{runId,commandId}});

  it('persists exact transfer proof and preserves Run data, then recovers history after ordinary release/acquire', async () => {
    const runId=await setup(), review=await proposal(runId);
    const [before]=await client`SELECT to_jsonb(r) body FROM audit_run r WHERE run_id=${runId}`;
    const applied=await confirm(runId,review.proposal.commandId);
    expect(applied).toMatchObject({ok:true,replayed:false,receipt:{epoch:2,holderId:manager}});
    expect(await client`SELECT to_jsonb(r) body FROM audit_run r WHERE run_id=${runId}`).toEqual([before]);
    const facts=await client`SELECT payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-transferred'`;
    expect(facts).toHaveLength(1);expect(JSON.stringify(facts)).not.toContain(review.request.reason);
    expect(await client`SELECT command_id FROM run_control_transfer_receipt WHERE command_id=${review.proposal.commandId}`).toHaveLength(1);
    expect(await client`SELECT count(*)::int n FROM run_conversation_message WHERE run_id=${runId} AND kind='platform-event'`).toMatchObject([{n:1}]);
    const observingAuditorRead = await new PostgresRunConversationRepository(db,cipher).read({runId,actorId:other});
    expect(observingAuditorRead.status).toBe('ready');
    expect(observingAuditorRead.messages).toEqual([expect.objectContaining({
      actorId:manager,actorName:'Transfer manager',kind:'platform-event',
      body:'Took control using explicit manager permission. Earlier discretionary reviews require a fresh controller check.',
      createdAt:applied.ok ? applied.receipt.updatedAt : undefined,
    })]);
    expect(JSON.stringify(observingAuditorRead)).not.toContain(review.request.reason);
    expect(observingAuditorRead.messages.some(message=>/resum/i.test(message.body ?? ''))).toBe(false);
    expect(await releaseRunControlLease(leaseDeps(),{session:managerSession,request:{runId,expectedEpoch:2}})).toMatchObject({ok:true});
    expect(await acquireRunControlLease(leaseDeps(),{session,request:{runId,expectedEpoch:3}})).toMatchObject({ok:true,lease:{epoch:4}});
    expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:true,replayed:true,receipt:{epoch:2}});
    expect(await readRunControlLease(db,{runId,actorId:manager,requiredForUnenrolledRun:true})).toMatchObject({status:'ready',heldByYou:false,epoch:4,transferEligible:true});
    await grant(false);expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:false,code:'unauthorized'});
  });

  it('rejects absent grants and ineligible roles without proposal or lease effects', async () => {
    const runId=await setup();await grant(false);
    for(const who of [managerSession,session,adminSession]) expect(await proposeRunControlTransfer(transferDeps(),{session:who,request:{runId,expectedEpoch:1,requestKey:ids.next(),reason:'Read the current owner.'}})).toMatchObject({ok:false,code:'unauthorized'});
    expect(await client`SELECT command_id FROM run_control_transfer WHERE run_id=${runId}`).toHaveLength(0);
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:1}]);
  });

  it('binds request key to reason/epoch and never silently confirms a proposal retry', async () => {
    const runId=await setup(),review=await proposal(runId);
    expect(await proposeRunControlTransfer(transferDeps(),{session:managerSession,request:review.request})).toMatchObject({ok:true,replayed:true});
    for(const patch of [{reason:'Changed reason.'},{expectedEpoch:2}])expect(await proposeRunControlTransfer(transferDeps(),{session:managerSession,request:{...review.request,...patch}})).toMatchObject({ok:false,code:'conflict'});
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:1}]);
  });

  it('allows only one of two separately granted managers to transfer the observed epoch', async () => {
    const runId=await setup();await grant(true,manager2);const who={userId:manager2,sessionId:manager2+'-session'};
    const a=await proposal(runId),b=await proposal(runId,who);
    const results=await Promise.all([confirm(runId,a.proposal.commandId),confirm(runId,b.proposal.commandId,undefined,who)]);
    expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok)).toMatchObject([{code:'conflict'}]);
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:2}]);
  });

  it.each(['missing','corrupt','removed'] as const)('refuses %s governed reason before first application', async mode => {
    const runId=await setup();
    let commandId: string;
    if(mode==='removed') {
      commandId=(await proposal(runId)).proposal.commandId;
      await client`UPDATE run_control_transfer_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1 WHERE command_id=${commandId}`;
    } else {
      // Model initially absent or corrupt storage without rewriting immutable live content.
      commandId=ids.next();
      await client`INSERT INTO run_control_transfer(command_id,run_id,actor_id,request_key,expected_epoch,prior_holder_id,fingerprint,created_at)
        VALUES(${commandId},${runId},${manager},${ids.next()},1,${actor},${'a'.repeat(64)},clock_timestamp())`;
      if(mode==='corrupt')await client`INSERT INTO run_control_transfer_content(command_id,ciphertext) VALUES(${commandId},'v1.AAAA')`;
    }
    expect(await confirm(runId,commandId)).toMatchObject({ok:false,code:'unavailable'});
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:1}]);
  });

  it('allows only removal and retains the tombstone against delete, reinsert and confirmation', async () => {
    const runId=await setup(),review=await proposal(runId),commandId=review.proposal.commandId;
    const [original]=await client`SELECT ciphertext FROM run_control_transfer_content WHERE command_id=${commandId}`;
    await expect(client`DELETE FROM run_control_transfer_content WHERE command_id=${commandId}`).rejects.toMatchObject({code:'23514'});
    await expect(client`UPDATE run_control_transfer_content SET ciphertext='v1.AAAA',content_epoch=content_epoch+1 WHERE command_id=${commandId}`).rejects.toMatchObject({code:'23514'});
    await client`UPDATE run_control_transfer_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1 WHERE command_id=${commandId}`;
    await expect(client`DELETE FROM run_control_transfer_content WHERE command_id=${commandId}`).rejects.toMatchObject({code:'23514'});
    await expect(client`INSERT INTO run_control_transfer_content(command_id,ciphertext) VALUES(${commandId},${original!.ciphertext})`).rejects.toMatchObject({code:'23505'});
    await expect(client`UPDATE run_control_transfer_content SET ciphertext=${original!.ciphertext},removed_at=NULL,content_epoch=content_epoch+1 WHERE command_id=${commandId}`).rejects.toMatchObject({code:'23514'});
    expect(await client`SELECT ciphertext,content_epoch FROM run_control_transfer_content WHERE command_id=${commandId}`).toEqual([{ciphertext:null,content_epoch:2}]);
    expect(await confirm(runId,commandId)).toMatchObject({ok:false,code:'unavailable'});
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:1}]);
  });

  it('recovers receipts without first applying a proposal and after the Run has finished', async () => {
    const runId=await setup('QUEUED'),review=await proposal(runId),request={runId,commandId:review.proposal.commandId};
    expect(await recoverRunControlTransferReceipt(transferDeps(),{session:managerSession,request})).toMatchObject({ok:false,code:'conflict'});
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:1}]);
    expect(await confirm(runId,request.commandId)).toMatchObject({ok:true});
    expect(await cancelRun({roles:new DrizzleRoleRepository(db),unitOfWork:new PostgresRunsUnitOfWork(db),repository:new PostgresRunCancellationRepository(db),ids,clock:new SystemClock()},
      {session,request:{runId,reason:'End queued receipt recovery fixture.'}})).toMatchObject({ok:true});
    expect(await recoverRunControlTransferReceipt(transferDeps(),{session:managerSession,request})).toMatchObject({ok:true,replayed:true,receipt:{epoch:2}});
    await grant(false);
    expect(await recoverRunControlTransferReceipt(transferDeps(),{session:managerSession,request})).toMatchObject({ok:false,code:'unauthorized'});
  });

  it('keeps a committed receipt valid after governed reason removal', async () => {
    const runId=await setup(),review=await proposal(runId);expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:true});
    await client`UPDATE run_control_transfer_content SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1 WHERE command_id=${review.proposal.commandId}`;
    expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:true,replayed:true});
  });

  it('revokes on demotion and requires a new explicit grant after promotion', async () => {
    await grant(true);
    expect(await setUserRole(identityDeps(),{session:adminSession,correlationId:ids.next(),userId:manager,role:'auditor',expectedRole:'audit-manager'})).toMatchObject({ok:true});
    const [revoked]=await client`SELECT granted,revision FROM user_permission_grant WHERE user_id=${manager}`;expect(revoked?.granted).toBe(false);
    expect(await setUserRole(identityDeps(),{session:adminSession,correlationId:ids.next(),userId:manager,role:'audit-manager',expectedRole:'auditor'})).toMatchObject({ok:true});
    expect(await client`SELECT granted,revision FROM user_permission_grant WHERE user_id=${manager}`).toEqual([revoked]);
    expect(await setUserRunControlTransferGrant(identityDeps(),{session:adminSession,correlationId:ids.next(),userId:manager,granted:true,expectedGrantRevision:Number(revoked!.revision)-1})).toMatchObject({ok:false});
  });

  it.each(['grant','role'] as const)('serializes real %s revocation ahead of blocked transfer confirmation', async mode => {
    const runId=await setup(),review=await proposal(runId);
    let announce!:(pid:number)=>void,release!:()=>void;
    const locked=new Promise<number>(r=>announce=r),released=new Promise<void>(r=>release=r);
    const revoking=db.transaction(async tx=>{
      const [pid]=await tx.execute<{pid:number}>('SELECT pg_backend_pid() pid');
      if(mode==='grant')await grant(false,manager,tx);
      else expect(await setUserRole(identityDeps(tx),{session:adminSession,correlationId:ids.next(),userId:manager,role:'auditor',expectedRole:'audit-manager'})).toMatchObject({ok:true});
      announce(pid!.pid);await released;
    });
    const pid=await locked;const pending=confirm(runId,review.proposal.commandId);
    try {
      await expect.poll(async()=>{const [r]=await client`SELECT count(*)::int n FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))`;return r!.n;},{timeout:200,interval:5}).toBeGreaterThan(0);
    }finally{release();await revoking;}
    expect(await pending).toMatchObject({ok:false,code:'unauthorized'});
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:1}]);
    if(mode==='role')expect(await setUserRole(identityDeps(),{session:adminSession,correlationId:ids.next(),userId:manager,role:'audit-manager',expectedRole:'auditor'})).toMatchObject({ok:true});
  });

  it('reauthorizes a grant administrator after waiting on their actual role/identity revocation', async () => {
    await grant(false);
    let announce!:(pid:number)=>void,release!:()=>void;
    const locked=new Promise<number>(r=>announce=r),released=new Promise<void>(r=>release=r);
    const revoking=client.begin(async tx=>{
      await tx`UPDATE user_role SET role='auditor' WHERE user_id=${admin}`;
      const [pid]=await tx`SELECT pg_backend_pid() pid`;announce(Number(pid!.pid));await released;
    });
    const pid=await locked;
    const [g]=await client`SELECT revision FROM user_permission_grant WHERE user_id=${manager}`;
    const pending=setUserRunControlTransferGrant(identityDeps(),{session:adminSession,correlationId:ids.next(),userId:manager,granted:true,expectedGrantRevision:Number(g!.revision)});
    try {await expect.poll(async()=>{const [r]=await client`SELECT count(*)::int n FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))`;return r!.n;},{timeout:2000,interval:5}).toBeGreaterThan(0);}
    finally{release();await revoking;}
    try {expect(await pending).toMatchObject({ok:false,reason:'Your role does not permit this action.'});expect(await client`SELECT granted FROM user_permission_grant WHERE user_id=${manager}`).toEqual([{granted:false}]);}
    finally{await client`UPDATE user_role SET role='poc-administrator' WHERE user_id=${admin}`;}
  });

  it('preserves accepted Pause and refuses stale Resume after transfer', async () => {
    const runId=await setup();expect(await pauseRun(waitDeps(),{session,request:{runId}})).toMatchObject({ok:true});
    const [before]=await client`SELECT pause_requested_at::text,pause_requested_by FROM audit_run WHERE run_id=${runId}`;
    const review=await proposal(runId);expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:true});
    expect(await client`SELECT pause_requested_at::text,pause_requested_by FROM audit_run WHERE run_id=${runId}`).toEqual([before]);
    await new PostgresWaitRepository(db).transaction(runId,async context=>{const run=context.run!;await context.saveRunState('PAUSED');await performPause(context as never,{run,request:run.pauseRequest!,waitId:ids.next(),at:new Date().toISOString()});});
    const [run]=await client`SELECT revision FROM audit_run WHERE run_id=${runId}`;
    expect(await resumeRun({...waitDeps(),requireControllerLease:true},{session,request:{runId,expectedRunRevision:Number(run!.revision),expectedControlEpoch:1}})).toMatchObject({ok:false,code:'stale-control'});
    expect(await client`SELECT state FROM audit_run WHERE run_id=${runId}`).toEqual([{state:'PAUSED'}]);
  });

  it('retains accepted Stop across manager transfer', async () => {
    const runId=await setup();
    expect(await cancelRun({roles:new DrizzleRoleRepository(db),unitOfWork:new PostgresRunsUnitOfWork(db),repository:new PostgresRunCancellationRepository(db),ids,clock:new SystemClock()},
      {session,request:{runId,reason:'Stop this test Run.'}})).toMatchObject({ok:true});
    const [before]=await client`SELECT cancel_requested_at::text,cancel_requested_by,cancel_reason FROM audit_run WHERE run_id=${runId}`;
    const review=await proposal(runId);expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:true});
    expect(await client`SELECT cancel_requested_at::text,cancel_requested_by,cancel_reason FROM audit_run WHERE run_id=${runId}`).toEqual([before]);
  });

  it('refuses confirmation when the reviewed Run has become terminal', async () => {
    const runId=await start('QUEUED');await grant(true);
    expect(await acquireRunControlLease(leaseDeps(),{session,request:{runId,expectedEpoch:0}})).toMatchObject({ok:true});
    const review=await proposal(runId);
    expect(await cancelRun({roles:new DrizzleRoleRepository(db),unitOfWork:new PostgresRunsUnitOfWork(db),repository:new PostgresRunCancellationRepository(db),ids,clock:new SystemClock()},
      {session,request:{runId,reason:'End queued fixture.'}})).toMatchObject({ok:true});
    expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:false,code:'terminal'});
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:1}]);
  });

  it('preserves the exact open question and its independent auditor answer right', async () => {
    const runId=await setup();
    const raised=await raiseEscalation({repository:new PostgresWaitRepository(db),ids,clock:new SystemClock()},
      {runId,kind:'retry-or-skip',stepId:'inspection',supportingEvidenceIds:[]});
    if(!raised.ok)throw new Error(raised.reason);
    const before=await client`SELECT to_jsonb(w) body FROM run_wait w WHERE wait_id=${raised.wait.waitId}`;
    const review=await proposal(runId);expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:true});
    expect(await client`SELECT to_jsonb(w) body FROM run_wait w WHERE wait_id=${raised.wait.waitId}`).toEqual(before);
    expect(await answerEscalation(waitDeps(),{session,request:{runId,waitId:raised.wait.waitId,expectedRunRevision:raised.run.revision,answerOptionId:'retry'}})).toMatchObject({ok:true});
  });

  it('rejects SQL marker-only, event-only, receipt-only and grant-forgery writes', async () => {
    const runId=await setup(),review=await proposal(runId),commandId=review.proposal.commandId;
    await expect(client`UPDATE run_control_lease SET transfer_command_id=${commandId} WHERE run_id=${runId}`).rejects.toMatchObject({code:'23514'});
    await expect(client.begin(async tx=>{
      await tx`UPDATE run_control_lease SET epoch=2,holder_id=${manager},updated_at=date_trunc('milliseconds',clock_timestamp()),expires_at=date_trunc('milliseconds',clock_timestamp())+interval '120 seconds',transfer_command_id=${commandId} WHERE run_id=${runId}`;
    })).rejects.toMatchObject({code:'23514'});
    await expect(client`INSERT INTO run_control_transfer_receipt(command_id,event_id) VALUES(${commandId},${ids.next()})`).rejects.toMatchObject({code:'23514'});
    await expect(db.transaction(async tx=>{
      const at=new Date().toISOString();
      await createAuditEventWriter(tx,{now:()=>new Date(at)},ids).append({actor:{type:'human',id:manager},eventType:'lifecycle.run-control-lease-transferred',source:'web',outcome:'success',aggregateId:runId,sessionId:managerSession.sessionId,correlationId:ids.next(),
        payload:{operation:'transfer',commandId,requestKey:review.request.requestKey,expectedEpoch:1,priorEpoch:1,priorHolderId:actor,epoch:2,holderId:manager,reasonRef:commandId,updatedAt:at,expiresAt:new Date(Date.parse(at)+120000).toISOString()}});
    })).rejects.toMatchObject({cause:{code:'23514',message:'Transfer fact requires its exact authoritative lease transition'}});
    await expect(client`UPDATE user_role SET user_id=${other} WHERE user_id=${manager}`).rejects.toMatchObject({code:'23514',message:'Role identity is immutable'});
    await expect(client`DELETE FROM user_permission_grant WHERE user_id=${manager}`).rejects.toMatchObject({code:'23514'});
    await expect(client`UPDATE user_role SET role='auditor' WHERE user_id=${manager}`).rejects.toMatchObject({code:'23514'});
    await expect(client`UPDATE user_permission_grant SET granted=false,revision=revision+1 WHERE user_id=${manager}`).rejects.toMatchObject({code:'23514'});
    expect(await confirm(runId,commandId)).toMatchObject({ok:true});
    for(const invalidCommandId of [null,42,'not-a-uuid','AAAAAAAA-AAAA-7AAA-8AAA-AAAAAAAAAAAA']) {
      await expect(client`INSERT INTO audit_events(event_id,actor_type,actor_id,event_type,occurred_at,source,outcome,session_id,correlation_id,aggregate_id,sequence,payload,previous_hash,event_hash)
        SELECT ${ids.next()},actor_type,actor_id,event_type,occurred_at,source,outcome,session_id,correlation_id,aggregate_id,sequence+1000,
          jsonb_set(payload,'{commandId}',${JSON.stringify(invalidCommandId)}::jsonb),previous_hash,event_hash
        FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-transferred'`)
        .rejects.toMatchObject({code:'23514',message:'Transfer fact requires a valid command identity'});
    }
    await expect(client`UPDATE audit_events SET payload=payload||'{"epoch":99}'::jsonb WHERE aggregate_id=${runId} AND event_type='lifecycle.run-control-lease-transferred'`).rejects.toMatchObject({code:'23514'});
    await expect(client`DELETE FROM run_control_transfer_receipt WHERE command_id=${commandId}`).rejects.toMatchObject({code:'23514'});
  });

  it('supports transfer then renewal and release in one outer transaction without breaking historical proof', async () => {
    const runId=await setup();
    expect(await renewRunControlLease(leaseDeps(),{session,request:{runId,expectedEpoch:1,requestKey:ids.next()}})).toMatchObject({ok:true});
    const review=await proposal(runId);
    await db.transaction(async tx=>{
      expect(await confirm(runId,review.proposal.commandId,tx)).toMatchObject({ok:true});
      expect(await renewRunControlLease(leaseDeps(tx),{session:managerSession,request:{runId,expectedEpoch:2,requestKey:ids.next()}})).toMatchObject({ok:true});
      expect(await releaseRunControlLease(leaseDeps(tx),{session:managerSession,request:{runId,expectedEpoch:2}})).toMatchObject({ok:true});
    });
    expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:true,replayed:true});
  });

  it('rolls back all transfer facts if the outer transaction aborts', async () => {
    const runId=await setup(),review=await proposal(runId);
    await expect(db.transaction(async tx=>{expect(await confirm(runId,review.proposal.commandId,tx)).toMatchObject({ok:true});throw new Error('rollback-transfer');})).rejects.toThrow('rollback-transfer');
    expect(await client`SELECT epoch FROM run_control_lease WHERE run_id=${runId}`).toEqual([{epoch:1}]);
    expect(await client`SELECT event_id FROM run_control_transfer_receipt WHERE command_id=${review.proposal.commandId}`).toHaveLength(0);
    expect(await confirm(runId,review.proposal.commandId)).toMatchObject({ok:true,replayed:false});
  });
});
