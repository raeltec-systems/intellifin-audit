import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { createDb, createSqlClient, CryptoUuidV7Generator, DrizzleProcedureRepository, DrizzleRoleRepository, PostgresProceduresUnitOfWork } from '@intellifin/infrastructure';
import { initialPlanDerivation, planAuthoringDigest, procedureVersionRowVersion, transitionVersion, mintPlatformDraft, type ProcedureVersionRecord } from '@intellifin/application';
import { deriveExecutablePlan, registrationDigest, snapshotFromRegistration } from '@intellifin/domain';
import { executablePlanInputs } from '../fixtures/executable-plan';
import { READ_ONLY_CREDENTIAL } from './credentials';
import { AUTH_STATE, ACCOUNTS, assertThrowawayDatabase } from './accounts';
test.use({ storageState: AUTH_STATE.auditor });

test('all Procedure Detail states remain visible and New version is keyboard accessible',async({page,browser,baseURL})=>{
  test.setTimeout(180000);
  const url=process.env.DATABASE_URL!;assertThrowawayDatabase(url);
  const sql=createSqlClient(url),db=createDb(sql),ids=new CryptoUuidV7Generator(),uow=new PostgresProceduresUnitOfWork(db),repo=new DrizzleProcedureRepository(db);
  const actor=String((await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`)[0]!.id),manager=`manager-${ids.next()}`,procedureId=ids.next();
  await sql`INSERT INTO auth_user(id,name,email) VALUES (${manager},'Manager',${manager+'@example.test'})`;await sql`INSERT INTO user_role(user_id,role) VALUES (${manager},'audit-manager')`;
  const adminContext=await browser.newContext({baseURL,storageState:AUTH_STATE.administrator}),adminPage=await adminContext.newPage();
  const registrationId=ids.next(),bindingId=ids.next();
  try {
    const original=executablePlanInputs();
    const registration={registrationId,displayName:'Browser target',kind:'web' as const,allowedOrigins:['https://synthetic.invalid'],applicationIdentity:'',credentialRef:READ_ONLY_CREDENTIAL,permittedActions:['navigate','read-attribute'] as const,attributeLabelPatterns:['Parameter'],secondaryKey:''};
    await sql`INSERT INTO target_system_registration(registration_id,display_name,kind,allowed_origins,application_identity,credential_ref,permitted_actions,attribute_label_patterns,secondary_key,note,status,digest) VALUES (${registrationId},${registration.displayName},'web',${registration.allowedOrigins},'',${READ_ONLY_CREDENTIAL},${[...registration.permittedActions]},${registration.attributeLabelPatterns},'','','active',${registrationDigest(registration)})`;
    const source=original.sourceSnapshot!;
    await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,sensitive_fields,note,status,digest) VALUES (${bindingId},'Browser source','versioned-file',${source.contract.location!},${[...source.contract.declared_schema]},${source.contract.declared_count_mechanism},${[...source.contract.sensitive_fields]},'','active',${source.digest})`;
    const input={...original,sourceSnapshot:{...source,bindingId},targets:[snapshotFromRegistration({...registration,digest:registrationDigest(registration)})],instructions:[{registrationId,text:'Read baseline parameters.'}]},compiled=deriveExecutablePlan(input);if(!compiled.ok)throw new Error(compiled.reason);
    const base:ProcedureVersionRecord={...input,...initialPlanDerivation(),procedureId,versionId:ids.next(),versionNumber:1,state:'DRAFT',compiledPlan:compiled.plan,planStatus:'succeeded',planDerivable:true,authorship:{createdBy:{type:'human',id:actor},responsibleAuthorId:actor,humanAuthorIds:[actor]}};
    const deps={roles:new DrizzleRoleRepository(db),unitOfWork:uow,ids};
    async function act(versionId:string,decision:'submit'|'approve'|'reject') {
      const row=(await repo.findVersion(versionId))!;const userId=decision==='submit'?actor:manager;
      const result=await transitionVersion(deps,{session:{userId,sessionId:userId},correlationId:ids.next(),procedureId,versionId,expectedRowVersion:procedureVersionRowVersion(row),rationale:'Clarify the source scope.'},decision);expect(result.ok).toBe(true);
    }
    await uow.execute(async ctx=>{await ctx.procedures.insertProcedure(base);await ctx.procedures.insertVersion({...base,planInputDigest:planAuthoringDigest(base)});});
    await act(base.versionId,'submit');await act(base.versionId,'approve');
    for(const [number,state] of [[2,'SUBMITTED'],[3,'REJECTED'],[4,'APPROVED'],[5,'DRAFT']] as const){
      const row={...base,versionId:ids.next(),versionNumber:number,...(state==='APPROVED'?{derivationModel:{provider:'anthropic',modelId:'changed',promptVersion:'1'}}:{})};
      await uow.execute(ctx=>ctx.procedures.insertVersion({...row,planInputDigest:planAuthoringDigest(row)}));
      if(state!=='DRAFT')await act(row.versionId,'submit');
      if(state==='REJECTED')await act(row.versionId,'reject');
      if(state==='APPROVED')await act(row.versionId,'approve');
    }
    await uow.execute(ctx=>mintPlatformDraft(ctx,ids,{kind:'model',changeId:ids.next(),revision:'browser-fixture',model:{provider:'anthropic',modelId:'changed-platform',promptVersion:'1'}}));
    await page.goto(`/procedures/${procedureId}`);
    await expect(page.getByText('Approval pending. An Audit Manager who did not author this version can approve it.')).toBeVisible();
    await expect(page.getByText(/Rejected: Clarify the source scope/)).toBeVisible();
    await expect(page.getByText(/a Regression Run is required before activation/)).toBeVisible();
    await expect(page.getByText('Created by the platform after a model change; requires approval.')).toBeVisible();
    await expect(page.getByText(/No automatic Schedule boundary/)).toBeVisible();
    await expect(page.getByRole('button',{name:'Initiate Run'})).toBeDisabled();
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
    for(const [path,field,value,kind] of [[`/administration/registrations/${registrationId}`,'attributeLabelPatterns','Changed Parameter','registration'],[`/administration/sources/${bindingId}`,'location','https://synthetic.invalid/new.csv','source']] as const){
      await adminPage.goto(path);
      await adminPage.locator('[name="note"]').fill('An annotation only.');
      await adminPage.getByRole('button',{name:'Save changes',exact:true}).click();
      await expect(adminPage.getByRole('dialog')).not.toContainText('platform-authored draft');
      await adminPage.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();
      await expect(adminPage.getByRole('dialog')).toHaveCount(0);
      await expect(adminPage.getByText(/^Saved\./)).toBeVisible();
      await adminPage.reload();
      await adminPage.locator(`[name="${field}"]`).fill(value);
      await adminPage.getByRole('button',{name:'Save changes',exact:true}).click();
      await expect(adminPage.getByRole('dialog')).toContainText('This change creates a platform-authored draft for 1 Procedures and requires approval.');
      expect((await new AxeBuilder({page:adminPage}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
      await adminPage.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).focus();await adminPage.keyboard.press('Enter');
      await expect(adminPage.getByRole('dialog')).toHaveCount(0);
      await expect(adminPage.getByText(/^Saved\./)).toBeVisible();
      await expect.poll(async()=>(await repo.listVersions(procedureId)).filter(row=>row.platformOrigin?.kind===kind).length).toBe(1);
    }
    const button=page.getByRole('button',{name:'New version'});await button.focus();await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/builder\?version=/,{timeout:30000});await expect(page.getByRole('heading',{name:base.controlName,exact:true})).toBeVisible();
    const activatedId=new URL(page.url()).searchParams.get('version')!;
    const activeDraft={...(await repo.findVersion(activatedId))!,schedule:{frequency:'weekly' as const,startTime:'15:30',periodDerivationRule:'previous-monday-sunday' as const}};const newPlan=deriveExecutablePlan(activeDraft);if(!newPlan.ok)throw new Error(newPlan.reason);
    await uow.execute(ctx=>ctx.procedures.updateVersion({...activeDraft,compiledPlan:newPlan.plan,planStatus:'succeeded',planDerivable:true,planInputDigest:planAuthoringDigest(activeDraft)}));
    await act(activatedId,'submit');await act(activatedId,'approve');
    const successor=(await repo.findVersion(activatedId))!;
    expect(successor.lifecycle?.handoverAt).not.toBeNull();
    expect((await repo.findVersion(base.versionId))?.state).toBe('ACTIVE');
    await sql`UPDATE procedure_version SET state='RETIRED' WHERE version_id=${base.versionId}`;
    await page.goto(`/procedures/${procedureId}`);await expect(page.getByText(`Retired; this version is read-only. Superseded by v${successor.versionNumber}.`)).toBeVisible();
    await expect(page.getByText(`First period start after activation: ${successor.lifecycle!.handoverAt}.`)).toBeVisible();
    await page.goto(`/procedures/${procedureId}/versions/${base.versionId}`);await expect(page.getByText(`Retired; this version is read-only. Superseded by v${successor.versionNumber}.`)).toBeVisible();
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
    await uow.execute(async ctx=>{for(let number=successor.versionNumber+1;number<=103;number++)await ctx.procedures.insertVersion({...base,versionId:ids.next(),versionNumber:number,planInputDigest:planAuthoringDigest(base)});});
    await page.goto(`/procedures/${procedureId}`);await expect(page.locator('.ls-card__title').filter({hasText:'Version 103 · DRAFT'})).toBeVisible();
    await page.getByRole('link',{name:'Older versions',exact:true}).click();
    await expect(page.getByText(`Retired; this version is read-only. Superseded by v${successor.versionNumber}.`)).toBeVisible();
    // The Active source lies on the newest history page despite its older number;
    // its direct review remains reachable independently of history pagination.
    await page.goto(`/procedures/${procedureId}/builder`);await expect(page.getByText(/Version 103 · Draft/)).toBeVisible();
    await page.goto(`/procedures/${procedureId}`);
    await page.getByRole('button',{name:'New version',exact:true}).click();
    await expect(page).toHaveURL(/builder\?version=/,{timeout:30000});await expect(page.getByText(/Version 104 · Draft/)).toBeVisible();
    await page.goto(`/procedures/${procedureId}`);
    let requests=0;const address=page.url();
    await page.route(address,async route=>{if(route.request().method()!=='POST')return route.continue();requests++;await route.fetch();await route.abort('failed');});
    const newButton=page.getByRole('button',{name:'New version',exact:true});
    await newButton.evaluate(element=>{(element as HTMLButtonElement).click();(element as HTMLButtonElement).click();});
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Reload the page before creating another version');
    await expect(newButton).toBeDisabled();await newButton.evaluate(element=>(element as HTMLButtonElement).click());
    expect(requests).toBe(1);expect((await repo.latestDraft(procedureId))?.versionNumber).toBe(105);
    await page.unroute(address);await page.reload();await expect(page.getByRole('button',{name:'New version',exact:true})).toBeEnabled();
  }finally{
    await adminContext.close();
    await sql`DELETE FROM procedure_succession WHERE procedure_id=${procedureId}`;await sql`DELETE FROM notification WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM pgboss.job WHERE data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id=${procedureId})`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;await sql`DELETE FROM auth_user WHERE id=${manager}`;await sql`DELETE FROM target_system_registration WHERE registration_id=${registrationId}`;await sql`DELETE FROM population_source_binding WHERE binding_id=${bindingId}`;await sql.end();
  }
});
