/** Grounded synthetic review: UI reads evidence cells, then records supported decisions. */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createSqlClient, createDb, findUserIdByEmail, DrizzleRunRepository, DrizzleProcedureRepository } from '@intellifin/infrastructure';
const APP='https://web-production-edded.up.railway.app';
const RUN=process.env.ACCEPTANCE_RUN_ID;
const OUT='live-review-evidence'; mkdirSync(OUT,{recursive:true});
const expected=new Map([['E-000102',{status:'Disabled',roles:['LOAN_VIEWER'],c1:'COMPLIANT'}],['E-000103',{status:'Active',roles:['LOAN_OFFICER'],c1:'EXCEPTION'}],['E-000105',{status:'Disabled',roles:['COLLECTIONS_AGENT'],c1:'COMPLIANT'}]]);
const report={startedAt:new Date().toISOString(),runId:RUN,events:[],cellReads:[],decisions:[],failures:[]};
let sql,browser,page,userId,phase='preflight',password='Review-'+randomBytes(32).toString('hex'),n=0;
const tag=process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
const email=`acceptance-evidence-review-${tag}@example.test`;
const name='Evidence Verification Manager';
const handles=new Set();
const safe=s=>{let r=String(s).replaceAll(password,'[credential omitted]');for(const h of handles)r=r.replaceAll(h,'[provider handle omitted]');return r.replace(/[A-Za-z0-9_+=./-]{160,}/g,'[opaque value omitted]');};
const save=()=>writeFileSync(OUT+'/report.json',safe(JSON.stringify(report,null,2)));
const emit=(event,data={})=>{report.events.push({at:new Date().toISOString(),event,...data});console.log('GROUNDED_REVIEW '+safe(JSON.stringify(report.events.at(-1))));save();};
class Refused extends Error {constructor(code){super(code);this.code=code;}}
const requireFact=(truth,code)=>{if(!truth)throw new Refused(code);};
async function capture(label){if(!page||page.isClosed()||new URL(page.url()).pathname==='/sign-in')return;const stem=String(++n).padStart(2,'0')+'-'+label;writeFileSync(`${OUT}/${stem}.txt`,safe(await page.locator('body').innerText()));await page.screenshot({path:`${OUT}/${stem}.png`,fullPage:false,mask:[page.locator('input[type="password"]')]});}
async function noHandle(){const html=await page.content();for(const h of handles)requireFact(!html.includes(h),'provider-handle-exposed');}
async function inspectCell(observation,attribute){
  requireFact(attribute&&attribute.grounding&&attribute.corroboration==='matched','attribute-not-grounded');
  const g=attribute.grounding;
  const url=APP+`/runs/${RUN}/evidence/${encodeURIComponent(g.evidenceId)}?locator=${encodeURIComponent(g.locator)}`;
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const section=page.locator('section').filter({has:page.getByRole('heading',{name:'Stored Structural Snapshot',exact:true})});
  await expect(section).toBeVisible();
  await expect(section.getByText('Snapshot cell unavailable',{exact:true})).toHaveCount(0);
  const field=section.locator('.ls-untrusted').filter({hasText:`${attribute.name}, as read at the stored snapshot locator`}).locator('pre');
  await expect(field).toHaveCount(1);
  const value=JSON.parse(await field.innerText());
  requireFact(JSON.stringify(value)===JSON.stringify(attribute.originalValue),'snapshot-cell-differs-from-observation');
  report.cellReads.push({key:observation.population_record_key,attribute:attribute.name,value,evidenceId:g.evidenceId,locator:g.locator,checkedAt:new Date().toISOString()});
  await noHandle();await capture(observation.population_record_key+'-'+attribute.name);save();
}
try{
  requireFact(/^[0-9a-f-]{36}$/.test(RUN??''),'missing-approved-test-run');
  requireFact(process.env.DATABASE_URL,'database-unavailable');
  sql=createSqlClient(process.env.DATABASE_URL,{max:2});const db=createDb(sql);
  const run=await new DrizzleRunRepository(db).findRun(RUN);
  requireFact(run?.procedureName.startsWith('Leaver Access — Live Acceptance — ')&&run.state==='COMPLETED','not-completed-acceptance-case');
  const version=await new DrizzleProcedureRepository(db).findVersion(run.versionId);
  const contract=version?.compiledPlan?.inputs;
  requireFact(contract?.targets.length===1&&contract.targets[0].contract.allowed_origins.includes('https://northstar-production-b312.up.railway.app/loancore'),'unexpected-test-target');
  const rows=await sql`SELECT observation_id,population_record_key,found,identity,attributes,evidence_ids,digest FROM run_observation WHERE run_id=${RUN}::uuid ORDER BY population_record_key`;
  const proposals=await sql`SELECT observation_id,condition_id,value,origin,confirmation,evidence_ids,agent_proposed_value FROM run_observation_evaluation WHERE run_id=${RUN}::uuid ORDER BY observation_id,condition_id`;
  const [result]=await sql`SELECT outcome,sealed,gate_passed FROM run_result WHERE run_id=${RUN}::uuid`;
  requireFact(result?.outcome==='PENDING_CONFIRMATION'&&!result.sealed&&result.gate_passed,'result-not-reviewable');
  requireFact(rows.length===3&&new Set(rows.map(x=>x.population_record_key)).size===3,'unexpected-observation-set');
  requireFact(proposals.length===6,'unexpected-evaluation-count');
  for(const o of rows){
    const wanted=expected.get(o.population_record_key);requireFact(wanted&&o.found==='true','unexpected-or-absent-record');
    const status=o.attributes.find(x=>x.name==='status');const roles=o.attributes.find(x=>x.name==='roles');
    requireFact(status?.normalizedValue===wanted.status&&JSON.stringify(roles?.normalizedValue)===JSON.stringify(wanted.roles),'captured-values-differ-from-independent-test-expectation');
    const c1=proposals.find(x=>x.observation_id===o.observation_id&&x.condition_id==='C1');
    const c2=proposals.find(x=>x.observation_id===o.observation_id&&x.condition_id==='C2');
    requireFact(c1?.origin==='RULE'&&c1.value===wanted.c1,'deterministic-evaluation-incorrect');
    requireFact(c2?.origin==='AGENT_JUDGED'&&c2.value==='COMPLIANT'&&c2.confirmation==='pending'&&c2.evidence_ids.length>0,'unsupported-privilege-proposal');
  }
  report.originalResult=result;report.originalProposals=proposals;report.observationDigests=rows.map(o=>({key:o.population_record_key,digest:o.digest}));
  const workspace=(await sql`SELECT workspace_id,status FROM run_workspace WHERE run_id=${RUN}::uuid`)[0];
  requireFact(workspace?.status==='RELEASED','workspace-not-released');if(workspace.workspace_id)handles.add(workspace.workspace_id);
  phase='create-separate-test-reviewer';console.log('::add-mask::'+password);
  execFileSync(process.execPath,['scripts/seed-identity.mts','--email',email,'--name',name,'--role','audit-manager','--create-only','true'],{env:{...process.env,SEED_PASSWORD:password,BETTER_AUTH_SECRET:randomBytes(32).toString('hex'),BETTER_AUTH_URL:'https://seed.invalid'},stdio:'pipe'});
  userId=await findUserIdByEmail(db,email);requireFact(userId,'reviewer-not-created');
  browser=await chromium.launch({headless:true,env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!/secret|password|token|api.?key|database/i.test(k)))});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(30000);
  phase='reviewer-sign-in';await page.goto(APP+'/sign-in',{waitUntil:'domcontentloaded'});await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>u.pathname!=='/sign-in');await expect(page.getByText(name,{exact:false}).first()).toBeVisible();
  for(const observation of rows){
    phase='inspect-snapshot-cells-'+observation.population_record_key;
    await inspectCell(observation,observation.identity);
    await inspectCell(observation,observation.attributes.find(a=>a.name==='status'));
    await inspectCell(observation,observation.attributes.find(a=>a.name==='roles'));
    phase='confirm-supported-proposal-'+observation.population_record_key;
    await page.goto(APP+`/runs/${RUN}/review`,{waitUntil:'domcontentloaded'});
    const card=page.locator('li.ls-evaluation').filter({hasText:observation.observation_id+' / C2'});
    await expect(card).toHaveCount(1);await expect(card.getByRole('button',{name:'Confirm evaluation',exact:true})).toBeVisible();
    await capture('review-'+observation.population_record_key);
    await card.getByRole('button',{name:'Confirm evaluation',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Confirm this evaluation?',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Confirm evaluation',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect.poll(async()=>{const [decision]=await sql`SELECT action,actor_id,effective_value,effective_confirmation FROM run_evaluation_review WHERE run_id=${RUN}::uuid AND observation_id=${observation.observation_id}::uuid AND condition_id='C2'`;return decision??null;},{timeout:60000,intervals:[1000]}).toEqual({action:'confirm',actor_id:userId,effective_value:'COMPLIANT',effective_confirmation:'confirmed'});
    report.decisions.push({key:observation.population_record_key,condition:'C2',decision:'confirmed',groundedCellReads:true});emit('grounded-decision-recorded',{key:observation.population_record_key});
  }
  phase='verify-final-sealed-result';
  await expect.poll(async()=>{const [r]=await sql`SELECT outcome,sealed,gate_passed FROM run_result WHERE run_id=${RUN}::uuid`;return r;},{timeout:60000,intervals:[1000]}).toEqual({outcome:'CONTROL_FAILURE',sealed:true,gate_passed:true});
  report.finalResult=(await sql`SELECT outcome,sealed,gate_passed FROM run_result WHERE run_id=${RUN}::uuid`)[0];
  report.exceptions=await sql`SELECT population_record_key,condition_ids FROM run_exception WHERE run_id=${RUN}::uuid`;
  requireFact(report.exceptions.length===1&&report.exceptions[0].population_record_key==='E-000103'&&JSON.stringify(report.exceptions[0].condition_ids)===JSON.stringify(['C1']),'final-exceptions-differ-from-expectation');
  await page.goto(APP+`/runs/${RUN}`,{waitUntil:'domcontentloaded'});await expect(page.getByText('Control Failure',{exact:true}).first()).toBeVisible();await noHandle();await capture('sealed-control-failure');
  await page.getByRole('link',{name:'Evidence',exact:true}).click();await capture('evidence-after-review');
  await page.getByRole('link',{name:'Replay',exact:true}).click();const frame=page.locator('.ls-session__frame');await expect(frame).toBeVisible();await expect.poll(()=>frame.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);const first=await frame.getAttribute('src');await page.getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>frame.getAttribute('src'),{timeout:15000}).not.toBe(first);await capture('replay-after-seal');
  report.accepted=true;emit('grounded-review-and-sealed-result-accepted');
}catch(error){report.failures.push({phase,kind:error?.name??'Error',code:error instanceof Refused?error.code:'interaction-or-runtime-failure'});emit('review-verification-failed',report.failures.at(-1));await capture('failure').catch(()=>{});process.exitCode=1;
}finally{await browser?.close().catch(()=>{});if(sql){try{if(userId){await sql`DELETE FROM auth_session WHERE user_id=${userId}`;await sql`DELETE FROM user_role WHERE user_id=${userId} AND role='audit-manager'`;report.temporaryAccessRemoved=true;}}finally{await sql.end({timeout:5}).catch(()=>{});}}report.finishedAt=new Date().toISOString();save();console.log('GROUNDED_REVIEW_REPORT '+safe(JSON.stringify(report)));}
