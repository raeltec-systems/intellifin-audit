/**
 * Whether a Timeline event re-reads a Run surface (Story 10.7 review).
 *
 * Every append to a Run's chain wakes the live channel (`appendAuditEvent`), and the Run
 * surfaces re-read themselves on it: Run Detail and the Runs list through
 * `SurfaceLiveBanner`, Live View and the Auditor Workspace through `LiveGate`. Three
 * families reach the channel and change nothing any of those surfaces renders:
 *
 * - `evidence-access.*`: a read grant decided by the worker, a read recorded by the web.
 *   Reading is what the Evidence inspector does on every render and what the frame route
 *   does for every frame it serves from storage (not for a 304), and each read appends
 *   two of these events to the Run's OWN chain. A surface that re-read on them would
 *   re-read itself: the inspector for as long as it is open on an active Run, two
 *   permanent chain events and one worker grant job per re-read, about once a second.
 * - `notification.*`: a delivery recorded by the worker. The Notifications page lists
 *   delivered rows, but it is not one of these surfaces: it is re-read on navigation and
 *   through the bell, whose own filter (`changesOpenWaits` in `shell/BellLive.tsx`) has
 *   never admitted a delivery.
 * - `security.denied`: a person refused an action. No surface renders it.
 *
 * Checked by searching `apps/web` for the three names and by reading every chain reader a
 * surface uses (`run-detail-repository.ts`, `run-stop-repository.ts`, the conversation
 * and wait repositories): each selects its own event types, and none of these.
 *
 * `security.action-denied` is NOT one of them: the Timeline renders a denied Tool Action.
 * This is an exclusion list and not an allowlist, so a family added later re-reads every
 * surface by default: a page one change short is the failure the channel exists to
 * prevent, and an unnecessary re-read is only a re-read. The stream still carries all
 * three families; only the re-read skips them.
 */
const INTERNAL_FAMILIES = ['evidence-access.', 'notification.'] as const;
const INTERNAL_EVENTS = ['security.denied'] as const;

export function refreshesSurface(eventType: string): boolean {
  if (INTERNAL_FAMILIES.some((family) => eventType.startsWith(family))) return false;
  return !INTERNAL_EVENTS.some((internal) => eventType === internal);
}
