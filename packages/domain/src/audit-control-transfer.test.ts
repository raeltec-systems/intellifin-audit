import { describe, expect, it } from 'vitest';
import { validateAuditEventDraft, type AuditEventDraft } from './audit-event.js';
const commandId='01990000-0000-7000-8000-000000000001';
const transfer:AuditEventDraft={actor:{type:'human',id:'manager'},eventType:'lifecycle.run-control-lease-transferred',source:'web',outcome:'success',sessionId:'session',correlationId:'correlation',aggregateId:commandId,
  payload:{operation:'transfer',commandId,requestKey:commandId,expectedEpoch:1,priorEpoch:1,priorHolderId:'auditor',epoch:2,holderId:'manager',reasonRef:commandId,updatedAt:'2026-09-20T12:00:00.000Z',expiresAt:'2026-09-20T12:02:00.000Z'}};
const grant:AuditEventDraft={actor:{type:'human',id:'administrator'},eventType:'configuration.user-permission-changed',source:'web',outcome:'success',sessionId:'session',correlationId:'correlation',payload:{subjectUserId:'manager',permission:'run.control-transfer',priorGranted:false,granted:true,priorRevision:0,revision:1,cause:'administration'}};
describe('closed manager authority audit envelopes',()=>{
  it('validates transfer identity, typed epoch, exact duration and excludes free text',()=>{
    expect(validateAuditEventDraft(transfer)).toBe(transfer);
    for(const patch of [{commandId:1},{requestKey:null},{holderId:'other'},{priorHolderId:'manager'},{expectedEpoch:'1'},{epoch:1},{reasonRef:'other'},
      {expiresAt:'2026-09-20T12:03:00.000Z'},{updatedAt:'today'},{reason:'Raw private reason'}])
      expect(()=>validateAuditEventDraft({...transfer,payload:{...transfer.payload,...patch}})).toThrow();
    expect(()=>validateAuditEventDraft({...transfer,source:'worker'})).toThrow();
  });
  it('validates grant toggles and revisions without disclosing identity addresses',()=>{
    expect(validateAuditEventDraft(grant)).toBe(grant);
    for(const patch of [{subjectUserId:'private@example.test'},{permission:'other'},{granted:'true'},{priorGranted:true},{revision:'1'},{revision:2},{cause:'because'}])
      expect(()=>validateAuditEventDraft({...grant,payload:{...grant.payload,...patch}})).toThrow();
  });
});
