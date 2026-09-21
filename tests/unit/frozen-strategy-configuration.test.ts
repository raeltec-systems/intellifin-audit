import { expect, it } from 'vitest';
import { deriveExecutablePlan, regressionRequirement } from '@intellifin/domain';
import { reviewedDefinition, versionConfigurationTuple } from '@intellifin/application';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { executablePlanInputs } from '../fixtures/executable-plan.js';

it('stamps interpreter 2 into new approval and requires regression when replacing interpreter 1',()=>{
  const next=activeRunVersion('01990000-0000-7000-8000-000000000001','01990000-0000-7000-8000-000000000002','author');
  const legacy=deriveExecutablePlan(executablePlanInputs(),'1');
  if(!legacy.ok)throw new Error(legacy.reason);
  const prior={...next,planCompilerVersion:'1',compiledPlan:legacy.plan,frozenReview:undefined,submittedReview:undefined};
  expect(reviewedDefinition(next).toolConfiguration.interpreterContract).toBe('executable-plan-v2');
  expect(reviewedDefinition(prior).toolConfiguration.interpreterContract).toBe('executable-plan-v1');
  expect(regressionRequirement(versionConfigurationTuple(next),versionConfigurationTuple(prior))).toEqual({requiresRegression:true,reason:'changed-configuration'});
  const frozen={...prior,frozenReview:{...next.frozenReview!,definition:{...reviewedDefinition(prior),compiledPlan:legacy.plan}}};
  expect(reviewedDefinition({...frozen,planCompilerVersion:'2'})).toBe(frozen.frozenReview.definition);
});
