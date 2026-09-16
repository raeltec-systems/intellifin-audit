import type { Role } from '@intellifin/domain';

import { roleLabel } from '../admin/roles';
// The one place a user id becomes a person's name, and the one rule for what to render
// when no name is known. A second copy here would be a second answer to that question.
import { ActorName } from '../runs/ActorName';

/**
 * The words in front of the identity line. The platform's own sentence fragment, not a
 * quotation from the UX contract, so it lives beside the surface rather than in
 * `copy.ts`.
 *
 * Visually hidden, not absent: sighted readers have the top bar's context — the line
 * sits against Sign out — while a screen reader meets "Dana Mwale, Auditor" with no
 * context at all unless something says what it is.
 */
export const SIGNED_IN_AS_LABEL = 'Signed in as';

/** Separates the person from the authority they hold, as every other line here does. */
const SEPARATOR = ' · ';

/**
 * Who is signed in, and what they are authorized to do (FR-1, FR-2).
 *
 * The owner opened production and found a shell that offered Sign out and never said
 * whose session it was ending. On a product built on attributable action that is a real
 * gap: an auditor and an Audit Manager use the same screens, the same Procedure and the
 * same buttons, and which of them is signed in decides whether Approve is theirs to
 * press. A person who cannot see which identity they hold cannot know why a control is
 * refused, and at a shared workstation cannot know whose name the next decision lands
 * against.
 *
 * The role is written in words through `roleLabel`, the same helper Administration uses,
 * so `audit-manager` is never printed at a reader — and an account with no `user_role`
 * row reads "No role", which is a state and never a default.
 *
 * It renders NOTHING when the identity could not be resolved. `currentIdentity`'s
 * `degraded` arm keeps the shell and drops the role, because a platform failure may
 * remove privilege and never the disclaimer; naming a person the server could not
 * identify would be the opposite — a label stating something the platform does not know.
 */
export function SignedInAs({
  userId,
  names,
  role,
}: {
  /** The session's user id, or `null` when the identity could not be resolved. */
  readonly userId: string | null;
  /** `ActorNameReader`'s answer. Empty when the name could not be read; the id then shows. */
  readonly names: ReadonlyMap<string, string>;
  readonly role: Role | null;
}): React.JSX.Element {
  if (userId === null) return <></>;
  return (
    <p className="ls-caption">
      <span className="ls-visually-hidden">{SIGNED_IN_AS_LABEL} </span>
      <ActorName id={userId} names={names} />
      {SEPARATOR}
      {roleLabel(role)}
    </p>
  );
}
