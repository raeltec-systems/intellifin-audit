import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flagRun, initiateRun } from '@intellifin/application';
import { createDb,createSqlClient,CryptoUuidV7Generator,DrizzleRoleRepository,PostgresProceduresUnitOfWork,PostgresRunFlagRepository,PostgresRunsUnitOfWork,SystemClock,type Database,type Sql } from '@intellifin/infrastructure';
import { PostgresRunConversationRepository } from '../../packages/infrastructure/src/runs/run-conversation-repository.js';
import { ConversationContentCipher } from '../../packages/infrastructure/src/runs/conversation-content.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';
const url=process.env.DATABASE_URL;
describe.skipIf(!url)('confirmed conversational manager flags',()=>{
 let sql:Sql,db:Database;
 const ids=new CryptoUuidV7Generator(),actor=ids.next(),other=ids.next(),procedureId=ids.next(),versionId=ids.next(),runs:string[]=[];
 const cipher=new ConversationContentCipher('11'.repeat(32)),session={userId:actor,sessionId:'conversation-flag-session'};
 beforeAll(async()=>{
   const target=new URL(url!);if(!['localhost','127.0.0.1','[::1]','postgres','db'].includes(target.hostname)||!/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1)))throw new Error('Use an isolated local test database');
   sql=createSqlClient(url!,{max:8});db=createDb(sql);
   await sql`INSERT INTO auth_user(id,name,email) VALUES(${actor},'Flag proposer',${actor+'@test.invalid'}),(${other},'Flag observer',${other+'@test.invalid'})`;
   await sql`INSERT INTO user_role(user_id,role) VALUES(${actor},'auditor'),(${other},'auditor')`;
   const version=activeRunVersion(procedureId,versionId,actor);
   await new PostgresProceduresUnitOfWork(db).execute(async c=>{await c.procedures.insertProcedure(version);await c.procedures.insertVersion(version);});
 });
 afterAll(async()=>{
   if(!sql)return;
   try {
     for(const runId of runs)await sql.begin(async tx=>{
       await tx`DELETE FROM pgboss.job WHERE data->>'runId'=${runId}`;
       await tx`DELETE FROM notification WHERE run_id=${runId}`;
       await tx`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
       await tx`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
       await tx`DELETE FROM run_initiation_request WHERE run_id=${runId}`;
       await tx`DELETE FROM audit_run WHERE run_id=${runId}`;
     });
     await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
     await sql`DELETE FROM auth_user WHERE id IN (${actor},${other})`;
   } finally {await sql.end({timeout:5});}
 });
 const repo=()=>new PostgresRunConversationRepository(db,cipher);
 async function start(state='RUNNING') {
   const year=2030+Math.floor(runs.length/12),month=String(1+runs.length%12).padStart(2,'0');
   const r=await initiateRun({roles:new DrizzleRoleRepository(db),unitOfWork:new PostgresRunsUnitOfWork(db),ids,clock:new SystemClock()},
     {session,request:{procedureId,requestToken:ids.next(),period:{from:`${year}-${month}-01`,to:`${year}-${month}-28`}}});
   if(!r.ok)throw new Error(r.reason);runs.push(r.runId);await sql`UPDATE audit_run SET state=${state} WHERE run_id=${r.runId}`;return r.runId;
 }
 async function propose(runId:string,text='flag: Please review this discrepancy.') {
   const request={runId,text,idempotencyKey:ids.next(),selectedSourceOrdinal:null,replyToWaitId:null};
   const receipt=await repo().append({actorId:actor,sessionId:session.sessionId,request});if(!receipt.ok)throw new Error(receipt.reason);
   const [command]=await sql`SELECT command_id FROM run_interaction_command WHERE message_id=${receipt.messageId}`;
   if(!command)throw new Error('Proposal missing');return {commandId:String(command.command_id),request};
 }
 const confirm=(runId:string,commandId:string,actorId=actor)=>repo().confirmFlag({actorId,sessionId:session.sessionId,request:{runId,commandId}});
 it.each(['RUNNING','PAUSED','AWAITING_AUDITOR'])('flags %s with no lease, exact retained note and existing recipients',async state=>{
   const runId=await start(state),p=await propose(runId,'flag: A 😀 discrepancy.');
   const [before]=await sql`SELECT to_jsonb(r) body FROM audit_run r WHERE run_id=${runId}`;
   expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(0);
   expect(await confirm(runId,p.commandId)).toMatchObject({ok:true,state:'applied',replayed:false});
   const [flag]=await sql`SELECT flag_id,note,flagged_by FROM run_flag WHERE run_id=${runId}`;
   expect(flag).toMatchObject({note:'A 😀 discrepancy.',flagged_by:actor});
   const expected=await sql`SELECT user_id id FROM user_role WHERE role='audit-manager' UNION SELECT ${actor}`;
   const notices=await sql`SELECT recipient_id,to_jsonb(notification) payload FROM notification WHERE flag_id=${flag!.flag_id}`;
   expect(notices.map(n=>n.recipient_id).sort()).toEqual(expected.map(r=>r.id).sort());expect(JSON.stringify(notices)).not.toContain('discrepancy');
   const facts=await sql`SELECT payload FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-flagged'`;
   expect(facts).toHaveLength(1);expect(Object.keys(facts[0]!.payload).sort()).toEqual(['commandId','flagId','flaggedAt','noteDigest','noteLength','state']);
   expect(JSON.stringify(facts)).not.toContain('discrepancy');
   expect(await sql`SELECT to_jsonb(r) body FROM audit_run r WHERE run_id=${runId}`).toEqual([before]);
   expect(await sql`SELECT run_id FROM run_control_lease WHERE run_id=${runId}`).toHaveLength(0);
   const read=await repo().read({runId,actorId:other});expect(read.status).toBe('ready');
   expect(read.messages.find(m=>m.command)?.command).toMatchObject({kind:'flag',state:'applied'});
 });
 it('recovers simultaneous same-proposal retries and preserves distinct proposals as separate flags',async()=>{
   const runId=await start(),p=await propose(runId);
   const settled=await Promise.allSettled([confirm(runId,p.commandId),confirm(runId,p.commandId)]);
   for(const outcome of settled) {
     if(outcome.status==='fulfilled')expect(outcome.value).toMatchObject({ok:true});
     else {expect(outcome.reason.cause?.code ?? outcome.reason.code).toBe('55P03');expect(await confirm(runId,p.commandId)).toMatchObject({ok:true,replayed:true});}
   }
   expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(1);
   const second=await propose(runId);expect(second.commandId).not.toBe(p.commandId);
   expect(await confirm(runId,second.commandId)).toMatchObject({ok:true,replayed:false});
   expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(2);
   expect(await repo().append({actorId:actor,sessionId:session.sessionId,request:p.request})).toMatchObject({ok:true,replayed:true});
   expect(await repo().append({actorId:actor,sessionId:session.sessionId,request:{...p.request,text:'flag: Changed note'}})).toMatchObject({ok:false,code:'conflict'});
 });
 it('keeps simultaneous distinct proposals as separate attributed statements',async()=>{
   const runId=await start(),a=await propose(runId),b=await propose(runId);
   const results=await Promise.allSettled([confirm(runId,a.commandId),confirm(runId,b.commandId)]);
   for(let i=0;i<results.length;i++) {
     const result=results[i]!;
     if(result.status==='fulfilled')expect(result.value).toMatchObject({ok:true});
     else {expect(result.reason.cause?.code ?? result.reason.code).toBe('55P03');expect(await confirm(runId,[a,b][i]!.commandId)).toMatchObject({ok:true});}
   }
   expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(2);
   expect(await sql`SELECT source_event_id FROM run_interaction_transition WHERE command_id IN (${a.commandId},${b.commandId}) AND state='applied'`).toHaveLength(2);
 });
 it('serializes role revocation ahead of a blocked first confirmation',async()=>{
   const runId=await start(),p=await propose(runId);let announce!:(pid:number)=>void,release!:()=>void;
   const locked=new Promise<number>(r=>announce=r),released=new Promise<void>(r=>release=r);
   const revocation=sql.begin(async tx=>{await tx`UPDATE user_role SET role='poc-administrator' WHERE user_id=${actor}`;
     const [backend]=await tx`SELECT pg_backend_pid() pid`;announce(Number(backend!.pid));await released;});
   const pid=await locked;
   const pending=confirm(runId,p.commandId).then(result=>({result}),error=>({error}));
   try {await expect.poll(async()=>Number((await sql`SELECT count(*)::int n FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))`)[0]!.n),{timeout:200,interval:5}).toBeGreaterThan(0);}
   finally {release();await revocation;}
   try {
     const outcome=await pending;
     if('error' in outcome){expect(outcome.error.cause?.code ?? outcome.error.code).toBe('55P03');expect(await confirm(runId,p.commandId)).toMatchObject({ok:false,code:'denied'});}
     else expect(outcome.result).toMatchObject({ok:false,code:'denied'});
     expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(0);
   } finally {await sql`UPDATE user_role SET role='auditor' WHERE user_id=${actor}`;}
 });
 it('binds confirmation to the original actor, Run and exact field set',async()=>{
   const runId=await start(),another=await start(),p=await propose(runId,'flag');
   expect(await confirm(runId,p.commandId,other)).toMatchObject({ok:false,code:'denied'});
   expect(await confirm(another,p.commandId)).toMatchObject({ok:false,code:'denied'});
   expect(await repo().confirmFlag({actorId:actor,sessionId:session.sessionId,request:{runId,commandId:p.commandId,note:'replacement'}})).toMatchObject({ok:false,code:'malformed'});
   expect(await confirm(runId,p.commandId)).toMatchObject({ok:true});
   expect(await sql`SELECT note FROM run_flag WHERE run_id=${runId}`).toEqual([{note:null}]);
 });
 it.each(['original','proposal','wrong-key'])('refuses %s governed content loss before first application',async mode=>{
   const runId=await start(),p=await propose(runId);
   if(mode!=='wrong-key')await sql`UPDATE run_conversation_content c SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1
     FROM run_conversation_message m WHERE m.message_id=c.message_id AND m.run_id=${runId} AND m.kind=${mode==='original'?'auditor-message':'command-receipt'}`;
   const result=mode==='wrong-key' ? await new PostgresRunConversationRepository(db,new ConversationContentCipher('22'.repeat(32))).confirmFlag({actorId:actor,sessionId:session.sessionId,request:{runId,commandId:p.commandId}}) : await confirm(runId,p.commandId);
   expect(result).toMatchObject({ok:false,code:'unavailable'});expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(0);
 });
 it('refuses initially corrupt encrypted proposal content without weakening tombstone guards',async()=>{
   const runId=await start();
   class CorruptCipher extends ConversationContentCipher { override seal():string {return 'v1.AAAA';} }
   const corrupt=new PostgresRunConversationRepository(db,new CorruptCipher('11'.repeat(32)));
   const receipt=await corrupt.append({actorId:actor,sessionId:session.sessionId,request:{runId,text:'flag: Retained note',idempotencyKey:ids.next(),selectedSourceOrdinal:null,replyToWaitId:null}});
   if(!receipt.ok)throw new Error(receipt.reason);
   const [command]=await sql`SELECT command_id FROM run_interaction_command WHERE message_id=${receipt.messageId}`;
   expect(await confirm(runId,String(command!.command_id))).toMatchObject({ok:false,code:'unavailable'});
   expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(0);
 });
 it('reauthorizes historical recovery while preserving applied proof after terminal state and content removal',async()=>{
   const runId=await start(),p=await propose(runId);expect(await confirm(runId,p.commandId)).toMatchObject({ok:true});
   await sql`UPDATE audit_run SET state='CANCELED' WHERE run_id=${runId}`;
   await sql`UPDATE run_conversation_content c SET ciphertext=NULL,removed_at=clock_timestamp(),content_epoch=content_epoch+1 FROM run_conversation_message m WHERE m.message_id=c.message_id AND m.run_id=${runId}`;
   expect(await confirm(runId,p.commandId)).toMatchObject({ok:true,replayed:true});
   await sql`DELETE FROM user_role WHERE user_id=${actor}`;
   try {expect(await confirm(runId,p.commandId)).toMatchObject({ok:false,code:'denied'});}finally{await sql`INSERT INTO user_role(user_id,role) VALUES(${actor},'auditor')`;}
 });
 it('refuses a terminal race and rolls back all effects on an outer commit failure',async()=>{
   const runId=await start(),p=await propose(runId);
   await expect(db.transaction(async tx=>{
     expect(await new PostgresRunConversationRepository(tx,cipher).confirmFlag({actorId:actor,sessionId:session.sessionId,request:{runId,commandId:p.commandId}})).toMatchObject({ok:true});
     throw new Error('lost commit');
   })).rejects.toThrow('lost commit');
   expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(0);
   expect(await sql`SELECT send_key FROM notification WHERE run_id=${runId}`).toHaveLength(0);
   expect(await sql`SELECT event_id FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-flagged'`).toHaveLength(0);
   expect(await sql`SELECT state FROM run_interaction_transition WHERE command_id=${p.commandId} ORDER BY sequence DESC LIMIT 1`).toEqual([{state:'interpreted'}]);
   await sql`UPDATE audit_run SET state='CANCELED' WHERE run_id=${runId}`;
   expect(await confirm(runId,p.commandId)).toMatchObject({ok:false,code:'conflict'});
 });
 it('rejects malformed inserted facts and a valid flag fact without its atomic receipt',async()=>{
   const runId=await start(),p=await propose(runId,'flag');
   const at=new Date().toISOString(),flagId=ids.next();
   await expect(sql`INSERT INTO run_flag(flag_id,interaction_command_id,run_id,flagged_by,session_id,flagged_at,note)
     VALUES(${ids.next()},${p.commandId},${runId},${actor},${session.sessionId},${at},NULL)`)
     .rejects.toMatchObject({code:'23514',message:'Conversational flag row requires its exact atomic fact and receipt'});
   const base={commandId:p.commandId,flagId,state:'RUNNING',flaggedAt:at,noteLength:0,noteDigest:null};
   const attempt=(payload:Record<string,unknown>)=>sql.begin(async tx=>{
     await tx`INSERT INTO run_flag(flag_id,interaction_command_id,run_id,flagged_by,session_id,flagged_at,note) VALUES(${flagId},${p.commandId},${runId},${actor},${session.sessionId},${at},NULL)`;
     await tx`INSERT INTO audit_events(event_id,actor_type,actor_id,event_type,occurred_at,source,outcome,session_id,correlation_id,aggregate_id,sequence,payload,previous_hash,event_hash)
       VALUES(${ids.next()},'human',${actor},'lifecycle.run-flagged',${at},'web','success',${session.sessionId},${ids.next()},${runId},10000,${JSON.stringify(payload)}::jsonb,${'a'.repeat(64)},${'b'.repeat(64)})`;
   });
   for(const patch of [{noteDigest:'c'.repeat(64)},{noteLength:'0'},{noteLength:1},{flagId:ids.next()},{commandId:null},{note:'leak'}])
     await expect(attempt({...base,...patch})).rejects.toMatchObject({code:'23514'});
   const {noteDigest:_,...missing}=base;await expect(attempt(missing)).rejects.toMatchObject({code:'23514'});
   await expect(attempt(base)).rejects.toMatchObject({code:'23514'});
   expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(0);
   expect(await confirm(runId,p.commandId)).toMatchObject({ok:true});
 });
 it('keeps direct flags distinct and rejects forged receipt, digest, identity and deletion writes',async()=>{
   const runId=await start(),p=await propose(runId);
   await expect(sql`UPDATE run_interaction_command SET flag_anchor='{"noteDigest":null,"noteLength":0}' WHERE command_id=${p.commandId}`).rejects.toMatchObject({code:'23514'});
   await expect(sql`INSERT INTO run_interaction_transition(command_id,sequence,state,reason_code,created_at,source_event_id) VALUES(${p.commandId},3,'applied','run-flagged',clock_timestamp(),${ids.next()})`).rejects.toMatchObject({code:'23514'});
   expect(await confirm(runId,p.commandId)).toMatchObject({ok:true});
   for(const patch of [{noteDigest:null},{commandId:ids.next()},{note:'leak'}])await expect(sql`UPDATE audit_events SET payload=payload||${JSON.stringify(patch)}::jsonb WHERE aggregate_id=${runId} AND event_type='lifecycle.run-flagged'`).rejects.toMatchObject({code:'23514'});
   await expect(sql`DELETE FROM audit_events WHERE aggregate_id=${runId} AND event_type='lifecycle.run-flagged'`).rejects.toMatchObject({code:'23514'});
   await sql`DELETE FROM notification WHERE run_id=${runId}`;
   await expect(sql`DELETE FROM run_flag WHERE run_id=${runId}`).rejects.toMatchObject({code:'23514'});
   const deps={roles:new DrizzleRoleRepository(db),repository:new PostgresRunFlagRepository(db),unitOfWork:new PostgresRunsUnitOfWork(db),ids,clock:new SystemClock()};
   expect(await flagRun(deps,{session,request:{runId,note:null}})).toMatchObject({ok:true});
   expect(await flagRun(deps,{session,request:{runId,note:null}})).toMatchObject({ok:true});
   expect(await sql`SELECT flag_id FROM run_flag WHERE run_id=${runId}`).toHaveLength(3);
 });
});
