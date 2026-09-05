import { expect, it, vi } from 'vitest';
import { applyPlatformConfiguration } from './apply-platform-configuration.js';
const valid={revision:'release-1',changeKind:'model',interpreterContract:'executable-plan-v1',model:{provider:'anthropic',modelId:'model',promptVersion:'1'}};
it.each([null,[],{}, {...valid,extra:true}, {...valid,revision:42}, {...valid,model:[]}, {...valid,model:{}}, {...valid,model:{...valid.model,modelId:null}}, {...valid,model:{...valid.model,modelId:12}}, {...valid,model:{...valid.model,modelId:undefined}}, {...valid,model:{...valid.model,extra:true}}, {...valid,changeKind:'tool'}, {...valid,changeKind:'prompt'}, {...valid,interpreterContract:'future'}, {...valid,model:{...valid.model,promptVersion:'2'}}])('refuses malformed or unsupported publication before any transaction: %j',async input=>{
  const execute=vi.fn();
  await expect(applyPlatformConfiguration({unitOfWork:{execute},ids:{next:()=> 'id'}},input)).rejects.toThrow('Unsupported configuration publication');
  expect(execute).not.toHaveBeenCalled();
});
