import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { deriveExecutablePlan, diffReviewedDefinitions, type ReviewedDefinition } from '@intellifin/domain';
import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { VersionDiff } from './VersionDiff';
function definition(scope: string, recording: boolean, text: string): ReviewedDefinition {
  const inputs = {...executablePlanInputs(),scope};
  inputs.evidenceRequirements = [{attributeName:'Parameter',modelRead:false,groundedBy:['structural-snapshot'],screenshot:true,platformCaptured:true,recordingSegment:recording}];
  const derived = deriveExecutablePlan(inputs); if (!derived.ok) throw new Error(derived.reason);
  return {schemaVersion:1,inputs,compiledPlan:{...derived.plan,sessionSteps:derived.plan.sessionSteps.map((step,index)=>index===0?{...step,text}:step)},modelConfiguration:null,toolConfiguration:{interpreterContract:'executable-plan-v1',identityMatching:'opaque-exact-strings',accessPolicy:'frozen-registered-read-actions',actions:['create-workspace']}};
}
function columns(html: string, heading: string) {
  const start=html.indexOf(`<summary>${heading} · `); expect(start).toBeGreaterThan(-1);
  const section=html.slice(start,html.indexOf('</details>',start));
  const [,previous,current]=section.split(/<h3>(?:Previous|Submitted for review)<\/h3>/);
  return {section,previous:previous!,current:current!};
}
describe('successor review rendering',()=>{
  it('renders before and after under their own headings for scope, Evidence and ordered plan steps',()=>{
    const before=definition('Prior saved scope',false,'Previous acquisition instructions');
    const after=definition('Current submitted scope',true,'Current acquisition instructions');
    const html=renderToStaticMarkup(React.createElement(VersionDiff,{diff:diffReviewedDefinitions(before,after),first:false}));
    const scope=columns(html,'Period and scope');
    expect(scope.previous).toContain('Prior saved scope'); expect(scope.previous).not.toContain('Current submitted scope');
    expect(scope.current).toContain('Current submitted scope'); expect(scope.current).not.toContain('Prior saved scope');
    const evidence=columns(html,'Evidence Requirements');
    expect(evidence.previous).toContain('Recording Segment</strong></dt><dd><span>No');
    expect(evidence.current).toContain('Recording Segment</strong></dt><dd><span>Yes');
    const plan=columns(html,'Executable plan');
    expect(plan.previous).toContain('Previous acquisition instructions'); expect(plan.previous).not.toContain('Current acquisition instructions');
    expect(plan.current).toContain('Current acquisition instructions'); expect(plan.current).not.toContain('Previous acquisition instructions');
    expect(html).toContain('Control · Unchanged'); expect(html).toContain('Evidence Requirements · Changed');
  });
});
