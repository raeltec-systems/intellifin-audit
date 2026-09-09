/**
 * Live-provider validation for the Solari Agent Workspace: creation, reachability,
 * capture, release. Diagnostic only — on no shipped path, and nothing imports it.
 *
 * WHY THIS EXISTS, given that `epic-4-browser-provider-decision.md` first argued against a
 * bespoke script. That argument was about a DIFFERENT question. The worker's own
 * `Agent Workspace mode selected` line answers "which mode is this deployment configured
 * for", and the composition root is rightly the only honest place to ask it. It cannot
 * answer "does the configured provider actually work", because a worker with a key logs
 * `mode: solari` whether or not the gateway ever accepts it. Those two are the distinction
 * the owner asked for, and only the second needs a probe.
 *
 * It exercises exactly the four things the review named, in order, and nothing else:
 *   1. remote session creation      sessions.create()
 *   2. target reachability          a real navigation from the remote browser
 *   3. capture                      a screenshot and a DOM read (what Story 4.4 needs)
 *   4. release                      releaseAndWait, then solari.close()
 *
 * Options are the ones the platform ships: stealth, proxy and captcha OFF, no profile.
 * A probe run under different options would prove a configuration no Run ever uses.
 *
 * The key is read from the environment and never printed. Nothing here writes to the
 * database, the audit chain or the object store.
 *
 *   cd packages/infrastructure && node scripts/probe-solari.mjs
 *
 * Exits non-zero when any step fails, including the release: a harness that reports FAIL
 * and exits 0 turns a failing check into an all-clear, which this repository has been
 * bitten by once already.
 */
import { Solari, SolariError } from '@solarisdk/browser';
import { chromium } from 'playwright-core';

const KEY = process.env.SOLARI_API_KEY;
if (!KEY) {
  console.log('FAIL  no SOLARI_API_KEY in the environment');
  process.exit(1);
}

let failed = false;
const say = (step, ok, detail) => {
  if (!ok) failed = true;
  console.log(`${ok ? '  ok' : 'FAIL'}  ${step.padEnd(26)} ${detail}`);
};
/** A measurement, not an assertion: it reports what happened and never fails the run. */
const note = (step, detail) => console.log(`  ??  ${step.padEnd(26)} ${detail}`);

const solari = new Solari({ apiKey: KEY });
let session = null;
let browser = null;
try {
  const startedAt = Date.now();
  session = await solari.sessions.create({});
  say('remote session created', true, `id ${session.id}, ${Date.now() - startedAt} ms`);
  // A hard provider deadline, not an idle window: the session auto-releases at it.
  say('plan deadline', typeof session.expiresAt === 'string', `expiresAt ${session.expiresAt}`);

  browser = await chromium.connect(session.wsEndpoint);
  say('wire protocol connected', true, browser.version());

  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();

  // 1. A PUBLIC target: does the remote browser reach anything at all?
  const response = await page.goto('https://example.com', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  say(
    'public target reachable',
    !!response && response.ok(),
    `example.com -> ${response?.status()} ${JSON.stringify(await page.title())}`,
  );

  // 2. CAPTURE: the two mechanisms Story 4.4 builds on.
  const shot = await page.screenshot({ type: 'png' });
  say('screenshot captured', shot.length > 1000, `${shot.length} bytes png`);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 40));
  say('DOM read captured', text.length > 0, JSON.stringify(text));

  // 3. The SYNTHETIC target. It is served on THIS machine's loopback, so a browser running
  //    in the provider's infrastructure cannot reach it, and that is a fact about where the
  //    fixture lives rather than a defect. Measured, never asserted: it is the boundary of
  //    what this probe can prove, and the reason the golden journeys stay on local Chromium.
  let loopback;
  try {
    const local = await page.goto('http://localhost:4300/loancore', {
      waitUntil: 'domcontentloaded',
      timeout: 8_000,
    });
    loopback = `status ${local?.status()}`;
  } catch (error) {
    loopback = (error?.message ?? String(error)).split('\n')[0].slice(0, 90);
  }
  note('synthetic on loopback', loopback);
} catch (error) {
  if (error instanceof SolariError) {
    // An entitlement refusal and an outage are different answers; the code says which.
    say('gateway', false, `${error.code ?? 'unknown'}: ${error.message}`);
  } else {
    say('probe', false, (error?.message ?? String(error)).split('\n')[0]);
  }
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (session) {
    try {
      await solari.sessions.releaseAndWait(session.id);
      say('session released', true, 'releaseAndWait confirmed');
    } catch (error) {
      // A release that fails leaks a provider-side session, so it is a failure of the run.
      say('session released', false, (error?.message ?? String(error)).split('\n')[0]);
    }
  }
  // REQUIRED in Node: the client holds a loopback proxy server open for its retry path,
  // and that handle keeps the event loop alive. Without it this process never exits.
  await solari.close();
  console.log('  ok  client closed');
}

process.exit(failed ? 1 : 0);
