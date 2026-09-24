import { expect, type Locator, type Page } from '@playwright/test';
import { RUN_CONTROL_LEASE_ACQUIRED_EVENT, RUN_CONTROL_LEASE_RENEWED_EVENT } from '@intellifin/application';

const HOLDS_CONTROL = 'You control this Run.';

/**
 * Acquires Run control through the "Run controller" region, and waits until it says so.
 *
 * Every control read (the page's first read, a live event's re-read, a renewal, the read
 * after a Release) puts the controller in "checking" for a moment, and a click that lands
 * then is refused, as every `aria-disabled` control refuses one. CI met it once: a click
 * right after Release reached no server action at all. The click is made only on an
 * enabled Acquire control, and made again only while the region does not yet say this
 * page holds control. A repeated acquire can never move the lease twice: the server
 * refuses it as `stale-epoch` or `held`.
 */
export async function acquireControl(controller: Locator): Promise<void> {
  const enabled = controller.page().locator(':not([aria-disabled="true"])');
  await expect(async () => {
    if (!((await controller.textContent()) ?? '').includes(HOLDS_CONTROL)) {
      await controller.getByRole('button', { name: 'Acquire control', exact: true }).and(enabled).click({ timeout: 5_000 });
    }
    await expect(controller).toContainText(HOLDS_CONTROL, { timeout: 10_000 });
  }).toPass({ timeout: 45_000 });
}

/**
 * Opens the Resume confirmation and confirms it, on a page that already holds control.
 *
 * Acquiring control starts a live refresh, and every renewal re-reads control again.
 * While a read settles, the opener and the dialog's confirm are `aria-disabled`, which is
 * focusable, so a click that lands in that moment is refused rather than delivered
 * anywhere. Each control is resolved only while it is enabled, and clicked again only
 * while its effect is still absent: the opener until the dialog shows, the confirm until
 * the dialog is gone. CI met the refused opener click once, in `live-escalation.spec.ts`.
 * The command itself is not retried: a confirm that was accepted is busy, so it is
 * `aria-disabled` until its answer arrives and the dialog closes.
 */
export async function resumeWithControl(page: Page): Promise<void> {
  const enabled = page.locator(':not([aria-disabled="true"])');
  const dialog = page.getByRole('dialog', { name: 'Resume this Run?', exact: true });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: 'Resume', exact: true }).and(enabled).click({ timeout: 5_000 });
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(async () => {
    if (await dialog.isVisible()) {
      await dialog.getByRole('button', { name: 'Resume Run', exact: true }).and(enabled).click({ timeout: 5_000 });
    }
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

/**
 * Compares a Run's event types with `expected`, in order, with controller lease renewals
 * set apart. A page that holds control renews every 30 seconds and each renewal is an
 * event on the Run's chain, so how many land depends only on how long the steps before
 * took. A renewal may only follow the acquisition; every other event is compared exactly.
 */
export function expectRunEvents(types: readonly string[], expected: readonly string[]): void {
  const acquiredAt = types.indexOf(RUN_CONTROL_LEASE_ACQUIRED_EVENT);
  const early = types.findIndex((type, index) =>
    type === RUN_CONTROL_LEASE_RENEWED_EVENT && (acquiredAt < 0 || index < acquiredAt));
  expect(early, 'a control lease renewal before the acquisition').toBe(-1);
  expect(types.filter(type => type !== RUN_CONTROL_LEASE_RENEWED_EVENT)).toEqual(expected);
}
