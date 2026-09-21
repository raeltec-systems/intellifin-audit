import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { authorizeActionRole, canonicalJson, sha256Hex, type JsonValue, type SanitizedToolAction } from '@intellifin/domain';
import { authorizeCommandRole, parseRunStrategyAnchor, sameStrategyAnchor, type RunStrategyOpportunity, type RunStrategyProposalAnchor,
  type RunStrategyRead, type RunStrategyWorkerPort, type RunConversationCommandReceipt, type RunConversationMessage } from '@intellifin/application';
import type { Database, Transaction } from '../db/client.js';
import { auditRun, authUser, runAgentWork, runWorkItem, runStepExecution, runStrategyOpportunity, runStrategyCursor,
  runStrategySelection, runStrategyTransition, runConversationContent, runConversationMessage } from '../db/schema.js';
import { DrizzleFrozenExecutionReader } from '../procedures/procedure-repository.js';
import { DrizzleRoleRepository } from '../identity/role-repository.js';
import { createAuditEventWriter, CryptoUuidV7Generator } from '../db/audit-events.js';
import { readLockedRunControlLease, runControlServerTime } from './run-control-lease-repository.js';
import type { ConversationContentCipher } from './conversation-content.js';

const json = (value: unknown) => canonicalJson(value as JsonValue);
type Selection = typeof runStrategySelection.$inferSelect;
async function latest(tx: Transaction, commandId: string) {
  return (await tx.select().from(runStrategyTransition).where(eq(runStrategyTransition.commandId, commandId)).orderBy(desc(runStrategyTransition.sequence)).limit(1))[0];
}
async function roleAllowed(tx: Transaction, actorId: string): Promise<boolean> {
  await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.id,actorId)).for('update');
  return authorizeActionRole(await new DrizzleRoleRepository(tx).findRole(actorId), 'run.resume').allowed;
}
async function owns(tx: Transaction, runId: string, actorId: string, epoch?: number): Promise<number | null> {
  if (!await roleAllowed(tx,actorId)) return null;
  const lease = await readLockedRunControlLease(tx,runId);
  const now = Date.parse(await runControlServerTime(tx));
  return lease && lease.holderId === actorId && lease.expiresAt !== null && Date.parse(lease.expiresAt) > now &&
    (epoch === undefined || epoch === lease.epoch) ? lease.epoch : null;
}
/** No snapshot/body I/O under locks: this reads the worker's committed capability publication. */
async function current(tx: Transaction, runId: string): Promise<(RunStrategyOpportunity & {targetName:string}) | null> {
  const [run] = await tx.select().from(auditRun).where(eq(auditRun.runId,runId));
  if (!run || run.state !== 'RUNNING' || run.cancelRequestedAt !== null || run.pauseRequestedAt !== null) return null;
  const [row] = await tx.select({ opportunity: runStrategyOpportunity }).from(runStrategyCursor)
    .innerJoin(runStrategyOpportunity, and(eq(runStrategyOpportunity.runId,runStrategyCursor.runId),eq(runStrategyOpportunity.opportunityId,runStrategyCursor.opportunityId)))
    .where(eq(runStrategyCursor.runId,runId));
  if (!row) return null;
  const opportunity = row.opportunity;
  const a = opportunity.anchor;
  if (!parseRunStrategyAnchor({ ...a, controlEpoch: 1 })) return null;
  const [stage] = await tx.select().from(runAgentWork).where(eq(runAgentWork.runId,runId));
  const [item] = await tx.select().from(runWorkItem).where(and(eq(runWorkItem.runId,runId),eq(runWorkItem.workItemId,a.workItemId)));
  const [step] = await tx.select().from(runStepExecution).where(and(eq(runStepExecution.runId,runId),eq(runStepExecution.stepExecutionId,a.stepExecutionId)));
  const plan = await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId,run.procedureId);
  if (!plan || plan.schemaVersion !== 2 || !stage || stage.status !== 'EXECUTING' || stage.attemptId !== a.attemptId || stage.workItemId !== a.workItemId ||
    !item || item.state !== 'IN_PROGRESS' || item.registrationId !== a.targetSystemId || item.subjectKey !== a.subjectKey ||
    !step || step.state !== 'RUNNING' || step.workItemId !== a.workItemId || step.action !== 'inspect-record' ||
    sha256Hex(json(plan)) !== a.planDigest || sha256Hex(json(plan.capabilityGraph)) !== a.graphDigest) return null;
  const [valid] = await tx.execute<{ valid: boolean }>(sql`SELECT run_strategy_opportunity_valid(${opportunity.opportunityId}::uuid) AND NOT EXISTS(
    SELECT 1 FROM run_tool_action WHERE run_id=${runId}::uuid AND step_execution_id=${a.stepExecutionId}::uuid
      AND action='search' AND outcome='performed' AND completed_at>${opportunity.createdAt}) AS valid`);
  return valid?.valid ? { anchor: a, tool: opportunity.tool, parameters: opportunity.parameters, targetName:plan.inputs.targets.find(target=>target.registrationId===a.targetSystemId)?.displayName??a.targetSystemId } : null;
}
async function transition(tx: Transaction, selection: Selection, state: typeof runStrategyTransition.$inferInsert.state,
  reasonCode: string, toolActionId: string | null = null): Promise<void> {
  const prior = await latest(tx,selection.commandId);
  const at = new Date(await runControlServerTime(tx));
  const [opportunity] = await tx.select().from(runStrategyOpportunity).where(eq(runStrategyOpportunity.opportunityId,selection.opportunityId));
  if (!opportunity) throw new Error('Strategy opportunity unavailable');
  const event = await createAuditEventWriter(tx,{ now: () => at },new CryptoUuidV7Generator()).append({
    actor: { type: state === 'interpreted' || state === 'queued' || state === 'refused' ? 'human' : 'system', id: state === 'interpreted' || state === 'queued' || state === 'refused' ? selection.actorId : 'strategy-coordinator' },
    eventType: `lifecycle.run-strategy-${state}`, source: state === 'interpreted' || state === 'queued' || state === 'refused' ? 'web' : 'worker',
    outcome: state === 'refused' || state === 'superseded' ? 'failure' : 'success', sessionId: selection.sessionId,
    correlationId: selection.commandId, aggregateId: selection.runId,
    payload: { commandId: selection.commandId, opportunityId: selection.opportunityId, nodeId: opportunity.anchor.nodeId,
      workItemId: opportunity.anchor.workItemId, attemptId: opportunity.anchor.attemptId, stepExecutionId: opportunity.anchor.stepExecutionId,
      expectedControlEpoch: selection.expectedControlEpoch, toolActionId, reasonCode },
  });
  await tx.insert(runStrategyTransition).values({ commandId: selection.commandId, sequence: (prior?.sequence ?? 0)+1, state, reasonCode, toolActionId, sourceEventId: event.eventId, createdAt: at });
  await tx.execute(sql`SELECT pg_notify('run_timeline', ${JSON.stringify({runId:selection.runId,sequence:event.sequence})})`);
}
export async function readRunStrategy(tx: Transaction, runId: string, actorId: string): Promise<RunStrategyRead> {
  const opportunity = await current(tx,runId);
  if (!opportunity) {
    const [run]=await tx.select().from(auditRun).where(eq(auditRun.runId,runId));
    const plan=run?await new DrizzleFrozenExecutionReader(tx).readFrozenExecution(run.versionId,run.procedureId):null;
    if(plan?.schemaVersion===1)return {available:false,reason:'This historical approval has no frozen selectable strategy. A new approved Procedure version is required.'};
    return { available: false, reason: 'No frozen fallback is currently eligible. It requires a committed complete zero-match primary lookup for this inspection.' };
  }
  // Read projections never lock identities; confirmation/worker consumption lock afresh.
  if (!authorizeActionRole(await new DrizzleRoleRepository(tx).findRole(actorId),'run.resume').allowed) return {available:false,reason:'Your role cannot select an execution strategy.'};
  const lease = await readLockedRunControlLease(tx,runId);
  if (!lease || lease.holderId !== actorId || !lease.expiresAt || Date.parse(lease.expiresAt)<=Date.parse(await runControlServerTime(tx)))
    return {available:false,reason:'Acquire current Run control to select a frozen strategy.'};
  return {available:true,anchor:{...opportunity.anchor,controlEpoch:lease.epoch},targetLabel:`${opportunity.anchor.subjectKey} on ${opportunity.targetName}`,label:'Full name search'};
}
export async function admitRunStrategy(tx: Transaction, input: { runId:string; actorId:string; anchor:RunStrategyProposalAnchor; strategy:string }): Promise<string | null> {
  if (!['p1.full-name','full name search'].includes(input.strategy.trim().toLowerCase())) return 'Only the declared Full name search can be selected. Other changes require a future Procedure version.';
  const epoch = await owns(tx,input.runId,input.actorId,input.anchor.controlEpoch);
  if (epoch === null) return 'Current Run control is required to propose this strategy.';
  const opportunity = await current(tx,input.runId);
  const { controlEpoch: _epoch, ...anchor } = input.anchor;
  return opportunity && sameStrategyAnchor(opportunity.anchor,anchor) ? null : 'The inspection, attempt or prerequisite evidence changed. Start a new strategy draft.';
}
export async function insertRunStrategy(tx: Transaction, input: { commandId:string;runId:string;actorId:string;sessionId:string;messageId:string;anchor:RunStrategyProposalAnchor }): Promise<void> {
  const at = new Date(await runControlServerTime(tx));
  const values = {commandId:input.commandId,runId:input.runId,actorId:input.actorId,sessionId:input.sessionId,messageId:input.messageId,
    opportunityId:input.anchor.snapshotEvidenceId,expectedControlEpoch:input.anchor.controlEpoch,
    interpretationDigest:sha256Hex(json({version:'frozen-strategy-v1',anchor:input.anchor})),createdAt:at};
  await tx.insert(runStrategySelection).values(values);
  await transition(tx,values,'interpreted','confirmation-required');
}
export async function confirmRunStrategy(db: Database | Transaction, cipher: ConversationContentCipher | null,
  input: {actorId:string;sessionId:string;request:unknown}): Promise<RunConversationCommandReceipt> {
  const preflight=await authorizeCommandRole({roles:new DrizzleRoleRepository(db),unitOfWork:{execute:work=>db.transaction(tx=>work({auditEvents:createAuditEventWriter(tx,{now:()=>new Date()},new CryptoUuidV7Generator())}))}},
    {session:{userId:input.actorId,sessionId:input.sessionId},correlationId:new CryptoUuidV7Generator().next(),action:'run.resume'});
  if(!preflight.allowed)return {ok:false,code:'denied',reason:preflight.reason};
  const v=input.request;
  if (!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).sort().join(',')!=='commandId,runId') return {ok:false,code:'malformed',reason:'Choose a recorded strategy proposal.'};
  const {runId,commandId}=v as Record<string,unknown>;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(typeof runId!=='string'||!uuid.test(runId)||typeof commandId!=='string'||!uuid.test(commandId))return {ok:false,code:'malformed',reason:'Choose a recorded strategy proposal.'};
  return db.transaction(async tx=>{
    await tx.select({id:auditRun.runId}).from(auditRun).where(eq(auditRun.runId,runId)).for('update');
    if(!await roleAllowed(tx,input.actorId)){
      const writer=createAuditEventWriter(tx,{now:()=>new Date()},new CryptoUuidV7Generator());
      const denied=await authorizeCommandRole({roles:new DrizzleRoleRepository(tx),unitOfWork:{execute:work=>work({auditEvents:writer})}},
        {session:{userId:input.actorId,sessionId:input.sessionId},correlationId:commandId,action:'run.resume'});
      return {ok:false,code:'denied',reason:denied.allowed?'Your current role cannot confirm a strategy.':denied.reason};
    }
    const [selection]=await tx.select().from(runStrategySelection).where(and(eq(runStrategySelection.runId,runId),eq(runStrategySelection.commandId,commandId),eq(runStrategySelection.actorId,input.actorId)));
    if(!selection)return {ok:false,code:'conflict',reason:'That strategy proposal is unavailable.'};
    const state=await latest(tx,commandId);
    if(state && ['queued','dispatched','applied'].includes(state.state))return {ok:true,commandId,state:state.state==='applied'?'applied':'queued',replayed:true};
    if(state?.state!=='interpreted')return {ok:false,code:'conflict',reason:'That strategy selection was refused or superseded.'};
    const [opportunity]=await tx.select().from(runStrategyOpportunity).where(eq(runStrategyOpportunity.opportunityId,selection.opportunityId));
    const bodyRows=await tx.select({id:runConversationMessage.messageId,ciphertext:runConversationContent.ciphertext,removedAt:runConversationContent.removedAt}).from(runConversationMessage)
      .innerJoin(runConversationContent,eq(runConversationContent.messageId,runConversationMessage.messageId))
      .where(and(eq(runConversationMessage.runId,runId),sql`(${runConversationMessage.messageId}=${selection.messageId}::uuid OR ${runConversationMessage.parentMessageId}=${selection.messageId}::uuid)`));
    let readable=cipher!==null && bodyRows.length===2;
    for(const body of bodyRows){try{if(body.removedAt!==null||!body.ciphertext||!cipher?.open(runId,body.id,body.ciphertext))readable=false;}catch{readable=false;}}
    if(!readable)return {ok:false,code:'unavailable',reason:'The governed strategy proposal is removed or unavailable.'};
    const reason=opportunity?await admitRunStrategy(tx,{runId,actorId:input.actorId,anchor:{...opportunity.anchor,controlEpoch:selection.expectedControlEpoch},strategy:'p1.full-name'}):'The recorded prerequisite is unavailable.';
    if(reason){await transition(tx,selection,'refused','stale-authority-or-inspection');return {ok:false,code:'conflict',reason};}
    await transition(tx,selection,'queued','awaiting-worker-boundary');
    return {ok:true,commandId,state:'queued',replayed:false};
  });
}
export function runStrategyWorkerPort(tx: Transaction, runId: string): RunStrategyWorkerPort {
  return {
    async publishStrategyOpportunity(opportunity) {
      if(opportunity){
        if(opportunity.anchor.runId!==runId)throw new Error('Strategy Run mismatch');
        const id=opportunity.anchor.snapshotEvidenceId;
        const [prior]=await tx.select().from(runStrategyOpportunity).where(eq(runStrategyOpportunity.opportunityId,id));
        if(prior && (json(prior.anchor)!==json(opportunity.anchor)||json(prior.tool)!==json(opportunity.tool)||json(prior.parameters)!==json(opportunity.parameters)))throw new Error('Strategy opportunity identity conflict');
        if(!prior)await tx.insert(runStrategyOpportunity).values({opportunityId:id,runId,...opportunity,createdAt:new Date(await runControlServerTime(tx))});
      }
      await tx.insert(runStrategyCursor).values({runId,opportunityId:opportunity?.anchor.snapshotEvidenceId??null})
        .onConflictDoUpdate({target:runStrategyCursor.runId,set:{opportunityId:opportunity?.anchor.snapshotEvidenceId??null}});
    },
    async claimStrategy(opportunity, toolActionId) {
      const selections=await tx.select().from(runStrategySelection).where(eq(runStrategySelection.runId,runId)).orderBy(asc(runStrategySelection.createdAt));
      // Acquire all potentially used actor locks before appending any audit-head fact.
      for (const actor of [...new Set(selections.map(selection => selection.actorId))].sort()) await tx.select({id:authUser.id}).from(authUser).where(eq(authUser.id,actor)).for('update');
      let claimed: {commandId:string;toolActionId:string}|null=null;
      for(const selection of selections){
        const state=await latest(tx,selection.commandId);
        if(!state||!['queued','dispatched'].includes(state.state))continue;
        const live=await current(tx,runId);
        const matches=opportunity!==null&&live!==null&&selection.opportunityId===opportunity.anchor.snapshotEvidenceId&&
          sameStrategyAnchor(live.anchor,opportunity.anchor)&&json(live.tool)===json(opportunity.tool)&&json(live.parameters)===json(opportunity.parameters);
        if(state.state==='dispatched'){
          if(!matches)await transition(tx,selection,'superseded','dispatch-outcome-unknown',state.toolActionId);
          continue;
        }
        if(!matches||claimed!==null||await owns(tx,runId,selection.actorId,selection.expectedControlEpoch)===null){
          await transition(tx,selection,'superseded','stale-authority-or-inspection');continue;
        }
        await transition(tx,selection,'dispatched','exact-action-reserved',toolActionId);
        claimed={commandId:selection.commandId,toolActionId};
      }
      return claimed;
    },
    async completeStrategy(commandId,action:SanitizedToolAction){
      const [selection]=await tx.select().from(runStrategySelection).where(and(eq(runStrategySelection.runId,runId),eq(runStrategySelection.commandId,commandId)));
      if(!selection)throw new Error('Strategy selection unavailable');
      const state=await latest(tx,commandId);
      if(state?.state==='applied'&&state.toolActionId===action.toolActionId)return;
      const [opportunity]=await tx.select().from(runStrategyOpportunity).where(eq(runStrategyOpportunity.opportunityId,selection.opportunityId));
      if(state?.state!=='dispatched'||state.toolActionId!==action.toolActionId||!opportunity||action.runId!==runId||action.workItemId!==opportunity.anchor.workItemId||
        action.stepExecutionId!==opportunity.anchor.stepExecutionId||action.targetSystem!==opportunity.anchor.targetSystemId||action.action!=='search'||
        action.destination!==opportunity.tool.destination||json(action.parameters)!==json(opportunity.parameters))throw new Error('Strategy action identity mismatch');
      await transition(tx,selection,action.outcome==='performed'?'applied':'superseded',action.outcome==='performed'?'exact-action-committed':'action-not-performed',action.toolActionId);
      await tx.update(runStrategyCursor).set({opportunityId:null}).where(eq(runStrategyCursor.runId,runId));
    },
  };
}
export async function readStrategyCommands(tx:Transaction,runId:string,actorId:string,messageIds:readonly string[],cipher:ConversationContentCipher|null):Promise<ReadonlyMap<string,NonNullable<RunConversationMessage['command']>>>{
  const result=new Map<string,NonNullable<RunConversationMessage['command']>>();
  if(messageIds.length===0)return result;
  const selections=await tx.select().from(runStrategySelection).where(and(eq(runStrategySelection.runId,runId),inArray(runStrategySelection.messageId,[...messageIds])));
  const eligible=await readRunStrategy(tx,runId,actorId);
  for(const selection of selections){
    const state=await latest(tx,selection.commandId);if(!state)continue;
    const [opportunity]=await tx.select().from(runStrategyOpportunity).where(eq(runStrategyOpportunity.opportunityId,selection.opportunityId));if(!opportunity)continue;
    const [body]=await tx.select().from(runConversationContent).where(eq(runConversationContent.messageId,selection.messageId));
    let readable=false;try{readable=Boolean(body?.ciphertext && body.removedAt===null && cipher?.open(runId,selection.messageId,body.ciphertext));}catch{}
    result.set(selection.messageId,{commandId:selection.commandId,kind:'strategy',state:state.state==='dispatched'?'queued':state.state,
      at:state.createdAt.toISOString(),strategyActionId:state.toolActionId,sourceEventId:state.sourceEventId,expectedControlEpoch:selection.expectedControlEpoch,
      targetLabel:`${opportunity.anchor.subjectKey} on ${opportunity.anchor.targetSystemId}`,strategyAnchor:{...opportunity.anchor,controlEpoch:selection.expectedControlEpoch},
      canConfirm:readable&&state.state==='interpreted'&&selection.actorId===actorId&&eligible.available&&eligible.anchor.snapshotEvidenceId===selection.opportunityId&&eligible.anchor.controlEpoch===selection.expectedControlEpoch,
      ...(!readable && state.state==='interpreted'?{reason:'The governed strategy proposal is removed or unavailable.'}:state.state==='dispatched'?{reason:'The selected action was dispatched; an applied receipt is not yet recorded.'}:['refused','superseded'].includes(state.state)?{reason:state.reasonCode}:{})});
  }
  return result;
}
