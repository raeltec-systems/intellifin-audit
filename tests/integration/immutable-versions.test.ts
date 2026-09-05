import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { deriveExecutablePlan, bindingDigestEnvelope, snapshotFromRegistration } from '@intellifin/domain';
import { createProcedure, applyPlatformConfiguration, renameProcedureDraft, derivePlan, initialPlanDerivation, planAuthoringDigest, procedureVersionRowVersion, transitionVersion, newProcedureVersion, mintPlatformDraft, registrationRowVersion, bindingRowVersion, changeTargetSystem, registerTargetSystem, changePopulationSource, registerPopulationSource, type RegistrationDependencies, type BindingDependencies, type ProcedureVersionRecord, type RegistrationFields, type BindingFields } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleProcedureRepository, DrizzleRegistrationRepository, DrizzleBindingRepository, DrizzleRoleRepository, PostgresProceduresUnitOfWork, PostgresRegistrationsUnitOfWork, PostgresSourcesUnitOfWork, ManifestCredentialProvider, TimerDeadline, AnthropicModelGateway, type Database, type Sql } from '@intellifin/infrastructure';
import { executablePlanInputs } from '../fixtures/executable-plan.js';
import { applyConfigurationFile } from '../../scripts/apply-platform-configuration.mjs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('immutable activation and transactional platform successors', () => {
  let sql: Sql, db: Database, uow: PostgresProceduresUnitOfWork, repo: DrizzleProcedureRepository;
  const ids = new CryptoUuidV7Generator(), prefix = ids.next(), author = `${prefix}-author`, manager = `${prefix}-manager`, admin = `${prefix}-admin`;
  const procedureIds: string[] = [], registrations: string[] = [], bindings: string[] = [], revisions: string[] = [];
  const session = (userId: string) => ({ userId, sessionId: userId });
  const deps = () => ({ roles: new DrizzleRoleRepository(db), unitOfWork: uow, ids });
  const registrationDeps = (): RegistrationDependencies => ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRegistrationsUnitOfWork(db), ids, credentials: new ManifestCredentialProvider(new Map([['vault://synthetic/prod', 'read-only' as const]])), deadlines: new TimerDeadline() });
  const bindingDeps = (): BindingDependencies => ({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresSourcesUnitOfWork(db), ids });
  beforeAll(async () => {
    sql = createSqlClient(url!, { max: 8 }); db = createDb(sql); uow = new PostgresProceduresUnitOfWork(db); repo = new DrizzleProcedureRepository(db);
    for (const [id, role] of [[author,'auditor'],[manager,'audit-manager'],[admin,'poc-administrator']]) {
      await sql`INSERT INTO auth_user(id,name,email) VALUES (${id!},${id!},${id! + '@test.invalid'})`;
      await sql`INSERT INTO user_role(user_id,role) VALUES (${id!},${role!})`;
    }
  });
  afterAll(async () => {
    for (const id of procedureIds) {
      await sql`DELETE FROM procedure_succession WHERE procedure_id=${id}`;
      await sql`DELETE FROM notification WHERE procedure_id=${id}`;
      await sql`DELETE FROM pgboss.job WHERE data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id=${id})`;
      await sql`DELETE FROM procedure_version WHERE procedure_id=${id}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${id}`;
    }
    for (const id of registrations) await sql`DELETE FROM target_system_registration WHERE registration_id=${id}`;
    for (const id of bindings) await sql`DELETE FROM population_source_binding WHERE binding_id=${id}`;
    for (const revision of revisions) { await sql`DELETE FROM procedure_configuration WHERE revision=${revision}`; await sql`DELETE FROM procedure_change WHERE change_id=${'platform:'+revision}`; }
    for (const id of [author, manager, admin]) await sql`DELETE FROM auth_user WHERE id=${id}`;
    await sql.end({ timeout: 5 });
  });
  async function seed() {
    const target: RegistrationFields = { displayName:'ProdConsole',kind:'web',allowedOrigins:['https://synthetic.invalid'],applicationIdentity:'',credentialRef:'vault://synthetic/prod',permittedActions:['navigate','read-attribute'],attributeLabelPatterns:['Parameter'],secondaryKey:'',note:'',status:'active' };
    const source: BindingFields = { displayName:'Baseline',kind:'versioned-file',location:'https://synthetic.invalid/population.csv',declaredSchema:['parameter'],declaredCountMechanism:'cover-sheet',sensitiveFields:[],note:'',status:'active' };
    const targetResult = await registerTargetSystem(registrationDeps(), { ...target, session:session(admin),correlationId:ids.next() });
    const sourceResult = await registerPopulationSource(bindingDeps(), { ...source,session:session(admin),correlationId:ids.next() });
    if (!targetResult.ok || !sourceResult.ok) throw new Error('registration fixture refused');
    registrations.push(targetResult.registrationId); bindings.push(sourceResult.bindingId);
    const inputs = { ...executablePlanInputs(), targets:[snapshotFromRegistration({...target,registrationId:targetResult.registrationId,digest:targetResult.digest})], instructions:[{registrationId:targetResult.registrationId,text:'Read the baseline parameters.'}], sourceSnapshot:{bindingId:sourceResult.bindingId,displayName:source.displayName,digest:sourceResult.digest,contract:bindingDigestEnvelope(source)} };
    const plan = deriveExecutablePlan(inputs); if (!plan.ok) throw new Error(plan.reason);
    let row: ProcedureVersionRecord = { ...inputs,...initialPlanDerivation(), procedureId:ids.next(),versionId:ids.next(),versionNumber:1,state:'DRAFT',compiledPlan:plan.plan,planStatus:'succeeded',planDerivable:true,authorship:{createdBy:{type:'human',id:author},responsibleAuthorId:author,humanAuthorIds:[author]} };
    row={...row,planInputDigest:planAuthoringDigest(row)}; procedureIds.push(row.procedureId);
    await uow.execute(async ctx => {await ctx.procedures.insertProcedure(row);await ctx.procedures.insertVersion(row);}); return row;
  }
  async function act(row: ProcedureVersionRecord, decision:'submit'|'approve') {
    const result=await transitionVersion(deps(),{session:session(decision==='submit'?author:manager),correlationId:ids.next(),procedureId:row.procedureId,versionId:row.versionId,expectedRowVersion:procedureVersionRowVersion(row)},decision);
    expect(result).toMatchObject({ok:true});return (await repo.findVersion(row.versionId))!;
  }
  async function active() { return act(await act(await seed(),'submit'),'approve'); }
  it('pages over 100 versions while resolving the latest Draft and older Active directly', async () => {
    const first = await active();
    await uow.execute(async ctx => { for (let number = 2; number <= 102; number++) await ctx.procedures.insertVersion({ ...first, versionId:ids.next(),versionNumber:number,state:'DRAFT',lifecycle:null,frozenReview:null,submittedReview:null,decisions:[] }); });
    const newest = await repo.latestDraft(first.procedureId);
    expect(newest?.versionNumber).toBe(102);
    expect((await repo.findVersion(newest!.versionId))?.versionNumber).toBe(102);
    const page = await repo.versionPage(first.procedureId);
    expect(page.versions).toHaveLength(100); expect(page.versions[0]?.versionNumber).toBe(102);
    const older = await repo.versionPage(first.procedureId,page.olderThan!);
    expect(older.versions.map(row=>row.versionNumber)).toEqual([2,1]);
    expect(older.versions[1]?.state).toBe('ACTIVE'); expect(older.olderThan).toBeNull();
  });
  it('records the scheduled successor boundary in both durable lifecycle and succession', async () => {
    const first=await active();
    const submitted=await act(await successor(first,{schedule:{frequency:'weekly',startTime:'15:30',periodDerivationRule:'previous-monday-sunday'}}),'submit');
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-06T23:45:00.000Z'));
    try {
      const next=await act(submitted,'approve');
      expect(next.lifecycle?.handoverAt).toBe('2026-09-07T00:00:00.000Z');
      const edges=await sql`SELECT handover_at FROM procedure_succession WHERE successor_id=${next.versionId}`;
      expect(new Date(edges[0]!.handover_at).toISOString()).toBe('2026-09-07T00:00:00.000Z');
    }finally{vi.useRealTimers();}
  });
  it('rechecks New version permission after waiting for the shared lock', async () => {
    const before=await active();let entered!:()=>void,release!:()=>void;
    const enteredPromise=new Promise<void>(resolve=>entered=resolve),released=new Promise<void>(resolve=>release=resolve);
    const blocker=uow.execute(async()=>{entered();await released;});await enteredPromise;
    const correlationId=ids.next();
    const pending=newProcedureVersion(deps(),{session:session(author),correlationId,procedureId:before.procedureId,versionId:before.versionId,expectedRowVersion:procedureVersionRowVersion(before)});
    try {
      await expect.poll(async()=>Number((await sql`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`)[0]!.count)).toBeGreaterThan(0);
      await sql`DELETE FROM user_role WHERE user_id=${author}`;
    }finally{release();await blocker;}
    try {
      expect(await pending).toMatchObject({ok:false});
      expect(await repo.listVersions(before.procedureId)).toHaveLength(1);
      expect(await sql`SELECT * FROM pgboss.job WHERE data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id=${before.procedureId})`).toHaveLength(0);
      expect(await sql`SELECT * FROM audit_events WHERE correlation_id=${correlationId} AND event_type='security.denied'`).toHaveLength(1);
    }finally{await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;}
  });
  it('projects each Procedure name from its own version rather than another Procedure', async () => {
    const first = await seed(), second = await seed();
    await sql`UPDATE procedure_version SET control_name='First distinct Draft' WHERE version_id=${first.versionId}`;
    await sql`UPDATE procedure_version SET control_name='Second distinct Draft' WHERE version_id=${second.versionId}`;
    const summaries = await repo.listProcedures();
    expect(summaries.find(row => row.procedureId === first.procedureId)?.controlName).toBe('First distinct Draft');
    expect(summaries.find(row => row.procedureId === second.procedureId)?.controlName).toBe('Second distinct Draft');
    expect((await repo.findProcedure(first.procedureId))?.controlName).toBe('First distinct Draft');
  });
  it('refuses malformed durable lifecycle and platform provenance before exposing a Draft', async () => {
    const row = await seed();
    for (const value of [{}, { changeId:'event', originatingVersionId:ids.next(), kind:'source', description:'source change' }]) {
      await sql`UPDATE procedure_version SET platform_origin=${JSON.stringify(value)}::jsonb WHERE version_id=${row.versionId}`;
      expect(await repo.findVersion(row.versionId)).toBeNull();
    }
    await sql`UPDATE procedure_version SET platform_origin=NULL WHERE version_id=${row.versionId}`;
    for (const value of [{}, { requiresRegression:false, reason:'first-version', priorActiveVersionId:null, activatedAt:'2026-09-05T00:00:00.000Z', handoverAt:null }]) {
      await sql`UPDATE procedure_version SET lifecycle=${JSON.stringify(value)}::jsonb WHERE version_id=${row.versionId}`;
      expect(await repo.findVersion(row.versionId)).toBeNull();
    }
    await sql`UPDATE procedure_version SET lifecycle=NULL, configuration_revision='invalid revision' WHERE version_id=${row.versionId}`;
    expect(await repo.findVersion(row.versionId)).toBeNull();
    await sql`UPDATE procedure_version SET configuration_revision=NULL WHERE version_id=${row.versionId}`;
    expect(await repo.findVersion(row.versionId)).not.toBeNull();
  });
  async function successor(before:ProcedureVersionRecord, change:Partial<ProcedureVersionRecord>={}) {
    const result=await newProcedureVersion(deps(),{session:session(author),correlationId:ids.next(),procedureId:before.procedureId,versionId:before.versionId,expectedRowVersion:procedureVersionRowVersion(before)});
    if(!result.ok) throw new Error(result.reason);
    let row={...(await repo.findVersion(result.versionId))!,...change};
    const plan=deriveExecutablePlan(row);if(!plan.ok)throw new Error(plan.reason);
    row={...row,compiledPlan:plan.plan,planDerivable:true,planStatus:'succeeded' as const,planInputDigest:planAuthoringDigest(row)};
    await uow.execute(ctx=>ctx.procedures.updateVersion(row));return row;
  }
  it('first and unchanged versions activate; out-of-number-order activation preserves both boundaries and the chain tip',async()=>{
    const first=await active();expect(first.lifecycle).toMatchObject({requiresRegression:false,reason:'first-version',handoverAt:null});
    const olderDraft=await successor(first), newerDraft=await successor(first);
    const newer=await act(await act(newerDraft,'submit'),'approve');
    const older=await act(await act(olderDraft,'submit'),'approve');
    expect(older.lifecycle?.priorActiveVersionId).toBe(newer.versionId);
    const links=await sql`SELECT * FROM procedure_succession WHERE procedure_id=${first.procedureId}`;
    expect(links).toHaveLength(2);expect(links.find(link=>link.successor_id===newer.versionId)?.predecessor_id).toBe(first.versionId);
    expect((await uow.execute(ctx=>ctx.procedures.findLatestActiveVersion!(first.procedureId)))?.versionId).toBe(older.versionId);
    const replay=await transitionVersion(deps(),{session:session(manager),correlationId:ids.next(),procedureId:older.procedureId,versionId:older.versionId,expectedRowVersion:procedureVersionRowVersion(older)},'approve');expect(replay.ok).toBe(false);
    expect(await sql`SELECT * FROM procedure_succession WHERE procedure_id=${first.procedureId}`).toHaveLength(2);
  });
  it('changed model approval stays pending and raw SQL cannot edit either approved, active or retired definitions',async()=>{
    const first=await active();const candidate=await successor(first,{derivationModel:{provider:'anthropic',modelId:'synthetic-new',promptVersion:'1'}});
    const pending=await act(await act(candidate,'submit'),'approve');expect(pending.state).toBe('APPROVED');expect(pending.lifecycle).toMatchObject({requiresRegression:true,activatedAt:null,handoverAt:null,priorActiveVersionId:first.versionId});
    for(const row of [first,pending]) {
      await expect(sql`UPDATE procedure_version SET control_name='tampered' WHERE version_id=${row.versionId}`).rejects.toThrow('immutable');
      await expect(sql`UPDATE procedure_version SET state='DRAFT', scope='tampered' WHERE version_id=${row.versionId}`).rejects.toThrow('immutable');
      await expect(sql`UPDATE procedure_version SET state='DRAFT' WHERE version_id=${row.versionId}`).rejects.toThrow('cannot return');
      await expect(sql`UPDATE procedure_version SET frozen_review=NULL WHERE version_id=${row.versionId}`).rejects.toThrow('immutable');
      const columns=await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='procedure_version' AND column_name NOT IN ('state','updated_at','plan_attempts','lifecycle')`;
      const raw=(await sql`SELECT * FROM procedure_version WHERE version_id=${row.versionId}`)[0]!;
      for(const column of columns){const replacement=raw[column.column_name]===null?(column.data_type==='jsonb'?"'{}'::jsonb":"'changed'"):'NULL';await expect(sql.unsafe(`UPDATE procedure_version SET "${column.column_name}"=${replacement} WHERE version_id=$1`,[row.versionId])).rejects.toThrow('immutable');}
      await sql`UPDATE procedure_version SET plan_attempts=plan_attempts WHERE version_id=${row.versionId}`;
    }
    await sql`UPDATE procedure_version SET state='RETIRED' WHERE version_id=${first.versionId}`;
    await expect(sql`UPDATE procedure_version SET instructions='[]' WHERE version_id=${first.versionId}`).rejects.toThrow('immutable');
  });
  it('raw SQL cannot rewrite recorded activation metadata or an activated succession, and a succession cannot cross Procedures',async()=>{
    // The definition trigger excludes `lifecycle` from its column comparison so activation
    // can record it; that exclusion is exactly where a later rewrite would hide, so the
    // trigger's own third branch guards it. Nothing exercised that branch, nor the
    // succession trigger's, before this test (verification-gap review on #21).
    const first=await active();expect(first.lifecycle).not.toBeNull();
    await expect(sql`UPDATE procedure_version SET lifecycle = lifecycle || '{"handoverAt":"2099-01-01T00:00:00.000Z"}'::jsonb WHERE version_id=${first.versionId}`).rejects.toThrow('Recorded activation metadata is immutable');
    await expect(sql`UPDATE procedure_version SET lifecycle = NULL WHERE version_id=${first.versionId}`).rejects.toThrow('Recorded activation metadata is immutable');
    // Same value is not a rewrite: IS DISTINCT FROM keeps the branch specific.
    await sql`UPDATE procedure_version SET lifecycle = lifecycle WHERE version_id=${first.versionId}`;
    expect((await repo.findVersion(first.versionId))?.lifecycle).toEqual(first.lifecycle);

    const next=await act(await act(await successor(first),'submit'),'approve');expect(next.state).toBe('ACTIVE');
    const [edge]=await sql`SELECT successor_id, activated_at, handover_at FROM procedure_succession WHERE successor_id=${next.versionId}`;
    expect(edge?.activated_at).not.toBeNull();
    await expect(sql`UPDATE procedure_succession SET handover_at = now() WHERE successor_id=${next.versionId}`).rejects.toThrow('Activated succession is immutable');
    await expect(sql`UPDATE procedure_succession SET predecessor_id = ${next.versionId} WHERE successor_id=${next.versionId}`).rejects.toThrow('Activated succession is immutable');
    await sql`UPDATE procedure_succession SET handover_at = handover_at WHERE successor_id=${next.versionId}`;

    // A succession edge whose endpoints belong to two Procedures is refused at insert.
    const other=await active();
    await expect(sql`INSERT INTO procedure_succession (procedure_id, predecessor_id, successor_id) VALUES (${first.procedureId}, ${other.versionId}, ${next.versionId})`).rejects.toThrow('same Procedure');
  });
  it('after a successor activates, a registration change counts and mints from the current version only',async()=>{
    // Nothing writes RETIRED until Schedule handover (a later epic), so a superseded
    // version stays ACTIVE beside its successor. `findLatestActiveVersion` already treats
    // a version with an activated successor as not current; the ripple count and the
    // mint fan-out must apply the same rule, or the administrator confirms "1 Procedure"
    // and two Drafts appear, one copied from the superseded definition (correctness
    // review on #21).
    const first=await active();
    const next=await act(await act(await successor(first),'submit'),'approve');expect(next.state).toBe('ACTIVE');
    const record=(await new DrizzleRegistrationRepository(db).findRegistration(first.targets[0]!.registrationId))!;
    expect(await repo.countReferencing(record.registrationId)).toBe(1);
    const result=await changeTargetSystem(registrationDeps(),{...record,attributeLabelPatterns:['Successor Parameter'],note:'',session:session(admin),correlationId:ids.next(),expectedRowVersion:registrationRowVersion(record),expectedAffectedProcedures:1});
    expect(result).toMatchObject({ok:true});
    const drafts=(await repo.listVersions(first.procedureId)).filter(version=>version.state==='DRAFT');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.platformOrigin?.originatingVersionId).toBe(next.versionId);
  });
  it('a registration only a superseded version still references counts no Procedure, and its change mints nothing',async()=>{
    // The count is "distinct Procedures", so a successor that RETAINS the registration hides
    // a count that ignores succession: both versions belong to one Procedure. A successor
    // that swaps it for another system is where the two rules differ — the superseded
    // version still names the original registration and still reads ACTIVE, and it must
    // not count, or the administrator confirms "1 Procedure" and nothing is minted.
    const first=await active();
    const replacement:RegistrationFields={displayName:'ProdConsoleTwo',kind:'web',allowedOrigins:['https://synthetic-two.invalid'],applicationIdentity:'',credentialRef:'vault://synthetic/prod',permittedActions:['navigate','read-attribute'],attributeLabelPatterns:['Parameter'],secondaryKey:'',note:'',status:'active'};
    const registered=await registerTargetSystem(registrationDeps(),{...replacement,session:session(admin),correlationId:ids.next()});
    if(!registered.ok)throw new Error('registration fixture refused');registrations.push(registered.registrationId);
    const pending=await act(await act(await successor(first,{targets:[snapshotFromRegistration({...replacement,registrationId:registered.registrationId,digest:registered.digest})],instructions:[{registrationId:registered.registrationId,text:'Read the replacement parameters.'}]}),'submit'),'approve');
    expect(pending.state).toBe('APPROVED');expect(pending.lifecycle).toMatchObject({requiresRegression:true,activatedAt:null});
    // A changed configuration waits for a Regression Run, which a later epic activates.
    // Simulate that activation with the one state progression generation 14 permits, so
    // the read rule is proven for the day a command can reach it.
    const activatedAt=new Date().toISOString();
    await sql`UPDATE procedure_version SET state='ACTIVE', lifecycle=jsonb_set(lifecycle,'{activatedAt}',to_jsonb(${activatedAt}::text)) WHERE version_id=${pending.versionId}`;
    await sql`UPDATE procedure_succession SET activated_at=${activatedAt}::timestamptz WHERE successor_id=${pending.versionId} AND predecessor_id=${first.versionId}`;
    expect((await uow.execute(ctx=>ctx.procedures.findLatestActiveVersion!(first.procedureId)))?.versionId).toBe(pending.versionId);
    const original=first.targets[0]!.registrationId;
    expect(await repo.countReferencing(original)).toBe(0);
    expect(await repo.countReferencing(registered.registrationId)).toBe(1);
    const record=(await new DrizzleRegistrationRepository(db).findRegistration(original))!;
    const result=await changeTargetSystem(registrationDeps(),{...record,attributeLabelPatterns:['Superseded Parameter'],note:'',session:session(admin),correlationId:ids.next(),expectedRowVersion:registrationRowVersion(record),expectedAffectedProcedures:0});
    expect(result).toMatchObject({ok:true});
    expect((await repo.listVersions(first.procedureId)).filter(version=>version.state==='DRAFT')).toHaveLength(0);
  });
  it.each(['registration','source'] as const)('%s save checks exact impact, mints atomically, and ignores annotations',async kind=>{
    const before=await active(),unrelated=await active();
    const correlationId=ids.next();
    const perform=async(count:number,annotation=false,fail=false)=>{
      if(kind==='registration'){
        const record=(await new DrizzleRegistrationRepository(db).findRegistration(before.targets[0]!.registrationId))!;
        let dependencies=registrationDeps();const original=dependencies.unitOfWork;
        if(fail)dependencies={...dependencies,unitOfWork:{execute:work=>original.execute(async ctx=>{const result=await work(ctx);throw new Error('forced rollback after mint');})}};
        return changeTargetSystem(dependencies,{...record,attributeLabelPatterns:annotation?record.attributeLabelPatterns:['Changed Parameter'],note:annotation?'annotation':'',session:session(admin),correlationId,expectedRowVersion:registrationRowVersion(record),expectedAffectedProcedures:count});
      }
      const record=(await new DrizzleBindingRepository(db).findBinding(before.sourceSnapshot!.bindingId))!;
      let dependencies=bindingDeps();const original=dependencies.unitOfWork;
      if(fail)dependencies={...dependencies,unitOfWork:{execute:work=>original.execute(async ctx=>{await work(ctx);throw new Error('forced rollback after mint');})}};
      return changePopulationSource(dependencies,{...record,location:annotation?record.location:'https://synthetic.invalid/changed.csv',note:annotation?'annotation':'',session:session(admin),correlationId,expectedRowVersion:bindingRowVersion(record),expectedAffectedProcedures:count});
    };
    expect(await perform(0)).toMatchObject({ok:false,reason:expect.stringContaining('1 Procedures')});
    await expect(perform(1,false,true)).rejects.toThrow('forced rollback');expect(await repo.listVersions(before.procedureId)).toHaveLength(1);
    expect(await sql`SELECT * FROM audit_events WHERE correlation_id=${correlationId}`).toHaveLength(0);
    expect(await perform(1)).toMatchObject({ok:true,published:true});
    const versions=await repo.listVersions(before.procedureId);expect(versions).toHaveLength(2);
    const draft=versions.find(row=>row.state==='DRAFT')!;expect(draft.platformOrigin?.kind).toBe(kind);expect(draft.authorship?.createdBy.type).toBe('platform');expect(draft.authorship?.responsibleAuthorId).toBe(author);
    if(kind==='registration') {
      const owner=(await new DrizzleRegistrationRepository(db).findRegistration(before.targets[0]!.registrationId))!;
      expect(draft.targets).toEqual([snapshotFromRegistration(owner)]);expect(draft.sourceSnapshot).toEqual(before.sourceSnapshot);
    }else{
      const owner=(await new DrizzleBindingRepository(db).findBinding(before.sourceSnapshot!.bindingId))!;
      expect(draft.sourceSnapshot).toEqual({bindingId:owner.bindingId,displayName:owner.displayName,digest:owner.digest,contract:bindingDigestEnvelope(owner)});expect(draft.targets).toEqual(before.targets);
    }
    expect((await repo.findVersion(before.versionId))?.targets).toEqual(before.targets);expect((await repo.findVersion(before.versionId))?.sourceSnapshot).toEqual(before.sourceSnapshot);
    expect((await repo.findVersion(unrelated.versionId))?.targets).toEqual(unrelated.targets);expect((await repo.findVersion(unrelated.versionId))?.sourceSnapshot).toEqual(unrelated.sourceSnapshot);
    const queued=(await sql`SELECT data FROM pgboss.job WHERE data->>'versionId'=${draft.versionId}`)[0]!.data;
    expect(await derivePlan({repository:repo,unitOfWork:uow,ids,clock:{now:()=>new Date()},model:null},queued)).toMatchObject({ok:true,outcome:'success'});
    const derived=(await repo.findVersion(draft.versionId))!;
    expect(derived.compiledPlan?.inputs.targets).toEqual(draft.targets);expect(derived.compiledPlan?.inputs.sourceSnapshot).toEqual(draft.sourceSnapshot);
    expect((await repo.findVersion(before.versionId))?.state).toBe('ACTIVE');
    const changeId=draft.platformOrigin!.changeId;
    const replay=await uow.execute(ctx=>mintPlatformDraft(ctx,ids,kind==='registration'?{kind,changeId,snapshot:draft.targets[0]!}:{kind,changeId,snapshot:draft.sourceSnapshot!}));expect(replay).toEqual([draft.versionId]);
    expect(await perform(1,true)).toMatchObject({ok:true,published:false});expect(await repo.listVersions(before.procedureId)).toHaveLength(2);
    expect(await sql`SELECT * FROM pgboss.job WHERE data->>'versionId'=${draft.versionId}`).toHaveLength(1);
    // Returning to the original digest is a new event, never the old change replay.
    if(kind==='registration'){
      const current=(await new DrizzleRegistrationRepository(db).findRegistration(before.targets[0]!.registrationId))!;
      expect(await changeTargetSystem(registrationDeps(),{...current,attributeLabelPatterns:before.targets[0]!.contract.attribute_label_patterns,expectedRowVersion:registrationRowVersion(current),expectedAffectedProcedures:1,session:session(admin),correlationId:ids.next()})).toMatchObject({ok:true,published:true});
    }else{
      const current=(await new DrizzleBindingRepository(db).findBinding(before.sourceSnapshot!.bindingId))!;
      expect(await changePopulationSource(bindingDeps(),{...current,location:before.sourceSnapshot!.contract.location!,expectedRowVersion:bindingRowVersion(current),expectedAffectedProcedures:1,session:session(admin),correlationId:ids.next()})).toMatchObject({ok:true,published:true});
    }
    expect(await repo.listVersions(before.procedureId)).toHaveLength(3);
    const later=await act(await act(await successor(before),'submit'),'approve');
    expect(later.state).toBe('ACTIVE');
    const historical=await uow.execute(ctx=>mintPlatformDraft(ctx,ids,kind==='registration'?{kind,changeId,snapshot:draft.targets[0]!}:{kind,changeId,snapshot:draft.sourceSnapshot!}));
    expect(historical).toEqual([draft.versionId]);
    expect(await repo.listVersions(before.procedureId)).toHaveLength(4);

  });
  it.each(['registration','source'] as const)('%s changes ignore corrupt unrelated Active rows but refuse corrupt affected rows',async kind=>{
    const affected=await active(),unrelated=await active();
    const change=async(suffix='first')=>{
      if(kind==='registration'){
        const owner=(await new DrizzleRegistrationRepository(db).findRegistration(affected.targets[0]!.registrationId))!;
        return changeTargetSystem(registrationDeps(),{...owner,attributeLabelPatterns:[`Subset proof ${suffix}`],expectedRowVersion:registrationRowVersion(owner),expectedAffectedProcedures:1,session:session(admin),correlationId:ids.next()});
      }
      const owner=(await new DrizzleBindingRepository(db).findBinding(affected.sourceSnapshot!.bindingId))!;
      return changePopulationSource(bindingDeps(),{...owner,location:`https://synthetic.invalid/${suffix}.csv`,expectedRowVersion:bindingRowVersion(owner),expectedAffectedProcedures:1,session:session(admin),correlationId:ids.next()});
    };
    await sql`UPDATE procedure_version SET plan_attempts='[{}]'::jsonb WHERE version_id=${unrelated.versionId}`;
    try {
      expect(await repo.findVersion(unrelated.versionId)).toBeNull();
      expect(await change()).toMatchObject({ok:true,published:true});
      await sql`UPDATE procedure_version SET plan_attempts='[{}]'::jsonb WHERE version_id=${affected.versionId}`;
      // A second distinct change still discovers and refuses this affected row.
      await expect(change('second')).rejects.toThrow('could not be verified');
    }finally{await sql`UPDATE procedure_version SET plan_attempts='[]'::jsonb WHERE version_id IN (${affected.versionId},${unrelated.versionId})`;}
  });
  it('serializes activation entering the reference set and refuses stale ripple confirmation before mutation',async()=>{
    const draft=await seed(),submitted=await act(draft,'submit');
    let entered!:()=>void,release!:()=>void;
    const enteredPromise=new Promise<void>(resolve=>entered=resolve),releasePromise=new Promise<void>(resolve=>release=resolve);
    const held={execute:<T>(work:Parameters<typeof uow.execute<T>>[0])=>uow.execute(async ctx=>{const result=await work(ctx);entered();await releasePromise;return result;})};
    const first=transitionVersion({...deps(),unitOfWork:held},{session:session(manager),correlationId:ids.next(),procedureId:submitted.procedureId,versionId:submitted.versionId,expectedRowVersion:procedureVersionRowVersion(submitted)},'approve');
    await enteredPromise;
    const registration=(await new DrizzleRegistrationRepository(db).findRegistration(submitted.targets[0]!.registrationId))!;
    const second=changeTargetSystem(registrationDeps(),{...registration,attributeLabelPatterns:['racing label'],expectedRowVersion:registrationRowVersion(registration),expectedAffectedProcedures:0,session:session(admin),correlationId:ids.next()});
    try {
      let blocked=false;const deadline=Date.now()+5000;
      while(Date.now()<deadline){const rows=await sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`;if(rows.length){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
      expect(blocked).toBe(true);
    }finally{release();}
    expect(await first).toMatchObject({ok:true,state:'ACTIVE'});expect(await second).toMatchObject({ok:false,reason:expect.stringContaining('1 Procedures')});
    expect((await new DrizzleRegistrationRepository(db).findRegistration(registration.registrationId))?.digest).toBe(registration.digest);
    expect(await repo.listVersions(draft.procedureId)).toHaveLength(1);
  });
  it('rolls successor activation, lineage, lifecycle, audit and notification back together',async()=>{
    const first=await active(),submitted=await act(await successor(first),'submit');
    const activationEvents = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${first.procedureId} AND event_type='lifecycle.procedure-version-activated'`;
    expect(activationEvents).toHaveLength(1);
    expect(activationEvents[0]!.payload).toMatchObject({ priorState:'APPROVED', state:'ACTIVE', versionId:first.versionId });
    const approvalEvents = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${first.procedureId} AND event_type='lifecycle.procedure-version-decided' AND payload->>'decision'='approve'`;
    expect(approvalEvents[0]!.payload).toMatchObject({ priorState:'SUBMITTED', state:'APPROVED' });
    const correlationId = ids.next();
    const failing={execute:<T>(work:Parameters<typeof uow.execute<T>>[0])=>uow.execute(ctx=>work({...ctx,notifications:{enqueue:async notice=>{await ctx.notifications.enqueue(notice);throw new Error('activation rollback');}}}))};
    await expect(transitionVersion({...deps(),unitOfWork:failing},{session:session(manager),correlationId,procedureId:submitted.procedureId,versionId:submitted.versionId,expectedRowVersion:procedureVersionRowVersion(submitted)},'approve')).rejects.toThrow('activation rollback');
    expect(await sql`SELECT * FROM audit_events WHERE correlation_id=${correlationId}`).toHaveLength(0);
    expect(await sql`SELECT * FROM procedure_succession WHERE procedure_id=${first.procedureId}`).toHaveLength(0);
    expect((await repo.findVersion(submitted.versionId))?.state).toBe('SUBMITTED');
    expect((await repo.findVersion(submitted.versionId))?.lifecycle).toBeNull();
    expect((await repo.findVersion(first.versionId))?.lifecycle).toEqual(first.lifecycle);
  });
  it('migrates a persisted generation-13 approval without silently activating or invalidating its review',async()=>{
    const row=await active(),dedicated=createSqlClient(url!,{max:1}),schema=`upgrade_${ids.next().replaceAll('-','')}`;
    try {
      await dedicated.unsafe(`CREATE SCHEMA "${schema}"`);
      await dedicated.unsafe(`SET search_path TO "${schema}", public`);
      await dedicated.unsafe(`CREATE TABLE "${schema}".procedure (LIKE public.procedure INCLUDING ALL)`);
      await dedicated.unsafe(`CREATE TABLE "${schema}".procedure_version (LIKE public.procedure_version INCLUDING ALL)`);
      await dedicated.unsafe(`CREATE TABLE "${schema}".schema_meta (LIKE public.schema_meta INCLUDING ALL)`);
      await dedicated.unsafe(`INSERT INTO "${schema}".procedure SELECT * FROM public.procedure WHERE procedure_id=$1`,[row.procedureId]);
      await dedicated.unsafe(`INSERT INTO "${schema}".procedure_version SELECT * FROM public.procedure_version WHERE version_id=$1`,[row.versionId]);
      await dedicated.unsafe(`ALTER TABLE "${schema}".procedure_version DROP COLUMN lifecycle, DROP COLUMN platform_origin, DROP COLUMN configuration_revision`);
      await dedicated.unsafe(`UPDATE "${schema}".procedure_version SET state='APPROVED'`);
      await dedicated`INSERT INTO schema_meta(version) VALUES (13)`;
      const before=(await dedicated`SELECT frozen_review FROM procedure_version`)[0]!.frozen_review;
      const migration=await readFile(new URL('../../packages/infrastructure/drizzle/0014_young_vance_astro.sql',import.meta.url),'utf8');
      for(const statement of migration.replaceAll('"public".',`"${schema}".`).split('--> statement-breakpoint'))if(statement.trim())await dedicated.unsafe(statement);
      const upgraded=await new DrizzleProcedureRepository(createDb(dedicated)).findVersion(row.versionId);
      expect(upgraded?.state).toBe('APPROVED');expect(upgraded?.lifecycle).toBeNull();expect(upgraded?.frozenReview).toEqual(before);
      await expect(dedicated`UPDATE procedure_version SET scope='changed'`).rejects.toThrow('immutable');
    }finally{await dedicated.unsafe('SET search_path TO public');await dedicated.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await dedicated.end();}
  });
  it('refuses approval if saved live fields contradict the submitted review',async()=>{
    const submitted=await act(await seed(),'submit');
    await sql`UPDATE procedure_version SET scope='Unreviewed scope' WHERE version_id=${submitted.versionId}`;
    const changed=(await repo.findVersion(submitted.versionId))!;
    expect(await transitionVersion(deps(),{session:session(manager),correlationId:ids.next(),procedureId:changed.procedureId,versionId:changed.versionId,expectedRowVersion:procedureVersionRowVersion(changed)},'approve')).toMatchObject({ok:false,reason:expect.stringContaining('submitted review snapshot')});
    expect((await repo.findVersion(changed.versionId))?.state).toBe('SUBMITTED');
  });
  it('records human edits to a platform Draft and prevents that manager from approving it',async()=>{
    const before=await active();
    const minted=await uow.execute(ctx=>mintPlatformDraft(ctx,ids,{kind:'registration',changeId:ids.next(),snapshot:before.targets[0]!}));
    let draft=(await repo.findVersion(minted[0]!))!;
    expect(await renameProcedureDraft(deps(),{session:session(manager),correlationId:ids.next(),procedureId:draft.procedureId,versionId:draft.versionId,expectedRowVersion:procedureVersionRowVersion(draft),controlName:'Manager edited platform Draft'})).toMatchObject({ok:true});
    draft=(await repo.findVersion(draft.versionId))!;
    await derivePlan({repository:repo,unitOfWork:uow,ids,clock:{now:()=>new Date()},model:null},{schemaVersion:1,versionId:draft.versionId,inputDigest:draft.planInputDigest!});
    const submitted=await act((await repo.findVersion(draft.versionId))!,'submit');
    expect(submitted.authorship?.createdBy.type).toBe('platform');expect(submitted.authorship?.humanAuthorIds).toContain(manager);
    expect(await transitionVersion(deps(),{session:session(manager),correlationId:ids.next(),procedureId:submitted.procedureId,versionId:submitted.versionId,expectedRowVersion:procedureVersionRowVersion(submitted)},'approve')).toMatchObject({ok:false,reason:'You cannot approve a version you authored.'});
  });
  it('records a publication whose model is unchanged in the chain, and mints nothing for it',async()=>{
    // A new revision with the same model still repoints `@current`, which every new
    // version stamps as its configuration revision. That is a state change nobody can
    // see without an event (correctness review on #21). A replay of the same file
    // appends nothing further.
    const first=`test-${ids.next()}`, again=`test-${ids.next()}`;revisions.push(first,again);
    const model={provider:'anthropic',modelId:first,promptVersion:'1'};
    // `@current` is shared by every file on this database and stamps every new version,
    // so it is put back exactly as found, whether or not the assertions pass.
    const priorPointer=(await sql`SELECT configuration FROM procedure_configuration WHERE revision='@current'`)[0]?.configuration;
    try{
      for(const revision of [first,again]){const file=join(tmpdir(),`${revision}.json`);await writeFile(file,JSON.stringify({revision,model,interpreterContract:'executable-plan-v1',changeKind:'model'}));await applyConfigurationFile(url!,file);if(revision===again)await applyConfigurationFile(url!,file);}
      const events=await sql`SELECT payload FROM audit_events WHERE event_type='configuration.procedure-platform-changed' AND correlation_id=${'platform:'+again}`;
      expect(events).toHaveLength(1);expect(events[0]?.payload).toMatchObject({revision:again,changeKind:'model',modelChanged:false});
      expect((await sql`SELECT configuration FROM procedure_configuration WHERE revision='@current'`)[0]?.configuration).toMatchObject({revision:again});
      expect(await sql`SELECT version_id FROM procedure_version WHERE configuration_revision=${again}`).toHaveLength(0);
    }finally{
      if(priorPointer)await sql`UPDATE procedure_configuration SET configuration=${sql.json(priorPointer)} WHERE revision='@current'`;else await sql`DELETE FROM procedure_configuration WHERE revision='@current'`;
    }
  });
  it('operational configuration file entry point mints a supported reviewed model contract and replays its durable revision',async()=>{
    const before=await active(), revision=`test-${ids.next()}`,file=join(tmpdir(),`${revision}.json`);revisions.push(revision);
    const priorPointer=(await sql`SELECT configuration FROM procedure_configuration WHERE revision='@current'`)[0]?.configuration;
    try{
      await writeFile(file,JSON.stringify({revision,model:{provider:'anthropic',modelId:revision,promptVersion:'1'},interpreterContract:'executable-plan-v1',changeKind:'model'}));
      await applyConfigurationFile(url!,file);await applyConfigurationFile(url!,file);
      const drafts=(await repo.listVersions(before.procedureId)).filter(row=>row.configurationRevision===revision);expect(drafts).toHaveLength(1);
      const draft=drafts[0]!;expect(draft.derivationModel?.modelId).toBe(revision);
      const result=await derivePlan({repository:repo,unitOfWork:uow,ids,clock:{now:()=>new Date()},model:null},{schemaVersion:1,versionId:draft.versionId,inputDigest:draft.planInputDigest!});expect(result).toMatchObject({ok:true,outcome:'failure'});
      expect((await repo.findVersion(draft.versionId))?.planFailureReason).toContain('configuration is unavailable');
      const realFetch=globalThis.fetch;let providerCalls=0;
      globalThis.fetch=async(input,init)=>{
        const target=typeof input==='string'?input:input instanceof URL?input.href:input.url;
        if(new URL(target).hostname!=='api.anthropic.com')return realFetch(input,init);
        providerCalls++;
        const body=JSON.parse(String(init?.body));
        const content=body.messages.at(-1).content;
        const prompt=typeof content==='string'?content:content.filter((part:{type:string})=>part.type==='text').map((part:{text:string})=>part.text).join('');
        const authored=JSON.parse(prompt);const compiled=deriveExecutablePlan(authored.authoredInputs,authored.compilerVersion);if(!compiled.ok)throw new Error(compiled.reason);
        expect(body.model).toBe(revision);
        return new Response(JSON.stringify({id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[{type:'text',text:JSON.stringify(compiled.plan)}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:100}}),{status:200,headers:{'content-type':'application/json'}});
      };
      try {
        const jobs=await sql`SELECT data FROM pgboss.job WHERE data->>'versionId'=${draft.versionId}`;
        expect(await derivePlan({repository:repo,unitOfWork:uow,ids,clock:{now:()=>new Date()},model:new AnthropicModelGateway(revision,'1','synthetic-key',65536)},jobs[0]!.data)).toMatchObject({ok:true,outcome:'success'});
        expect(providerCalls).toBe(1);
        const submitted=await act((await repo.findVersion(draft.versionId))!,'submit');
        expect(submitted.submittedReview?.definition.modelConfiguration?.modelId).toBe(revision);
      }finally{globalThis.fetch=realFetch;}
      const noopRevision=`${revision}-noop`;revisions.push(noopRevision);
      await writeFile(file,JSON.stringify({revision:noopRevision,model:{provider:'anthropic',modelId:revision,promptVersion:'1'},interpreterContract:'executable-plan-v1',changeKind:'model'}));
      expect(await applyConfigurationFile(url!,file)).toBe(0);
      // Replay of the older revision cannot reset the current publication identity.
      await applyPlatformConfiguration({unitOfWork:uow,ids},{revision,model:{provider:'anthropic',modelId:revision,promptVersion:'1'},interpreterContract:'executable-plan-v1',changeKind:'model'});
      const created=await createProcedure({...deps(),derivationModel:{provider:'openai',modelId:'stale-web-model',promptVersion:'1'}},{templateId:'P-4',controlName:'Current published configuration',session:session(author),correlationId:ids.next()});
      expect(created.ok).toBe(true);if(!created.ok)throw new Error(created.reason);procedureIds.push(created.procedureId);
      const fresh=(await repo.findVersion(created.versionId))!;
      expect(fresh.derivationModel).toEqual({provider:'anthropic',modelId:revision,promptVersion:'1'});expect(fresh.configurationRevision).toBe(noopRevision);
      expect(fresh.planInputDigest).toBe(planAuthoringDigest(fresh));
      expect((await sql`SELECT data FROM pgboss.job WHERE data->>'versionId'=${fresh.versionId}`)[0]!.data.inputDigest).toBe(fresh.planInputDigest);
      const snapshot=(await sql`SELECT * FROM procedure_configuration ORDER BY revision`);
      await expect(uow.execute(ctx=>ctx.procedures.applyConfigurationRevision!(revision,{model:{provider:'anthropic',modelId:revision,promptVersion:'1'},interpreterContract:'executable-plan-v1',changeKind:'tool'}))).rejects.toThrow('cannot be redefined');
      for(const changeKind of ['prompt','tool'])await expect(applyPlatformConfiguration({unitOfWork:uow,ids},{revision,model:{provider:'anthropic',modelId:revision,promptVersion:'1'},interpreterContract:'executable-plan-v1',changeKind})).rejects.toThrow('Unsupported');
      expect(await sql`SELECT * FROM procedure_configuration ORDER BY revision`).toEqual(snapshot);
      await writeFile(file,JSON.stringify({revision:`${revision}-unsupported`,model:{provider:'anthropic',modelId:revision,promptVersion:'2'},interpreterContract:'executable-plan-v1',changeKind:'prompt'}));
      await expect(applyConfigurationFile(url!,file)).rejects.toThrow('Unsupported');
    }finally{await unlink(file);await sql`DELETE FROM procedure_configuration WHERE revision='@current'`;if(priorPointer!==undefined)await sql`INSERT INTO procedure_configuration(revision,configuration) VALUES ('@current',${sql.json(priorPointer)})`;}
  });
});
