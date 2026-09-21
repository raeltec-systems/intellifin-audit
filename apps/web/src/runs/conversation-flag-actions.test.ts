import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({authorize:vi.fn(),confirm:vi.fn(),runtime:vi.fn()}));
vi.mock('../server-session',()=>({requireServerAction:mocks.authorize}));
vi.mock('../bootstrap',()=>({getRuntime:mocks.runtime}));
import { confirmConversationFlag } from './run-conversation-actions';
beforeEach(()=>{vi.clearAllMocks();mocks.runtime.mockResolvedValue({conversation:{confirmFlag:mocks.confirm}});mocks.authorize.mockResolvedValue({allowed:true,session:{userId:'fresh-actor',sessionId:'fresh-session'}});});
describe('flag confirmation action',()=>{
 it('uses current server identity and the dedicated flag authority',async()=>{
   const request={runId:'run',commandId:'command'};mocks.confirm.mockResolvedValue({ok:true,commandId:'command',state:'applied',replayed:true});
   expect(await confirmConversationFlag(request)).toMatchObject({ok:true,replayed:true});
   expect(mocks.authorize).toHaveBeenCalledWith('run.flag');
   expect(mocks.confirm).toHaveBeenCalledWith({actorId:'fresh-actor',sessionId:'fresh-session',request});
 });
 it('denies revoked access before the repository',async()=>{
   mocks.authorize.mockResolvedValue({allowed:false,reason:'Role revoked'});
   expect(await confirmConversationFlag({})).toMatchObject({ok:false,code:'denied'});expect(mocks.runtime).not.toHaveBeenCalled();
 });
 it('reports unknown delivery without leaking a storage failure or creating a fresh proposal',async()=>{
   mocks.confirm.mockRejectedValue(new Error('private SQL payload'));
   const result=await confirmConversationFlag({runId:'run',commandId:'same-command'});
   expect(result).toMatchObject({ok:false,code:'unavailable'});expect(JSON.stringify(result)).toContain('delivery is unknown');expect(JSON.stringify(result)).not.toContain('private SQL');
 });
});
