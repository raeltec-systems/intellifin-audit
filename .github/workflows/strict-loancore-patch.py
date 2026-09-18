# Workflow-owned acceptance harness assembly. Never changes application files.
from pathlib import Path
p=Path('scripts/verify-deployed-loancore.mjs')
s=p.read_text()
def replace(a,b):
 global s
 assert s.count(a)==1, (a[:100],s.count(a))
 s=s.replace(a,b,1)
replace("from './acceptance-truth.mjs';", "from './scripts/acceptance-truth.mjs';")
replace("const report = { startedAt:", "const report = { releasedApplicationSha: process.env.RELEASE_SHA, workflowRunId: process.env.GITHUB_RUN_ID, workflowAttempt: process.env.GITHUB_RUN_ATTEMPT, visualReviewRequired: true, startedAt:")
replace("const secrets = new Set();", "const secrets = new Set([process.env.DATABASE_URL]);")
replace("const sections = {", "const sections = { 'Evidence Requirements': 'evidence',")
replace("heading === 'Target System selection' ? 'systems' : null", "heading === 'Target System selection' ? 'systems' : heading === 'Evidence Requirements' ? 'capture' : null")
start=s.index('async function acknowledged('); end=s.index('async function selectContaining(',start)
s=s[:start]+r'''
async function readDraft(procedureId) {
  return (await sql`SELECT version_id, procedure_id, state, period, scope, source_snapshot,
    inclusion_rule, targets, instructions, compliance_conditions, evidence_requirements, schedule,
    plan_status, plan_failure_reason, compiled_plan, plan_input_digest, section_preparation,
    authorship, decisions, lifecycle FROM procedure_version WHERE procedure_id=${procedureId}::uuid
    ORDER BY version_number DESC LIMIT 1`)[0];
}
function draftEvidence(row) {
  return { versionId:row.version_id, procedureId:row.procedure_id, state:row.state,
    period:row.period, scope:row.scope, sourceBindingId:row.source_snapshot?.bindingId??null,
    sourceSnapshotDigest:row.source_snapshot?.digest??null,
    sourceSnapshotSha256:createHash('sha256').update(JSON.stringify(row.source_snapshot)).digest('hex'),
    inclusionRule:row.inclusion_rule,
    targets:row.targets.map(t=>({registrationId:t.registrationId,displayName:t.displayName,digest:t.digest,kind:t.contract.kind})),
    instructions:row.instructions, conditions:row.compliance_conditions, evidenceRequirements:row.evidence_requirements,
    schedule:row.schedule, planStatus:row.plan_status, planFailureReason:row.plan_failure_reason,
    planInputDigest:row.plan_input_digest, hasCompiledPlan:row.compiled_plan!==null,
    sectionPreparation:row.section_preparation, authorship:row.authorship, decisions:row.decisions, lifecycle:row.lifecycle };
}
async function settleDraftBeforeEdit(page) {
  const id=new URL(page.url()).pathname.split('/')[2];
  await poll(()=>readDraft(id),row=>row&&row.plan_status!=='pending',90000);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('[data-guided-ready=true]')).toBeVisible();
}
async function acknowledged(page, action) {
  const path=new URL(page.url()).pathname;
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===path && r.request().method()==='POST',{timeout:15000}).catch(()=>null);
  await action();
  const seen=await response;
  emit('ui-save-request-observed',{phase,httpStatus:seen?.status()??null});
  // Streaming response completion is not a persistence acknowledgement.
}
const STALE='That procedure changed since this page was loaded. Reload the page and try again.';
function hasPredicate(tree, fn) {
  if(tree===null||typeof tree!=='object') return false;
  if(fn(tree)) return true;
  return Object.values(tree).some(value=>Array.isArray(value)?value.some(v=>hasPredicate(v,fn)):hasPredicate(value,fn));
}
async function sectionProof(heading) {
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  if(heading==='Period and scope') return row=>row.period?.from===PERIOD.from&&row.period?.to===PERIOD.to&&row.scope===SCOPE;
  if(heading==='Population Source binding') {
    const bindingId=await auditor.getByLabel('Where the records come from').inputValue();
    assert.match(bindingId,/^[0-9a-f-]{36}$/);
    return row=>row.source_snapshot?.bindingId===bindingId
      && row.inclusion_rule?.all?.length===2
      && row.inclusion_rule.all.some(p=>p.column==='employment_status'&&p.kind==='text'&&p.operator==='eq'&&p.value==='Terminated')
      && row.inclusion_rule.all.some(p=>p.column==='termination_effective_date'&&p.kind==='within-period');
  }
  if(heading==='Target System selection') return row=>row.targets.length===1&&row.targets[0].registrationId===report.registrationId&&row.targets[0].contract.kind==='web';
  if(heading==='Audit Instructions') {
    const text=await auditor.getByLabel(`What the agent should do in ${TARGET_NAME}`).inputValue();
    return row=>row.instructions.length===1&&row.instructions[0].registrationId===report.registrationId&&row.instructions[0].text===text;
  }
  if(heading==='Compliance Rule conditions') return row=>{
    const c1=row.compliance_conditions.find(c=>c.conditionId==='C1'),c2=row.compliance_conditions.find(c=>c.conditionId==='C2');
    return row.compliance_conditions.length===2&&c1?.status==='RULE'
      && hasPredicate(c1.rule,p=>p.kind==='named-set'&&p.field==='account_status'&&equal(p.compliant,['Disabled'])&&equal(p.exception,['Active']))
      && hasPredicate(c1.rule,p=>p.kind==='boolean'&&p.field==='found'&&p.value===false)
      && c2?.status==='AGENT_JUDGED'&&c2.policy?.kind==='role-privilege'
      && equal([...c2.policy.privileged].sort(),['SYSTEM_ADMIN','LOAN_ADMIN','BRANCH_SUPERVISOR'].sort())
      && equal([...c2.policy.nonPrivileged].sort(),['LOAN_VIEWER','LOAN_OFFICER','COLLECTIONS_AGENT','TREASURY_ANALYST','SERVICING_CLERK','RISK_ANALYST','OPS_CLERK'].sort());
  };
  if(heading==='Evidence Requirements') return row=>['username','account_status','roles'].every(name=>row.evidence_requirements.some(e=>e.attributeName===name&&e.groundedBy.includes('structural-snapshot')&&e.screenshot===true&&e.modelRead===false));
  if(heading==='Schedule') return row=>row.schedule?.frequency==='once';
  throw new Error(`No persistence assertion for ${heading}`);
}
async function step(heading,fill,save,_unusedBanner) {
  phase=heading;
  await settleDraftBeforeEdit(auditor); await openStep(auditor,heading); await fill();
  const id=new URL(auditor.url()).pathname.split('/')[2];
  const proves=await sectionProof(heading);
  await acknowledged(auditor,save);
  const row=await poll(()=>readDraft(id),r=>r&&proves(r)&&r.plan_status!=='pending',45000);
  (report.savedSections??=[]).push({at:new Date().toISOString(),section:heading,...draftEvidence(row)});
  emit('draft-section-persisted',{section:heading,versionId:row.version_id,sourceBindingId:row.source_snapshot?.bindingId??null});
}
''' +s[end:]
replace("  emit('procedure-created-through-ui', { procedureId, control });", "  if(!prefix) report.procedureId=procedureId;\n  emit('procedure-created-through-ui', { procedureId, control });\n  await shot(auditor,`${prefix}00-procedure-created`);")
replace("  await step('Schedule',", "  await step('Evidence Requirements',async()=>{\n    const values=await auditor.getByLabel('What to record',{exact:true}).evaluateAll(nodes=>nodes.map(n=>n.value));\n    for(const name of ['username','account_status','roles']) assert(values.includes(name),`Missing proof field ${name}`);\n  },()=>auditor.getByRole('button',{name:'Save Evidence Requirements',exact:true}).click(),'');\n  await step('Schedule',")
start=s.index("  phase = `${prefix}review-sections`;");end=s.index("  await planSettled(auditor); await shot",start)
s=s[:start]+r'''
  phase=`${prefix}review-sections`;
  for(const section of ['context','scope','evidence','instructions','assessment','frequency']) {
    await settleDraftBeforeEdit(auditor);
    await auditor.locator(`[data-preparation-nav="${section}"]`).click();
    const panel=auditor.locator(`[data-preparation-panel="${section}"]`);
    await acknowledged(auditor,()=>panel.getByRole('button',{name:/^(Yes, use this control|Mark reviewed and continue)$/}).click());
    const row=await poll(()=>readDraft(procedureId),row=>{
      const s=row?.section_preparation?.sections?.[section];
      return s&&!s.needsClarification&&s.review?.actorId===accounts.auditor.userId&&s.review.basis===s.basis&&s.review.revision===s.revision;
    },30000);
    emit('section-review-persisted',{section,review:row.section_preparation.sections[section].review});
  }
  const prepared=await poll(()=>readDraft(procedureId),row=>row?.plan_status==='succeeded'&&row.compiled_plan!==null,90000);
  if(!prefix){report.versionId=prepared.version_id;report.prepared=draftEvidence(prepared);report.checks.planSucceeded=true;report.checks.sectionPersistence=true;}
''' +s[end:]
replace('toContainText(/Re-derived|Cannot derive:/, { timeout: 150000 })','toContainText(/Re-derived/, { timeout: 150000 })')
replace("  await expect(auditor.getByText('Submitted', { exact: true }).first()).toBeVisible();", "  await expect(auditor.getByText('Submitted', { exact: true }).first()).toBeVisible();\n  const submitted=await poll(()=>readDraft(procedureId),row=>row?.state==='SUBMITTED',30000);\n  if(!prefix) report.submitted=draftEvidence(submitted);\n  await shot(auditor,`${prefix}01-submitted`);")
replace("  await manager.goto(auditor.url(), { waitUntil: 'domcontentloaded' });\n  await confirmed(manager, 'Approve');", "  assert.notEqual(accounts.auditor.userId,accounts.manager.userId);\n  await manager.goto(auditor.url(), { waitUntil: 'domcontentloaded' });\n  await expect(manager.locator('[data-version-actions-ready]')).toHaveAttribute('data-version-actions-ready','true');\n  await shot(manager,`${prefix}02-before-manager-approval`);\n  await confirmed(manager, 'Approve');")
replace("  emit('procedure-independently-approved-through-ui', { procedureId });", "  const approved=await poll(()=>readDraft(procedureId),row=>row?.state==='ACTIVE',30000);\n  if(!prefix) report.approved=draftEvidence(approved);\n  emit('procedure-independently-approved-through-ui', { procedureId, auditorId:accounts.auditor.userId, managerId:accounts.manager.userId });")
replace("  started.push(runId);", "  started.push(runId); if(!prefix) report.runId=runId;")
replace("        report.checks.visibleInspection = true;", "        if(state==='RUNNING') report.checks.visibleInspection = true;\n        (report.visibleFrames??=[]).push({at:new Date().toISOString(),runId:report.runId,state,src});")
replace("  emit('watch-observed', report.watch);", "  report.watch.runningScreens=new Set((report.visibleFrames??[]).filter(f=>f.state==='RUNNING').map(f=>f.src)).size;\n  report.checks.watchChangingWhileRunning=report.watch.runningScreens>=2;\n  report.watch.mode='platform-owned sequential screen captures; not live video';\n  emit('watch-observed', report.watch);")
replace("groundingLinks.slice(0, 6)","groundingLinks")
replace("  if (['COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED'].includes(final.run.state)) {", "  report.checks.workspaceReleased=(await poll(()=>facts(report.runId),f=>f.workspace?.status==='RELEASED',90000)).workspace.status==='RELEASED';\n  report.workspaceReleaseObservedAt=new Date().toISOString();\n  report.artifacts=await sql`SELECT evidence_id,kind,role,state,digest,size,captured_at,required FROM run_evidence WHERE run_id=${report.runId}::uuid ORDER BY captured_at,evidence_id`;\n  if (['COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED'].includes(final.run.state)) {")
replace("  if (process.env.ACCEPTANCE_NEGATIVE_CASE === 'true') { await negativeCase(); report.required.push('defectivePopulationRefused'); }", "  report.required.push('sectionPersistence','planSucceeded','watchChangingWhileRunning');\n  report.positiveAutomatedChecksPassed=report.required.every(name=>report.checks[name]===true);\n  // A person must inspect captured Watch and Replay evidence before the negative phase.\n  report.negativeDeferred='Positive Watch/replay visual review must complete first';")
replace("  report.accepted = report.required.every(name => report.checks[name] === true);", "  report.accepted=false; // This phase supplies evidence, never a substitute for visual acceptance.\n  report.phaseComplete=report.positiveAutomatedChecksPassed===true;")
replace("  if (!report.accepted) process.exitCode = 1;", "  if (!report.phaseComplete) process.exitCode = 1;")
replace("  report.failures.push({ phase, kind: error?.name ?? 'Error' });", "  const message=String(error?.message??'').slice(0,2500);checkSecretFree(message);\n  report.failures.push({ phase, kind: error?.name ?? 'Error', message });\n  if(report.procedureId) report.draftAtFailure=draftEvidence(await readDraft(report.procedureId));\n  if(auditor){const banners=await auditor.locator('.ls-banner').allInnerTexts().catch(()=>[]);checkSecretFree(JSON.stringify(banners));report.failureBanners=banners;}")
replace("      report.identityCleanup.push({ userId: account.userId, revoked: true });", "      const [counts]=await sql`SELECT (SELECT count(*)::int FROM auth_session WHERE user_id=${account.userId}) AS sessions,(SELECT count(*)::int FROM user_role WHERE user_id=${account.userId}) AS roles`;\n      assert.equal(counts.sessions,0);assert.equal(counts.roles,0);\n      report.identityCleanup.push({ userId: account.userId, revoked: true,...counts });")
Path('strict-loancore-acceptance.mjs').write_text(s)
Path('deployed-loancore-evidence').mkdir(exist_ok=True)
Path('deployed-loancore-evidence/executed-harness.mjs').write_text(s)
