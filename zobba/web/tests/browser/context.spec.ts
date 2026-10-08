import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration, restoreAndClose } from './cleanup';

// Story 22.3: compaction records, stale sources and the context budget are shown
// in "What Zobba is using" as recorded facts; raw steps remain listed.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const restore = fixtureRestoration(['actor-a'], "UPDATE public.identities SET active=true WHERE id='actor-a'; UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a'; UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a';");
const resetTasks = 'TRUNCATE public.tasks, public.task_counters, public.task_routing_questions CASCADE;';
test.beforeAll(async () => { runtime = await startAuthRuntime(); });
test.beforeEach(async () => { await runtime.stopWorker(); await runtime.sqlAsync(restore(resetTasks)); });
test.afterEach(async ({ page }) => {
  await runtime.stopWorker();
  await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) await restoreAndClose(runtime, restore()); });

async function signIn(page: Page) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}

test('compaction records, stale sources and the budget refusal are recorded facts in What Zobba is using', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.getByLabel('Send to', { exact: true }).selectOption('create');
  await page.getByLabel('Task objective', { exact: true }).fill('Review leaver access');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Review leaver access' })).toBeVisible();
  const [task, cycle] = runtime.sqlValue("SELECT id||'|'||cycle_id FROM public.tasks WHERE objective='Review leaver access'").split('|');
  expect(task).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(cycle).toMatch(/^[A-Za-z0-9_-]+$/);
  // Synthetic recorded facts: three model turns that did not complete, the last
  // one not sent because its owned context exceeded the budget.
  const digest = JSON.stringify({ cycle_id: cycle, first_ordinal: 0, last_ordinal: 1, sequence: 0, task_id: task });
  const sha = createHash('sha256').update(digest).digest('hex');
  const step = (ordinal: number, extra: string, values: string) =>
    `INSERT INTO public.task_steps(organisation_id,client_id,engagement_id,task_id,cycle_id,ordinal,kind,intent_revision,execution_epoch,status,current_work${extra}) VALUES('org-a','client-a','engagement-a','${task}','${cycle}',${ordinal},'model_turn',1,1,'failed','Model turn ${ordinal + 1} did not complete'${values});`;
  await runtime.sqlAsync([
    step(0, ',estimated_input_tokens,actual_input_tokens', ',4100,3990'),
    step(1, ',estimated_input_tokens', ',4200'),
    step(2, ',reason,estimated_input_tokens', ",'context_budget',9100"),
    `INSERT INTO public.task_context_compactions(organisation_id,client_id,engagement_id,task_id,cycle_id,sequence,first_ordinal,last_ordinal,digest,digest_sha256,sources,omissions,estimated_tokens,created_at) VALUES('org-a','client-a','engagement-a','${task}','${cycle}',0,0,1,'${digest}','${sha}','[{"id":"record-withdrawn","revision":1,"status":"withdrawn"}]','{"stale_sources":1,"steps_compacted":2}',4200,1767225600);`,
  ].join('\n'));
  await page.getByRole('button', { name: 'Open Review leaver access', exact: true }).click();
  const using = page.getByRole('region', { name: 'What Zobba is using', exact: true });
  const context = using.getByRole('region', { name: 'Context of recent turns' });
  await expect(context).toContainText('The latest turn was not sent');
  await expect(context).toContainText('estimated 9100 input tokens');
  await expect(context).toContainText('Steps 1–2 compacted · record 1 · made 2026-01-01 00:00:00 UTC');
  await expect(context.locator('time')).toHaveAttribute('datetime', '2026-01-01T00:00:00.000Z');
  await expect(context).toContainText('revision 1 · withdrawn · stale');
  await expect(context).toContainText('Steps represented only by a fact digest: 2');
  await expect(context).toContainText('Stale knowledge revisions: 1');
  await expect(context).toContainText('is not evidence');
  // The compacted raw steps stay reachable under Current work.
  const work = page.getByRole('region', { name: 'Task details' }).locator('.task-work');
  await work.getByText(/Recorded steps \(3\)/).click();
  await expect(work.locator('.work-steps li')).toHaveCount(3);
  await expect(work.locator('.work-steps li').nth(2)).toContainText('not sent: context budget');
  // The API returns no digest body or model text, only identities and counts.
  const response = await page.request.get(`${runtime.url}/api/engagements/engagement-a/tasks/${task}/work?${scope}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.compactions).toEqual([{ sequence: 0, first_ordinal: 0, last_ordinal: 1, digest_sha256: sha, sources: [{ id: 'record-withdrawn', revision: '1', status: 'withdrawn' }], omissions: [{ category: 'steps_compacted', count: 2 }, { category: 'stale_sources', count: 1 }], estimated_tokens: '4200', created_at: '1767225600' }]);
  expect(body.steps[0].actual_input_tokens).toBe('3990');
  expect(body.steps[2].reason).toBe('context_budget');
  expect(errors).toEqual([]);
});
