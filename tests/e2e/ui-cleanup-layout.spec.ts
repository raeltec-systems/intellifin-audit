import { mkdirSync } from 'node:fs';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { GATE_CHECKS } from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  PostgresProceduresUnitOfWork,
  type Sql,
} from '@intellifin/infrastructure';

import { activeRunVersion } from '../fixtures/active-run-version';
import { ACCOUNTS, AUTH_STATE, assertThrowawayDatabase, signIn } from './accounts';

/**
 * The UI cleanup's release checks (package 7 of the 21 September 2026 plan).
 *
 * Every ordinary surface, as each of the three roles, at the two laptop sizes the plan
 * names: no page-level horizontal scrolling, a level-one heading, no WCAG 2.1 AA violation,
 * a keyboard walk whose stops are sized, on screen and ringed, and a screenshot per state
 * so the before/after can be read by a person. The seed is the
 * `run-surfaces.spec.ts` shape — one Active Procedure, a Completed Run with a finding and
 * an Inconclusive one — because those are the surfaces the walkthrough measured.
 *
 * Screenshots default to `test-results/ui-cleanup/`; point `UI_CLEANUP_SCREENSHOTS` at a
 * folder to keep a curated set.
 */

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
] as const;

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SHOTS = process.env['UI_CLEANUP_SCREENSHOTS'] ?? path.join('test-results', 'ui-cleanup');

const ids = new CryptoUuidV7Generator();
const procedureId = ids.next();
const versionId = ids.next();
const controlName = `UI cleanup layout ${procedureId.slice(-8)}`;
const runs = { completed: ids.next(), inconclusive: ids.next() };
let sql: Sql;
let auditorId: string;

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

/** Pixels the document is wider than the viewport. Zero is the only acceptable answer. */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth, document.body.scrollWidth - root.clientWidth);
  });
}

async function checkSurface(page: Page, route: string, slug: string, role: string, viewport: { width: number; height: number }): Promise<void> {
  await page.goto(route);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Streams settle before the measurements: a Suspense fallback is not the page.
  await page.waitForLoadState('networkidle');
  expect(await pageOverflow(page), `${route} scrolls the page sideways at ${viewport.width}px`).toBe(0);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${role}-${slug}-${viewport.width}x${viewport.height}.png`), fullPage: false });
  await scan(page);
  await keyboardWalk(page, route, viewport);
}

/**
 * The first stops a keyboard user meets, from the top of the page. Each one has to be a
 * real, sized element, inside the viewport's width once the browser has scrolled it into
 * view, and drawn with a focus ring. The first stop is the skip link, because the shell
 * promises one. A page with fewer stops ends the walk when focus leaves the document, or
 * reaches the development server's overlay, which is not part of the product.
 */
const KEYBOARD_STOPS = 14;

async function keyboardWalk(page: Page, route: string, viewport: { width: number; height: number }): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  for (let stop = 1; stop <= KEYBOARD_STOPS; stop += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body || element === document.documentElement) return null;
      // `next dev`'s own overlay is appended after the page and is not the product: reaching
      // it means every stop the page itself offers has been walked.
      if (element.tagName.toLowerCase() === 'nextjs-portal') return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        name: `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}${element.getAttribute('type') === null ? '' : `[type=${element.getAttribute('type')}]`} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48)}"${element.matches(':focus-visible') ? '' : ' (not :focus-visible)'} outline=${style.outlineStyle} ${style.outlineWidth}`,
        left: box.left,
        right: box.right,
        area: box.width * box.height,
        ring: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0,
      };
    });
    if (focus === null) break;
    if (stop === 1) expect(focus.name, `${route}: the first Tab stop is the skip link`).toContain('Skip to content');
    expect(focus.area, `${route}: Tab stop ${stop} (${focus.name}) has no size`).toBeGreaterThan(0);
    expect(focus.left, `${route}: Tab stop ${stop} (${focus.name}) starts left of the viewport`).toBeGreaterThanOrEqual(-1);
    expect(focus.right, `${route}: Tab stop ${stop} (${focus.name}) ends past the viewport`).toBeLessThanOrEqual(viewport.width + 1);
    expect(focus.ring, `${route}: Tab stop ${stop} (${focus.name}) shows no focus ring`).toBe(true);
  }
}

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the UI cleanup layout checks.');
  assertThrowawayDatabase(databaseUrl);
  sql = createSqlClient(databaseUrl, { max: 4 });
  const db = createDb(sql);
  const [auditor] = await sql`SELECT id FROM auth_user WHERE email=${ACCOUNTS.auditor.email}`;
  if (!auditor) throw new Error('Seed the E2E Auditor before the UI cleanup layout checks.');
  auditorId = auditor.id as string;
  const row = { ...activeRunVersion(procedureId, versionId, auditorId), controlName };
  await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
    await context.procedures.insertProcedure(row);
    await context.procedures.insertVersion(row);
  });
  await seedRun(runs.completed, '2026-08-01', '2026-08-31', '2026-09-01T09:00:00Z');
  await terminate(runs.completed, 'COMPLETED', '2026-09-01T09:03:41Z');
  await seedRun(runs.inconclusive, '2026-07-01', '2026-07-31', '2026-09-02T09:00:00Z');
  for (const [index, check] of GATE_CHECKS.entries()) {
    const failed = check === 'per-record-coverage';
    await sql`INSERT INTO run_gate_check(run_id,check_name,outcome,diagnostics,target_systems,work_items,records,total,decided_at)
              VALUES(${runs.inconclusive},${check},${failed ? 'FAIL' : 'PASS'},
                ${failed ? '["record-uninspected"]' : '[]'}::jsonb,
                ${failed ? '["accessgate"]' : '[]'}::jsonb,'[]'::jsonb,
                ${failed ? '["E-001"]' : '[]'}::jsonb,${failed ? 3 : 0},
                ${`2026-09-02T09:0${String(index % 10)}:00Z`})`;
  }
  await terminate(runs.inconclusive, 'INCONCLUSIVE', '2026-09-02T09:05:00Z');
});

