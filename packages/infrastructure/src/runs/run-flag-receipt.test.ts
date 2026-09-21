import { describe, expect, it } from 'vitest';
import { matchesFlagInteractionEvent } from './run-interaction-projection.js';
import type { runInteractionCommand } from '../db/schema.js';
const id='01990000-0000-7000-8000-000000000001';
const command:typeof runInteractionCommand.$inferSelect={commandId:id,runId:id,messageId:id,actorId:'auditor',kind:'flag',requestKey:id,
 semanticFingerprint:'a'.repeat(64),planDigest:'b'.repeat(64),expectedRunRevision:1,interpretationVersion:'confirmed-flag-v1',
 deferredAnchor:null,deferredControlEpoch:null,resumeAnchor:null,answerAnchor:null,answerOptionId:null,flagAnchor:{noteDigest:null,noteLength:0},createdAt:new Date()};
const event={aggregateId:id,eventType:'lifecycle.run-flagged',source:'web',outcome:'success',actor:{type:'human',id:'auditor'},
 payload:{commandId:id,flagId:id,state:'RUNNING',flaggedAt:'2026-09-20T12:00:00.000Z',noteDigest:null,noteLength:0}};
describe('flag receipt identity and note-free event',()=>{
 it('accepts explicit absence and refuses malformed or unrelated facts',()=>{
   expect(matchesFlagInteractionEvent(command,event)).toBe(true);
   for(const patch of [{commandId:'01990000-0000-7000-8000-000000000002'},{noteDigest:'a'.repeat(64)},{noteLength:'0'},{noteLength:1},{note:'leaked'},{flagId:null},{state:'QUEUED'},{flaggedAt:'invalid'}])
     expect(matchesFlagInteractionEvent(command,{...event,payload:{...event.payload,...patch}})).toBe(false);
   expect(matchesFlagInteractionEvent(command,{...event,actor:{type:'human',id:'other'}})).toBe(false);
   expect(matchesFlagInteractionEvent(command,{...event,source:'worker'})).toBe(false);
 });
 it('requires the exact retained note digest and UTF-16 length',()=>{
   const flagAnchor={noteDigest:'c'.repeat(64),noteLength:2};
   expect(matchesFlagInteractionEvent({...command,flagAnchor},{...event,payload:{...event.payload,...flagAnchor}})).toBe(true);
   expect(matchesFlagInteractionEvent({...command,flagAnchor},{...event,payload:{...event.payload,...flagAnchor,noteLength:1}})).toBe(false);
 });
});
