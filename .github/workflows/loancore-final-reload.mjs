import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createSqlClient } from '@intellifin/infrastructure';

assert.equal(process.env.CONFIRM_DEPLOYED_AUDIT, 'synthetic-loancore');
assert(process.env.DATABASE_URL && process.env.GITHUB_RUN_ID);
const BASE='https://web-production-edded.up.railway.app';
const RUN='01a0b44d-b1d2-7596-87e3-7d6dba84e091';
const NEGATIVE='01a0b452-3b49-71c8-846d-8aac3cc45884';
const OUT='final-reload-evidence';mkdirSync(OUT,{recursive:true});
const email=`final-reload-auditor-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}@example.test`;
const password=`Acceptance-${randomBytes(32).toString('hex')}`;
console.log(`::add-mask::${password}`);
const sql=createSqlClient(process.env.DATABASE_URL,{max:2});
const report={releasedApplicationSha:'44fb5966dd085f53625d5f9ac77a466a9c18805f',workflowRunId:process.env.GITHUB_RUN_ID,workflowSha:process.env.GITHUB_SHA,runId:RUN,negativeRunId:NEGATIVE,viewport:{width:1440,height:1000},startedAt:new Date().toISOString(),checks:{},consoleErrors:[],consoleWarnings:[],pageErrors:[],pages:[],newAuditRunsStarted:0};
function safe(text){for(const secret of [password,process.env.DATABASE_URL])assert(!text.includes(secret),'Secret containment failure');return text;}
let browser;
async function capture(page,name){
 const text=safe(await page.locator('body').innerText());
 safe(await page.content());
 assert(text.length>100 && !/Application error:|A client-side exception has occurred|Internal Server Error/.test(text),'Empty or broken application');
 const title=await page.title();assert(title.trim());
 report.pages.push({name,url:page.url(),title,bodyLength:text.length});
 writeFileSync(`${OUT}/${name}.txt`,text);
 await page.screenshot({path:`${OUT}/${name}.png`,fullPage:false,mask:[page.locator('input[type=password]')]});
 return text;
}
try {
 execFileSync(process.execPath,['scripts/seed-identity.mts','--email',email,'--name','Final Read-only QA Auditor','--role','auditor','--create-only','true'],{env:{...process.env,SEED_PASSWORD:password,BETTER_AUTH_SECRET:randomBytes(32).toString('hex'),BETTER_AUTH_URL:'https://seed.invalid'},stdio:'pipe',timeout:60000});
 const users=await sql`SELECT id FROM auth_user WHERE email=${email}`;assert.equal(users.length,1);
 report.temporaryUserId=users[0].id;
 const before=await sql`SELECT run_id,state FROM audit_run WHERE run_id IN (${RUN}::uuid,${NEGATIVE}::uuid) ORDER BY run_id`;
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:report.viewport});const page=await context.newPage();
 page.on('pageerror',error=>report.pageErrors.push(safe(String(error.message)).slice(0,1500)));
 page.on('console',message=>{
  if(['error','warning'].includes(message.type()))(message.type()==='error'?report.consoleErrors:report.consoleWarnings).push(safe(message.text()).slice(0,1500));
 });
 await page.goto(BASE+'/sign-in',{waitUntil:'domcontentloaded'});
 await expect(page.locator('[data-signin-ready]')).toHaveAttribute('data-signin-ready','true');
 await page.locator('input[type=email]').fill(email);await page.locator('input[type=password]').fill(password);
 await page.getByRole('button',{name:/sign in/i}).click();
 await page.waitForURL(url=>url.origin===BASE&&!/sign-in|login/.test(url.pathname),{timeout:40000});
 await page.goto(`${BASE}/runs/${RUN}`,{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'Conclusion',exact:true})).toBeVisible();
 await page.reload({waitUntil:'domcontentloaded'});
 const conclusion=page.getByRole('heading',{name:'Conclusion',exact:true});await expect(conclusion).toBeVisible();
 await conclusion.scrollIntoViewIfNeeded();
 const sealedText=await capture(page,'01-sealed-result-reloaded');
 assert(sealedText.includes('Control Failure')&&sealedText.includes('Result version 2')&&sealedText.includes('Sealed'));
 // Count review cards, not the vocabulary legend elsewhere on the Run page.
 const review=page.getByRole('region',{name:'Evaluation review',exact:true});
 await expect(review.locator(':scope > ul > li.ls-evaluation')).toHaveCount(3);
 await expect(review.getByText('Agent-Judged (confirmed)',{exact:true})).toHaveCount(3);
 report.reviewCardsConfirmed=3;
 report.checks.sealedResultSurvivesReload=true;
 report.checks.threeConfirmationsRendered=true;
 report.checks.noStaleQueuedCopyAfterReload=!sealedText.includes('Review queued.');
 await page.goto(`${BASE}/runs/${RUN}/replay`,{waitUntil:'domcontentloaded'});
 const pills=page.locator('.ls-session__scrubber button');await expect(pills).toHaveCount(15);
 const frame=page.locator('img.ls-session__frame');
 for(const index of [3,8,13]){
  await pills.nth(index).click();await expect.poll(()=>frame.evaluate(img=>img.complete&&img.naturalWidth>200),{timeout:30000}).toBe(true);
  const src=await frame.getAttribute('src');assert(src.startsWith(`/api/runs/${RUN}/frames/`));
  await frame.scrollIntoViewIfNeeded();await expect(frame).toBeInViewport({ratio:.9});
  await capture(page,`02-replay-record-${index}`);
 }
 report.checks.replaySelectionAfterFreshLogin=true;
 await page.goto(`${BASE}/runs/${NEGATIVE}`,{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'Conclusion',exact:true})).toBeVisible();
 const negativeText=await capture(page,'03-negative-result-reloaded');
 assert(negativeText.includes('Inconclusive')&&negativeText.includes('No conclusion issued')&&negativeText.includes('27 records'));
 report.checks.negativeOutcomeSurvivesReload=true;
 const after=await sql`SELECT run_id,state FROM audit_run WHERE run_id IN (${RUN}::uuid,${NEGATIVE}::uuid) ORDER BY run_id`;
 assert.deepEqual(after,before);report.checks.runStatesUnchanged=true;
 assert.equal(report.pageErrors.length,0);assert.equal(report.consoleErrors.length,0);assert.equal(report.consoleWarnings.length,0);
 report.checks.browserConsoleCleanOnExercisedRoutes=true;
 assert(Object.values(report.checks).every(value=>value===true));
 report.passed=true;
} catch(error){report.passed=false;report.failure={name:error.name,message:safe(String(error.message)).slice(0,2500)};process.exitCode=1;}
finally {
 await browser?.close().catch(()=>{});
 try {
  const users=await sql`SELECT id FROM auth_user WHERE email=${email}`;
  assert.equal(users.length,1,'Expected exact temporary QA identity');
  await sql.begin(async tx=>{await tx`DELETE FROM auth_session WHERE user_id=${users[0].id}`;await tx`DELETE FROM user_role WHERE user_id=${users[0].id}`;});
  const [counts]=await sql`SELECT (SELECT count(*)::int FROM auth_session WHERE user_id=${users[0].id}) AS sessions,(SELECT count(*)::int FROM user_role WHERE user_id=${users[0].id}) AS roles`;
  assert.equal(counts.sessions,0);assert.equal(counts.roles,0);report.cleanup={userId:users[0].id,...counts,verified:true};
 } catch(error){report.cleanup={verified:false,error:error.name};report.passed=false;process.exitCode=1;}
 report.finishedAt=new Date().toISOString();
 writeFileSync(`${OUT}/report.json`,safe(JSON.stringify(report,null,2)));
 console.log(JSON.stringify({passed:report.passed,checks:report.checks,cleanup:report.cleanup,failure:report.failure}));
 await sql.end({timeout:5}).catch(()=>{});
}
