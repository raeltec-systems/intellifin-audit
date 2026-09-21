import { describe, expect, it } from 'vitest';
import { interpretRunConversationMessage, parseRunConversationFlag, runConversationFlagProposalText } from './run-conversation.js';
const request={runId:'run',idempotencyKey:'key',selectedSourceOrdinal:null,replyToWaitId:null};
describe('bounded conversational flag',()=>{
  it.each(['flag',' FLAG ','flag: Please investigate.','flag: 😀\nSecond line'])('retains exact bounded note for %s',text=>{
    const parsed=parseRunConversationFlag(text);expect(parsed).not.toBeNull();
    expect(interpretRunConversationMessage({...request,text})).toMatchObject({intent:{kind:'flag-proposal',note:parsed!.note},requiresConfirmation:true,execution:'not-executed'});
  });
  it.each(['do not flag','if it fails flag','"flag"','flag and pause now','flag: '+ 'x'.repeat(501),'flag: password: hunter2','flag: \ud800'])('does not infer consent from %s',text=>{
    expect(parseRunConversationFlag(text)).toBeNull();expect(interpretRunConversationMessage({...request,text}).intent.kind).not.toBe('flag-proposal');
  });
  it('preserves the absence of a note and explains attention without pausing',()=>{
    expect(parseRunConversationFlag('flag')).toEqual({note:null});
    expect(runConversationFlagProposalText(null)).toContain('No note was supplied.');
    expect(runConversationFlagProposalText('Line one\nLine two')).toContain('Recorded note: Line one\nLine two');
    expect(runConversationFlagProposalText(null)).toContain('Work continues without pausing.');
  });
});
