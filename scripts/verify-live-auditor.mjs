/** One explicitly authorized live UI rerun. Never changes a procedure or existing account. */
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import {
  createSqlClient, createDb, findUserIdByEmail, DrizzleRunRepository,
  DrizzleProcedureRepository, DrizzleRunDetailRepository, DrizzleRunStopReader,
  PostgresPopulationRepository,
} from '@intellifin/infrastructure';

const base = 'https://web-production-edded.up.railway.app';
const predecessor = '01a0ac83-dbe9-7612-ab2c-e5635af1c123';
const out = 'live-auditor-evidence';
mkdirSync(out, { recursive: true });
const password = `Live-${randomBytes(32).toString('hex')}`;
console.log(`::add-mask::${password}`);
const email = `live-verify-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}@example.test`;
const report = { startedAt: new Date().toISOString(), app: base, sourceCommit: '1e7dd7f742dd8bcf288146ba15389d99e4a237a1', predecessor, runId: null, account: email, observations: [], images: [], failures: [] };
const emit = (event, facts = {}) => { const entry = { at: new Date().toISOString(), event, ...facts }; report.observations.push(entry); console.log(`LIVE_VERIFY ${JSON.stringify(entry)}`); };
const safe = text => text.replaceAll(password, '[redacted]').replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/g, value => { try { const u = new URL(value); return u.origin === base ? `${u.origin}${u.pathname}` : '[external URL omitted]'; } catch { return '[URL omitted]'; } }).replace(/[A-Za-z0-9_+=./-]{160,}/g, '[opaque value omitted]');
const sql = createSqlClient(process.env.DATABASE_URL, { max: 2 });
const db = createDb(sql);
const runs = new DrizzleRunRepository(db);
let browser, context, page, watch, userId, seeded = false, signedIn = false;
const surface = async (p, name) => {
  const text = safe(await p.locator('body').innerText());
  writeFileSync(`${out}/${name}.txt`, text);
  // The application supplies credential-masked workspace frames. Never capture sign-in.
  if (signedIn && new URL(p.url()).origin === base && !/sign.?in|login/.test(new URL(p.url()).pathname)) {
    await p.screenshot({ path: `${out}/${name}.png`, fullPage: false, mask: [p.locator('input[type="password"]')] });
  }
  return text;
};
const loadedImages = async p => p.locator('img').evaluateAll(imgs => imgs.filter(img => img.complete && img.naturalWidth > 200 && img.naturalHeight > 120).map(img => ({ alt: img.alt, width: img.naturalWidth, height: img.naturalHeight, route: (() => { try { return new URL(img.currentSrc).pathname; } catch { return 'inline'; } })() })));
try {
  const original = await runs.findRun(predecessor);
  if (!original || !['INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'].includes(original.state)) throw new Error('Predecessor is not a stopped Run');
  const version = await new DrizzleProcedureRepository(db).findVersion(original.versionId);
  const origins = [];
  const walk = value => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (key === 'allowedOrigins' && Array.isArray(child)) origins.push(...child); else walk(child); } };
  walk(version?.compiledPlan);
  if (!origins.length || origins.some(origin => new URL(origin).hostname !== 'northstar-production-b312.up.railway.app')) throw new Error('Target safety preflight refused');
  emit('synthetic-preflight-passed', { procedure: original.procedureName, period: original.period, allowedTargetCount: origins.length });
  execFileSync(process.execPath, ['scripts/seed-identity.mts', '--email', email, '--name', 'Live Verification Auditor', '--role', 'auditor', '--create-only', 'true'], { env: { ...process.env, SEED_PASSWORD: password, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: 'https://seed.invalid' }, stdio: 'pipe' });
  seeded = true;
  userId = await findUserIdByEmail(db, email);
  if (!userId) throw new Error('Created user could not be found');
  emit('isolated-auditor-created');
  browser = await chromium.launch({ headless: true, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/secret|password|token|api.?key|database/i.test(key))) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(url => !/sign.?in|login/.test(url.pathname), { timeout: 30000 });
  await page.getByText('Live Verification Auditor', { exact: false }).first().waitFor();
  signedIn = true;
  emit('live-ui-sign-in-passed');
  await surface(page, '01-overview');
  await page.goto(`${base}/runs/${predecessor}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#run-lifecycle[data-client-ready="true"]').waitFor();
  await surface(page, '02-predecessor');
  // These are the actual UI controls, not a direct Run insert or application command call.
  await page.getByRole('button', { name: 'Rerun', exact: true }).click();
  await page.getByRole('button', { name: 'Start the new Run', exact: true }).click();
  const linked = page.getByRole('link', { name: 'Open the linked Run', exact: true });
  await linked.waitFor({ timeout: 45000 });
  const href = await linked.getAttribute('href');
  const match = href?.match(/^\/runs\/([0-9a-f-]{36})$/);
  if (!match || match[1] === predecessor) throw new Error('New Run acknowledgement missing');
  report.runId = match[1];
  emit('live-run-created-through-ui', { runId: report.runId });
  await linked.click();
  await page.waitForURL(`${base}/runs/${report.runId}`);
  await surface(page, '03-new-run');
  const deadline = Date.now() + 10 * 60 * 1000;
  let n = 0, lastState = '', lastImages = '', captures = 0;
  while (Date.now() < deadline) {
    const row = await runs.findRun(report.runId);
    if (!row) throw new Error('Created Run disappeared');
    if (row.initiatorId !== userId || row.predecessorRunId !== predecessor) throw new Error('Run attribution mismatch');
    if (row.state !== lastState) { emit('persisted-lifecycle', { state: row.state }); lastState = row.state; }
    if (!watch && row.state !== 'QUEUED') {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const link = page.getByRole('link', { name: 'Watch', exact: true });
      if (await link.count()) {
        const watchHref = await link.getAttribute('href');
        if (watchHref !== `/runs/${report.runId}/live`) throw new Error('Watch destination mismatch');
        watch = await context.newPage();
        watch.on('response', async response => {
          try {
            const url = new URL(response.url());
            const mime = response.headers()['content-type'] || '';
            if (url.origin === base && mime.startsWith('image/') && /api|evidence|frame|asset/.test(url.pathname)) {
              const bytes = await response.body();
              const frame = { at: new Date().toISOString(), path: url.pathname, status: response.status(), mime, bytes: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') };
              report.images.push(frame); emit('workspace-image-response', { status: frame.status, mime, bytes: frame.bytes, digest: frame.digest });
            }
          } catch { /* A stopped response is not a frame. */ }
        });
        await watch.goto(`${base}${watchHref}`, { waitUntil: 'domcontentloaded' });
        await surface(watch, '04-watch-opened');
        emit('watch-opened-through-displayed-link');
      }
    }
    if (watch) {
      const images = await loadedImages(watch);
      const signature = JSON.stringify(images) + report.images.length;
      if (signature !== lastImages || (n % 4 === 0 && captures < 6)) {
        await surface(watch, `05-watch-${String(captures).padStart(2, '0')}`);
        emit('watch-observed', { state: row.state, loadedImages: images.map(image => ({ ...image, route: safe(image.route) })) });
        captures++; lastImages = signature;
      }
    }
    if (!['QUEUED', 'RUNNING', 'AWAITING_AUDITOR', 'PAUSED'].includes(row.state)) { report.terminalState = row.state; break; }
    if (row.state === 'AWAITING_AUDITOR' || row.state === 'PAUSED') { report.humanInputRequired = row.state; break; }
    await new Promise(resolve => setTimeout(resolve, 10000)); n++;
  }
  if (!report.terminalState && !report.humanInputRequired) report.observationDeadlineReached = true;
  await page.goto(`${base}/runs/${report.runId}`, { waitUntil: 'domcontentloaded' });
  await surface(page, '06-result');
  const detail = new DrizzleRunDetailRepository(db);
  const result = await detail.readResult(report.runId);
  const population = await new PostgresPopulationRepository(db).readPopulation(report.runId);
  const workspace = await sql`SELECT status, mode, attempts, length(workspace_id)::int AS identity_length, diagnostic FROM run_workspace WHERE run_id = ${report.runId}::uuid`;
  report.workspace = workspace[0] ?? null;
  report.stop = await new DrizzleRunStopReader(db).readStop(report.runId);
  report.population = population?.summary ?? null;
  report.coverage = result?.publication?.coverage ?? null;
  report.outcome = result?.outcome ?? null;
  report.sealed = result?.sealed ?? null;
  for (const [tab, label] of [['timeline','Execution Timeline'], ['evidence','Evidence']]) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL(`${base}/runs/${report.runId}/${tab}`);
    await surface(page, `07-${tab}`);
  }
  if (report.terminalState) {
    await page.getByRole('link', { name: 'Replay', exact: true }).click();
    await page.waitForURL(`${base}/runs/${report.runId}/replay`);
    await page.waitForTimeout(3000);
    await surface(page, '08-replay');
    report.replayImages = await loadedImages(page);
    emit('replay-opened', { loadedImages: report.replayImages });
    const play = page.getByRole('button', { name: /^play(?: replay)?$/i });
    if (await play.count() === 1 && await play.isEnabled()) {
      await play.click(); await page.waitForTimeout(5000);
      await surface(page, '09-replay-playing'); report.replayPlaybackClicked = true;
    }
  }
} catch (error) {
  // Raw exceptions may contain password inputs, database parameters or provider URLs.
  report.failures.push({ name: error?.name || 'Error', stage: report.observations.at(-1)?.event || 'preflight' });
  emit('verification-stopped', report.failures.at(-1));
  if (signedIn && page) await surface(page, '99-stopped-surface').catch(() => {});
  process.exitCode = 1;
} finally {
  if (signedIn && page) {
    const signOut = page.getByRole('button', { name: /sign out/i });
    if (await signOut.count().catch(() => 0) === 1) await signOut.click().catch(() => {});
  }
  await browser?.close().catch(() => {});
  if (seeded) {
    try {
      const createdId = await findUserIdByEmail(db, email);
      if (createdId && (!userId || createdId === userId)) {
        // Remove only the role created for this test. Preserve the named actor/history.
        await sql`DELETE FROM user_role WHERE user_id = ${createdId} AND role = 'auditor'`;
        report.temporaryRoleRemoved = true;
      }
    } catch { report.temporaryRoleRemoved = false; }
  }
  await sql.end({ timeout: 5 }).catch(() => {});
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${out}/report.json`, safe(JSON.stringify(report, null, 2)));
  console.log(`LIVE_VERIFY_REPORT ${safe(JSON.stringify(report))}`);
}
