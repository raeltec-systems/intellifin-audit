import { expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { NewVersionButton } from './NewVersionButton';
const state=vi.hoisted(()=>({calls:vi.fn(),push:vi.fn(),values:[] as unknown[]}));
vi.mock('react',()=>({useRef:(current:unknown)=>({current}),useState:(initial:unknown)=>[initial,(value:unknown)=>state.values.push(value)]}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:state.push})}));
vi.mock('../../app/procedures/version-actions',()=>({newVersionAction:state.calls}));
it('blocks same-render duplicate invocation and keeps an unknown committed outcome blocked',async()=>{
  state.calls.mockReset();state.values=[];
  let finish!:(value:unknown)=>void;
  state.calls.mockImplementation(()=>new Promise(resolve=>finish=resolve));
  const element=NewVersionButton({procedureId:'p',versionId:'v',expectedRowVersion:'revision'});
  const button=(element.props as {children:ReactElement[]}).children[0]!;
  const click=(button.props as {onClick:()=>Promise<void>}).onClick;
  const pending=click();await click();expect(state.calls).toHaveBeenCalledTimes(1);
  finish({ok:false,unknownOutcome:true,reason:'Reload the page before creating another version.'});await pending;
  await click();expect(state.calls).toHaveBeenCalledTimes(1);
  expect(state.values).toContain('Reload the page before creating another version.');
});
it('allows a new invocation after an explicit known refusal',async()=>{
  state.calls.mockReset();state.calls.mockResolvedValue({ok:false,reason:'Permission refused.'});
  const element=NewVersionButton({procedureId:'p',versionId:'v',expectedRowVersion:'revision'});
  const click=((element.props as {children:ReactElement[]}).children[0]!.props as {onClick:()=>Promise<void>}).onClick;
  await click();await click();expect(state.calls).toHaveBeenCalledTimes(2);
});
