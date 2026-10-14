import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import type { Evidence } from '../../src/evidence';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { fixtureRestoration } from './cleanup';

// Story 22.5 citation presentation. The verification itself (real documents,
// sandbox, database and API) is proved by the worker suite
// `crates/worker/tests/citations.rs`; producing a real cited answer here would
// need a qualified model, which this harness deliberately never composes. The
// answers read is therefore fulfilled with a synthetic response that names an
// original really registered through the UI, so Open exercises the actual
// evidence viewer, its current-access checks and the exact original.
test.use({ ignoreHTTPSErrors: true });
let runtime: AuthRuntime;
const scope = 'organisation_id=org-a&client_id=client-a';
const restore = fixtureRestoration(['actor-a'], `UPDATE public.identities SET active=true WHERE id='actor-a';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a' AND organisation_id='org-a';`);
test.beforeAll(async () => { runtime = await startAuthRuntime({ evidence: true }); });
test.beforeEach(async () => runtime.sqlAsync(restore('TRUNCATE public.evidence_reservations,public.tasks,public.task_counters CASCADE;')));
test.afterEach(async ({ context }) => {
  await runtime.sqlAsync(restore());
  for (const page of context.pages()) await page.getByLabel('Password', { exact: true }).fill('', { timeout: 100 }).catch(() => {});
});
test.afterAll(async () => { if (runtime) { try { await runtime.sqlAsync(restore()); } finally { await runtime.close(); } } });

async function capture(page: Page, info: TestInfo, filename: string) {
  const path = info.outputPath(filename);
  await page.screenshot({ path, fullPage: true });
  await info.attach(filename, { path, contentType: 'image/png' });
}
async function signIn(page: Page) {
  await page.goto(runtime.url);
  await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
  await page.getByLabel('Password', { exact: true }).fill(runtime.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /FY2026 audit/ }).click();
  await expect(page.getByText('Conversation up to date', { exact: true })).toBeVisible();
}
const notes = { name: 'Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Opening balance 1,250.00 agreed to the ledger.\n') };

test('a citation chip shows its sources on focus and hover, dismisses with Escape and opens the cited location', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await page.getByLabel('Original file (up to 10 MiB)', { exact: true }).setInputFiles(notes);
  await page.getByRole('button', { name: 'Acquire and verify original', exact: true }).click();
  await expect(page.getByText('Original verified and registered.', { exact: true })).toBeVisible();
  const listed = await page.request.get(`${runtime.url}/api/engagements/engagement-a/evidence?${scope}`);
  const evidence = (await listed.json()).items.find((item: Evidence) => item.reservation.request.filename === notes.name) as Evidence;
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();

  await page.getByLabel('Send to', { exact: true }).selectOption('create');
  await page.getByLabel('Task objective', { exact: true }).fill('Agree the opening balance');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  await expect(page.locator('.task-card h3').filter({ hasText: 'Agree the opening balance' })).toBeVisible();

  const verified = {
    original_id: evidence.reservation.id, readable: true, filename: 'Notes.txt', version: evidence.version, sha256: evidence.reservation.request.identity.sha256,
    locator: 'bytes:16-24', location: 'bytes 16–24', byte_start: 16, byte_end: 24, quote: '1,250.00', verification: 'verified', reason: null,
  };
  const pageOnly = {
    original_id: 'scan', readable: true, filename: 'Scanned letter.pdf', version: 'v1', sha256: 'b'.repeat(64),
    locator: 'page:3', location: 'page 3', byte_start: null, byte_end: null, quote: 'Signed by A. Auditor', verification: 'unverified', reason: 'page_only',
  };
  const hidden = {
    original_id: 'restricted', readable: false, filename: null, version: null, sha256: null,
    locator: null, location: null, byte_start: null, byte_end: null, quote: null, verification: 'unverified', reason: 'source_unreadable',
  };
  const answer = {
    invocation_id: 'invocation-a', text: 'The opening balance is 1,250.00. It was signed off.',
    segments: [{ text: 'The opening balance is 1,250.00.', sources: [verified, pageOnly, hidden] }, { text: ' It was signed off.', sources: [] }],
    limitations: ['Page 9 of the contract does not exist.'],
    verification_failed: false,
  };
  // One malformed answer beside it is skipped with a notice, never blanking the rest.
  const malformed = { ...answer, invocation_id: 'invocation-b', text: 'Edited after verification.' };
  await page.route('**/api/engagements/engagement-a/tasks/*/answers?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answers: [answer, malformed] }) }));
  await page.getByRole('button', { name: 'Open Agree the opening balance', exact: true }).click();
  const answers = page.getByRole('region', { name: 'Answers', exact: true });
  // The answer is shown as written, with the chip after its cited span.
  const text = answers.locator('.cited-answer > p');
  await expect(text).toContainText('The opening balance is 1,250.00.');
  await expect(text).toContainText('It was signed off.');
  await expect(answers).toContainText('Page 9 of the contract does not exist.');
  await expect(page.getByText('1 answer could not be shown because the response for it was not valid.', { exact: true })).toBeVisible();
  await expect(answers.locator('.cited-answer')).toHaveCount(1);

  // The chip: short filename and +N for the further sources.
  const chip = answers.getByRole('button', { name: /^Citation: Notes\.txt, Scanned letter\.pdf, a source you cannot open$/ });
  await expect(chip).toContainText('Notes.txt');
  await expect(chip).toContainText('+2');
  const card = answers.getByRole('group', { name: 'Citation sources', exact: true });
  await expect(card).toBeHidden();

  // Keyboard focus shows the card; Escape dismisses it and keeps focus.
  await chip.focus();
  await expect(card).toBeVisible();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toContainText('bytes 16–24');
  await expect(card).toContainText('1,250.00');
  await expect(card).toContainText('Unverified · Only the page was confirmed; the page was read as an image.');
  await expect(card).toContainText('A source you cannot open');
  // A verified source has no badge; an unreadable one shows no quote.
  await expect(card.locator('.citation-unverified')).toHaveCount(2);
  // The card is placed against its own chip, just below it.
  const chipBox = (await chip.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.y).toBeGreaterThanOrEqual(chipBox.y + chipBox.height - 1);
  expect(cardBox.y).toBeLessThan(chipBox.y + chipBox.height + 16);
  expect(Math.abs(cardBox.x - chipBox.x)).toBeLessThan(2);
  await capture(page, info, 'citation-card.png');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(chip).toBeFocused();

  // Hover shows the card and it stays while the pointer moves onto it.
  await page.mouse.move(0, 0);
  await chip.hover();
  await expect(card).toBeVisible();
  await card.hover();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  // A card shown by hover while focus is elsewhere is dismissed by Escape,
  // but focus is not taken to the chip.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await chip.hover();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(chip).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  // Open: the evidence viewer opens the exact original at the cited bytes.
  // Enter on the focused chip shows the card again; Tab reaches Open.
  await chip.focus();
  await chip.press('Enter');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Open at bytes 16–24', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Original source details', exact: true });
  await expect(inspector.getByRole('heading', { name: 'Notes.txt' })).toBeVisible();
  await expect(inspector).toContainText('Cited location · bytes 16–24');
  await expect(inspector.locator('mark.cited-range')).toHaveText('1,250.00');
  await capture(page, info, 'citation-open.png');
  // The unreadable source offers no Open at all.
  await expect(card.getByRole('button', { name: 'Open at page 1', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
