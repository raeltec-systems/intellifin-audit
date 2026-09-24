import { authorizeActionRole, type Role } from '@intellifin/domain';
import type { SessionSnapshot } from '@intellifin/application';
import {
  DrizzlePendingResultReader,
  DrizzleSubmittedVersionReader,
  type PendingResultPage,
  type SubmittedVersionPage,
} from '@intellifin/infrastructure';

import { getRuntime } from '../bootstrap';

/**
 * What a role is waiting on, read once and shared by every surface that says it
 * (UI cleanup 2026-09-22, UX-01, UX-30, UX-35, UX-36, and the sidebar counts).
 *
 * The Overview's attention list, the Reviews area's two tabs and the sidebar's Reviews
 * count all answer the same question about the same person. Three call sites reading the
 * repositories directly would be three chances to apply the role rule differently, and
 * the failure mode is a sidebar badge counting work the page it leads to does not show.
 *
 * `null` means the READ FAILED and is never an absence. `AWAITING_AUDITOR` and
 * `PENDING_CONFIRMATION` both mean the platform is holding on a person, so a surface that
 * rendered nothing would tell that person it is simply quiet — the rule Story 5.6 landed
 * on `OpenEscalationSection` and the Overview met again one surface along.
 */

/** A read that can fail without the surface being allowed to call it empty. */
export type Unreadable<T> = T | null;

export interface ReviewQueues {
  /** Procedure Versions in SUBMITTED. Empty for a role that neither submits nor approves. */
  readonly versions: Unreadable<SubmittedVersionPage>;
  /** Runs whose Result is unsealed and waiting for this person. */
  readonly pending: Unreadable<PendingResultPage>;
}

/** Whether this role may approve a submitted Procedure Version at all. */
export function maySeeApprovalQueue(role: Role): boolean {
  return authorizeActionRole(role, 'procedure.version.approve').allowed;
}

/** Whether this role authors Procedures, and so has versions of their own in flight. */
export function maySubmitVersions(role: Role): boolean {
  return authorizeActionRole(role, 'procedure.version.submit').allowed;
}

/** Whether this role confirms the agent's assessments. */
export function mayConfirmAssessments(role: Role): boolean {
  return authorizeActionRole(role, 'evaluation.confirm').allowed;
}

/**
 * Both queues for one person, each read separately so one failure does not hide the other.
 *
 * The version read is role-level, not per version: whether THIS manager may approve a
 * PARTICULAR version is the author rule, applied where the decision is taken. A version
 * they wrote themselves is still waiting and is still listed — they need to know it is,
 * even though somebody else has to approve it.
 */
export async function readReviewQueues(
  session: SessionSnapshot,
  role: Role,
  limits: {
    readonly versions?: number;
    readonly pending?: number;
    /** `false` skips the version queue entirely, for a surface that does not show it. */
    readonly wantVersions?: boolean;
  } = {},
): Promise<ReviewQueues> {
  const runtime = await getRuntime();
  const decides = maySeeApprovalQueue(role);
  const wantsVersions =
    (limits.wantVersions ?? true) && (decides || maySubmitVersions(role));
  const [versions, pending] = await Promise.all([
    wantsVersions
      ? attempt(
          () =>
            // A manager is being asked to DECIDE, so they see the whole queue; an Auditor
            // is being told where their OWN work got to, so they see theirs. One read for
            // both would put every other auditor's version under a heading saying "yours".
            decides
              ? new DrizzleSubmittedVersionReader(runtime.db).listSubmitted(limits.versions)
              : new DrizzleSubmittedVersionReader(runtime.db).listSubmittedFor(
                  session.userId,
                  limits.versions,
                ),
          runtime,
        )
      : Promise.resolve<SubmittedVersionPage>({ rows: [], total: 0 }),
    mayConfirmAssessments(role)
      ? attempt(
          () =>
            new DrizzlePendingResultReader(runtime.db).listPendingResults(
              { userId: session.userId },
              limits.pending,
            ),
          runtime,
        )
      : Promise.resolve<PendingResultPage>({ rows: [], total: 0 }),
  ]);
  return { versions, pending };
}

/**
 * How many items are awaiting THIS person's review, for the sidebar's Reviews count.
 *
 * `undefined` is "not counted", which the sidebar shows as no count at all rather than as
 * a fabricated zero — EXPERIENCE.md's cold-load rule, and the same reading `countOpenFor`
 * already takes for the bell. A role with no review work of any kind gets `undefined` too:
 * a `0` beside the word Reviews is noise, and the surface itself says what an empty queue
 * does and does not mean.
 */
export async function countReviewsAwaiting(
  session: SessionSnapshot,
  role: Role,
): Promise<number | undefined> {
  const wantsVersions = maySeeApprovalQueue(role);
  const wantsPending = mayConfirmAssessments(role);
  if (!wantsVersions && !wantsPending) return undefined;
  const runtime = await getRuntime();
  try {
    // Two counts ADDED, never a join: a Procedure Version and a pending Result are
    // different things waiting, and a join would report their product.
    const [versions, pending] = await Promise.all([
      wantsVersions
        ? new DrizzleSubmittedVersionReader(runtime.db).listSubmitted(1).then((page) => page.total)
        : Promise.resolve(0),
      wantsPending
        ? new DrizzlePendingResultReader(runtime.db).countPendingResults({ userId: session.userId })
        : Promise.resolve(0),
    ]);
    return versions + pending;
  } catch (error) {
    // A missing count is not zero, and a failed read must not imply that nothing is
    // waiting for a decision.
    runtime.telemetry.captureError('Notification count could not be read', error, {
      outcome: 'failure',
    });
    return undefined;
  }
}

async function attempt<T>(
  read: () => Promise<T>,
  runtime: Awaited<ReturnType<typeof getRuntime>>,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    runtime.telemetry.captureError('Notification count could not be read', error, {
      outcome: 'failure',
    });
    return null;
  }
}
