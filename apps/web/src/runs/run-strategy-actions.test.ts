import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({authorize:vi.fn(),confirm:vi.fn()}));
vi.mock('../server-session',()=>({requireServerAction:mocks.authorize}));
vi.mock('../bootstrap',()=>({getRuntime:async()=>({conversation:{confirmStrategy:mocks.confirm}})}));
import { confirmConversationStrategy } from './run-conversation-actions';
const request={runId:'01990000-0000-7000-8000-000000000001',commandId:'01990000-0000-7000-8000-000000000002'};
beforeEach(()=>{vi.resetAllMocks();mocks.authorize.mockResolvedValue({allowed:true,session:{userId:'actor',sessionId:'session'}});});
it('authenticates the discretionary action and forwards only the recorded command request',async()=>{
  mocks.confirm.mockResolvedValue({ok:true,commandId:request.commandId,state:'queued',replayed:false});
  expect(await confirmConversationStrategy(request)).toMatchObject({ok:true,state:'queued'});
  expect(mocks.authorize).toHaveBeenCalledWith('run.resume');
  expect(mocks.confirm).toHaveBeenCalledWith({actorId:'actor',sessionId:'session',request});
});
it('refuses before repository access when the session is unauthorized',async()=>{
  mocks.authorize.mockResolvedValue({allowed:false,reason:'Role denied'});
  expect(await confirmConversationStrategy(request)).toEqual({ok:false,code:'denied',reason:'Role denied'});
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it('does not expose failure details and preserves same-command recovery guidance',async()=>{
  mocks.confirm.mockRejectedValue(new Error('private provider material'));
  const result=await confirmConversationStrategy(request);
  expect(result).toMatchObject({ok:false,code:'unavailable',reason:expect.stringContaining('same proposal')});
  expect(JSON.stringify(result)).not.toContain('private provider material');
});
