import { describe, expect, it } from 'vitest';
import type { AuditEventDraft, AuditEventRecord, Role, RunRecord } from '@intellifin/domain';
import { confirmRunControlTransfer, recoverRunControlTransferReceipt, parseRunControlTransferRequest, proposeRunControlTransfer, type RunControlTransferDependencies,
  type RunControlTransferRecord, type RunControlTransferReceipt } from './run-control-transfer.js';
import type { RunControlLeaseState } from './run-control-lease.js';
const runId='01990000-0000-7000-8000-000000000001', key='01990000-0000-7000-8000-000000000002';
const session={userId:'manager',sessionId:'session'};
const request={runId,requestKey:key,expectedEpoch:1,reason:'The current controller is unavailable.'};
function world() {
  const scene = { role:'audit-manager' as Role|null, granted:true, state:'RUNNING', now:new Date('2026-09-20T12:00:00.000Z'),
    fail:'', removed:false, lease:{runId,epoch:1,holderId:'auditor',updatedAt:'2026-09-20T11:59:00.000Z',expiresAt:'2026-09-20T12:01:00.000Z'} as RunControlLeaseState,
    records:new Map<string,RunControlTransferRecord>(), receipts:new Map<string,RunControlTransferReceipt>(), reasons:new Map<string,string>(), events:[] as AuditEventDraft[], notifications:0 };
  let sequence=5;
  const ids={next:()=>`01990000-0000-7000-8000-${String(++sequence).padStart(12,'0')}`};
  const append=async (event:AuditEventDraft) => { if(scene.fail==='audit') throw new Error('audit failure');scene.events.push(event);return {...event,eventId:ids.next(),occurredAt:scene.now.toISOString(),sequence} as AuditEventRecord; };
  const roles={findRole:async()=>scene.role};
  const deps:RunControlTransferDependencies={roles,ids,unitOfWork:{execute:work=>work({auditEvents:{append}})},repository:{
    async transaction(id,actor,work) {
      expect(id).toBe(runId); expect(actor).toBe(session.userId);
      const before={lease:scene.lease,records:new Map(scene.records),reasons:new Map(scene.reasons),receipts:new Map(scene.receipts),events:scene.events.length,notifications:scene.notifications};
      try{return await work({run:{runId,state:scene.state} as RunRecord,roles,permissions:{readGrant:async()=>({granted:scene.granted,revision:1})},now:scene.now,auditEvents:{append},
        fingerprint:r=>JSON.stringify(r),readLease:async()=>scene.lease,readProposal:async id=>scene.records.get(id)??null,
        readProposalByKey:async key=>[...scene.records.values()].find(r=>r.requestKey===key)??null,
        readReason:async id=>scene.removed?null:scene.reasons.get(id)??null,
        insertProposal:async (r,reason)=>{scene.records.set(r.commandId,r);scene.reasons.set(r.commandId,reason);},
        readReceipt:async id=>scene.receipts.get(id)??null,
        saveTransfer:async (_record,lease)=>{scene.lease=lease;},
        insertReceipt:async (commandId,eventId)=>{if(scene.fail==='receipt')throw new Error('receipt failure');scene.receipts.set(commandId,{commandId,eventId,runId,epoch:scene.lease.epoch,holderId:scene.lease.holderId!,updatedAt:scene.lease.updatedAt,expiresAt:scene.lease.expiresAt!});},
        actorName:async id=>id,notifyTimeline:async()=>{if(scene.fail==='notification')throw new Error('notification failure');scene.notifications++;},
      });}catch(error){scene.lease=before.lease;scene.records=before.records;scene.reasons=before.reasons;scene.receipts=before.receipts;scene.events.length=before.events;scene.notifications=before.notifications;throw error;}
    },
  }};
  const propose=()=>proposeRunControlTransfer(deps,{session,request});
  const confirm=(commandId:string)=>confirmRunControlTransfer(deps,{session,request:{runId,commandId}});
  return {scene,deps,propose,confirm};
}
describe('governed manager controller transfer',()=>{
  it('requires one bounded exact reason envelope and refuses credential-shaped content',()=>{
    expect(parseRunControlTransferRequest({...request,reason:'  Reason  '})?.reason).toBe('Reason');
    for(const patch of [{reason:''},{reason:'x'.repeat(1001)},{reason:'\ud800'},{reason:'password: secret-value'},{expectedEpoch:'1'},{expectedEpoch:0},{actorId:'other'},{requestKey:'bad'}])
      expect(parseRunControlTransferRequest({...request,...patch})).toBeNull();
  });
  it('proposes without effect, applies once and returns a historical receipt without ownership',async()=>{
    const w=world(),proposal=await w.propose();if(!proposal.ok)throw new Error(proposal.reason);
    expect(w.scene.lease.epoch).toBe(1);expect(w.scene.events).toHaveLength(0);
    const result=await w.confirm(proposal.proposal.commandId);expect(result).toMatchObject({ok:true,replayed:false,receipt:{epoch:2,holderId:'manager'}});
    expect(w.scene.events[0]?.payload).toMatchObject({priorEpoch:1,epoch:2,reasonRef:proposal.proposal.commandId});
    expect(JSON.stringify(w.scene.events)).not.toContain(request.reason);
    w.scene.lease={...w.scene.lease,epoch:4,holderId:'other'};w.scene.removed=true;
    expect(await w.confirm(proposal.proposal.commandId)).toMatchObject({ok:true,replayed:true,receipt:{epoch:2}});
    expect(w.scene.lease).toMatchObject({epoch:4,holderId:'other'});expect(w.scene.events).toHaveLength(1);
    w.scene.granted=false;expect(await w.confirm(proposal.proposal.commandId)).toMatchObject({ok:false,code:'unauthorized'});
  });
  it.each(['auditor','poc-administrator',null] as const)('refuses role %s even with a grant',async role=>{
    const w=world();w.scene.role=role;expect(await w.propose()).toMatchObject({ok:false,code:'unauthorized'});expect(w.scene.records.size).toBe(0);
    expect(w.scene.events).toMatchObject([{ eventType: 'security.denied', payload: { action: 'run.control-transfer' } }]);
  });
  it('receipt-only recovery never applies an unconfirmed proposal, including while the original lease is live',async()=>{
    const w=world(),proposal=await w.propose();if(!proposal.ok)throw new Error(proposal.reason);
    const input={session,request:{runId,commandId:proposal.proposal.commandId}};
    expect(await recoverRunControlTransferReceipt(w.deps,input)).toMatchObject({ok:false,code:'conflict'});
    expect(w.scene.lease).toMatchObject({epoch:1,holderId:'auditor'});
    expect(w.scene.events).toHaveLength(0);expect(w.scene.receipts.size).toBe(0);expect(w.scene.notifications).toBe(0);
    w.scene.state='CANCELED';
    expect(await recoverRunControlTransferReceipt(w.deps,input)).toMatchObject({ok:false,code:'conflict'});
    expect(w.scene.lease.epoch).toBe(1);
  });
  it('receipt-only recovery authenticates the original actor and current grant while accepting terminal historical proof',async()=>{
    const w=world(),proposal=await w.propose();if(!proposal.ok)throw new Error(proposal.reason);
    const commandId=proposal.proposal.commandId,input={session,request:{runId,commandId}};
    expect(await w.confirm(commandId)).toMatchObject({ok:true});
    w.scene.state='CANCELED';w.scene.removed=true;w.scene.lease={...w.scene.lease,epoch:4,holderId:'other'};
    expect(await recoverRunControlTransferReceipt(w.deps,input)).toMatchObject({ok:true,replayed:true,receipt:{epoch:2}});
    expect(w.scene.lease).toMatchObject({epoch:4,holderId:'other'});expect(w.scene.events).toHaveLength(1);expect(w.scene.notifications).toBe(1);
    const record=w.scene.records.get(commandId)!;w.scene.records.set(commandId,{...record,actorId:'different-manager'});
    expect(await recoverRunControlTransferReceipt(w.deps,input)).toMatchObject({ok:false,code:'unknown'});
    w.scene.records.set(commandId,record);w.scene.granted=false;
    expect(await recoverRunControlTransferReceipt(w.deps,input)).toMatchObject({ok:false,code:'unauthorized'});
    w.scene.granted=true;w.scene.role='auditor';
    expect(await recoverRunControlTransferReceipt(w.deps,input)).toMatchObject({ok:false,code:'unauthorized'});
  });
  it('does not grant a manager authority by role alone',async()=>{const w=world();w.scene.granted=false;expect(await w.propose()).toMatchObject({ok:false,code:'unauthorized'});});
  it('exactly replays a proposal but conflicts on changed epoch or reason',async()=>{
    const w=world();expect(await w.propose()).toMatchObject({ok:true,replayed:false});w.scene.lease={...w.scene.lease,epoch:3};
    expect(await w.propose()).toMatchObject({ok:true,replayed:true});
    for(const patch of [{reason:'Different reason'},{expectedEpoch:2}])expect(await proposeRunControlTransfer(w.deps,{session,request:{...request,...patch}})).toMatchObject({ok:false,code:'conflict'});
    expect(w.scene.records.size).toBe(1);
  });
  it.each(['role','grant','epoch','holder','expired','removed','terminal'] as const)('refuses changed %s before confirmation without effects',async mode=>{
    const w=world(),proposal=await w.propose();if(!proposal.ok)throw new Error(proposal.reason);
    if(mode==='role')w.scene.role='auditor';if(mode==='grant')w.scene.granted=false;
    if(mode==='epoch')w.scene.lease={...w.scene.lease,epoch:3};if(mode==='holder')w.scene.lease={...w.scene.lease,holderId:'other'};
    if(mode==='expired')w.scene.now=new Date(w.scene.lease.expiresAt!);if(mode==='removed')w.scene.removed=true;if(mode==='terminal')w.scene.state='CANCELED';
    expect(await w.confirm(proposal.proposal.commandId)).toMatchObject({ok:false});expect(w.scene.receipts.size).toBe(0);expect(w.scene.notifications).toBe(0);
  });
  it.each(['audit','receipt','notification'])('rolls back after %s failure',async failure=>{
    const w=world(),proposal=await w.propose();if(!proposal.ok)throw new Error(proposal.reason);w.scene.fail=failure;
    await expect(w.confirm(proposal.proposal.commandId)).rejects.toThrow();expect(w.scene.lease.epoch).toBe(1);expect(w.scene.receipts.size).toBe(0);
    w.scene.fail='';expect(await w.confirm(proposal.proposal.commandId)).toMatchObject({ok:true,replayed:false});
  });
});
