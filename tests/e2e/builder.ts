import { expect, type Locator, type Page } from '@playwright/test';
import { DRAFT_SECTION_HEADINGS } from '@intellifin/domain';

import { isTemplateOnly } from '../../apps/web/src/design/plain-words';

/**
 * The Builder's steps, in order — every section the domain declares except the two the
 * Template writes. DERIVED, so a section added to `DRAFT_SECTION_HEADINGS` is a step the
 * suite checks for rather than one it silently stops knowing about.
 */
export const BUILDER_STEPS = DRAFT_SECTION_HEADINGS.filter(
  (heading) => !isTemplateOnly(heading),
);

/**
 * Open one Builder step, the way a person does.
 *
 * The Builder is a list of questions: each step states what is already set and keeps its
 * editor behind a native `<details>`, closed once the step has been answered. Opening
 * one that is already open would close it, so the state is read first. The element is
 * native, so this works before React hydrates as well as after.
 */
export async function openStep(page: Page | Locator, heading: string): Promise<void> {
  const step = page.locator(`[data-step="${heading}"]`);
  await step.waitFor({ state: 'attached' });
  if (await step.evaluate((node) => (node as HTMLDetailsElement).open)) return;
  await step.locator('summary.ls-step__summary').click();
  await expect(step).toHaveJSProperty('open', true);
}

/**
 * Keep every disclosure on the page open, for a spec whose subject is what is INSIDE them.
 *
 * A hundred assertions in this suite are about the editors — a stale-tab conflict, a
 * lost save response, a compiled condition's badge — and were written when the Builder
 * rendered all nine sections at once. Making each of them click a disclosure open first
 * would test the disclosure a hundred times and the editors no better.
 *
 * So the disclosure gets its own test instead (`procedures.spec.ts`, "the Builder opens
 * as a short list of questions"), which runs WITHOUT this and asserts the real thing: an
 * answered step starts closed, still says what is set in it, and opens on a click.
 *
 * This is a script in the TEST browser and changes nothing in the product. It runs on
 * every navigation and every reload, which is what makes it a single line per spec file
 * rather than a call beside every `goto`.
 */
export async function keepBuilderStepsOpen(page: Page): Promise<void> {
  // On the CONTEXT, not the page: version-review races a Draft against itself in a
  // second tab opened from this context, and a page-level script would not reach it.
  await page.context().addInitScript(() => {
    const open = (): void => {
      // Every `<details>`, not only `details.ls-step`: a step's "More options" fold is
      // itself a disclosure, and a spec that opens the step but not the fold reaches a
      // control it can see the label of and cannot click.
      for (const step of document.querySelectorAll<HTMLDetailsElement>('details')) {
        if (!step.open) step.open = true;
      }
    };
    const start = (): void => {
      open();
      new MutationObserver(open).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  });
}

/**
 * Open the fold that holds the compiled plan and the agent summary.
 *
 * They are the platform proving what it will execute — worth reading, and the wrong
 * thing for an auditor to meet before they have answered a single question — so the
 * Builder keeps them one fold down.
 */
export async function openPlanDetail(page: Page | Locator): Promise<void> {
  const detail = page.locator('[data-plan-detail]');
  await detail.waitFor({ state: 'attached' });
  if (await detail.evaluate((node) => (node as HTMLDetailsElement).open)) return;
  await detail.locator('summary').first().click();
  await expect(detail).toHaveJSProperty('open', true);
}
