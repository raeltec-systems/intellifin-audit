import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { bindingDigest, registrationDigest, deriveExecutablePlan } from '@intellifin/domain';
import { createSqlClient, CryptoUuidV7Generator } from '@intellifin/infrastructure';
import { createDb, PostgresProceduresUnitOfWork, InAppNotificationSender } from '@intellifin/infrastructure';
import { initialPlanDerivation, planAuthoringDigest, type ProcedureVersionRecord } from '@intellifin/application';
import { executablePlanInputs } from '../fixtures/executable-plan';
import { AUTH_STATE, ACCOUNTS, assertThrowawayDatabase, signIn } from './accounts';
test.use({ storageState: AUTH_STATE.auditor });
const scan = async (page: Page) => expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
async function save(page: Page, label: string, confirmation = label) { await page.getByRole('button', { name: label, exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: confirmation, exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); }

test('P-1 authored Builder → actual worker/SDK HTTP → submitted review → rejection/edit → approval', async ({ page, browser, baseURL }) => {
  test.setTimeout(180000); page.setDefaultTimeout(15000);
  // This journey freezes the model identity playwright.config.ts gives ITS web server
  // (the synthetic fixture) and spawns a worker with the same one. With
  // `PLAYWRIGHT_BASE_URL` the config starts no server, so an external web app with the
  // default deterministic configuration (or any other model) creates a Draft this
  // worker cannot derive and the frozen-identity assertion fails for a reason that is
  // not the code's. State the boundary rather than fail on it (found by the automated
  // reviewer on #21).
  test.skip(process.env['PLAYWRIGHT_BASE_URL'] !== undefined, 'The worker-backed review journey needs the web server playwright.config.ts starts with the synthetic model configuration; an external server is not supported for this spec.');
  const url = process.env['DATABASE_URL']!; assertThrowawayDatabase(url);
  const sql = createSqlClient(url), ids = new CryptoUuidV7Generator(), stamp = ids.next();
  const sourceId = ids.next(), webId = ids.next(), desktopId = ids.next(), managerId = `manager-${stamp}`;
  const sourceName = `E2E review population ${stamp}`, webName = `E2E LoanCore ${stamp}`, desktopName = `E2E LedgerDesk ${stamp}`, controlName = `E2E P1 version review ${stamp}`;
  const email = `${managerId}@example.test`;
  let procedureId: string | undefined;
  await sql`DELETE FROM pgboss.job WHERE name = 'procedures' AND NOT EXISTS (SELECT 1 FROM procedure_version WHERE version_id::text = pgboss.job.data->>'versionId')`;
  let output = '', stopWorker: (() => Promise<void>) | undefined;
  const managerContext = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } }); const manager = await managerContext.newPage();
  try {

    const source = { kind: 'versioned-file' as const, location: 'https://synthetic.invalid/terminations.csv', declaredSchema: ['employee_id','full_name','employment_status','termination_effective_date','termination_time','department'], sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const };
    await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,sensitive_fields,note,status,digest) VALUES (${sourceId},${sourceName},${source.kind},${source.location},${source.declaredSchema},${source.declaredCountMechanism},${source.sensitiveFields},'','active',${bindingDigest(source)})`;
    for (const [id,name,kind] of [[webId,webName,'web'],[desktopId,desktopName,'desktop']] as const) {
      const registration = { kind, allowedOrigins: kind === 'web' ? ['https://synthetic.invalid'] : [], applicationIdentity: kind === 'desktop' ? 'com.synthetic.ledgerdesk' : '', credentialRef: `vault://synthetic/${kind}`, permittedActions: ['read-attribute'] as const, attributeLabelPatterns: ['employee_id','account_status'], secondaryKey: '' };
      await sql`INSERT INTO target_system_registration(registration_id,display_name,kind,allowed_origins,application_identity,credential_ref,permitted_actions,attribute_label_patterns,secondary_key,note,status,digest) VALUES (${id},${name},${kind},${registration.allowedOrigins},${registration.applicationIdentity},${registration.credentialRef},${registration.permittedActions},${registration.attributeLabelPatterns},'','','active',${registrationDigest(registration)})`;
    }
    // Synthetic account fixture reuses the seeded password hash without reading it into a payload.
    await sql`INSERT INTO auth_user(id,name,email,email_verified) VALUES (${managerId},'Synthetic Audit Manager',${email},true)`;
    await sql`INSERT INTO auth_account(id,issuer,account_id,provider_id,user_id,password) SELECT ${ids.next()},issuer,${managerId},provider_id,${managerId},password FROM auth_account WHERE user_id = (SELECT id FROM auth_user WHERE email = ${ACCOUNTS.auditor.email}) AND provider_id = 'credential'`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${managerId},'audit-manager')`;
    await page.goto('/procedures/new'); await page.getByLabel('Template', { exact: true }).selectOption('P-1'); await page.getByLabel('Control name', { exact: true }).fill(controlName); await save(page,'Create Procedure');
    await expect(page).toHaveURL(/\/builder$/); procedureId = page.url().split('/').at(-2)!;
    const submit = page.getByRole('button', { name: 'Submit for approval', exact: true }); await expect(submit).toBeDisabled(); await expect(submit).toHaveAccessibleDescription(/Choose a Population Source/);
    await page.getByLabel('Period start').fill('2026-08-01'); await page.getByLabel('Period end').fill('2026-08-31'); await page.getByLabel('Scope statement').fill('All terminated employees in the Finance department.'); await save(page,'Save Period and scope','Save Draft changes'); await expect(page.getByRole('button',{name:'Save Period and scope',exact:true})).toBeEnabled(); await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.').first()).toBeVisible();
    await page.getByLabel('Population Source', { exact: true }).selectOption(sourceId);
    await page.getByRole('button', { name: 'Add clause', exact: true }).click();
    const clauses = page.getByLabel(/^Declared column /); const count = await clauses.count();
    await clauses.last().selectOption('department'); await page.getByLabel(`Comparison value ${count}`, { exact: true }).fill('Finance');
    await page.getByLabel('Permit versioned duplicate primary keys', { exact: true }).check();
    await save(page,'Save Population Source binding','Save Draft changes'); await expect(page.getByRole('button',{name:'Save Population Source binding',exact:true})).toBeEnabled(); await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.').first()).toBeVisible();
    for (const id of [webId,desktopId]) { await page.getByLabel('Add a Target System').selectOption(id); await page.getByRole('button', { name: 'Add Target System', exact: true }).click(); }
    await save(page,'Save Target Systems'); await expect(page.getByText('Saved. The Target System selection is recorded in the audit chain.')).toBeVisible();
    for (const name of [webName,desktopName]) await page.getByLabel(`Audit Instructions for ${name}`, { exact: true }).fill('Read account status for each terminated employee by employee_id and full_name.');
    await save(page,'Save Audit Instructions'); await expect(page.getByText('Saved. The Audit Instructions are recorded in the audit chain.')).toBeVisible();
    await page.reload(); await expect(page.getByLabel('Permit versioned duplicate primary keys', { exact: true })).toBeChecked(); await expect(page.getByLabel(`Comparison value ${count}`, { exact: true })).toHaveValue('Finance');
  const worker = spawn(process.execPath, ['--import', pathToFileURL(resolve('tests/fixtures/anthropic-worker-preload.mjs')).href, resolve('apps/worker/dist/main.js')], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, SERVICE_NAME: 'worker', MODEL_PROVIDER: 'anthropic', MODEL_ID: 'synthetic-http-fixture', MODEL_PROMPT_VERSION: '1', MODEL_API_KEY: 'isolated-synthetic-http-fixture', MODEL_MAX_OUTPUT_TOKENS: '65536' }, stdio: ['ignore','pipe','pipe'] });
  let workerFailure: string | null = null;
  worker.on('error', error => { workerFailure = error.name; });
  const workerExited = new Promise<void>(resolve => worker.once('close', code => { if (code !== 0 && code !== null) workerFailure = `Worker exited with code ${code}`; resolve(); }));
  worker.stdout.on('data', data => { output += String(data); }); worker.stderr.on('data', data => { output += String(data); });
    stopWorker = async () => { worker.kill(); await workerExited; };
    // Cold worker imports share the host with the full browser suite; wait for an
    // explicit readiness signal while still failing immediately on process errors.
    await expect.poll(() => { if (workerFailure) throw new Error(workerFailure + ' ' + output); return output.includes('Heartbeat loop started'); }, { timeout: 45000 }).toBe(true);
    await expect(page.getByTestId('executable-plan-preview')).toContainText('Re-derived', { timeout: 45000 });
    expect(output).toContain('Synthetic Anthropic HTTP response delivered');
    // Author once more with the real worker running, then prove its current result.
    await page.getByLabel('Scope statement').fill('All terminated employees in Finance, reviewed with the worker running.');
    await save(page,'Save Period and scope','Save Draft changes'); await expect(page.getByRole('button',{name:'Save Period and scope',exact:true})).toBeEnabled(); await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.').first()).toBeVisible();
    await expect(page.getByText('Saved. The Draft change is recorded in the audit chain.').first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Scope statement')).toHaveValue('All terminated employees in Finance, reviewed with the worker running.');
    await expect(submit).toBeEnabled({ timeout: 45000 });
    await expect(submit).toBeEnabled(); await scan(page);
    await submit.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(submit).toBeFocused();
    await save(page,'Submit for approval'); await expect(page).toHaveURL(/\/versions\//);
    const reviewUrl = page.url(); await expect(page.getByRole('button',{ name:'Approve',exact:true })).toBeDisabled(); await expect(page.getByRole('button',{ name:'Approve',exact:true })).toHaveAccessibleDescription(/You cannot approve a version you authored\./);
    await expect(page.locator('details')).toHaveCount(12); await expect(page.locator('details:not([open])')).toHaveCount(0); await scan(page);
    await signIn(manager,email); await expect(manager).toHaveURL(new URL('/', baseURL!).href); await manager.goto('/notifications'); await expect(manager.getByRole('link',{ name:/Procedure Version submitted/ })).toBeVisible({ timeout: 10000 }); await manager.getByRole('link',{ name:/Procedure Version submitted/ }).click(); await expect(manager).toHaveURL(reviewUrl);
    await manager.getByRole('button',{ name:'Reject',exact:true }).click(); await expect(manager.getByLabel('Rationale')).toBeFocused(); await manager.getByRole('dialog').getByRole('button',{ name:'Reject',exact:true }).click(); await expect(manager.getByText('A rationale is required.')).toBeVisible(); await scan(manager);
    await manager.getByLabel('Rationale').fill('Clarify the saved scope before approval.'); await manager.getByRole('dialog').getByRole('button',{ name:'Reject',exact:true }).click(); await expect(manager.getByText('Rationale: Clarify the saved scope before approval.')).toBeVisible();
    await page.reload(); await save(page,'Edit'); await expect(page).toHaveURL(/\/builder\?version=/); await save(page,'Submit for approval'); await expect(page).toHaveURL(/\/versions\//);
    await manager.goto(reviewUrl);
    await expect(manager.getByRole('region',{name:'Decision history'})).toContainText('Clarify the saved scope before approval.');
    let decisionPosts = 0;
    await manager.route(reviewUrl, async route => { if (route.request().method() !== 'POST') return route.continue(); decisionPosts++; await route.fetch(); await route.abort('failed'); });
    await save(manager,'Approve');
    await expect(manager.getByText('The decision may have been saved. Reload the page before trying again.')).toBeVisible();
    await expect(manager.getByRole('button',{name:'Approve',exact:true})).toBeDisabled();
    await expect(manager.getByRole('button',{name:'Reject',exact:true})).toBeDisabled();
    await manager.getByRole('button',{name:'Reject',exact:true}).press('Enter'); await expect(manager.getByRole('dialog')).toHaveCount(0); expect(decisionPosts).toBe(1);
    await manager.unroute(reviewUrl); await manager.getByRole('button',{name:'Reload version'}).click();
    await expect(manager.getByRole('heading',{ name:'Saved decision' })).toBeVisible(); await expect(manager.getByText('Active', { exact: true })).toBeVisible(); await scan(manager);
    await page.goto('/notifications'); await expect(page.getByRole('link',{ name:/Procedure Version approved/ })).toBeVisible({timeout:10000}); await expect(page.getByRole('link',{name:/Procedure Version submitted/})).toHaveCount(0); await scan(page);
    const frozen = await sql`SELECT state, frozen_review, decisions FROM procedure_version WHERE procedure_id = ${procedureId}`;
    expect(frozen[0]?.frozen_review.definition.modelConfiguration).toEqual({ provider: 'anthropic', modelId: 'synthetic-http-fixture', promptVersion: '1' });
    expect(frozen[0]?.frozen_review.definition.compiledPlan.inputs.scope).toBe('All terminated employees in Finance, reviewed with the worker running.');
    expect(frozen[0]?.state).toBe('ACTIVE'); expect(frozen[0]?.frozen_review.approval.actorId).toBe(managerId); expect(frozen[0]?.decisions.map((d: {decision:string}) => d.decision)).toEqual(['submit','reject','edit','submit','approve']);
  } catch (error) {
    await test.info().attach('synthetic-worker-log', { body: output, contentType: 'text/plain' });
    if (procedureId) {
      const versions = await sql`SELECT version_id, plan_status, plan_failure_reason, plan_input_digest, plan_attempts FROM procedure_version WHERE procedure_id = ${procedureId}`;
      const jobs = await sql`SELECT id,state,started_on,completed_on,output FROM pgboss.job WHERE name = 'procedures' AND data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id = ${procedureId})`;
      await test.info().attach('derivation-state', { body: JSON.stringify({versions,jobs},null,2), contentType: 'application/json' });
    }
    throw error;
  } finally {
    await stopWorker?.(); await managerContext.close();
    if (procedureId) { await sql`DELETE FROM notification WHERE procedure_id = ${procedureId}`; await sql`DELETE FROM pgboss.job WHERE data->>'versionId' IN (SELECT version_id::text FROM procedure_version WHERE procedure_id = ${procedureId})`; await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`; }
    await sql`DELETE FROM auth_user WHERE id = ${managerId}`;
    await sql`DELETE FROM population_source_binding WHERE binding_id = ${sourceId}`; for (const id of [webId,desktopId]) await sql`DELETE FROM target_system_registration WHERE registration_id = ${id}`;
    await sql.end({ timeout: 5 });
  }
});

