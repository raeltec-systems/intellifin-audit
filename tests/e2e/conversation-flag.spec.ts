import { expect,test,type Page } from '@playwright/test';
import { createRunWorkspaceBrowserFixture,type RunWorkspaceBrowserFixture } from '../fixtures/run-workspace-browser';
import { ACCOUNTS,AUTH_STATE } from './accounts';
let fixture:RunWorkspaceBrowserFixture;
const path=()=>`/runs/${fixture.runId}/workspace`;
async function propose(page:Page,text='flag: Please inspect this discrepancy.') {
  await page.goto(path());await expect(page.getByLabel('Message the Run',{exact:true})).toBeEditable();
  await page.getByLabel('Message the Run',{exact:true}).fill(text);
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByRole('button',{name:'Review flag',exact:true})).toBeVisible();
  const [command]=await fixture.sql`SELECT command_id FROM run_interaction_command WHERE run_id=${fixture.runId} AND kind='flag' ORDER BY created_at DESC LIMIT 1`;
  if(!command)throw new Error('Flag proposal missing');return String(command.command_id);
}
async function review(page:Page) {
  await page.getByRole('button',{name:'Review flag',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Request manager attention?',exact:true});
  await expect(dialog).toContainText('Work continues without pausing');return dialog;
}
test.describe('conversational manager attention',()=>{
 test.use({storageState:AUTH_STATE.auditor});
 test.beforeEach(async()=>{test.setTimeout(120_000);fixture=await createRunWorkspaceBrowserFixture();});
 test.afterEach(async()=>{await fixture?.restoreAuditor();await fixture?.cleanup();});
 test('confirms an attributed flag without a controller lease, preserving the open question and note-free notifications',async({page})=>{
   await propose(page,'flag: Synthetic discrepancy <script>not executed</script>.');
   expect(await fixture.sql`SELECT run_id FROM run_control_lease WHERE run_id=${fixture.runId}`).toHaveLength(0);
   expect(await fixture.sql`SELECT flag_id FROM run_flag WHERE run_id=${fixture.runId}`).toHaveLength(0);
   const dialog=await review(page);await expect(dialog).toContainText('Synthetic discrepancy <script>not executed</script>.');
   await dialog.getByRole('button',{name:'Confirm flag',exact:true}).click();
   await expect(page.getByLabel('Conversation history')).toContainText('Flag request: applied.');
   const [flag]=await fixture.sql`SELECT flag_id,note,flagged_by FROM run_flag WHERE run_id=${fixture.runId}`;
   expect(flag).toMatchObject({flagged_by:fixture.auditorId,note:'Synthetic discrepancy <script>not executed</script>.'});
   const recipients=await fixture.sql`SELECT user_id id FROM user_role WHERE role='audit-manager' UNION SELECT initiator_id FROM audit_run WHERE run_id=${fixture.runId}`;
   const notices=await fixture.sql`SELECT recipient_id,to_jsonb(n) payload FROM notification n WHERE flag_id=${flag!.flag_id}`;
   expect(notices.map(n=>n.recipient_id).sort()).toEqual(recipients.map(r=>r.id).sort());expect(JSON.stringify(notices)).not.toContain('Synthetic discrepancy');
   expect(await fixture.sql`SELECT closed_at FROM run_wait WHERE wait_id=${fixture.waitId}`).toEqual([{closed_at:null}]);
   expect(await fixture.sql`SELECT state,cancel_requested_at,pause_requested_at FROM audit_run WHERE run_id=${fixture.runId}`).toEqual([{state:'AWAITING_AUDITOR',cancel_requested_at:null,pause_requested_at:null}]);
 });
 test('recovers the exact lost confirmation without creating another flag or notification',async({page})=>{
   const commandId=await propose(page),dialog=await review(page);let lost=false,retried=false,replayed=false;
   const requests:Record<string,unknown>[]= [];let release!:()=>void;const held=new Promise<void>(r=>release=r);
   await page.route(`**${path()}*`,async route=>{
     const request=route.request();if(lost&&!retried&&request.method()==='GET')await held;
     if(request.method()==='POST'&&request.headers()['next-action']) {
       const args=JSON.parse(request.postData()??'[]') as Record<string,unknown>[];
       if(args[0]?.commandId===commandId) {
         requests.push(args[0]);
         if(!lost){lost=true;await route.fetch();await route.abort('failed');return;}
         retried=true;const response=await route.fetch();replayed=(await response.text()).includes('"replayed":true');await route.fulfill({response});release();return;
       }
     }
     await route.continue();
   });
   try {
     await dialog.getByRole('button',{name:'Confirm flag',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Retry this same confirmation');
     const notices=await fixture.sql`SELECT send_key FROM notification WHERE run_id=${fixture.runId} AND kind='flag' ORDER BY send_key`;
     await dialog.getByRole('button',{name:'Confirm flag',exact:true}).click();await expect.poll(()=>replayed).toBe(true);
     expect(requests).toEqual([{runId:fixture.runId,commandId},{runId:fixture.runId,commandId}]);
     expect(await fixture.sql`SELECT flag_id FROM run_flag WHERE run_id=${fixture.runId}`).toHaveLength(1);
     expect(await fixture.sql`SELECT send_key FROM notification WHERE run_id=${fixture.runId} AND kind='flag' ORDER BY send_key`).toEqual(notices);
   } finally {release();}
   await page.reload();await expect(page.getByLabel('Conversation history')).toContainText('Flag request: applied.');
 });
 test('a different eligible signed-in account cannot confirm an already opened proposal',async({page,browser})=>{
   await propose(page);const dialog=await review(page);
   const [administrator]=await fixture.sql`SELECT u.id,r.role FROM auth_user u JOIN user_role r ON r.user_id=u.id WHERE u.email=${ACCOUNTS.administrator.email}`;
   if(!administrator)throw new Error('Administrator fixture missing');
   const second=await browser.newContext({storageState:AUTH_STATE.administrator});
   try {
     await fixture.sql`UPDATE user_role SET role='auditor' WHERE user_id=${administrator.id}`;
     await page.context().clearCookies();await page.context().addCookies(await second.cookies());
     const response=page.waitForResponse(r=>r.request().method()==='POST' && Boolean(r.request().headers()['next-action']));
     await dialog.getByRole('button',{name:'Confirm flag',exact:true}).click();
     expect(await (await response).text()).toContain('Only the auditor who proposed this flag');
     expect(await fixture.sql`SELECT flag_id FROM run_flag WHERE run_id=${fixture.runId}`).toHaveLength(0);
     await page.reload();await expect(page.getByRole('button',{name:'Review flag',exact:true})).toHaveCount(0);
     await expect(page.getByLabel('Conversation history')).toContainText('Only the auditor who proposed this flag');
   } finally {await fixture.sql`UPDATE user_role SET role=${administrator.role} WHERE user_id=${administrator.id}`;await second.close();}
 });
 test('fresh revocation refuses an opened flag review with no flag or notification',async({page})=>{
   await propose(page);const dialog=await review(page);await fixture.revokeAuditor();
   await dialog.getByRole('button',{name:'Confirm flag',exact:true}).click();
   await expect.poll(async()=>Number((await fixture.sql`SELECT count(*)::int n FROM audit_events WHERE actor_id=${fixture.auditorId} AND outcome='denied'`)[0]?.n)).toBeGreaterThan(0);
   expect(await fixture.sql`SELECT flag_id FROM run_flag WHERE run_id=${fixture.runId}`).toHaveLength(0);
   expect(await fixture.sql`SELECT send_key FROM notification WHERE run_id=${fixture.runId} AND kind='flag'`).toHaveLength(0);
 });
});
