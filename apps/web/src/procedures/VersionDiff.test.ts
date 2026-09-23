import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { deriveExecutablePlan, diffReviewedDefinitions, type ReviewedDefinition } from '@intellifin/domain';
import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { DIFF_HEADING, DIFF_WORDS, VersionDiff } from './VersionDiff';
function definition(scope: string, recording: boolean, text: string): ReviewedDefinition {
  const inputs = {...executablePlanInputs(),scope};
  inputs.evidenceRequirements = [{attributeName:'Parameter',modelRead:false,groundedBy:['structural-snapshot'],screenshot:true,platformCaptured:true,recordingSegment:recording}];
  const derived = deriveExecutablePlan(inputs); if (!derived.ok) throw new Error(derived.reason);
  return {schemaVersion:1,inputs,compiledPlan:{...derived.plan,sessionSteps:derived.plan.sessionSteps.map((step,index)=>index===0?{...step,text}:step)},modelConfiguration:null,toolConfiguration:{interpreterContract:'executable-plan-v1',identityMatching:'opaque-exact-strings',accessPolicy:'frozen-registered-read-actions',actions:['create-workspace']}};
}
function columns(html: string, heading: string) {
  const start=html.indexOf(`<summary>${heading} · `); expect(start).toBeGreaterThan(-1);
  const section=html.slice(start,html.indexOf('</details>',start));
  const [,previous,current]=section.split(/<h4>(?:Previous|Submitted for review)<\/h4>/);
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
    expect(evidence.previous).toContain('Clip of the session recording</strong></dt><dd><span>No');
    expect(evidence.current).toContain('Clip of the session recording</strong></dt><dd><span>Yes');
    const plan=columns(html,'Executable plan');
    expect(plan.previous).toContain('Previous acquisition instructions'); expect(plan.previous).not.toContain('Current acquisition instructions');
    expect(plan.current).toContain('Current acquisition instructions'); expect(plan.current).not.toContain('Previous acquisition instructions');
    expect(html).toContain('Control · Unchanged'); expect(html).toContain('Evidence Requirements · Changed');
  });

  /**
   * "Model: Not set" said nothing true to the owner, who had just used the writing
   * assistant on the same Procedure. Those are two different models: the assistant is
   * the authoring one, and this field is the plan-check model a platform configuration
   * revision publishes — unset here, which is why derivation was deterministic.
   */
  it('explains an unconfigured plan-check model rather than calling it unfilled',()=>{
    const before=definition('Prior saved scope',false,'Previous acquisition instructions');
    const after=definition('Current submitted scope',true,'Current acquisition instructions');
    expect(after.modelConfiguration).toBeNull();
    const html=renderToStaticMarkup(React.createElement(VersionDiff,{diff:diffReviewedDefinitions(before,after),first:false}));
    const model=columns(html,'Model and tool configuration');
    expect(model.current).toContain('Plan-check model');
    expect(model.current).toContain('No plan-check model is configured');
    expect(model.current).toContain('assistant that helps you write is a separate model');
    // The generic absence word is gone from THIS field. It stays for every other one.
    expect(model.current).not.toContain('<dd><span>Not set</span></dd>');
  });

  /**
   * UI cleanup 2026-09-22, UX-33. `diffReviewedDefinitions` marks EVERY section of a
   * first version `changed` — a review with no baseline must — so "Changed" there told
   * an approver that fourteen sections had been changed by somebody on a version with no
   * predecessor at all. A first version's sections are NEW.
   */
  it('says a first version\u2019s sections are New, and opens none of them',()=>{
    const after=definition('Current submitted scope',true,'Current acquisition instructions');
    const diff=diffReviewedDefinitions(null,after);
    expect(diff.every(section=>section.changed)).toBe(true);
    const html=renderToStaticMarkup(React.createElement(VersionDiff,{diff,first:true}));
    expect(html).toContain(`\u00b7 ${DIFF_WORDS.first}`);
    expect(html).not.toContain(`\u00b7 ${DIFF_WORDS.changed}`);
    // Every section closed: a first version used to force all fourteen open, which is
    // most of what made the approval surface 13,887px tall.
    expect(html).not.toContain('<details open');
    // And no "Previous" column, because there is no previous version to show.
    expect(html).not.toContain('<h4>Previous</h4>');
  });

  it('carries a heading where the page gives it one, and labels itself where it does not',()=>{
    const diff=diffReviewedDefinitions(null,definition('Scope',false,'Steps'));
    const labelled=renderToStaticMarkup(React.createElement(VersionDiff,{diff,first:true,headingId:'frozen-diff'}));
    expect(labelled).toContain('id="frozen-diff"');
    expect(labelled).toContain(DIFF_HEADING);
    expect(labelled).toContain('aria-labelledby="frozen-diff"');
    const bare=renderToStaticMarkup(React.createElement(VersionDiff,{diff,first:true}));
    expect(bare).toContain(`aria-label="${DIFF_HEADING}"`);
  });
});