async function seedRun(runId: string, from: string, to: string, at: string): Promise<void> {
  await sql`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,
              period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
            VALUES(${ids.next()},${runId},${ids.next()},${procedureId},${versionId},1,${controlName},
              ${from},${to},'QUEUED','STANDARD',${auditorId},'fixture','auditor',${at})`;
}

async function terminate(runId: string, state: 'COMPLETED' | 'INCONCLUSIVE', at: string): Promise<void> {
  const outcome = state === 'COMPLETED' ? 'PASS' : 'INCONCLUSIVE';
  const outcomeRow = state === 'COMPLETED' ? 'pass' : 'gate-failed';
  const publication = JSON.stringify({
    templateId: 'P-1',
    controlName,
    scope: null,
    period: { from: '2026-08-01', to: '2026-08-31' },
    population: { rowsParsed: 10, included: 8, excluded: 2, indeterminate: 0 },
    exclusions: [{ reason: 'termination_effective_date is outside the Period', total: 2, records: ['#9', '#10'] }],
    coverage: [{ targetSystem: 'accessgate', inspected: 7, uninspected: 1, records: ['E-009'] }],
    conditions: [{ conditionId: 'C1', origin: 'RULE', confirmation: null, value: 'COMPLIANT', total: 7 }],
    exceptions: { total: 0, records: [] },
    unevaluated: { total: 0, records: [] },
    controlFields: ['account_status'],
    gate: { passed: state === 'COMPLETED', checks: GATE_CHECKS.length, failed: [] },
    evidence: { state: 'SEALED', requiredTotal: 1, registered: 1, missingRequired: 0, abandoned: 0 },
    statement: state === 'COMPLETED'
      ? 'Every condition on every inspected record is Compliant.'
      : 'The Evidence does not support a conclusion.',
  });
  await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
            VALUES(${runId},'SEALED',${state},${at},0,0,'[]'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
            VALUES(${runId},1,${outcome},${outcomeRow},true,${state},${state === 'COMPLETED'},${at},
              'Every account of every employee terminated in the period.',${publication}::jsonb)`;
  await sql`UPDATE audit_run SET state=${state} WHERE run_id=${runId}`;
}

test.afterAll(async () => {
  if (!sql) return;
  try {
    for (const runId of Object.values(runs)) {
      await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
      await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
      await sql`DELETE FROM run_result WHERE run_id=${runId}`;
      await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
      await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
    }
    await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
    await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.describe('as an Auditor', () => {
      test.use({ storageState: AUTH_STATE.auditor });

      test('every ordinary surface fits the viewport and passes the accessibility gate', async ({ page }) => {
        test.setTimeout(240_000);
        const surfaces: readonly [string, string][] = [
          ['/', 'overview'],
          ['/procedures', 'procedures'],
          ['/procedures/new', 'new-procedure'],
          [`/procedures/${procedureId}`, 'procedure'],
          ['/runs', 'runs'],
          [`/runs/${runs.completed}`, 'run-result'],
          [`/runs/${runs.completed}/evidence`, 'run-evidence'],
          [`/runs/${runs.completed}/exceptions`, 'run-exceptions'],
          [`/runs/${runs.completed}/review`, 'run-review'],
          [`/runs/${runs.completed}/timeline`, 'run-timeline'],
          [`/runs/${runs.completed}/replay`, 'run-replay'],
          [`/runs/${runs.inconclusive}`, 'run-inconclusive'],
          ['/review', 'reviews'],
          ['/notifications', 'notifications'],
        ];
        for (const [route, slug] of surfaces) {
          await checkSurface(page, route, slug, 'auditor', viewport);
        }
      });
    });

    test.describe('as a PoC Administrator', () => {
      test.use({ storageState: AUTH_STATE.administrator });

      test('the administration surfaces fit the viewport and pass the accessibility gate', async ({ page }) => {
        test.setTimeout(120_000);
        for (const [route, slug] of [
          ['/', 'overview'],
          ['/administration', 'administration'],
          ['/administration/sources', 'sources'],
          ['/administration/registrations', 'systems'],
        ] as const) {
          await checkSurface(page, route, slug, 'administrator', viewport);
        }
      });
    });

    test.describe('as an Audit Manager', () => {
      // No saved state for this role: `auth.setup.ts` signs in two roles, and the manager
      // signs in here through the real form. Required, never skipped — a skipped role
      // would read as a checked one.
      test.use({ storageState: { cookies: [], origins: [] } });

      test('the review and approval surfaces fit the viewport and pass the accessibility gate', async ({ page }) => {
        test.setTimeout(180_000);
        const managerEmail = process.env['E2E_MANAGER_EMAIL'];
        if (!managerEmail) throw new Error('E2E_MANAGER_EMAIL is required for the Audit Manager layout checks.');
        await signIn(page, managerEmail);
        for (const [route, slug] of [
          ['/', 'overview'],
          ['/review', 'reviews'],
          ['/review/results', 'reviews-results'],
          [`/procedures/${procedureId}/versions/${versionId}`, 'version-review'],
          ['/runs', 'runs'],
          [`/runs/${runs.completed}`, 'run-result'],
          ['/notifications', 'notifications'],
        ] as const) {
          await checkSurface(page, route, slug, 'manager', viewport);
        }
      });
    });
  });
}
