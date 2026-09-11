import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { DRAFT_SECTION_HEADINGS } from '@intellifin/domain';

import { isTemplateOnly } from '../../apps/web/src/design/plain-words';

/** Keep named PNG files as well as report attachments. Body-only attachments receive
 * opaque report names, which prevents a remote reviewer selecting the actual captures. */
export async function attachAuthoringScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/**
 * The Builder's steps, in order — every section the domain declares except the two the
 * Template writes. DERIVED, so a section added to `DRAFT_SECTION_HEADINGS` is a step the
 * suite checks for rather than one it silently stops knowing about.
 */
export const BUILDER_STEPS = DRAFT_SECTION_HEADINGS.filter(
  (heading) => !isTemplateOnly(heading),
);

/** Open a section after the guided editor has hydrated. Its native links remain
 * usable before hydration; these tests need the interactive focused layout. */
export const PREPARATION_STEP_FOR_HEADING: Readonly<Record<string, string>> = {
  'Risk': 'context', 'Control': 'context', 'Objective': 'context', 'Criterion reference': 'context',
  'Period and scope': 'scope', 'Population Source binding': 'evidence', 'Target System selection': 'evidence',
  'Audit Instructions': 'instructions', 'Compliance Rule conditions': 'assessment', 'Evidence Requirements': 'evidence', 'Schedule': 'frequency',
};
export async function openStep(page: Page | Locator, heading: string): Promise<void> {
  if (!Object.hasOwn(PREPARATION_STEP_FOR_HEADING, heading)) throw new Error('Unknown preparation section: ' + heading);
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();
  const section = PREPARATION_STEP_FOR_HEADING[heading]!;
  await page.locator(`[data-preparation-nav="${section}"]`).click();
  await expect(page.locator(`[data-preparation-panel="${section}"]`)).toBeVisible();
}

/**
 * Keep the BUILDER's disclosures open, for a spec whose subject is what is inside them.
 *
 * A hundred assertions in this suite are about the editors — a stale-tab conflict, a
 * lost save response, a compiled condition's badge — and were written when the Builder
 * rendered all nine sections at once. Making each of them click a disclosure open first
 * would test the disclosure a hundred times and the editors no better.
 *
 * So the disclosure gets its own test instead (`builder-steps.spec.ts`), which runs
 * WITHOUT this and asserts the real thing: an answered step starts closed, still says
 * what is set in it, and opens on a click or on Enter.
 *
 * The selector names exactly the three disclosures the Builder owns and NOTHING else.
 * It began as a bare `details`, which also forced open the version-diff disclosures on
 * the review page — so `version-review.spec.ts`'s "every section is expanded on a first
 * version" passed whatever `VersionDiff`'s own `open` logic did. A helper that makes an
 * unrelated assertion unfailable is the defect this repository keeps finding, one layer
 * out from the product.
 *
 * This is a script in the TEST browser and changes nothing in the product. It runs on
 * every navigation and every reload, which is what makes it a single line per spec file
 * rather than a call beside every `goto`.
 */
const BUILDER_DISCLOSURES = [
  'details.ls-step', // a step
  '.ls-guided__editor details', // a "More options" or Template-default fold inside one
  'details[data-plan-detail]', // the Builder's own compiled-plan fold
].join(', ');

export async function keepBuilderStepsOpen(page: Page): Promise<void> {
  // On the CONTEXT, not the page: version-review races a Draft against itself in a
  // second tab opened from this context, and a page-level script would not reach it.
  await page.context().addInitScript((selector: string) => {
    const open = (): void => {
      // Do not mutate server-rendered markup while React is hydrating it.
      if (!document.querySelector('[data-guided-ready="true"]')) return;
      // Editor-contract tests deliberately expose each mounted panel. The dedicated
      // guided journey and owner walkthrough use real navigation WITHOUT this helper.
      for (const panel of document.querySelectorAll<HTMLElement>('[data-preparation-panel]')) {
        if (panel.hidden) panel.hidden = false;
      }
      for (const step of document.querySelectorAll<HTMLDetailsElement>(selector)) {
        if (!step.open) step.open = true;
      }
    };
    const start = (): void => {
      open();
      new MutationObserver(open).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'data-guided-ready'],
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }, BUILDER_DISCLOSURES);
}

/**
 * Open the fold that holds the compiled plan and the agent summary.
 *
 * They are the platform proving what it will execute — worth reading, and the wrong
 * thing for an auditor to meet before they have answered a single question — so the
 * Builder keeps them one fold down.
 */
export async function openPlanDetail(page: Page | Locator): Promise<void> {
  await expect(page.locator('[data-guided-ready="true"]')).toBeVisible();
  await page.locator('[data-preparation-nav="review"]').click();
  const detail = page.locator('[data-plan-detail]');
  await detail.waitFor({ state: 'attached' });
  if (await detail.evaluate((node) => (node as HTMLDetailsElement).open)) return;
  await detail.locator('summary').first().click();
  await expect(detail).toHaveJSProperty('open', true);
}