test('Population, Target and Instruction editors preserve dirty values, reset conflicts and block a lost committed response', async ({ page }) => {
  test.setTimeout(150000); page.setDefaultTimeout(15000);
  const url = process.env['DATABASE_URL']!; assertThrowawayDatabase(url);
  const sql = createSqlClient(url), ids = new CryptoUuidV7Generator(), procedureId = ids.next(), versionId = ids.next(), targetB = ids.next(), targetC = ids.next();
  const other = await page.context().newPage();
  try {
    for (const [id,name] of [[targetB,'Conflict target B'],[targetC,'Conflict target C']] as const) {
      const f = { kind:'web' as const, allowedOrigins:['https://synthetic.invalid'], applicationIdentity:'', credentialRef:'vault://synthetic/readonly', permittedActions:['read-attribute'] as const, attributeLabelPatterns:['Parameter'], secondaryKey:'' };
      await sql`INSERT INTO target_system_registration(registration_id,display_name,kind,allowed_origins,application_identity,credential_ref,permitted_actions,attribute_label_patterns,secondary_key,note,status,digest) VALUES (${id},${name},${f.kind},${f.allowedOrigins},'',${f.credentialRef},${f.permittedActions},${f.attributeLabelPatterns},'','','active',${registrationDigest(f)})`;
    }
    const row: ProcedureVersionRecord = { ...executablePlanInputs(), ...initialPlanDerivation(), procedureId,versionId,versionNumber:1,state:'DRAFT',controlName:`E2E remaining forms ${versionId}` };
    await new PostgresProceduresUnitOfWork(createDb(sql)).execute(async ({ procedures }) => { await procedures.insertProcedure(row); await procedures.insertVersion(row); });
    const builder = `/procedures/${procedureId}/builder`;
    await page.goto(builder); await other.goto(builder);
    // A checkbox round trip proves the freshly loaded second form is hydrated.
    await other.getByLabel('Permit a zero-record Pass').check(); await other.getByLabel('Permit a zero-record Pass').uncheck();
    await page.getByLabel('Permit a zero-record Pass').check(); await other.getByLabel('Permit versioned duplicate primary keys').check(); await save(other,'Save Population Source binding','Save Draft changes');
    await expect(other.getByText('Saved. The Draft change is recorded in the audit chain.')).toBeVisible(); await page.bringToFront();
    await expect(page.getByText('Population Source changed in another session. Review the saved values before replacing them.')).toBeVisible({ timeout:20000 }); await expect(page.getByRole('button',{name:'Submit for approval',exact:true})).toHaveAccessibleDescription(/conflict/);
    await expect(page.getByLabel('Permit a zero-record Pass')).toBeChecked(); await page.getByRole('button',{name:'Use saved Population Source'}).click(); await expect(page.getByLabel('Permit a zero-record Pass')).not.toBeChecked(); await expect(page.getByLabel('Permit versioned duplicate primary keys')).toBeChecked();
    async function lose(label: string, confirmation: string) {
      const address = page.url(); let posts = 0;
      await page.route(address,async route => { if (route.request().method() !== 'POST') return route.continue(); posts++; await route.fetch(); await route.abort('failed'); });
      await save(page,label,confirmation);
      await expect(page.getByRole('paragraph').filter({hasText:'The save response was lost.'})).toBeVisible(); await expect(page.getByRole('button',{name:'Submit for approval',exact:true})).toHaveAccessibleDescription(/unknown save outcome/); await expect(page.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-disabled','true');
      expect(posts).toBe(1); await page.unroute(address); await page.getByRole('button',{name:'Reload saved version'}).click();
    }
    await page.getByLabel('Permit a zero-record Pass').check(); await lose('Save Population Source binding','Save Draft changes'); await expect(page.getByLabel('Permit a zero-record Pass')).toBeChecked();
    await other.reload(); await page.getByRole('button',{name:'Remove ProdConsole',exact:true}).click(); await page.getByLabel('Add a Target System').selectOption(targetB); await page.getByRole('button',{name:'Add Target System',exact:true}).click();
    await other.getByRole('button',{name:'Remove ProdConsole',exact:true}).click(); await other.getByLabel('Add a Target System').selectOption(targetC); await other.getByRole('button',{name:'Add Target System',exact:true}).click(); await save(other,'Save Target Systems');
    await expect(other.getByText('Saved. The Target System selection is recorded in the audit chain.')).toBeVisible(); await page.bringToFront();
    await expect(page.getByText('Target Systems changed in another session. Review the saved values before replacing them.')).toBeVisible({timeout:20000}); await expect(page.getByRole('button',{name:'Submit for approval',exact:true})).toHaveAccessibleDescription(/conflict/); await expect(page.getByRole('button',{name:'Remove Conflict target B',exact:true})).toBeVisible(); await page.getByRole('button',{name:'Use saved Target Systems'}).click(); await expect(page.getByRole('button',{name:'Remove Conflict target C',exact:true})).toBeVisible();
    await page.getByLabel('Add a Target System').selectOption(targetB); await page.getByRole('button',{name:'Add Target System',exact:true}).click(); await lose('Save Target Systems','Save Target Systems'); await expect(page.getByRole('button',{name:'Remove Conflict target B',exact:true})).toBeVisible();
    await other.reload(); const label = 'Audit Instructions for Conflict target C'; await page.getByLabel(label,{exact:true}).fill('Locally edited instructions.'); await other.getByLabel(label,{exact:true}).fill('Saved remote instructions.'); await save(other,'Save Audit Instructions');
    await expect(other.getByText('Saved. The Audit Instructions are recorded in the audit chain.')).toBeVisible(); await page.bringToFront();
    await expect(page.getByText('Audit Instructions changed in another session. Review the saved values before replacing them.')).toBeVisible({timeout:20000}); await expect(page.getByRole('button',{name:'Submit for approval',exact:true})).toHaveAccessibleDescription(/conflict/); await expect(page.getByLabel(label,{exact:true})).toHaveValue('Locally edited instructions.'); await page.getByRole('button',{name:'Use saved Audit Instructions'}).click(); await expect(page.getByLabel(label,{exact:true})).toHaveValue('Saved remote instructions.');
    await page.getByLabel(label,{exact:true}).fill('Committed instruction response was lost.'); await lose('Save Audit Instructions','Save Audit Instructions'); await expect(page.getByLabel(label,{exact:true})).toHaveValue('Committed instruction response was lost.'); await scan(page);
  } finally { await other.close(); await sql`DELETE FROM pgboss.job WHERE data->>'versionId' = ${versionId}`; await sql`DELETE FROM procedure WHERE procedure_id = ${procedureId}`; for (const id of [targetB,targetC]) await sql`DELETE FROM target_system_registration WHERE registration_id = ${id}`; await sql.end({timeout:5}); }
});

test('Submit respects every local editor, confirmation rechecks, pending/unknown saves and notification refresh', async ({page}) => {
  test.setTimeout(90000);
  const url=process.env['DATABASE_URL']!; assertThrowawayDatabase(url);
  const sql=createSqlClient(url), db=createDb(sql), uow=new PostgresProceduresUnitOfWork(db), ids=new CryptoUuidV7Generator();
  const procedureId=ids.next(),versionId=ids.next();
  let release: (()=>void) | undefined;
  try {
    const actor=(await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`)[0]!.id as string;
    const input=executablePlanInputs(), compiled=deriveExecutablePlan(input); if(!compiled.ok) throw new Error(compiled.reason);
    let row:ProcedureVersionRecord={...input,...initialPlanDerivation(),procedureId,versionId,versionNumber:1,state:'DRAFT',authorship:{createdBy:{type:'human',id:actor},responsibleAuthorId:actor,humanAuthorIds:[actor]},compiledPlan:compiled.plan,planStatus:'succeeded',planDerivable:true};
    row={...row,planInputDigest:planAuthoringDigest(row)};
    await uow.execute(async ({procedures})=>{await procedures.insertProcedure(row);await procedures.insertVersion(row);});
    const builder=`/procedures/${procedureId}/builder`; await page.goto(builder);
    const submit=page.getByRole('button',{name:'Submit for approval',exact:true}); await expect(submit).toBeEnabled();
    const edits:[string,()=>Promise<unknown>][]=[
      ['Period and scope',()=>page.getByLabel('Scope statement').fill('Unsaved scope')],
      ['Population Source',()=>page.getByLabel('Permit a zero-record Pass').check()],
      ['Target Systems',()=>page.getByRole('button',{name:'Remove ProdConsole',exact:true}).click()],
      ['Audit Instructions',()=>page.getByLabel('Audit Instructions for ProdConsole',{exact:true}).fill('Unsaved instructions')],
      ['Compliance Rule',()=>page.getByLabel('Agent-Judged confidence threshold',{exact:true}).fill('0.99')],
      ['Evidence Requirements',()=>page.getByRole('button',{name:'Add Evidence Requirement',exact:true}).click()],
      ['Schedule',()=>page.getByLabel('Fixed UTC start time').fill('03:45')],
      ['Control name',()=>page.getByLabel('New Control name').fill('Unsaved Control name')],
    ];
    for(const [name,edit] of edits) {
      await edit(); await expect(submit).toBeDisabled(); await expect(submit).toHaveAccessibleDescription(new RegExp(`unsaved changes in ${name}`));
      await page.getByRole('button',{name:`Use saved ${name}`,exact:true}).click(); await expect(submit).toBeEnabled();
    }
    await submit.click();
    // A status may change after the dialog opens; submission must read it again.
    await page.getByLabel('Scope statement').evaluate(element=>{const input=element as HTMLTextAreaElement;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Changed after confirmation opened');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.getByRole('dialog').getByRole('button',{name:'Submit for approval',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('unsaved changes in Period and scope');
    expect((await sql`SELECT state FROM procedure_version WHERE version_id=${versionId}`)[0]?.state).toBe('DRAFT');
    await page.keyboard.press('Escape'); await page.getByRole('button',{name:'Use saved Period and scope',exact:true}).click();
    let entered!:()=>void; const began=new Promise<void>(resolve=>{entered=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});
    await page.route(page.url(),async route=>{if(route.request().method()!=='POST')return route.continue();entered();await held;await route.fetch();await route.abort('failed');});
    await page.getByLabel('New Control name').fill('Saved name with lost response'); await save(page,'Save Control name'); await began;
    await expect(submit).toBeDisabled(); await expect(submit).toHaveAccessibleDescription(/save to be acknowledged/);
    release!(); await expect(submit).toHaveAccessibleDescription(/unknown save outcome in Control name/);
    await expect(page.getByLabel('New Control name')).toHaveValue('Saved name with lost response');
    await page.unroute(page.url());
    const notification={sendKey:ids.next(),recipientId:actor,procedureId,versionId,procedureName:'A delayed review notice',versionNumber:1,kind:'approved' as const};
    await uow.execute(async ({notifications})=>notifications.enqueue(notification));
    await page.goto('/notifications'); await expect(page.getByText('New notifications may take a moment to appear. Refresh to check.',{exact:true}).first()).toBeVisible();
    await expect(page.getByRole('link',{name:/A delayed review notice/})).toHaveCount(0);
    await new InAppNotificationSender(db).send(notification);
    await page.getByRole('button',{name:'Refresh notifications',exact:true}).click();
    await expect(page.getByRole('link',{name:/A delayed review notice · v1/})).toBeVisible(); await scan(page);
  } finally {release?.();await sql`DELETE FROM notification WHERE procedure_id=${procedureId}`;await sql`DELETE FROM pgboss.job WHERE data->>'versionId'=${versionId}`;await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;await sql.end({timeout:5});}
});
